// Simple server: serves static frontend + proxies RPC to Monad
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8082;
const MONAD_RPC = 'https://testnet-rpc.monad.xyz';
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend-monad');

const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Proxy RPC requests
    if (req.url === '/rpc' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const url = new URL(MONAD_RPC);
            const options = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            };

            const proxy = https.request(options, (proxyRes) => {
                let data = '';
                proxyRes.on('data', chunk => data += chunk);
                proxyRes.on('end', () => {
                    res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
                    res.end(data);
                });
            });

            proxy.on('error', (err) => {
                console.error('RPC proxy error:', err.message);
                res.writeHead(502);
                res.end(JSON.stringify({ error: err.message }));
            });

            proxy.write(body);
            proxy.end();
        });
        return;
    }

    // Serve static files
    let filePath = req.url.split('?')[0]; // strip query params
    if (filePath === '/') filePath = '/index.html';

    const fullPath = path.join(FRONTEND_DIR, filePath);
    const ext = path.extname(fullPath);

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`\n🟣 Antaria Monad Frontend`);
    console.log(`📡 http://localhost:${PORT}`);
    console.log(`🔄 RPC proxy → ${MONAD_RPC}\n`);
});
