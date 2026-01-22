# Mock Service Manager

Generic API mocking service with MongoDB configuration and web UI.

## Quick Start

```bash
cd /Users/developer/basal-analytics/mock-service
docker-compose up -d --build
```

## Access

- **UI**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **Mountebank Admin**: http://localhost:2525
- **Mock Services**: Ports 10080-10099, 10100-10119

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Web UI    │────▶│   Backend   │────▶│  MongoDB    │
│  :3000      │     │   :3001     │     │  :27017     │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ Mountebank  │
                    │   :2525     │
                    └─────────────┘
```

## Usage

### Via UI (Recommended)
1. Open http://localhost:3000
2. Click "New Mock" to create a configuration
3. Add stubs with predicates and responses
4. Save - automatically syncs to Mountebank

### Via API

**Create Mock:**
```bash
curl -X POST http://localhost:3001/api/mocks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "User API",
    "port": 10080,
    "stubs": [{
      "predicates": [{"equals": {"method": "GET", "path": "/users"}}],
      "responses": [{"is": {"statusCode": 200, "body": {"users": []}}}]
    }]
  }'
```

**Test Mock:**
```bash
curl http://localhost:10080/users
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/mocks | List all mocks |
| POST | /api/mocks | Create mock |
| PUT | /api/mocks/:id | Update mock |
| DELETE | /api/mocks/:id | Delete mock |
| PATCH | /api/mocks/:id/toggle | Enable/disable |
| POST | /api/mocks/:id/stubs | Add stub |
| POST | /api/sync | Sync all to Mountebank |
