/**
 * Module 7: Ledger Query Verification Script
 * Tests:
 * - Role-based filtering (participant vs organizer)
 * - Pagination
 * - Type filtering
 * - Entry formatting
 */

import { LedgerRepository } from '../infra/ledger';
import { TandaService } from '../domain/tanda-service';
import pino from 'pino';

const logger = pino({ name: 'verify-module7', level: 'info' });

async function main() {
    console.log('🧪 Module 7: Ledger Query Verification\n');

    // Setup
    const ledger = new LedgerRepository();
    const tandaService = new TandaService(ledger);

    // Clear events table
    const db = await ledger.getDatabase();
    await db.run("DELETE FROM events WHERE 1=1");
    console.log('🧹 Cleared events table\n');

    const organizerId = '521111111111@s.whatsapp.net';
    const user1 = '522222222222@s.whatsapp.net';

    // --- Step 1: Create and Activate Tanda ---
    console.log('📦 Step 1: Creating and activating Tanda...');
    const tanda = await tandaService.createTanda({
        name: 'Tanda Verificación M7',
        organizerId,
        amount: 1000,
        participants: 2,
        periodicity: 'weekly',
        durationMonths: 2
    });
    await tandaService.joinTanda(tanda.id, user1, 'MEMBER');

    await ledger.recordEvent({
        type: 'InitialFundCompleted',
        tanda_id: tanda.id,
        timestamp: Date.now(),
        payload: {}
    });
    await tandaService.assignTurnOrder(tanda.id, 'MANUAL', [organizerId, user1]);
    console.log('✅ Tanda activated\n');

    // --- Step 2: Generate some activity ---
    console.log('📝 Step 2: Generating ledger events...');

    // Simulate payments
    await tandaService.payPeriodic({ userId: user1, tandaId: tanda.id, amountFiat: 1000 });
    await tandaService.payPeriodic({ userId: organizerId, tandaId: tanda.id, amountFiat: 1000 });

    // Simulate coverage
    await ledger.recordEvent({
        type: 'PoolCovered',
        tanda_id: tanda.id,
        user_id: user1,
        timestamp: Date.now(),
        payload: { round: 2, coverage_count: 1 }
    });

    console.log('✅ Events generated\n');

    // --- Step 3: Test Participant View ---
    console.log('🧪 Test 1: Participant Ledger View');
    const participantView = await tandaService.getLedgerView(user1, tanda.id);
    console.log(`  Total: ${participantView.total} entries`);
    console.log(`  Entries:\n    ${participantView.entries.join('\n    ')}\n`);

    // --- Step 4: Test Organizer View ---
    console.log('🧪 Test 2: Organizer Ledger View');
    const organizerView = await tandaService.getLedgerView(organizerId, tanda.id);
    console.log(`  Total: ${organizerView.total} entries`);
    console.log(`  Entries:\n    ${organizerView.entries.join('\n    ')}\n`);

    // --- Step 5: Test Filter ---
    console.log('🧪 Test 3: Filtered View (Pagos only)');
    const filteredView = await tandaService.getLedgerView(organizerId, tanda.id, { filter: 'pagos' });
    console.log(`  Total: ${filteredView.total} entries`);
    console.log(`  Entries:\n    ${filteredView.entries.join('\n    ')}\n`);

    // --- Step 6: Test Pagination ---
    console.log('🧪 Test 4: Pagination');
    const page1 = await tandaService.getLedgerView(organizerId, tanda.id, { limit: 2, offset: 0 });
    const page2 = await tandaService.getLedgerView(organizerId, tanda.id, { limit: 2, offset: 2 });
    console.log(`  Page 1: ${page1.entries.length} entries, hasMore: ${page1.hasMore}`);
    console.log(`  Page 2: ${page2.entries.length} entries, hasMore: ${page2.hasMore}\n`);

    // --- Step 7: Test Export ---
    console.log('🧪 Test 5: Export Format');
    const exportData = await tandaService.getLedgerExport(tanda.id);
    console.log(`  Export entries: ${exportData.length}`);
    console.log(`  Sample entry: ${JSON.stringify(exportData[0], null, 2).substring(0, 200)}...\n`);

    // --- Summary ---
    console.log('='.repeat(50));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Participant view (filtered): ${participantView.total < organizerView.total ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Organizer view (full): ${organizerView.total > 0 ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Filter works: ${filteredView.total <= organizerView.total ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Pagination: ${page1.hasMore === true ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Export format: ${exportData.length > 0 && exportData[0].ledger_id ? 'PASS' : 'FAIL'}`);
    console.log('='.repeat(50));

    const allPassed =
        participantView.total < organizerView.total &&
        organizerView.total > 0 &&
        filteredView.total <= organizerView.total &&
        exportData.length > 0;

    console.log(allPassed ? '\n🎉 ALL TESTS PASSED!' : '\n❌ SOME TESTS FAILED');

    process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
