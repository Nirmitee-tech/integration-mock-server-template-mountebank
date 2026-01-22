# Mock Service Manager

Dynamic API mocking service with MongoDB configuration, Handlebars templating, and webhook support.

## Quick Setup

```bash
# Clone/copy this folder, then:
cd mock-service
chmod +x setup.sh reset.sh
./setup.sh
```

This will:
1. Start all Docker containers
2. Load sample mock configurations
3. Start mock servers on ports 10080-10085

## Access Points

| Service | URL |
|---------|-----|
| **Web UI** | http://localhost:3000 |
| Backend API | http://localhost:3001 |
| MongoDB | localhost:27117 |

## Sample Mock Services

| Service | Port | Endpoints |
|---------|------|-----------|
| User Service | 10080 | GET/POST/PUT/DELETE /api/users |
| Order Service | 10081 | GET/POST/PATCH /api/orders |
| Payment Service | 10082 | POST /api/payments, /api/payments/refund |
| Product Service | 10083 | GET/POST /api/products |
| Auth Service | 10084 | POST /api/auth/login, /refresh, /validate |
| Notification | 10085 | POST /api/notifications |

## Test Commands

```bash
# Get user by ID (ID extracted from path)
curl http://localhost:10080/api/users/12345

# Get orders for user
curl http://localhost:10081/api/orders/user/67890

# Create order (request body values echoed in response)
curl -X POST http://localhost:10081/api/orders \
  -H "Content-Type: application/json" \
  -d '{"orderId":"ORD-123","userId":"USER-456","amount":150.00}'

# Process payment (2 second delay)
curl -X POST http://localhost:10082/api/payments \
  -H "Content-Type: application/json" \
  -d '{"orderId":"ORD-123","amount":99.99,"cardLast4":"4242"}'

# Login
curl -X POST http://localhost:10084/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"test123"}'
```

## Template Variables

Use these in `bodyTemplate`:

| Variable | Example | Source |
|----------|---------|--------|
| `{{extracted.orderId}}` | `ORD-123` | Request body `{"orderId":"ORD-123"}` |
| `{{extracted.path1}}` | `12345` | Path `/users/12345` with pattern `/users/(\d+)` |
| `{{extracted.status}}` | `active` | Query param `?status=active` |
| `{{vars.currency}}` | `USD` | Global variable |
| `{{uuid}}` | `a1b2c3...` | Random UUID |
| `{{now}}` | `2024-01-22T15:00:00Z` | Current ISO timestamp |
| `{{timestamp}}` | `1705932000000` | Unix timestamp |
| `{{random 1 100}}` | `42` | Random number in range |
| `{{request.method}}` | `POST` | HTTP method |
| `{{request.path}}` | `/api/users` | Request path |

## Configuration Structure

```json
{
  "name": "Service Name",
  "description": "Description",
  "port": 10080,
  "enabled": true,
  "variables": {
    "currency": "USD",
    "apiVersion": "v1"
  },
  "stubs": [
    {
      "name": "Endpoint Name",
      "predicates": [
        {"equals": {"method": "POST", "path": "/api/orders"}},
        {"matches": {"path": "/api/users/\\d+"}}
      ],
      "extractors": {
        "pathPattern": "/api/users/(\\d+)"
      },
      "responses": [{
        "statusCode": 200,
        "delayMs": 1000,
        "headers": {"Content-Type": "application/json"},
        "bodyTemplate": "{\"id\": \"{{extracted.path1}}\", \"requestId\": \"{{uuid}}\"}",
        "webhook": {
          "enabled": true,
          "url": "http://callback-url/webhook",
          "method": "POST",
          "delayMs": 5000,
          "bodyTemplate": "{\"event\": \"completed\", \"timestamp\": \"{{now}}\"}"
        }
      }]
    }
  ]
}
```

## API Endpoints

### Mocks Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/mocks | List all mocks |
| GET | /api/mocks/:id | Get single mock |
| POST | /api/mocks | Create mock |
| PUT | /api/mocks/:id | Update mock |
| DELETE | /api/mocks/:id | Delete mock |
| PATCH | /api/mocks/:id/toggle | Enable/disable mock |
| POST | /api/mocks/:id/stubs | Add stub to mock |
| PUT | /api/mocks/:id/stubs/:index | Update stub |
| DELETE | /api/mocks/:id/stubs/:index | Delete stub |
| POST | /api/sync | Restart all mock servers |

### Create Mock via API

```bash
curl -X POST http://localhost:3001/api/mocks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My API",
    "port": 10090,
    "enabled": true,
    "stubs": [{
      "name": "Get Item",
      "predicates": [{"matches": {"method": "GET", "path": "/api/items/.*"}}],
      "extractors": {"pathPattern": "/api/items/(.+)"},
      "responses": [{
        "statusCode": 200,
        "bodyTemplate": "{\"itemId\": \"{{extracted.path1}}\", \"timestamp\": \"{{now}}\"}"
      }]
    }]
  }'
```

## Predicate Types

```json
// Exact match
{"equals": {"method": "POST", "path": "/api/users"}}

// Regex match
{"matches": {"method": "GET", "path": "/api/users/\\d+"}}

// Contains
{"contains": {"path": "/api/", "body": "orderId"}}
```

## File Structure

```
mock-service/
├── docker-compose.yml
├── setup.sh              # Initial setup script
├── reset.sh              # Reset and reload data
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── index.html
└── seed-data/
    └── sample-mocks.json # Sample configurations
```

## Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f backend

# Reset everything
./reset.sh

# Rebuild after changes
docker-compose up -d --build
```

## Import/Export Data

### Export current mocks
```bash
curl -s http://localhost:3001/api/mocks > my-mocks-backup.json
```

### Import mocks from file
```bash
cat my-mocks.json | node -e "
const http = require('http');
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  JSON.parse(data).forEach(mock => {
    delete mock._id;
    const req = http.request({
      hostname: 'localhost', port: 3001,
      path: '/api/mocks', method: 'POST',
      headers: {'Content-Type': 'application/json'}
    }, res => console.log(mock.name, res.statusCode));
    req.write(JSON.stringify(mock));
    req.end();
  });
});
"
```

## Troubleshooting

**Port already in use:**
```bash
docker-compose down
docker stop $(docker ps -q) 2>/dev/null
./setup.sh
```

**Mock not responding:**
```bash
# Check if mock server is running
curl http://localhost:3001/api/status

# Restart mock servers
curl -X POST http://localhost:3001/api/sync
```

**View backend logs:**
```bash
docker logs -f mock-backend
```
