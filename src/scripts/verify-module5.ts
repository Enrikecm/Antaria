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

async function runModule5Verification() {
    console.log('--- START MODULE 5 VERIFICATION ---');
    const ledger = new LedgerRepository();
    const db = await import('../infra/database').then(m => m.getDb());
    await db.run('DELETE FROM events');
    await db.run('DELETE FROM user_sessions');

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

    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

    // 1. Setup Tanda, Activation, Calendar
    console.log('[SETUP] Creating Active Tanda...');
    await send(alice, '1'); await delay(100);
    await send(alice, 'Tanda 5'); await delay(100);
    await send(alice, '1000'); await delay(100);
    await send(alice, '2'); await delay(100);
    await send(alice, '1'); await delay(100);
    await send(alice, '10'); await delay(100);
    await send(alice, 'SI'); await delay(500); // Wait for DB write

    const events = await ledger.getAllTandaCreatedEvents();
    if (events.length === 0) {
        console.log('CRITICAL: No TandaCreated events found after flow.');
        // Check all events
        const all = await db.all('SELECT * FROM events');
        console.log('All events in DB:', all.map(e => e.type).join(', '));
        process.exit(1);
    }
    const tandaId = events.slice(-1)[0].tanda_id!;
    console.log(`[SCRIPT] Using Tanda ID: ${tandaId}`);
    const code = events.slice(-1)[0].payload.inviteCode;

    await send(bob, '2'); await send(bob, code);

    // Pay Initials
    await send(alice, '4'); await send(alice, 'Ref Alice');
    await send(bob, '4'); await send(bob, 'Ref Bob');

    // Validate
    await send(alice, '8'); await delay(200);
    await send(alice, '1'); await delay(500); // Validate 1

    await send(alice, '8'); await delay(200);
    await send(alice, '1'); await delay(1000); // Validate 2 (Should trigger Fund Complete)

    // Check if Funding Completed
    const fundCheckEvts = await ledger.getEventsByTanda(tandaId);
    if (!fundCheckEvts.find(e => e.type === 'InitialFundCompleted')) {
        console.error('CRITICAL: InitialFundCompleted NOT found after 2nd validation.');
    } else {
        console.log('✅ InitialFundCompleted found.');
    }

    // Assign Turn Order (Activation)
    console.log('[ACTION] Entering Organizer Panel to Trigger Activation...');
    await send(alice, '8'); await delay(500); // Trigger checkPendingTurnOrder

    console.log('[ACTION] Assigning Turn Order...');
    await send(alice, '1'); await delay(1000); // Random -> Activates

    console.log('[SETUP] Tanda Active. Calendar Generated.');

    // 2. Manipulate Calendar to simulate "Yesterday was due date"
    // Fetch Calendar
    let allEvts = await ledger.getEventsByTanda(tandaId);
    console.log('Events found:');
    console.log(allEvts.map(e => ` - ${e.type}`).join('\n'));

    const calEvt = allEvts.find(e => e.type === 'CalendarCreated');

    if (!calEvt) {
        console.error('CRITICAL: CalendarCreated event not found!');
        process.exit(1);
    }

    const schedule = calEvt.payload.schedule;

    // Hack: Update event payload in DB to set first date to Past
    const pastDate = Date.now() - (24 * 60 * 60 * 1000); // Yesterday
    schedule[0].date = pastDate;

    await db.run(`UPDATE events SET payload = ? WHERE uuid = ?`, [JSON.stringify({ schedule }), calEvt?.id]);
    console.log('[SIM] Time Travel: First payment was due yesterday.');

    // 3. Run Late Check
    console.log('[ACTION] Running checkLatePayments...');
    await tandaService.checkLatePayments();

    // Verify Late + Covered
    let evts = await ledger.getEventsByTanda(tandaId);
    const late = evts.find(e => e.type === 'ContributionLate');
    const covered = evts.find(e => e.type === 'PoolCovered');

    if (late && covered) {
        console.log('✅ LATE DETECTED & COVERED (Policy v1)');
    } else {
        console.error('❌ Failed to detect late/cover.');
    }

    // 4. Simulate Window Expiry Warning (Day 2)
    const windowEvt = evts.find(e => e.type === 'RegularizationWindowStarted');
    // Set window start to 30 hours ago
    const start30h = Date.now() - (30 * 60 * 60 * 1000);
    await db.run(`UPDATE events SET timestamp = ? WHERE uuid = ?`, [start30h, windowEvt?.id]);

    console.log('[ACTION] Running checkRegularizationWindows (Simulating Day 2)...');
    await tandaService.checkRegularizationWindows();

    evts = await ledger.getEventsByTanda(tandaId);
    const reminder = evts.find(e => e.type === 'WindowReminderSent');
    if (reminder) console.log('✅ Reminder Sent'); else console.error('❌ Reminder Missing');

    // 5. Regularize (Pay Late)
    console.log('[ACTION] Bob paying late...');
    const lateUser = late?.user_id || 'unknown';
    // If random assigned Alice first, Alice is late. Check logs.
    console.log(`Late User is: ${lateUser}`);

    await send(lateUser, '4');
    await send(lateUser, 'Late Payment Proof');

    await send(alice, '8'); // Organizer validates
    await send(alice, '1');

    evts = await ledger.getEventsByTanda(tandaId);
    const restored = evts.find(e => e.type === 'CoverageRestored');

    if (restored) {
        console.log('✅ COVERAGE RESTORED. Regularization Complete.');
    } else {
        console.error('❌ Failed to restore coverage.');
    }

    console.log('--- END MODULE 5 VERIFICATION ---');
}

runModule5Verification().catch(console.error);
