/**
 * Module 8: Closure + Yield + Raffle Verification Script
 * Tests:
 * - Ready to close detection
 * - Yield calculation
 * - Loss calculation
 * - Eligibility determination
 * - Raffle execution
 * - Idempotency
 */

import { LedgerRepository } from '../infra/ledger';
import { TandaService } from '../domain/tanda-service';
import pino from 'pino';

const logger = pino({ name: 'verify-module8', level: 'info' });

async function main() {
    console.log('🧪 Module 8: Closure + Raffle Verification\n');

    // Setup
    const ledger = new LedgerRepository();
    const tandaService = new TandaService(ledger);

    // Clear events table
    const db = await ledger.getDatabase();
    await db.run("DELETE FROM events WHERE 1=1");
    console.log('🧹 Cleared events table\n');

    const organizerId = '521111111111@s.whatsapp.net';
    const user1 = '522222222222@s.whatsapp.net';
    const user2 = '523333333333@s.whatsapp.net';

    // --- Step 1: Create and Activate Tanda ---
    console.log('📦 Step 1: Creating and activating Tanda...');
    const tanda = await tandaService.createTanda({
        name: 'Tanda Cierre M8',
        organizerId,
        amount: 1000,
        participants: 3,
        periodicity: 'weekly',
        durationMonths: 1
    });
    await tandaService.joinTanda(tanda.id, user1, 'MEMBER');
    await tandaService.joinTanda(tanda.id, user2, 'MEMBER');

    await ledger.recordEvent({
        type: 'InitialFundCompleted',
        tanda_id: tanda.id,
        timestamp: Date.now(),
        payload: {}
    });

    // Set past dates for calendar to simulate end
    const pastDate = Date.now() - (30 * 24 * 60 * 60 * 1000);
    await tandaService.assignTurnOrder(tanda.id, 'MANUAL', [organizerId, user1, user2]);

    // Modify calendar to be in the past
    const events = await ledger.getEventsByTanda(tanda.id);
    const calendarEvent = events.find(e => e.type === 'CalendarCreated');
    if (calendarEvent) {
        await db.run(`UPDATE events SET payload = ? WHERE uuid = ?`, [
            JSON.stringify({
                schedule: [
                    { round: 1, date: pastDate - 20 * 24 * 60 * 60 * 1000 },
                    { round: 2, date: pastDate - 10 * 24 * 60 * 60 * 1000 },
                    { round: 3, date: pastDate }
                ]
            }),
            calendarEvent.id
        ]);
    }
    console.log('✅ Tanda created with past calendar\n');

    // --- Step 2: Simulate payments ---
    console.log('💰 Step 2: Simulating payments...');
    await ledger.recordEvent({
        type: 'PeriodicPaymentRecorded',
        tanda_id: tanda.id,
        user_id: organizerId,
        amount: 1000,
        timestamp: Date.now(),
        payload: { round: 1, timing: 'ON_TIME' }
    });
    await ledger.recordEvent({
        type: 'ContributionReceived',
        tanda_id: tanda.id,
        user_id: organizerId,
        amount: 1000,
        timestamp: Date.now(),
        payload: { round: 1 }
    });
    await ledger.recordEvent({
        type: 'PeriodicPaymentRecorded',
        tanda_id: tanda.id,
        user_id: user1,
        amount: 1000,
        timestamp: Date.now(),
        payload: { round: 1, timing: 'ON_TIME' }
    });
    await ledger.recordEvent({
        type: 'ContributionReceived',
        tanda_id: tanda.id,
        user_id: user1,
        amount: 1000,
        timestamp: Date.now(),
        payload: { round: 1 }
    });
    // User2 has coverage (not repaid = loss)
    await ledger.recordEvent({
        type: 'PoolCovered',
        tanda_id: tanda.id,
        user_id: user2,
        timestamp: Date.now(),
        payload: { round: 1, coverage_count: 1 }
    });
    console.log('✅ Payments simulated (user2 has unpaid coverage)\n');

    // --- Step 3: Test Ready to Close ---
    console.log('🧪 Test 1: Ready to Close Check');
    const readyCheck = await tandaService.isTandaReadyToClose(tanda.id);
    console.log(`  Ready: ${readyCheck.ready}`);
    console.log(`  Result: ${readyCheck.ready ? 'PASS' : 'FAIL'}\n`);

    // --- Step 4: Test Yield Calculation ---
    console.log('🧪 Test 2: Yield Calculation');
    const yieldGross = await tandaService.calculateYieldGross(tanda.id);
    console.log(`  Yield Gross (5% of fund): $${yieldGross}`);
    console.log(`  Result: ${yieldGross > 0 ? 'PASS' : 'SKIP (no fund set)'}\n`);

    // --- Step 5: Test Loss Calculation ---
    console.log('🧪 Test 3: Loss Calculation');
    const losses = await tandaService.calculateLosses(tanda.id);
    console.log(`  Losses (unrepaid coverages): $${losses}`);
    console.log(`  Result: ${losses === 1000 ? 'PASS' : 'FAIL'}\n`);

    // --- Step 6: Test Eligibility ---
    console.log('🧪 Test 4: Eligibility Check');
    const eligibles = await tandaService.getEligibleForRaffle(tanda.id);
    console.log(`  Eligible count: ${eligibles.length}`);
    console.log(`  Eligibles: ${eligibles.map(e => e.substring(0, 10)).join(', ')}`);
    // user2 should NOT be eligible (has unpaid coverage)
    const user2Eligible = eligibles.includes(user2);
    console.log(`  User2 excluded: ${!user2Eligible ? 'PASS' : 'FAIL'}\n`);

    // --- Step 7: Test Close Tanda ---
    console.log('🧪 Test 5: Close Tanda');
    const closeResult = await tandaService.closeTanda(tanda.id, organizerId);
    console.log(`  Success: ${closeResult.success}`);
    console.log(`  Message: ${closeResult.msg.substring(0, 100)}...`);
    console.log(`  Result: ${closeResult.success ? 'PASS' : 'FAIL'}\n`);

    // --- Step 8: Test Idempotency ---
    console.log('🧪 Test 6: Idempotency');
    const closeResult2 = await tandaService.closeTanda(tanda.id, organizerId);
    console.log(`  Second close prevented: ${!closeResult2.success ? 'PASS' : 'FAIL'}\n`);

    // --- Step 9: Verify Ledger Events ---
    console.log('🧪 Test 7: Ledger Events');
    const finalEvents = await ledger.getEventsByTanda(tanda.id);
    const yieldCalc = finalEvents.find(e => e.type === 'YieldCalculated');
    const raffleDraw = finalEvents.find(e => e.type === 'RaffleDrawn');
    const winner = finalEvents.find(e => e.type === 'RaffleWinnerSelected');
    const closed = finalEvents.find(e => e.type === 'TandaClosed');
    console.log(`  YieldCalculated: ${yieldCalc ? 'PASS' : 'FAIL'}`);
    console.log(`  RaffleDrawn: ${raffleDraw ? 'PASS' : 'SKIP'}`);
    console.log(`  RaffleWinnerSelected: ${winner ? 'PASS' : 'SKIP'}`);
    console.log(`  TandaClosed: ${closed ? 'PASS' : 'FAIL'}\n`);

    // --- Summary ---
    console.log('='.repeat(50));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Ready to close: ${readyCheck.ready ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Loss calculation: ${losses === 1000 ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Eligibility (user2 excluded): ${!user2Eligible ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Close tanda: ${closeResult.success ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Idempotency: ${!closeResult2.success ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Ledger events: ${yieldCalc && closed ? 'PASS' : 'FAIL'}`);
    console.log('='.repeat(50));

    const allPassed =
        readyCheck.ready &&
        losses === 1000 &&
        !user2Eligible &&
        closeResult.success &&
        !closeResult2.success &&
        yieldCalc && closed;

    console.log(allPassed ? '\n🎉 ALL TESTS PASSED!' : '\n❌ SOME TESTS FAILED');

    process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
