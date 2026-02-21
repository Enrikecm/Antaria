import { MessageHandler } from '../app/message-handler';
import { SessionRepository } from '../infra/session-repo';
import { LedgerRepository } from '../infra/ledger';
import { TandaService } from '../domain/tanda-service';
import pino from 'pino';

// Mock WhatsApp Service
class MockWhatsAppService {
    async sendMessage(to: string, text: string) {
        process.stdout.write(`\n🤖 BOT -> ${to}: ${text.split('\n')[0]}...\n`);
    }
}

async function runModule3Verification() {
    console.log('--- START MODULE 3 VERIFICATION ---');
    const ledger = new LedgerRepository();

    // Ensure Schema Initialized & Clean DB
    const db = await import('../infra/database').then(m => m.getDb());
    await db.run('DELETE FROM events');
    console.log('DB Cleared');

    const wa = new MockWhatsAppService() as any;
    const sessionRepo = new SessionRepository();
    const tandaService = new TandaService(ledger);
    const handler = new MessageHandler(wa, sessionRepo, tandaService, ledger);

    const alice = 'alice'; // Organizer
    const bob = 'bob'; // Member

    const send = async (user: string, text: string) => {
        const jid = `${user}@s.whatsapp.net`;
        console.log(`\n👤 ${user}: ${text}`);
        await handler.handle({
            key: { remoteJid: jid, fromMe: false },
            message: { conversation: text }
        });
    };

    await sessionRepo.clearState(alice);
    await sessionRepo.clearState(bob);

    // 1. Alice Creates Tanda (2 participants)
    await send(alice, '1'); // Create
    await send(alice, 'Tanda Magica');
    await send(alice, '1000');
    await send(alice, '2'); // 2 participants
    await send(alice, '1'); // Weekly
    await send(alice, '10'); // Duration
    await send(alice, 'SI'); // Confirm

    // Get Code
    const events = await ledger.getAllTandaCreatedEvents();
    const lastTanda = events.slice(-1)[0];
    const code = lastTanda.payload.inviteCode;
    console.log(`>>> Code: ${code}`);

    // 2. Bob Joins
    await send(bob, '2'); // Join
    await send(bob, code);

    // 3. Alice Pays (Initial)
    await send(alice, '4');
    await send(alice, 'Foto Alice');

    // 4. Bob Pays (Initial)
    await send(bob, '4');
    await send(bob, 'Foto Bob');

    // 5. Alice Validates
    // We loop validation twice to validate both
    console.log('Start Validation Loop');
    await send(alice, '8'); // Organizer Panel -> First Pending (e.g. Alice's)
    await send(alice, '1'); // Validate

    await send(alice, '8'); // Organizer Panel -> Second Pending (e.g. Bob's)
    await send(alice, '1'); // Validate

    console.log('\n--- VERIFYING LEDGER STATE ---');
    console.log(`Checking Tanda ID: ${lastTanda.id}`);
    const dbEvents = await ledger.getEventsByTanda(lastTanda.id!);
    console.log('Events found:', dbEvents.map(e => e.type).join(', '));

    const fundCompleted = dbEvents.find(e => e.type === 'InitialFundCompleted');

    if (fundCompleted) {
        console.log('✅ InitialFundCompleted Event Found!');
    } else {
        console.error('❌ InitialFundCompleted Event MISSING');
    }

    console.log('--- END MODULE 3 VERIFICATION ---');
}

runModule3Verification().catch(console.error);
