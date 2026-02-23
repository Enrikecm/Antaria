import { ethers, JsonRpcProvider, Wallet, Contract } from 'ethers';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import pino from 'pino';
import { DomainEvent, EventType } from '../domain/events';
import { getDb } from './database';

dotenv.config();

const logger = pino({ name: 'infra/anchor' });

// Events that trigger on-chain anchoring
const ANCHORABLE_EVENTS: Record<string, string> = {
    'TandaCreated': 'TANDA_CREATED',
    'TandaActivated': 'TANDA_ACTIVATED',
    'InitialFundCompleted': 'INITIAL_FUND_COMPLETED',
    'DefaultConfirmed': 'COVERAGE_ACTIVATED',
    'ReplacementConfirmed': 'USER_REPLACED',
    'TandaClosed': 'TANDA_CLOSED',
    'RaffleWinnerSelected': 'RAFFLE_RESULT',
};

export class AnchorService {
    private provider: JsonRpcProvider | null = null;
    private wallet: Wallet | null = null;
    private contract: Contract | null = null;
    private salt: string;
    private enabled: boolean;
    private network: string;

    constructor() {
        this.salt = process.env.ANCHOR_SALT || 'antaria-v1-default-salt';
        this.enabled = process.env.ANCHOR_ENABLED === 'true';
        this.network = process.env.ANCHOR_NETWORK || 'monad';

        if (this.enabled) {
            this.initializeConnection();
        } else {
            logger.info('AnchorService running in DRY-RUN mode (ANCHOR_ENABLED=false)');
        }
    }

    private initializeConnection() {
        try {
            if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY.includes('YOUR_PRIVATE_KEY')) {
                logger.warn('No valid PRIVATE_KEY found. Anchor service disabled.');
                this.enabled = false;
                return;
            }

            // Network-specific configuration
            let configFile: string;
            let rpcUrl: string;
            let chainId: number | undefined;

            if (this.network === 'celo') {
                configFile = './celo-config.json';
                rpcUrl = 'https://rpc.ankr.com/celo';
                chainId = 42220;
            } else if (this.network === 'alfajores') {
                configFile = './celo-config.json';
                rpcUrl = 'https://alfajores-forno.celo-testnet.org';
                chainId = 44787;
            } else {
                // Default: Monad Testnet
                configFile = './monad-config.json';
                rpcUrl = 'https://testnet-rpc.monad.xyz';
                chainId = 10143;
            }

            if (!fs.existsSync(configFile)) {
                logger.warn({ configFile }, 'Config file not found. Anchor service disabled.');
                this.enabled = false;
                return;
            }

            const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));

            // Override RPC from config if available
            if (config.rpc) {
                rpcUrl = config.rpc;
            }

            this.provider = new JsonRpcProvider(rpcUrl, chainId);
            this.wallet = new Wallet(process.env.PRIVATE_KEY, this.provider);
            this.contract = new Contract(config.contractAddress, config.abi, this.wallet);

            logger.info({ address: config.contractAddress, network: this.network, rpc: rpcUrl },
                `🔗 AnchorService connected to AnchorRegistry on ${this.network}`);
        } catch (err) {
            logger.error({ err }, 'Failed to initialize AnchorService');
            this.enabled = false;
        }
    }

    /**
     * Determines if a domain event should be anchored on-chain
     */
    shouldAnchor(event: DomainEvent): boolean {
        return event.type in ANCHORABLE_EVENTS;
    }

    /**
     * Get the on-chain anchor type string for a domain event
     */
    getAnchorType(eventType: EventType): string {
        return ANCHORABLE_EVENTS[eventType] || 'UNKNOWN';
    }

    /**
     * Compute privacy-safe hashes for on-chain anchoring
     */
    computeHashes(event: DomainEvent): { groupId: string; refId: string; dataHash: string } {
        const tandaId = event.tanda_id || 'no-tanda';
        const groupId = ethers.keccak256(
            ethers.toUtf8Bytes(tandaId + this.salt)
        );

        const refId = ethers.keccak256(
            ethers.toUtf8Bytes((event.id || 'no-id') + this.salt)
        );

        const dataToHash = {
            type: event.type,
            timestamp: event.timestamp,
            user_id_hash: event.user_id
                ? ethers.keccak256(ethers.toUtf8Bytes(event.user_id + this.salt))
                : null,
            tanda_id_hash: groupId,
            amount: event.amount || null,
            payload_hash: ethers.keccak256(
                ethers.toUtf8Bytes(JSON.stringify(event.payload || {}) + this.salt)
            ),
        };
        const dataHash = ethers.keccak256(
            ethers.toUtf8Bytes(JSON.stringify(dataToHash))
        );

        return { groupId, refId, dataHash };
    }

    /**
     * Record anchor attempt in local database
     */
    private async recordAnchorLog(
        eventId: string,
        anchorType: string,
        groupId: string,
        dataHash: string,
        txHash: string | null,
        status: 'PENDING' | 'SENT' | 'CONFIRMED' | 'FAILED'
    ) {
        try {
            const db = await getDb();
            await db.run(
                `INSERT INTO anchor_log (event_id, anchor_type, group_id, data_hash, tx_hash, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [eventId, anchorType, groupId, dataHash, txHash, status, Date.now()]
            );
        } catch (err) {
            logger.warn({ err }, 'Failed to record anchor log');
        }
    }

    /**
     * Main entry point: process a domain event for potential on-chain anchoring
     */
    async processEvent(event: DomainEvent): Promise<void> {
        if (!this.shouldAnchor(event)) return;

        const anchorType = this.getAnchorType(event.type);
        const { groupId, refId, dataHash } = this.computeHashes(event);

        logger.info({ eventType: event.type, anchorType, tandaId: event.tanda_id },
            `Anchoring event on ${this.network}`);

        // Dry-run mode: log only, don't send TX
        if (!this.enabled || !this.contract) {
            logger.info({
                anchorType,
                groupId: groupId.substring(0, 10) + '...',
                dataHash: dataHash.substring(0, 10) + '...',
            }, '[DRY-RUN] Would anchor event');

            await this.recordAnchorLog(event.id || '', anchorType, groupId, dataHash, null, 'PENDING');
            return;
        }

        // Live mode: send TX to AnchorRegistry on Monad
        try {
            await this.recordAnchorLog(event.id || '', anchorType, groupId, dataHash, null, 'PENDING');

            const tx = await this.contract.anchor(groupId, anchorType, refId, dataHash);
            const receipt = await tx.wait();

            logger.info({
                txHash: receipt.hash,
                gasUsed: receipt.gasUsed.toString(),
                anchorType,
            }, `✅ Anchor TX confirmed on ${this.network}`);

            await this.recordAnchorLog(event.id || '', anchorType, groupId, dataHash, receipt.hash, 'CONFIRMED');
        } catch (err) {
            logger.error({ err, anchorType }, '❌ Anchor TX failed');
            await this.recordAnchorLog(event.id || '', anchorType, groupId, dataHash, null, 'FAILED');
        }
    }

    /**
     * Get all anchor logs for a tanda (by computing its groupId)
     */
    async getAnchorsByTanda(tandaId: string): Promise<any[]> {
        const groupId = ethers.keccak256(
            ethers.toUtf8Bytes(tandaId + this.salt)
        );
        const db = await getDb();
        return db.all(
            `SELECT * FROM anchor_log WHERE group_id = ? ORDER BY created_at ASC`,
            [groupId]
        );
    }

    /**
     * Check if the service is enabled and connected
     */
    isEnabled(): boolean {
        return this.enabled;
    }
}
