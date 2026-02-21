// Antaria — Monad Testnet Frontend App
// Reads anchored events from AnchorRegistry on Monad Testnet

// ⚠️ CONTRACT_ADDRESS will be set after deployment
let CONTRACT_ADDRESS = '0xB284Dd77dcdc080d7c5548592768A6E6188e5381';

const RPC_ENDPOINTS = [
    '/rpc',  // local proxy (bypasses CORS)
    'https://testnet-rpc.monad.xyz',
    'https://10143.rpc.thirdweb.com',
];
const EXPLORER_TX = 'https://testnet.monadexplorer.com/tx/';
const EXPLORER_ADDRESS = 'https://testnet.monadexplorer.com/address/';

const ABI = [
    "event Anchored(bytes32 indexed groupId, string anchorType, bytes32 refId, bytes32 dataHash, uint256 timestamp)",
    "function anchorCount() view returns (uint256)"
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
    'TANDA_CREATED': '#836EF9',
    'TANDA_ACTIVATED': '#E879F9',
    'INITIAL_FUND_COMPLETED': '#60A5FA',
    'COVERAGE_ACTIVATED': '#F472B6',
    'USER_REPLACED': '#A78BFA',
    'TANDA_CLOSED': '#34D399',
    'RAFFLE_RESULT': '#FBBF24',
};

const ANCHOR_LABELS = {
    'TANDA_CREATED': 'Tanda Creada',
    'TANDA_ACTIVATED': 'Tanda Activada',
    'INITIAL_FUND_COMPLETED': 'Fondo Inicial Completo',
    'COVERAGE_ACTIVATED': 'Cobertura Activada',
    'USER_REPLACED': 'Usuario Reemplazado',
    'TANDA_CLOSED': 'Tanda Cerrada',
    'RAFFLE_RESULT': 'Resultado de Rifa',
};

let provider;
let contract;

async function connectRPC() {
    for (const rpc of RPC_ENDPOINTS) {
        try {
            // Resolve relative URLs (e.g. /rpc) to full URL
            const url = rpc.startsWith('/') ? window.location.origin + rpc : rpc;
            console.log('🟣 Trying RPC:', url);
            const p = new ethers.JsonRpcProvider(url, 10143);
            await p.getBlockNumber(); // test it works
            console.log('✅ Connected to:', url);
            return p;
        } catch (err) {
            console.warn('⚠️ RPC failed:', rpc, err.message);
        }
    }
    throw new Error('All RPC endpoints failed');
}

async function init() {
    // Check if contract address is set
    if (CONTRACT_ADDRESS.includes('%%')) {
        document.getElementById('contractAddress').textContent = 'Pendiente de deploy...';
        document.getElementById('networkStatus').textContent = '⏳ Pendiente';
        document.getElementById('timelineContainer').innerHTML =
            '<div class="timeline-empty"><p>🟣 Contrato aún no deployado. Regresa pronto.</p></div>';
        return;
    }

    try {
        provider = await connectRPC();
        contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

        // Set contract info
        document.getElementById('contractAddress').textContent = CONTRACT_ADDRESS;
        document.getElementById('explorerLink').href = EXPLORER_ADDRESS + CONTRACT_ADDRESS;

        await Promise.all([
            loadStats(),
            loadTimeline(),
        ]);

        setupVerification();
    } catch (err) {
        console.error('Init error:', err);
        document.getElementById('networkStatus').textContent = '❌ Error de Conexión';
    }
}

// ===== Stats =====
async function loadStats() {
    try {
        const count = await contract.anchorCount();
        document.getElementById('totalAnchors').textContent = count.toString();

        const events = await getAnchoredEvents();
        const groups = new Set(events.map(e => e.args.groupId));
        document.getElementById('totalGroups').textContent = groups.size.toString();

        document.getElementById('networkStatus').textContent = 'Monad Testnet';
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
    const fromBlock = Math.max(0, latest - 500000);
    return contract.queryFilter(contract.filters.Anchored(), fromBlock, 'latest');
}

async function loadTimeline() {
    const container = document.getElementById('timelineContainer');

    try {
        const events = await getAnchoredEvents();

        if (events.length === 0) {
            container.innerHTML =
                '<div class="timeline-empty"><p>No hay eventos anclados aún. Los eventos aparecerán aquí cuando ocurran.</p></div>';
            return;
        }

        const sorted = events.slice().reverse();
        container.innerHTML = '';

        for (const event of sorted) {
            const anchorType = event.args.anchorType;
            const icon = ANCHOR_ICONS[anchorType] || '📌';
            const color = ANCHOR_COLORS[anchorType] || '#836EF9';
            const label = ANCHOR_LABELS[anchorType] || anchorType;
            const timestamp = event.args.timestamp;
            const date = new Date(Number(timestamp) * 1000);
            const timeStr = date.toLocaleString('es-MX');

            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.innerHTML = `
                <div class="timeline-dot" style="background: ${color}20; border-color: ${color};">
                    ${icon}
                </div>
                <div class="timeline-content">
                    <div class="timeline-header">
                        <span class="timeline-type" style="color: ${color}">${label}</span>
                        <span class="timeline-time">${timeStr}</span>
                    </div>
                    <div class="timeline-hash">Hash: ${event.args.dataHash}</div>
                    <div class="timeline-tx">
                        <a href="${EXPLORER_TX}${event.transactionHash}" target="_blank">
                            Ver en Monad Explorer ↗
                        </a>
                    </div>
                </div>
            `;
            container.appendChild(item);
        }
    } catch (err) {
        console.error('Timeline error:', err);
        container.innerHTML =
            '<div class="timeline-empty"><p>⚠️ Error cargando eventos. Verifica tu conexión.</p></div>';
    }
}

// ===== Verification =====
function setupVerification() {
    const btn = document.getElementById('verifyBtn');
    const input = document.getElementById('txHashInput');
    const result = document.getElementById('verifyResult');

    btn.addEventListener('click', async () => {
        const hash = input.value.trim();
        if (!hash || !hash.startsWith('0x')) {
            result.className = 'verify-result error';
            result.textContent = '⚠️ Ingresa un TX hash válido (empieza con 0x).';
            return;
        }

        result.className = 'verify-result success';
        result.textContent = '🔍 Buscando...';
        result.style.display = 'block';

        try {
            const tx = await provider.getTransaction(hash);
            if (!tx) {
                result.className = 'verify-result error';
                result.textContent = '❌ Transacción no encontrada en Monad Testnet.';
                return;
            }

            const receipt = await provider.getTransactionReceipt(hash);
            const status = receipt && receipt.status === 1 ? '✅ Confirmada' : '⏳ Pendiente';

            result.className = 'verify-result success';
            result.innerHTML = `
                <strong>${status}</strong><br>
                <strong>Bloque:</strong> ${tx.blockNumber}<br>
                <strong>De:</strong> <code>${tx.from}</code><br>
                <strong>A:</strong> <code>${tx.to}</code><br>
                <a href="${EXPLORER_TX}${hash}" target="_blank" style="color: var(--monad-purple-light);">
                    Ver en Monad Explorer ↗
                </a>
            `;
        } catch (err) {
            result.className = 'verify-result error';
            result.textContent = '❌ Error: ' + err.message;
        }
    });
}

// ===== Boot =====
document.addEventListener('DOMContentLoaded', init);
