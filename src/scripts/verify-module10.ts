/**
 * Module 10: Proactive Reminders Verification Script
 * Tests:
 * - Reminder flag tracking (idempotence)
 * - E1/E2/E3/E4 event detection
 * - Message generation
 * - Organizer summary
 */

import { LedgerRepository } from '../infra/ledger';
import { TandaService } from '../domain/tanda-service';
import pino from 'pino';

const logger = pino({ name: 'verify-module10', level: 'info' });

async function main() {
    console.log('🧪 Module 10: Proactive Reminders Verification\n');

    // Setup
    const ledger = new LedgerRepository();
    const tandaService = new TandaService(ledger);

    // Clear tables
    const db = await ledger.getDatabase();
    await db.run("DELETE FROM events WHERE 1=1");
    await db.run("DELETE FROM reminder_flags WHERE 1=1");
    console.log('🧹 Cleared tables\n');

    const organizerId = '521111111111@s.whatsapp.net';
    const user1 = '522222222222@s.whatsapp.net';
    const user2 = '523333333333@s.whatsapp.net';

    // Create tanda
    const tanda = await tandaService.createTanda({
        name: 'Tanda Reminders M10',
        organizerId,
        amount: 1000,
        participants: 3,
        periodicity: 'weekly',
        durationMonths: 1
    });

    await tandaService.joinTanda(tanda.id, user1, 'MEMBER');
    await tandaService.joinTanda(tanda.id, user2, 'MEMBER');

    // Set calendar with due date = now (to trigger E2)
    const now = Date.now();
    await ledger.recordEvent({
        type: 'CalendarCreated',
        tanda_id: tanda.id,
        timestamp: now,
        payload: {
            schedule: [
                { round: 1, date: now }, // Due now (E2)
                { round: 2, date: now + 7 * 24 * 60 * 60 * 1000 },
                { round: 3, date: now + 14 * 24 * 60 * 60 * 1000 }
            ]
        }
    });
    console.log('📦 Created tanda with calendar (period 1 due now)\n');

    // Mock sendMessage function
    const sentMessages: { to: string; msg: string }[] = [];
    const mockSend = async (to: string, msg: string) => {
        sentMessages.push({ to, msg });
        console.log(`  📨 Sent to ${to.substring(0, 10)}...`);
    };

    // --- Step 1: Test evaluateReminders (should send E2) ---
    console.log('🧪 Test 1: Evaluate Reminders (E2 - due day)');
    const result1 = await tandaService.evaluateReminders(tanda.id, mockSend);
    console.log(`  Sent: ${result1.sent}, Skipped: ${result1.skipped}`);
    // Should send to 3 users (organizer + user1 + user2)
    const test1Pass = result1.sent >= 2; // At least user1 and user2 (organizer might be skipped)
    console.log(`  Result: ${test1Pass ? 'PASS' : 'FAIL'}\n`);

    // --- Step 2: Test Idempotence ---
    console.log('🧪 Test 2: Idempotence (run again, should not resend)');
    const beforeCount = sentMessages.length;
    const result2 = await tandaService.evaluateReminders(tanda.id, mockSend);
    const afterCount = sentMessages.length;
    const test2Pass = afterCount === beforeCount; // No new messages
    console.log(`  Sent this time: ${result2.sent}`);
    console.log(`  Result: ${test2Pass ? 'PASS' : 'FAIL'}\n`);

    // --- Step 3: Test Flag Retrieval ---
    console.log('🧪 Test 3: Reminder Flags');
    const flags = await tandaService.getReminderFlags(tanda.id, user1, 1);
    console.log(`  E1: ${flags.sent_E1}, E2: ${flags.sent_E2}, E3: ${flags.sent_E3}, E4: ${flags.sent_E4}`);
    const test3Pass = flags.sent_E2 === true && flags.sent_E1 === false;
    console.log(`  Result: ${test3Pass ? 'PASS' : 'FAIL'}\n`);

    // --- Step 4: Test Organizer Summary ---
    console.log('🧪 Test 4: Organizer Summary');
    const summary = await tandaService.getOrganizerSummary(tanda.id);
    console.log(`  Unpaid: ${summary?.unpaid}, In Grace: ${summary?.inGrace}, Late: ${summary?.late}`);
    const test4Pass = summary !== null && summary.periodId === 1;
    console.log(`  Result: ${test4Pass ? 'PASS' : 'FAIL'}\n`);

    // --- Step 5: Test Message Templates ---
    console.log('🧪 Test 5: Message Templates');
    const orgMsg = tandaService.getOrganizerReminderMessage({
        unpaid: 2,
        inGrace: 1,
        late: 0,
        periodId: 1
    });
    const hasEmoji = orgMsg.includes('📊');
    const hasNumbers = orgMsg.includes('Pendientes: 2');
    console.log(`  Has emoji: ${hasEmoji}, Has numbers: ${hasNumbers}`);
    const test5Pass = hasEmoji && hasNumbers;
    console.log(`  Result: ${test5Pass ? 'PASS' : 'FAIL'}\n`);

    // --- Summary ---
    console.log('='.repeat(50));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ E2 reminder sent: ${test1Pass ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Idempotence: ${test2Pass ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Flags tracking: ${test3Pass ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Organizer summary: ${test4Pass ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Message templates: ${test5Pass ? 'PASS' : 'FAIL'}`);
    console.log('='.repeat(50));

    const allPassed = test1Pass && test2Pass && test3Pass && test4Pass && test5Pass;

    console.log(allPassed ? '\n🎉 ALL TESTS PASSED!' : '\n❌ SOME TESTS FAILED');

    process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
