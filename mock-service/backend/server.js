const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const Handlebars = require('handlebars');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mock_service';
const PORT = process.env.PORT || 3001;

// Store active mock servers
const mockServers = new Map();

// Register Handlebars helpers
Handlebars.registerHelper('now', () => new Date().toISOString());
Handlebars.registerHelper('timestamp', () => Date.now());
Handlebars.registerHelper('uuid', () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0;
  return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
}));
Handlebars.registerHelper('random', (min, max) => Math.floor(Math.random() * (max - min + 1)) + min);
Handlebars.registerHelper('json', obj => JSON.stringify(obj));
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('default', (value, defaultValue) => value || defaultValue);

// MongoDB Schemas
const webhookSchema = new mongoose.Schema({
  url: { type: String, required: true },
  method: { type: String, default: 'POST' },
  headers: { type: mongoose.Schema.Types.Mixed, default: {} },
  bodyTemplate: { type: String },
  delayMs: { type: Number, default: 0 },
  enabled: { type: Boolean, default: true }
}, { _id: false });

const responseSchema = new mongoose.Schema({
  statusCode: { type: Number, default: 200 },
  headers: { type: mongoose.Schema.Types.Mixed, default: { 'Content-Type': 'application/json' } },
  bodyTemplate: { type: String },
  body: { type: mongoose.Schema.Types.Mixed },
  delayMs: { type: Number, default: 0 },
  webhook: webhookSchema
}, { _id: false });

const stubSchema = new mongoose.Schema({
  name: { type: String },
  predicates: [mongoose.Schema.Types.Mixed],
  responses: [responseSchema],
  extractors: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const mockConfigSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  port: { type: Number, required: true, unique: true },
  protocol: { type: String, default: 'http' },
  enabled: { type: Boolean, default: true },
  defaultHeaders: { type: mongoose.Schema.Types.Mixed, default: {} },
  variables: { type: mongoose.Schema.Types.Mixed, default: {} },
  stubs: [stubSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

mockConfigSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const MockConfig = mongoose.model('MockConfig', mockConfigSchema);

// Process webhook with delay
async function processWebhook(webhook, context) {
  if (!webhook || !webhook.enabled || !webhook.url) return;

  setTimeout(async () => {
    try {
      let body = webhook.bodyTemplate ? JSON.parse(renderTemplate(webhook.bodyTemplate, context)) : null;
      const response = await axios({
        method: webhook.method || 'POST',
        url: webhook.url,
        headers: webhook.headers || {},
        data: body,
        timeout: 30000
      });
      console.log(`Webhook sent to ${webhook.url}: ${response.status}`);
    } catch (error) {
      console.error(`Webhook failed to ${webhook.url}:`, error.message);
    }
  }, webhook.delayMs || 0);
}

// Render Handlebars template
function renderTemplate(template, context) {
  try {
    const compiled = Handlebars.compile(template);
    return compiled(context);
  } catch (error) {
    console.error('Template error:', error.message);
    return JSON.stringify({ error: 'Template rendering failed', details: error.message });
  }
}

// Check if request matches predicate
function matchesPredicate(pred, method, path, body, query, headers) {
  if (pred.equals) {
    if (pred.equals.method && pred.equals.method.toUpperCase() !== method.toUpperCase()) return false;
    if (pred.equals.path && pred.equals.path !== path) return false;
  }
  if (pred.matches) {
    if (pred.matches.method && !new RegExp(pred.matches.method, 'i').test(method)) return false;
    if (pred.matches.path && !new RegExp(pred.matches.path).test(path)) return false;
  }
  if (pred.contains) {
    if (pred.contains.path && !path.includes(pred.contains.path)) return false;
    if (pred.contains.body && !JSON.stringify(body).includes(pred.contains.body)) return false;
  }
  return true;
}

// Create mock server for a port
function createMockServer(config) {
  const mockApp = express();
  mockApp.use(cors());
  mockApp.use(express.json({ limit: '10mb' }));

  // Handle all requests
  mockApp.all('*', async (req, res) => {
    try {
      // Reload config from DB to get latest
      const freshConfig = await MockConfig.findById(config._id);
      if (!freshConfig || !freshConfig.enabled) {
        return res.status(503).json({ error: 'Mock service disabled' });
      }

      const method = req.method;
      const path = req.path;
      const body = req.body;
      const query = req.query;
      const headers = req.headers;

      // Find matching stub
      let matchedStub = null;
      for (const stub of freshConfig.stubs) {
        const predicates = stub.predicates || [];
        let allMatch = true;

        for (const pred of predicates) {
          if (!matchesPredicate(pred, method, path, body, query, headers)) {
            allMatch = false;
            break;
          }
        }

        if (allMatch && predicates.length > 0) {
          matchedStub = stub;
          break;
        }
      }

      if (!matchedStub) {
        return res.status(404).json({
          error: 'No matching stub found',
          request: { method, path }
        });
      }

      const response = matchedStub.responses?.[0] || {};
      const extractors = matchedStub.extractors || {};

      // Build context
      const context = {
        request: { method, path, query, headers, body },
        vars: freshConfig.variables || {},
        extracted: {}
      };

      // Extract from path
      if (extractors.pathPattern) {
        const match = path.match(new RegExp(extractors.pathPattern));
        if (match) {
          if (match.groups) Object.assign(context.extracted, match.groups);
          match.forEach((m, i) => { if (i > 0) context.extracted['path' + i] = m; });
        }
      }

      // Extract from query and body
      Object.assign(context.extracted, query);
      if (body && typeof body === 'object') Object.assign(context.extracted, body);

      // Apply delay
      if (response.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, response.delayMs));
      }

      // Build response body
      let responseBody;
      if (response.bodyTemplate) {
        const rendered = renderTemplate(response.bodyTemplate, context);
        try {
          responseBody = JSON.parse(rendered);
        } catch {
          responseBody = rendered;
        }
      } else {
        responseBody = response.body || {};
      }

      // Set headers
      const respHeaders = { ...freshConfig.defaultHeaders, ...response.headers };
      Object.entries(respHeaders).forEach(([key, value]) => res.setHeader(key, value));

      // Trigger webhook
      if (response.webhook?.enabled) {
        processWebhook(response.webhook, context);
      }

      res.status(response.statusCode || 200).json(responseBody);
    } catch (error) {
      console.error('Mock error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  const server = http.createServer(mockApp);
  return server;
}

// Start mock server on port
async function startMockServer(config) {
  // Stop existing server on this port
  await stopMockServer(config.port);

  if (!config.enabled || config.stubs.length === 0) {
    console.log(`Mock ${config.name} disabled or has no stubs`);
    return;
  }

  try {
    const server = createMockServer(config);
    server.listen(config.port, () => {
      console.log(`Mock server "${config.name}" running on port ${config.port}`);
    });
    mockServers.set(config.port, server);
  } catch (error) {
    console.error(`Failed to start mock on port ${config.port}:`, error.message);
  }
}

// Stop mock server
async function stopMockServer(port) {
  if (mockServers.has(port)) {
    const server = mockServers.get(port);
    await new Promise(resolve => server.close(resolve));
    mockServers.delete(port);
    console.log(`Stopped mock server on port ${port}`);
  }
}

// Start all mock servers
async function startAllMockServers() {
  const configs = await MockConfig.find({ enabled: true });
  for (const config of configs) {
    await startMockServer(config);
  }
  console.log(`Started ${configs.length} mock servers`);
}

// ============ API Routes ============

app.get('/api/mocks', async (req, res) => {
  try {
    const mocks = await MockConfig.find().sort({ createdAt: -1 });
    res.json(mocks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mocks/:id', async (req, res) => {
  try {
    const mock = await MockConfig.findById(req.params.id);
    if (!mock) return res.status(404).json({ error: 'Mock not found' });
    res.json(mock);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/mocks', async (req, res) => {
  try {
    const mock = new MockConfig(req.body);
    await mock.save();
    await startMockServer(mock);
    res.status(201).json(mock);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/mocks/:id', async (req, res) => {
  try {
    const mock = await MockConfig.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!mock) return res.status(404).json({ error: 'Mock not found' });
    await startMockServer(mock);
    res.json(mock);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/mocks/:id', async (req, res) => {
  try {
    const mock = await MockConfig.findByIdAndDelete(req.params.id);
    if (!mock) return res.status(404).json({ error: 'Mock not found' });
    await stopMockServer(mock.port);
    res.json({ message: 'Deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/mocks/:id/toggle', async (req, res) => {
  try {
    const mock = await MockConfig.findById(req.params.id);
    if (!mock) return res.status(404).json({ error: 'Mock not found' });
    mock.enabled = !mock.enabled;
    await mock.save();
    await startMockServer(mock);
    res.json(mock);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/mocks/:id/stubs', async (req, res) => {
  try {
    const mock = await MockConfig.findById(req.params.id);
    if (!mock) return res.status(404).json({ error: 'Mock not found' });
    mock.stubs.push(req.body);
    await mock.save();
    await startMockServer(mock);
    res.json(mock);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/mocks/:id/stubs/:stubIndex', async (req, res) => {
  try {
    const mock = await MockConfig.findById(req.params.id);
    if (!mock) return res.status(404).json({ error: 'Mock not found' });
    const stubIndex = parseInt(req.params.stubIndex);
    if (stubIndex < 0 || stubIndex >= mock.stubs.length) return res.status(404).json({ error: 'Stub not found' });
    mock.stubs[stubIndex] = req.body;
    await mock.save();
    await startMockServer(mock);
    res.json(mock);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/mocks/:id/stubs/:stubIndex', async (req, res) => {
  try {
    const mock = await MockConfig.findById(req.params.id);
    if (!mock) return res.status(404).json({ error: 'Mock not found' });
    mock.stubs.splice(parseInt(req.params.stubIndex), 1);
    await mock.save();
    await startMockServer(mock);
    res.json(mock);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sync', async (req, res) => {
  try {
    await startAllMockServers();
    res.json({ message: 'All mock servers restarted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/status', (req, res) => {
  const servers = [];
  mockServers.forEach((server, port) => {
    servers.push({ port, listening: server.listening });
  });
  res.json({ activeMocks: servers });
});

// Webhook test
app.post('/api/webhook/test', async (req, res) => {
  const { url, method, headers, body, delayMs } = req.body;
  setTimeout(async () => {
    try {
      await axios({ method: method || 'POST', url, headers: headers || {}, data: body, timeout: 30000 });
      console.log(`Test webhook to ${url}: success`);
    } catch (error) {
      console.error(`Test webhook failed: ${error.message}`);
    }
  }, delayMs || 0);
  res.json({ status: 'scheduled', delayMs: delayMs || 0 });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Connect and start
mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    await startAllMockServers();
    app.listen(PORT, () => {
      console.log(`Backend API running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
