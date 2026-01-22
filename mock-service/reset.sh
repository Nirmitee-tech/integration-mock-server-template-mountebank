#!/bin/bash

# Reset Mock Service - Clears all data and reloads sample mocks

echo "Resetting Mock Service..."

# Clear all existing mocks
echo "Clearing existing mocks..."
curl -s http://localhost:3001/api/mocks | \
    node -e "
    const data = [];
    process.stdin.on('data', chunk => data.push(chunk));
    process.stdin.on('end', () => {
        const mocks = JSON.parse(data.join(''));
        mocks.forEach(mock => {
            require('http').request({
                hostname: 'localhost',
                port: 3001,
                path: '/api/mocks/' + mock._id,
                method: 'DELETE'
            }, () => console.log('Deleted:', mock.name)).end();
        });
    });
    "

sleep 2

# Reload sample data
echo "Loading sample data..."
./setup.sh
