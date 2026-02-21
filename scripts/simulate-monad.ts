/**
 * Simulate tanda creation + anchoring on Monad Testnet
 * No WhatsApp needed — tests the full anchor flow directly
 */
import { ethers, JsonRpcProvider, Wallet, Contract } from 'ethers';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

const MONAD_RPC = 'https://testnet-rpc.monad.xyz';
const MONAD_EXPLORER = 'https://testnet.monadexplorer.com';
const CHAIN_ID = 10143;

async function main() {
    console.log('🟣 Simulando creación de tanda en Monad Testnet...\n');

    // Load Monad config
    const config = JSON.parse(fs.readFileSync('./monad-config.json', 'utf-8'));
    const provider = new JsonRpcProvider(MONAD_RPC, CHAIN_ID);
    const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);
    const contract = new Contract(config.contractAddress, config.abi, wallet);

    console.log('📋 Contrato:', config.contractAddress);
    console.log('👤 Wallet:', wallet.address);

    const balance = await provider.getBalance(wallet.address);
    console.log('💰 Balance:', ethers.formatEther(balance), 'MON\n');

    const salt = process.env.ANCHOR_SALT || 'antaria-v1-default-salt';

    // Simular evento: TANDA_CREATED
    console.log('--- Evento 1: TANDA_CREATED ---');
    const tandaId = 'tanda-demo-monad-' + Date.now();
    const groupId1 = ethers.keccak256(ethers.toUtf8Bytes(tandaId + salt));
    const refId1 = ethers.keccak256(ethers.toUtf8Bytes('event-created-' + salt));
    const dataHash1 = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
        type: 'TandaCreated',
        name: 'Tanda Demo Monad Blitz',
        members: 5,
        amount: 1000,
        timestamp: Date.now()
    })));

    const tx1 = await contract.anchor(groupId1, 'TANDA_CREATED', refId1, dataHash1);
    console.log('📤 TX enviada:', tx1.hash);
    const receipt1 = await tx1.wait();
    console.log('✅ Confirmada! Gas:', receipt1.gasUsed.toString());
    console.log(`🔗 ${MONAD_EXPLORER}/tx/${tx1.hash}\n`);

    // Simular evento: TANDA_ACTIVATED
    console.log('--- Evento 2: TANDA_ACTIVATED ---');
    const refId2 = ethers.keccak256(ethers.toUtf8Bytes('event-activated-' + salt));
    const dataHash2 = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
        type: 'TandaActivated',
        tandaId,
        activatedAt: Date.now()
    })));

    const tx2 = await contract.anchor(groupId1, 'TANDA_ACTIVATED', refId2, dataHash2);
    console.log('📤 TX enviada:', tx2.hash);
    const receipt2 = await tx2.wait();
    console.log('✅ Confirmada! Gas:', receipt2.gasUsed.toString());
    console.log(`🔗 ${MONAD_EXPLORER}/tx/${tx2.hash}\n`);

    // Simular evento: INITIAL_FUND_COMPLETED
    console.log('--- Evento 3: INITIAL_FUND_COMPLETED ---');
    const refId3 = ethers.keccak256(ethers.toUtf8Bytes('event-fund-' + salt));
    const dataHash3 = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
        type: 'InitialFundCompleted',
        tandaId,
        totalFund: 5000,
        timestamp: Date.now()
    })));

    const tx3 = await contract.anchor(groupId1, 'INITIAL_FUND_COMPLETED', refId3, dataHash3);
    console.log('📤 TX enviada:', tx3.hash);
    const receipt3 = await tx3.wait();
    console.log('✅ Confirmada! Gas:', receipt3.gasUsed.toString());
    console.log(`🔗 ${MONAD_EXPLORER}/tx/${tx3.hash}\n`);

    // Verificar anchor count
    const count = await contract.anchorCount();
    console.log('📊 Total eventos anclados en Monad:', count.toString());
    console.log('\n🎉 ¡Simulación completa! 3 eventos anclados en Monad Testnet');
}

main().catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
