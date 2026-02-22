import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import pino from 'pino';

const logger = pino({ name: 'infra/db' });

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
    if (dbInstance) {
        return dbInstance;
    }

    dbInstance = await open({
        filename: './antaria.db',
        driver: sqlite3.Database
    });

    logger.info('Connected to SQLite database.');
    await dbInstance.exec('PRAGMA journal_mode = WAL;');
    await initSchema(dbInstance);

    return dbInstance;
}

async function initSchema(db: Database) {
    logger.info('Initializing schema...');

    await db.exec(`
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            type TEXT NOT NULL,
            payload TEXT NOT NULL, 
            timestamp INTEGER NOT NULL,
            user_id TEXT,
            tanda_id TEXT,
            pool_id TEXT,
            amount REAL,
            external_ref TEXT
        );
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS replacement_invites (
            code TEXT PRIMARY KEY,
            tanda_id TEXT NOT NULL,
            replaced_user_id TEXT NOT NULL,
            status TEXT NOT NULL, -- ACTIVE, USED, EXPIRED
            created_at INTEGER NOT NULL,
            used_by_user_id TEXT
        );
    `);

    // Module 9: Fund Layers
    await db.exec(`
        CREATE TABLE IF NOT EXISTS fund_layers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tanda_id TEXT UNIQUE NOT NULL,
            capa1_balance REAL NOT NULL DEFAULT 0,
            capa2_balance REAL NOT NULL DEFAULT 0,
            capa3_balance REAL NOT NULL DEFAULT 0,
            capa4_balance REAL NOT NULL DEFAULT 0,
            capa3_initial REAL NOT NULL DEFAULT 0,
            capa4_initial REAL NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        );
    `);

    // Module 10: Reminder Flags (idempotence anti-spam)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS reminder_flags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tanda_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            period_id INTEGER NOT NULL,
            sent_E1 INTEGER NOT NULL DEFAULT 0,
            sent_E2 INTEGER NOT NULL DEFAULT 0,
            sent_E3 INTEGER NOT NULL DEFAULT 0,
            sent_E4 INTEGER NOT NULL DEFAULT 0,
            sent_org INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            UNIQUE(tanda_id, user_id, period_id)
        );
    `);

    // Monad Anchor Log
    await db.exec(`
        CREATE TABLE IF NOT EXISTS anchor_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL,
            anchor_type TEXT NOT NULL,
            group_id TEXT NOT NULL,
            data_hash TEXT NOT NULL,
            tx_hash TEXT,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
    `);

    await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_tanda_id ON events(tanda_id);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_pool_id ON events(pool_id);`);

    logger.info('Schema initialized.');
}
