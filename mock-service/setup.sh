#!/bin/bash

# Mock Service Setup Script
# This script sets up the mock service with sample data

set -e

echo "============================================"
echo "   Mock Service Setup"
echo "============================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "Error: Docker is not running. Please start Docker first."
    exit 1
fi

echo -e "${YELLOW}Step 1: Starting services...${NC}"
docker-compose down 2>/dev/null || true
docker-compose up -d --build

echo ""
echo -e "${YELLOW}Step 2: Waiting for services to be ready...${NC}"
sleep 10

# Wait for backend to be healthy
MAX_RETRIES=30
RETRY_COUNT=0
until curl -s http://localhost:3001/health > /dev/null 2>&1; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "Error: Backend service failed to start"
        exit 1
    fi
    echo "Waiting for backend... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done
echo -e "${GREEN}Backend is ready!${NC}"

echo ""
echo -e "${YELLOW}Step 3: Loading sample mock configurations...${NC}"

# Load sample data via API using node script
if [ -f "seed-data/sample-mocks.json" ]; then
    node -e "
    const http = require('http');
    const fs = require('fs');
    const mocks = JSON.parse(fs.readFileSync('seed-data/sample-mocks.json', 'utf8'));

    async function postMock(mock) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(mock);
            const options = {
                hostname: 'localhost',
                port: 3001,
                path: '/api/mocks',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            const req = http.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    if (res.statusCode === 201 || res.statusCode === 200) {
                        resolve(JSON.parse(body));
                    } else if (res.statusCode === 400 && body.includes('duplicate')) {
                        resolve({ skipped: true, name: mock.name });
                    } else {
                        reject(new Error(body));
                    }
                });
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    (async () => {
        for (const mock of mocks) {
            try {
                const result = await postMock(mock);
                if (result.skipped) {
                    console.log('⏭️  Skipped (exists):', mock.name);
                } else {
                    console.log('✅ Created:', result.name, 'on port', result.port);
                }
            } catch (err) {
                console.log('❌ Failed:', mock.name, '-', err.message);
            }
        }
    })();
    "
else
    echo "Warning: seed-data/sample-mocks.json not found. Skipping sample data."
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   Setup Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Access Points:"
echo "  • UI:              http://localhost:3000"
echo "  • Backend API:     http://localhost:3001"
echo "  • MongoDB:         localhost:27117"
echo ""
echo "Mock Services:"
echo "  • User Service:    http://localhost:10080"
echo "  • Order Service:   http://localhost:10081"
echo "  • Payment Service: http://localhost:10082"
echo "  • Product Service: http://localhost:10083"
echo "  • Auth Service:    http://localhost:10084"
echo "  • Notification:    http://localhost:10085"
echo ""
echo "Quick Test:"
echo "  curl http://localhost:10080/api/users/12345"
echo "  curl http://localhost:10081/api/orders/user/67890"
echo "  curl -X POST http://localhost:10082/api/payments -H 'Content-Type: application/json' -d '{\"orderId\":\"ORD-123\",\"amount\":99.99,\"cardLast4\":\"4242\"}'"
echo ""
