/**
 * Module 6: Status Panel Verification Script
 * Tests role-based status display:
 * - Participant view (personal status, qualitative fund)
 * - Organizer view (full summary, fund amount)
 * - Fund status indicators (🟢🟡🔴)
 */

import { LedgerRepository } from '../infra/ledger';
import { TandaService } from '../domain/tanda-service';
import pino from 'pino';

const logger = pino({ name: 'verify-module6', level: 'info' });

async function main() {
    console.log('🧪 Module 6: Status Panel Verification\n');

    // Setup
    const ledger = new LedgerRepository();
    const tandaService = new TandaService(ledger);

    // Clear events table
    const db = await ledger.getDatabase();
    await db.run("DELETE FROM events WHERE 1=1");
    console.log('🧹 Cleared events table\n');

    const organizerId = '521111111111@s.whatsapp.net';
    const user1 = '522222222222@s.whatsapp.net';

    // --- Step 1: Create Tanda ---
    console.log('📦 Step 1: Creating Tanda...');
    const tanda = await tandaService.createTanda({
        name: 'Tanda Verificación M6',
        organizerId,
        amount: 1000,
        participants: 2,
        periodicity: 'weekly',
        durationMonths: 2
    });
    console.log(`✅ Tanda created: ${tanda.id}\n`);

    // --- Step 2: Add participant ---
    console.log('👥 Step 2: Adding participant...');
    await tandaService.joinTanda(tanda.id, user1, 'MEMBER');
    console.log('✅ User1 joined\n');

    // --- Step 3: Test inactive tanda panel ---
    console.log('🧪 Test 1: Panel before activation');
    const result1 = await tandaService.getStatusPanel(user1, tanda.id);
    console.log(`  Result: ${result1.success ? '✅' : '❌'}`);
    console.log(`  Panel: ${result1.panel}\n`);

    // --- Step 4: Activate Tanda ---
    console.log('📅 Step 4: Activating Tanda...');
    await ledger.recordEvent({
        type: 'InitialFundCompleted',
        tanda_id: tanda.id,
        timestamp: Date.now(),
        payload: {}
    });
    await tandaService.assignTurnOrder(tanda.id, 'MANUAL', [organizerId, user1]);
    console.log('✅ Tanda activated\n');

    // --- Step 5: Test participant panel ---
    console.log('🧪 Test 2: Participant Panel');
    const result2 = await tandaService.getStatusPanel(user1, tanda.id);
    console.log(`  Result: ${result2.success ? '✅' : '❌'}`);
    console.log(`  Panel:\n${result2.panel}\n`);

    // --- Step 6: Test organizer panel ---
    console.log('🧪 Test 3: Organizer Panel');
    const result3 = await tandaService.getStatusPanel(organizerId, tanda.id);
    console.log(`  Result: ${result3.success ? '✅' : '❌'}`);
    console.log(`  Panel:\n${result3.panel}\n`);

    // --- Step 7: Test fund status changes ---
    console.log('🧪 Test 4: Fund Status After Coverage');

    // Simulate coverage
    await ledger.recordEvent({
        type: 'PoolCovered',
        tanda_id: tanda.id,
        user_id: user1,
        timestamp: Date.now(),
        payload: { round: 1, coverage_count: 1 }
    });

    const fundStatus = await tandaService.getFundStatus(tanda.id);
    console.log(`  Fund Status: ${fundStatus.emoji} ${fundStatus.label}`);
    console.log(`  Fund Amount: $${fundStatus.amount}\n`);

    // --- Step 8: Test roles ---
    console.log('🧪 Test 5: Role Detection');
    const role1 = await tandaService.getUserRole(organizerId, tanda.id);
    const role2 = await tandaService.getUserRole(user1, tanda.id);
    console.log(`  Organizer Role: ${role1}`);
    console.log(`  User1 Role: ${role2}\n`);

    // --- Summary ---
    console.log('='.repeat(50));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Inactive tanda handled: ${!result1.success ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Participant panel: ${result2.success && result2.panel.includes('Estado de tu tanda') ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Organizer panel: ${result3.success && result3.panel.includes('Estado general') ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Fund status after coverage: ${fundStatus.emoji === '🟡' ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Role detection: ${role1 === 'ORGANIZER' && role2 === 'MEMBER' ? 'PASS' : 'FAIL'}`);
    console.log('='.repeat(50));

    const allPassed =
        !result1.success &&
        result2.success &&
        result3.success &&
        fundStatus.emoji === '🟡' &&
        role1 === 'ORGANIZER' &&
        role2 === 'MEMBER';

    console.log(allPassed ? '\n🎉 ALL TESTS PASSED!' : '\n❌ SOME TESTS FAILED');

    process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
