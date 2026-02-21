import pino from 'pino';
import { getDb } from './infra/database';
import { WhatsAppService } from './infra/baileys';
import { SessionRepository } from './infra/session-repo';
import { LedgerRepository } from './infra/ledger';
import { TandaService } from './domain/tanda-service';
import { MessageHandler } from './app/message-handler';
import { setupScheduler } from './app/scheduler';
import { CeloAnchorService } from './infra/celo-anchor';

const logger = pino({ transport: { target: 'pino-pretty' } });

async function main() {
    try {
        logger.info('Antaria Bot initializing...');
        await getDb();

        const ledger = new LedgerRepository();
        const sessionRepo = new SessionRepository();
        const tandaService = new TandaService(ledger);
        const wa = new WhatsAppService();
        const handler = new MessageHandler(wa, sessionRepo, tandaService, ledger);

        // Celo Anchor Service (non-blocking)
        const anchorService = new CeloAnchorService();
        ledger.setAnchorService(anchorService);
        logger.info({ enabled: anchorService.isEnabled() }, 'Celo Anchor Service initialized');

        wa.onMessage(async (msg) => {
            await handler.handle(msg);
        });

        await wa.connect();

        setupScheduler(tandaService);

    } catch (err) {
        logger.fatal(err, 'Startup failed');
        process.exit(1);
    }
}

main();

