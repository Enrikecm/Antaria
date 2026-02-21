import { LedgerRepository } from '../infra/ledger';
import { TandaService } from '../domain/tanda-service';
import pino from 'pino';

const logger = pino({ transport: { target: 'pino-pretty' } });

async function runDomainVerification() {
    logger.info('Starting Domain Verification...');
    const ledger = new LedgerRepository();
    const service = new TandaService(ledger);
    const tanda = await service.createTanda({
        name: 'Tanda Test 1', organizerId: 'u-org', amount: 1000, participants: 2, periodicity: 'weekly', durationMonths: 6
    });
    logger.info({ tandaId: tanda.id }, 'Tanda Created');
}

runDomainVerification().catch(err => {
    logger.fatal(err);
    process.exit(1);
});
