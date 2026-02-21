import { LedgerRepository } from '../infra/ledger';
import { DomainEvent } from '../domain/events';
import pino from 'pino';

const logger = pino({
    transport: { target: 'pino-pretty' }
});

async function runVerification() {
    logger.info('Starting Ledger Verification...');
    const ledger = new LedgerRepository();
    const tandaId = 'tanda-123';
    const event1: Omit<DomainEvent, 'id'> = {
        type: 'TandaCreated',
        payload: { name: 'Tanda Verano', periodicity: 'weekly' },
        timestamp: Date.now(),
        tanda_id: tandaId,
        user_id: 'user-admin'
    };
    await ledger.recordEvent(event1);
    const events = await ledger.getEventsByTanda(tandaId);
    if (events.length > 0) logger.info('Verification SUCCESS!');
}

runVerification().catch(err => {
    logger.fatal(err);
    process.exit(1);
});
