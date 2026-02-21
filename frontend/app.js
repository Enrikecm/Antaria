// Antaria — Celo Frontend App
// Reads anchored events from AnchorRegistry on Celo Mainnet

const CONTRACT_ADDRESS = '0xB284Dd77dcdc080d7c5548592768A6E6188e5381';
const CELO_RPCS = [
    'https://rpc.ankr.com/celo',
    'https://1rpc.io/celo',
    'https://forno.celo.org',
];
const CELOSCAN_TX = 'https://celoscan.io/tx/';

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
    'TANDA_CREATED': '#35D07F',
    'TANDA_ACTIVATED': '#FBCC5C',
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

async function init() {
    // Try each RPC until one works
    for (const rpc of CELO_RPCS) {
        try {
            console.log('Trying RPC:', rpc);
            provider = new ethers.JsonRpcProvider(rpc);
            contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

            // Quick test — if this fails, try next RPC
            await contract.anchorCount();
            console.log('Connected to:', rpc);

            await Promise.all([
                loadStats(),
                loadTimeline(),
            ]);

            setupVerification();
            return; // Success, stop trying
        } catch (err) {
            console.warn('RPC failed:', rpc, err.message);
        }
    }
    // All RPCs failed
    document.getElementById('networkStatus').textContent = '❌ Sin conexión';
    document.getElementById('timelineContainer').innerHTML = `
        <div class="empty-state">
            <div class="icon">⚠️</div>
            <p>No se pudo conectar a la red de Celo. Intenta recargar en unos minutos.</p>
        </div>
    `;
}

// ===== Stats =====
async function loadStats() {
    try {
        const count = await contract.anchorCount();
        document.getElementById('totalAnchors').textContent = count.toString();

        // Get unique groups from events
        const events = await getAnchoredEvents();
        const groups = new Set(events.map(e => e.args.groupId));
        document.getElementById('totalGroups').textContent = groups.size.toString();

        document.getElementById('networkStatus').textContent = 'Celo Mainnet';
    } catch (err) {
        console.error('Stats error:', err);
        document.getElementById('totalAnchors').textContent = '—';
        document.getElementById('totalGroups').textContent = '—';
        document.getElementById('networkStatus').textContent = '⚠️ RPC Error';
    }
}

// ===== Timeline =====
async function getAnchoredEvents() {
    const filter = contract.filters.Anchored();
    // Query last ~500k blocks (~1 week on Celo) to avoid RPC overload
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - 500000);
    const events = await contract.queryFilter(filter, fromBlock, 'latest');
    return events;
}

async function loadTimeline() {
    const container = document.getElementById('timelineContainer');
    const loading = document.getElementById('timelineLoading');

    try {
        const events = await getAnchoredEvents();

        if (events.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">📡</div>
                    <p>No hay eventos anclados todavía</p>
                </div>
            `;
            return;
        }

        // Show most recent first
        const reversed = [...events].reverse();
        container.innerHTML = '';

        for (let i = 0; i < reversed.length; i++) {
            const event = reversed[i];
            const timestamp = new Date(Number(event.args.timestamp) * 1000);
            const anchorType = event.args.anchorType;
            const icon = ANCHOR_ICONS[anchorType] || '📋';
            const color = ANCHOR_COLORS[anchorType] || '#35D07F';
            const label = ANCHOR_LABELS[anchorType] || anchorType;
            const txHash = event.transactionHash;
            const shortHash = txHash.substring(0, 10) + '...' + txHash.substring(58);

            const el = document.createElement('div');
            el.className = 'timeline-event';
            el.style.animationDelay = `${i * 0.1}s`;
            el.innerHTML = `
                <div class="event-icon" style="background: ${color}15">${icon}</div>
                <div class="event-info">
                    <div class="event-type">
                        ${label}
                        <span class="event-type-badge" style="background: ${color}20; color: ${color}">${anchorType}</span>
                    </div>
                    <div class="event-meta">
                        ${timestamp.toLocaleDateString('es-MX', {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            })}
                        · Block ${event.blockNumber}
                    </div>
                </div>
                <a href="${CELOSCAN_TX}${txHash}" target="_blank" class="event-link">
                    🔗 ${shortHash}
                </a>
            `;
            container.appendChild(el);
        }
    } catch (err) {
        console.error('Timeline error:', err);
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">⚠️</div>
                <p>Error cargando eventos: ${err.message}</p>
            </div>
        `;
    }
}

// ===== Verification =====
function setupVerification() {
    const btn = document.getElementById('verifyBtn');
    const input = document.getElementById('txHashInput');

    btn.addEventListener('click', () => verifyTx());
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') verifyTx();
    });
}

async function verifyTx() {
    const input = document.getElementById('txHashInput');
    const result = document.getElementById('verifyResult');
    const txHash = input.value.trim();

    if (!txHash || !txHash.startsWith('0x')) {
        result.className = 'verify-result error';
        result.innerHTML = '❌ Ingresa un TX hash válido (empieza con 0x...)';
        return;
    }

    result.className = 'verify-result';
    result.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Verificando...</p></div>';

    try {
        const receipt = await provider.getTransactionReceipt(txHash);

        if (!receipt) {
            result.className = 'verify-result error';
            result.innerHTML = '❌ Transacción no encontrada';
            return;
        }

        if (receipt.to.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
            result.className = 'verify-result error';
            result.innerHTML = '❌ Esta transacción no pertenece al contrato AnchorRegistry';
            return;
        }

        // Parse the Anchored event
        const iface = new ethers.Interface(ABI);
        let anchorData = null;

        for (const log of receipt.logs) {
            try {
                const parsed = iface.parseLog({ topics: log.topics, data: log.data });
                if (parsed && parsed.name === 'Anchored') {
                    anchorData = parsed;
                    break;
                }
            } catch (e) { /* not our event */ }
        }

        if (!anchorData) {
            result.className = 'verify-result error';
            result.innerHTML = '❌ No se encontró evento Anchored en esta transacción';
            return;
        }

        const block = await provider.getBlock(receipt.blockNumber);
        const timestamp = new Date(block.timestamp * 1000);
        const anchorType = anchorData.args.anchorType;
        const icon = ANCHOR_ICONS[anchorType] || '📋';
        const label = ANCHOR_LABELS[anchorType] || anchorType;

        result.className = 'verify-result success';
        result.innerHTML = `
            <div class="verify-badge">✅ Verificado en Celo Mainnet</div>
            <div class="verify-field">
                <span class="label">Tipo</span>
                <span class="value">${icon} ${label}</span>
            </div>
            <div class="verify-field">
                <span class="label">Fecha</span>
                <span class="value">${timestamp.toLocaleString('es-MX')}</span>
            </div>
            <div class="verify-field">
                <span class="label">Bloque</span>
                <span class="value">${receipt.blockNumber}</span>
            </div>
            <div class="verify-field">
                <span class="label">Group ID</span>
                <span class="value">${anchorData.args.groupId.substring(0, 18)}...</span>
            </div>
            <div class="verify-field">
                <span class="label">Data Hash</span>
                <span class="value">${anchorData.args.dataHash.substring(0, 18)}...</span>
            </div>
            <div class="verify-field">
                <span class="label">Gas Usado</span>
                <span class="value">${receipt.gasUsed.toString()}</span>
            </div>
            <div style="margin-top: 12px; text-align: center;">
                <a href="${CELOSCAN_TX}${txHash}" target="_blank" class="event-link" style="display: inline-flex;">
                    🔗 Ver en CeloScan
                </a>
            </div>
        `;
    } catch (err) {
        console.error('Verify error:', err);
        result.className = 'verify-result error';
        result.innerHTML = `❌ Error: ${err.message}`;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
