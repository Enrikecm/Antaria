import { Database } from 'sqlite';
import { getDb } from './database';
import pino from 'pino';

const logger = pino({ name: 'infra/session' });

export interface UserSession {
    userId: string;
    state: string;
    context: any;
}

export class SessionRepository {
    private db: Database | null = null;

    async getDatabase(): Promise<Database> {
        if (!this.db) {
            this.db = await getDb();
            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS user_sessions (
                    user_id TEXT PRIMARY KEY,
                    state TEXT,
                    context TEXT
                );
            `);
        }
        return this.db;
    }

    async getState(userId: string): Promise<UserSession | null> {
        const db = await this.getDatabase();
        const row = await db.get(`SELECT * FROM user_sessions WHERE user_id = ?`, [userId]);
        if (!row) return null;
        return {
            userId: row.user_id,
            state: row.state,
            context: JSON.parse(row.context)
        };
    }

    async setState(userId: string, state: string, context: any = {}): Promise<void> {
        const db = await this.getDatabase();
        await db.run(
            `INSERT INTO user_sessions (user_id, state, context) 
             VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET state = ?, context = ?`,
            [userId, state, JSON.stringify(context), state, JSON.stringify(context)]
        );
    }

    async clearState(userId: string): Promise<void> {
        const db = await this.getDatabase();
        await db.run(`DELETE FROM user_sessions WHERE user_id = ?`, [userId]);
    }
}
