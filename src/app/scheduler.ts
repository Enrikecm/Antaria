import { TandaService } from '../domain/tanda-service';
import pino from 'pino';

const logger = pino({ name: 'app/scheduler' });

export function setupScheduler(tandaService: TandaService) {
    logger.info('Scheduler started. Jobs will run every 60 seconds (MVP).');

    setInterval(async () => {
        try {
            await tandaService.checkLatePayments();
            await tandaService.checkRegularizationWindows();
        } catch (err) {
            logger.error(err, 'Scheduler Job Failed');
        }
    }, 60000);
}
