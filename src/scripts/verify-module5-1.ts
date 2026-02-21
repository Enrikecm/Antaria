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

async function runModule51Verification() {
    console.log('--- START MODULE 5.1 VERIFICATION ---');
    const ledger = new LedgerRepository();
    const db = await import('../infra/database').then(m => m.getDb());

    // Clean DB
    await db.run('DELETE FROM events');
    await db.run('DELETE FROM user_sessions');
    await db.run('DELETE FROM replacement_invites');

    const wa = new MockWhatsAppService() as any;
    const sessionRepo = new SessionRepository();
    const tandaService = new TandaService(ledger);
    const handler = new MessageHandler(wa, sessionRepo, tandaService, ledger);

    const alice = 'alice'; // Organizer
    const bob = 'bob'; // To be replaced
    const charlie = 'charlie'; // Replacement

    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
    const send = async (user: string, text: string) => {
        const jid = `${user}@s.whatsapp.net`;
        console.log(`\n👤 ${user}: ${text}`);
        await handler.handle({
            key: { remoteJid: jid, fromMe: false },
            message: { conversation: text }
        });
    };

    // 1. Setup Tanda
    console.log('[SETUP] Creating Active Tanda...');
    await send(alice, '1'); await delay(100);
    await send(alice, 'Tanda Def Repl'); await delay(100);
    await send(alice, '1000'); await delay(100);
    await send(alice, '2'); await delay(100);
    await send(alice, '1'); await delay(100);
    await send(alice, '10'); await delay(100);
    await send(alice, 'SI'); await delay(500);

    const events = await ledger.getAllTandaCreatedEvents();
    const tandaId = events.slice(-1)[0].tanda_id!;
    const code = events.slice(-1)[0].payload.inviteCode;

    await send(bob, '2'); await send(bob, code);

    // Payments
    await send(alice, '4'); await send(alice, 'Ref');
    await send(bob, '4'); await send(bob, 'Ref');
    await send(alice, '8'); await send(alice, '1');
    await send(alice, '8'); await send(alice, '1');

    // Activation (Turn Order)
    await send(alice, '8'); await delay(200);
    await send(alice, '1'); await delay(500); // Random

    console.log('[SETUP] Tanda Active. Bob Joining Default.');

    // 2. Simulate Default
    // Bob defaults on Round 1
    // We manually insert the DefaultConfirmed event as if checks happened
    const calEvt = (await ledger.getEventsByTanda(tandaId)).find(e => e.type === 'CalendarCreated');
    const schedule = calEvt?.payload.schedule;

    // Ensure Bob's turn is NOT now.
    // If Random assign Bob round 1, then his date is NOW+7days.
    // We check eligibility: Date > Now?
    // StartDate is +7 days. So Bob has NOT received turn.

    await ledger.recordEvent({
        type: 'DefaultConfirmed',
        tanda_id: tandaId,
        user_id: bob,
        timestamp: Date.now(),
        payload: { reason: 'limit_exceeded', round: 1 }
    });

    console.log('[ACTION] Alice entering Organizer Panel...');
    await send(alice, '8');

    // Should see prompt
    console.log('[ACTION] Alice choosing to Replace...');
    await send(alice, '1');

    // 3. Capture Code
    const replEvents = await ledger.getEventsByTanda(tandaId);
    const codeEvt = replEvents.find(e => e.type === 'ReplacementCodeCreated');

    if (!codeEvt) {
        console.error('CRITICAL: No Replacement Code Generated.');
        process.exit(1);
    }
    const replCode = codeEvt.payload.code;
    console.log(`>>> Replacement Code: ${replCode}`);

    // 4. Charlie Joins
    console.log('[ACTION] Charlie joining with Replacement Code...');
    await send(charlie, '2');
    await send(charlie, replCode);

    // Should ask for payment immediately
    console.log('[ACTION] Charlie paying...');
    await send(charlie, 'Photo Charlie');

    // 5. Alice Validates
    console.log('[ACTION] Alice validating Charlie...');
    await send(alice, '8');
    // This goes to Organzier Panel -> Checks Defaults (Empty now, Bob removed or handled?)
    // Note: Active Default check should filter out "ParticipantRemoved".
    // We emitted ParticipantRemoved in generateReplacementCode. So it should skip default prompt and go to pending proofs.

    await send(alice, '1'); // Validate

    // 6. Verify
    const finalEvts = await ledger.getEventsByTanda(tandaId);
    if (finalEvts.find(e => e.type === 'ReplacementConfirmed')) {
        console.log('✅ ReplacementConfirmed Found.');
    } else {
        console.error('❌ ReplacementConfirmed MISSING.');
    }

    if (finalEvts.find(e => e.type === 'ParticipantRemoved' && e.user_id === bob)) {
        console.log('✅ Bob Removed.');
    } else {
        console.error('❌ Bob Detection Failed.');
    }

    console.log('--- END MODULE 5.1 VERIFICATION ---');
}

runModule51Verification().catch(console.error);
