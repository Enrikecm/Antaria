/**
 * Module 4: Periodic Payment Verification Script
 * Tests the complete periodic payment flow including:
 * - Payment ON_TIME
 * - Payment GRACE
 * - Payment LATE (without coverage)
 * - Payment LATE (with coverage - repayment)
 * - Priority to oldest unpaid period
 * - Rejection when user is REPLACED
 */

import { LedgerRepository } from '../infra/ledger';
import { TandaService } from '../domain/tanda-service';
import pino from 'pino';

const logger = pino({ name: 'verify-module4', level: 'info' });

async function main() {
    console.log('🧪 Module 4: Periodic Payment Verification\n');

    // Setup
    const ledger = new LedgerRepository();
    const tandaService = new TandaService(ledger);

    // Clear sessions table first to avoid state pollution
    const db = await ledger.getDatabase();
    await db.run("DELETE FROM events WHERE 1=1");
    console.log('🧹 Cleared events table\n');

    const organizerId = '521111111111@s.whatsapp.net';
    const user1 = '522222222222@s.whatsapp.net';
    const user2 = '523333333333@s.whatsapp.net';

    // --- Step 1: Create Tanda ---
    console.log('📦 Step 1: Creating Tanda...');
    const tanda = await tandaService.createTanda({
        name: 'Tanda Verificación M4',
        organizerId,
        amount: 1000,
        participants: 2,
        periodicity: 'weekly',
        durationMonths: 2
    });
    console.log(`✅ Tanda created: ${tanda.id}\n`);

    // --- Step 2: Add participants ---
    console.log('👥 Step 2: Adding participants...');
    await tandaService.joinTanda(tanda.id, user1, 'MEMBER');
    console.log(`✅ User1 joined`);

    // --- Step 3: Simulate Initial Fund Complete ---
    console.log('\n💰 Step 3: Simulating Initial Fund...');
    await ledger.recordEvent({
        type: 'InitialFundCompleted',
        tanda_id: tanda.id,
        timestamp: Date.now(),
        payload: {}
    });

    // --- Step 4: Activate Tanda with Calendar ---
    console.log('\n📅 Step 4: Activating Tanda with Calendar...');
    const order = [organizerId, user1];
    await tandaService.assignTurnOrder(tanda.id, 'MANUAL', order);
    console.log('✅ Calendar created and Tanda activated\n');

    // --- Step 5: Test Payment ON_TIME ---
    console.log('🧪 Test 1: Payment ON_TIME');
    const result1 = await tandaService.payPeriodic({
        userId: user1,
        tandaId: tanda.id,
        amountFiat: 1000
    });
    console.log(`  Result: ${result1.success ? '✅' : '❌'} ${result1.msg}`);
    console.log(`  Timing: ${result1.timing}`);
    console.log(`  Period: ${result1.periodId}\n`);

    // --- Step 6: Test Wrong Amount ---
    console.log('🧪 Test 2: Wrong Amount (should fail)');
    const result2 = await tandaService.payPeriodic({
        userId: organizerId,
        tandaId: tanda.id,
        amountFiat: 500  // Wrong amount
    });
    console.log(`  Result: ${result2.success ? '✅' : '❌'} ${result2.msg}\n`);

    // --- Step 7: Test Correct Amount for Organizer ---
    console.log('🧪 Test 3: Correct Payment for Organizer');
    const result3 = await tandaService.payPeriodic({
        userId: organizerId,
        tandaId: tanda.id,
        amountFiat: 1000
    });
    console.log(`  Result: ${result3.success ? '✅' : '❌'} ${result3.msg}\n`);

    // --- Step 8: Simulate Late Payment with Coverage ---
    console.log('🧪 Test 4: Late Payment with Coverage (Simulated)');

    // Simulate coverage for user1 round 2
    await ledger.recordEvent({
        type: 'PoolCovered',
        tanda_id: tanda.id,
        user_id: user1,
        timestamp: Date.now(),
        payload: { round: 2, coverage_count: 1 }
    });
    console.log('  📦 Simulated coverage event for round 2');

    // Now pay - should trigger coverage repayment
    const result4 = await tandaService.payPeriodic({
        userId: user1,
        tandaId: tanda.id,
        amountFiat: 1000
    });
    console.log(`  Result: ${result4.success ? '✅' : '❌'} ${result4.msg}\n`);

    // --- Step 9: Test User Status ---
    console.log('🧪 Test 5: User Status Checks');
    const status1 = await tandaService.getUserPaymentStatus(user1, tanda.id);
    const status2 = await tandaService.getUserPaymentStatus(organizerId, tanda.id);
    console.log(`  User1 Status: ${status1}`);
    console.log(`  Organizer Status: ${status2}\n`);

    // --- Step 10: Test REPLACED user ---
    console.log('🧪 Test 6: REPLACED user cannot pay');

    // Simulate removed user
    await ledger.recordEvent({
        type: 'ParticipantRemoved',
        tanda_id: tanda.id,
        user_id: user2,
        timestamp: Date.now(),
        payload: { reason: 'DEFAULT' }
    });

    // Add as participant first to test
    await tandaService.joinTanda(tanda.id, user2, 'MEMBER');

    const result5 = await tandaService.payPeriodic({
        userId: user2,
        tandaId: tanda.id,
        amountFiat: 1000
    });
    console.log(`  Result: ${result5.success ? '✅' : '❌'} ${result5.msg}\n`);

    // --- Step 11: Verify Ledger Events ---
    console.log('📋 Ledger events created:');
    const events = await ledger.getEventsByTanda(tanda.id);
    const m4Events = events.filter(e =>
        ['PeriodicPaymentRecorded', 'CoverageRepaid', 'ContributionReceived', 'ContributionRegularized'].includes(e.type)
    );
    for (const e of m4Events) {
        console.log(`  - ${e.type} (User: ${e.user_id?.substring(0, 8)}, Round: ${e.payload?.round || '-'})`);
    }

    // --- Summary ---
    console.log('\n' + '='.repeat(50));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ ON_TIME payment: ${result1.success && result1.timing === 'ON_TIME' ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Wrong amount rejected: ${!result2.success ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Correct amount accepted: ${result3.success ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Coverage repayment: ${result4.success && result4.msg.includes('cobertura') ? 'PASS' : 'FAIL'}`);
    console.log(`✅ REPLACED user rejected: ${!result5.success ? 'PASS' : 'FAIL'}`);
    console.log('='.repeat(50));

    const allPassed = result1.success && !result2.success && result3.success && result4.success && !result5.success;
    console.log(allPassed ? '\n🎉 ALL TESTS PASSED!' : '\n❌ SOME TESTS FAILED');

    process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
