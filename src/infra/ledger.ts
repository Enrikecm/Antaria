import { Database } from 'sqlite';
import { getDb } from './database';
import { DomainEvent } from '../domain/events';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';

const logger = pino({ name: 'infra/ledger' });

export class LedgerRepository {
    private db: Database | null = null;
    private anchorService: any = null;

    setAnchorService(service: any) {
        this.anchorService = service;
    }

    async getDatabase(): Promise<Database> {
        if (!this.db) {
            this.db = await getDb();
        }
        return this.db;
    }

    async recordEvent(event: Omit<DomainEvent, 'id'>): Promise<string> {
        const db = await this.getDatabase();
        const eventUuid = uuidv4();
        const timestamp = event.timestamp || Date.now();

        await db.run(
            `INSERT INTO events (
                uuid, type, payload, timestamp, user_id, tanda_id, pool_id, amount, external_ref
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                eventUuid,
                event.type,
                JSON.stringify(event.payload),
                timestamp,
                event.user_id || null,
                event.tanda_id || null,
                event.pool_id || null,
                event.amount || null,
                event.external_ref || null
            ]
        );

        // Hook: anchor key events on Celo (non-blocking)
        if (this.anchorService) {
            this.anchorService.processEvent({ ...event, id: eventUuid, timestamp }).catch((err: any) => {
                logger.warn({ err }, 'Anchor failed (non-blocking)');
            });
        }

        return eventUuid;
    }

    async getEventsByTanda(tandaId: string): Promise<DomainEvent[]> {
        const db = await this.getDatabase();
        const rows = await db.all<any[]>(
            `SELECT * FROM events WHERE tanda_id = ? ORDER BY timestamp ASC`,
            [tandaId]
        );
        return rows.map(this.mapRowToEvent);
    }

    async getEventsByUser(userId: string): Promise<DomainEvent[]> {
        const db = await this.getDatabase();
        const rows = await db.all<any[]>(
            `SELECT * FROM events WHERE user_id = ? ORDER BY timestamp ASC`,
            [userId]
        );
        return rows.map(this.mapRowToEvent);
    }

    async getAllTandaCreatedEvents(): Promise<DomainEvent[]> {
        const db = await this.getDatabase();
        const rows = await db.all<any[]>(
            `SELECT * FROM events WHERE type = 'TandaCreated'`
        );
        return rows.map(this.mapRowToEvent);
    }

    private mapRowToEvent(row: any): DomainEvent {
        return {
            id: row.uuid,
            type: row.type,
            payload: JSON.parse(row.payload),
            timestamp: row.timestamp,
            user_id: row.user_id,
            tanda_id: row.tanda_id,
            pool_id: row.pool_id,
            amount: row.amount,
            external_ref: row.external_ref
        };
    }
}
