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

async function runModule52Verification() {
    console.log('--- START MODULE 5.2 VERIFICATION ---');
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
    const bob = 'bob'; // Defaulter (Case B)
    const charlie = 'charlie';

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
    await send(alice, 'Tanda Case B'); await delay(100);
    await send(alice, '1000'); await delay(100);
    await send(alice, '2'); await delay(100);
    await send(alice, '1'); await delay(100);
    await send(alice, '10'); await delay(100);
    await send(alice, 'SI'); await delay(500);

    const events = await ledger.getAllTandaCreatedEvents();
    const tandaId = events.slice(-1)[0].tanda_id!;
    const code = events.slice(-1)[0].payload.inviteCode;

    await send(bob, '2'); await send(bob, code);

    // Payments & Activation
    await send(alice, '4'); await send(alice, 'Ref');
    await send(bob, '4'); await send(bob, 'Ref');
    await send(alice, '8'); await send(alice, '1');
    await send(alice, '8'); await send(alice, '1');

    await send(alice, '8'); await delay(200);
    await send(alice, '1'); await delay(500);

    console.log('[SETUP] Tanda Active. Simulating Case B (Bob received turn).');

    // 2. Manipulate Calendar: Bob received turn YESTERDAY.
    const calEvt = (await ledger.getEventsByTanda(tandaId)).find(e => e.type === 'CalendarCreated');
    const schedule = calEvt?.payload.schedule;

    // Find Bob's turn
    const bobTurnIdx = schedule.findIndex((s: any) => s.userId === bob);
    schedule[bobTurnIdx].date = Date.now() - 100000; // Received Turn

    // Update Calendar
    await db.run(`UPDATE events SET payload = ? WHERE uuid = ?`, [JSON.stringify({ schedule }), calEvt?.id]);

    // 3. Bob Defaults
    await ledger.recordEvent({
        type: 'DefaultConfirmed',
        tanda_id: tandaId,
        user_id: bob,
        timestamp: Date.now(),
        payload: { reason: 'limit_exceeded', round: 2 }
    });

    console.log('[TEST] Checking Block Status...');
    const status = await tandaService.isUserBlocked(bob);
    if (status.blocked) console.log('✅ Bob is BLOCKED locally.'); else console.error('❌ Bob is NOT blocked');

    console.log('[ACTION] Bob tries to join new Tanda...');
    // Create new Tanda by Charlie
    await send(charlie, '1'); await send(charlie, 'Tanda Charlie'); await send(charlie, '100'); await send(charlie, '2'); await send(charlie, '1'); await send(charlie, '10'); await send(charlie, 'SI');
    const evts2 = await ledger.getAllTandaCreatedEvents();
    const code2 = evts2.slice(-1)[0].payload.inviteCode;

    // Bob Joins
    await send(bob, '2'); await send(bob, code2);
    // Expect Error Log in console (Flow Error)

    // 4. Alice Organizer Panel (Case B)
    console.log('[ACTION] Alice entering Organizer Panel...');
    await send(alice, '8');

    // Alice should see Case B menu.
    // Choose 3: Reverse
    console.log('[ACTION] Alice reversing default...');
    await send(alice, '3');

    // 5. Verify Unblock
    const status2 = await tandaService.isUserBlocked(bob);
    if (!status2.blocked) console.log('✅ Bob UNBLOCKED after reversal.'); else console.error('❌ Bob still blocked');

    const finalEvts = await ledger.getEventsByTanda(tandaId);
    if (finalEvts.find(e => e.type === 'DefaultReversed')) console.log('✅ DefaultReversed Event Found.');

    console.log('--- END MODULE 5.2 VERIFICATION ---');
}

runModule52Verification().catch(console.error);
