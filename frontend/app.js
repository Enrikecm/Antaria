// ===== Antaria — Celo Frontend =====

const CONTRACT_ADDRESS = '0x40c410F3e5701EF60be7ACC06EaeBc901337bda0';
const EXPLORER_BASE = 'https://celoscan.io';
const RPC_ENDPOINTS = [
    '/api/rpc',   // Vercel serverless proxy
    '/rpc',       // Local proxy
    'https://rpc.ankr.com/celo',   // Ankr (working)
    'https://forno.celo.org',      // Fallback
];
const CHAIN_ID = 42220;
const NETWORK_LABEL = 'Celo Mainnet';

const ABI = [
    "function anchorCount() view returns (uint256)",
    "function owner() view returns (address)",
    "event Anchored(bytes32 indexed groupId, string anchorType, bytes32 refId, bytes32 dataHash, uint256 timestamp)"
];

const ANCHOR_ICONS = {
    'TANDA_CREATED': '🏗️',
    'TANDA_ACTIVATED': '⚡',
    'INITIAL_FUND_COMPLETED': '💰',
    'COVERAGE_ACTIVATED': '🛡️',
    'USER_REPLACED': '🔄',
    'TANDA_CLOSED': '🏁',
    'RAFFLE_RESULT': '🎲',
};

const ANCHOR_COLORS = {
    'TANDA_CREATED': '#35D07F',
    'TANDA_ACTIVATED': '#FBCC5C',
    'INITIAL_FUND_COMPLETED': '#5DCEA0',
    'COVERAGE_ACTIVATED': '#E74C3C',
    'USER_REPLACED': '#3498DB',
    'TANDA_CLOSED': '#A8E6CF',
    'RAFFLE_RESULT': '#F39C12',
};

const ANCHOR_LABELS = {
    'TANDA_CREATED': 'Tanda Creada',
    'TANDA_ACTIVATED': 'Tanda Activada',
    'INITIAL_FUND_COMPLETED': 'Fondo Inicial Completado',
    'COVERAGE_ACTIVATED': 'Cobertura Activada',
    'USER_REPLACED': 'Usuario Reemplazado',
    'TANDA_CLOSED': 'Tanda Cerrada',
    'RAFFLE_RESULT': 'Resultado de Rifa',
};

let provider = null;
let contract = null;

// ===== Debug Logger =====
function logError(msg, err) {
    console.error(msg, err);
    const container = document.getElementById('debugLog');
    if (container) {
        container.style.display = 'block';
        const p = document.createElement('p');
        p.textContent = `❌ ${msg}: ${err.message || err}`;
        container.appendChild(p);
    }
}

// ===== Connect =====
async function connectRPC() {
    // 1. Try MetaMask first (Opción 4 elegante)
    if (window.ethereum) {
        try {
            console.log('🦊 Intentando conectar con MetaMask...');
            const p = new ethers.BrowserProvider(window.ethereum);
            const network = await p.getNetwork();
            if (Number(network.chainId) === CHAIN_ID) {
                console.log('✅ Conectado vía MetaMask');
                return p;
            } else {
                console.warn('⚠️ MetaMask está en otra red:', network.chainId);
            }
        } catch (err) {
            console.warn('⚠️ Error con MetaMask:', err.message);
        }
    }

    // 2. Try RPC Endpoints (Proxy Vercel + Directos)
    for (const rpc of RPC_ENDPOINTS) {
        try {
            const url = rpc.startsWith('/') ? window.location.origin + rpc : rpc;
            console.log('🟢 Probando RPC:', url);
            const p = new ethers.JsonRpcProvider(url, CHAIN_ID, {
                staticNetwork: true // Optimización para v6
            });
            await p.getBlockNumber();
            console.log('✅ Conectado a:', url);
            return p;
        } catch (err) {
            console.warn('⚠️ Falló RPC:', rpc, err.message);
            // Si es el proxy de Vercel y falla, loguear detalle
            if (rpc === '/api/rpc') logError('Error en Proxy Vercel', err);
        }
    }
    throw new Error('No se pudo conectar a ningún nodo de Celo');
}

async function init() {
    try {
        provider = await connectRPC();
        contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

        document.getElementById('contractAddress').textContent = CONTRACT_ADDRESS;
        document.getElementById('explorerLink').href = `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`;

        await loadStats();
        await loadTimeline();
    } catch (err) {
        console.error('Init failed:', err);
        document.getElementById('networkStatus').textContent = '❌ Sin conexión';
    }
}

// ===== Stats =====
async function loadStats() {
    try {
        const count = await contract.anchorCount();
        document.getElementById('totalAnchors').textContent = count.toString();
        document.getElementById('networkStatus').textContent = NETWORK_LABEL;

        try {
            const events = await getAnchoredEvents();
            const groups = new Set(events.map(e => e.args.groupId));
            document.getElementById('totalGroups').textContent = groups.size.toString();
        } catch (evErr) {
            console.warn('⚠️ Error cargando eventos:', evErr.message);
            document.getElementById('totalGroups').textContent = '—';
        }
    } catch (err) {
        console.error('Stats error:', err);
        document.getElementById('totalAnchors').textContent = '—';
        document.getElementById('totalGroups').textContent = '—';
        document.getElementById('networkStatus').textContent = '⚠️ RPC Error';
    }
}

// ===== Timeline =====
async function getAnchoredEvents() {
    const latest = await provider.getBlockNumber();

    const ranges = [10000, 5000, 1000]; // Intentar rangos cada vez más pequeños

    for (const range of ranges) {
        try {
            const fromBlock = Math.max(0, latest - range);
            console.log(`🔍 Buscando eventos en rango de ${range} bloques (desde ${fromBlock})...`);
            return await contract.queryFilter(contract.filters.Anchored(), fromBlock, 'latest');
        } catch (err) {
            if (err.message.includes('range') || err.message.includes('too large')) {
                console.warn(`⚠️ Rango de ${range} muy grande, intentando con el siguiente...`);
                continue;
            }
            throw err;
        }
    }
    throw new Error('No se pudieron recuperar los eventos ni con rangos pequeños.');
}

async function loadTimeline() {
    const container = document.getElementById('timelineContainer');

    try {
        const events = await getAnchoredEvents();
        console.log(`📊 Eventos encontrados: ${events.length}`);

        if (events.length === 0) {
            container.innerHTML =
                '<div class="timeline-empty"><p>No hay eventos anclados aún. Los eventos aparecerán aquí cuando ocurran.</p></div>';
            return;
        }

        const sorted = events.slice().sort((a, b) => {
            const timeA = a.args && a.args.timestamp ? Number(a.args.timestamp) : 0;
            const timeB = b.args && b.args.timestamp ? Number(b.args.timestamp) : 0;
            return timeB - timeA; // Descendente
        });

        container.innerHTML = '';

        for (const event of sorted) {
            if (!event.args) continue;

            const anchorType = event.args.anchorType;
            const icon = ANCHOR_ICONS[anchorType] || '📌';
            const color = ANCHOR_COLORS[anchorType] || '#35D07F';
            const label = ANCHOR_LABELS[anchorType] || anchorType;
            const timestamp = event.args.timestamp;
            const date = new Date(Number(timestamp) * 1000);
            const timeStr = date.toLocaleString('es-MX');

            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.innerHTML = `
                <div class="timeline-dot" style="background: ${color}20; border-color: ${color}; color: ${color}">
                    ${icon}
                </div>
                <div class="timeline-content">
                    <div class="timeline-header">
                        <span class="timeline-type" style="color: ${color}">${label}</span>
                        <span class="timeline-time">${timeStr}</span>
                    </div>
                    <div class="timeline-hash">Group: ${event.args.groupId.substring(0, 18)}...</div>
                    <div class="timeline-tx">
                        <a href="${EXPLORER_BASE}/tx/${event.transactionHash}" target="_blank">
                            🔗 Ver TX en CeloScan ↗
                        </a>
                    </div>
                </div>
            `;
            container.appendChild(item);
        }
    } catch (err) {
        console.error('Timeline error:', err);
        logError('Error al renderizar Timeline', err);
        container.innerHTML =
            `<div class="timeline-empty"><p>Error cargando timeline: ${err.message || 'Error desconocido'}. Intenta recargar.</p></div>`;
    }
}

// ===== Verify =====
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('verifyBtn')?.addEventListener('click', async () => {
        const txHash = document.getElementById('txHashInput').value.trim();
        const result = document.getElementById('verifyResult');

        if (!txHash || !txHash.startsWith('0x')) {
            result.className = 'verify-result error';
            result.textContent = '❌ Ingresa un TX hash válido (empieza con 0x)';
            return;
        }

        try {
            result.className = 'verify-result success';
            result.textContent = '🔍 Buscando...';

            const tx = await provider.getTransaction(txHash);
            if (tx) {
                const receipt = await provider.getTransactionReceipt(txHash);
                result.innerHTML = `
                    ✅ <strong>Transacción encontrada en Celo</strong><br>
                    📦 Bloque: ${receipt.blockNumber}<br>
                    ⛽ Gas usado: ${receipt.gasUsed.toString()}<br>
                    <a href="${EXPLORER_BASE}/tx/${txHash}" target="_blank" style="color: #5DCEA0">
                        🔗 Ver en CeloScan ↗
                    </a>
                `;
            } else {
                result.className = 'verify-result error';
                result.textContent = '❌ Transacción no encontrada en Celo';
            }
        } catch (err) {
            result.className = 'verify-result error';
            result.textContent = '❌ Error verificando: ' + err.message;
        }
    });
});

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
    if (typeof ethers === 'undefined') {
        const msg = 'La librería ethers.js no se cargó correctamente. Revisa tu conexión a internet o los bloqueadores de scripts.';
        console.error(msg);

        // Show in debugLog if possible
        const container = document.getElementById('debugLog');
        if (container) {
            container.style.display = 'block';
            const p = document.createElement('p');
            p.textContent = `❌ Error Crítico: ${msg}`;
            container.appendChild(p);
        }

        document.getElementById('networkStatus').textContent = '❌ Error de Carga';
        return;
    }

    init();
});
