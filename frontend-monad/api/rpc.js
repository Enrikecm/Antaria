// Vercel Serverless Function — Proxy RPC requests to Monad Testnet
// This bypasses CORS restrictions from browser-based calls

export default async function handler(req, res) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const MONAD_RPC = 'https://testnet-rpc.monad.xyz';

    try {
        const response = await fetch(MONAD_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
        });

        const data = await response.json();

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        return res.status(200).json(data);
    } catch (error) {
        console.error('RPC Proxy Error:', error);
        return res.status(502).json({ error: 'RPC request failed' });
    }
}
