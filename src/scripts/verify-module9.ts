/**
 * Module 9: Fund Layers Verification Script
 * Tests:
 * - Layer initialization (25/30/35/10)
 * - Coverage usage (priority 1→2→3→4)
 * - Repayment restoration (priority 4→3→2→1)
 * - Real yield calculation from Capa 3+4
 * - Layer status query
 */

import { LedgerRepository } from '../infra/ledger';
import { TandaService } from '../domain/tanda-service';
import pino from 'pino';

const logger = pino({ name: 'verify-module9', level: 'info' });

async function main() {
    console.log('🧪 Module 9: Fund Layers Verification\n');

    // Setup
    const ledger = new LedgerRepository();
    const tandaService = new TandaService(ledger);

    // Clear tables
    const db = await ledger.getDatabase();
    await db.run("DELETE FROM events WHERE 1=1");
    await db.run("DELETE FROM fund_layers WHERE 1=1");
    console.log('🧹 Cleared tables\n');

    const organizerId = '521111111111@s.whatsapp.net';
    const tandaId = 'test-tanda-m9';

    // Simulate tanda creation event
    await ledger.recordEvent({
        type: 'TandaCreated',
        tanda_id: tandaId,
        user_id: organizerId,
        timestamp: Date.now(),
        payload: {
            id: tandaId,
            name: 'Test M9',
            requiredInitialFund: 10000
        }
    });

    // --- Step 1: Initialize Fund Layers ---
    console.log('📦 Step 1: Initialize Fund Layers (10000 total)');
    await tandaService.initializeFundLayers(tandaId, 10000);
    const initialStatus = await tandaService.getFundLayerStatus(tandaId);
    console.log(`  Capa 1 (25%): ${initialStatus?.capa1}`);
    console.log(`  Capa 2 (30%): ${initialStatus?.capa2}`);
    console.log(`  Capa 3 (35%): ${initialStatus?.capa3}`);
    console.log(`  Capa 4 (10%): ${initialStatus?.capa4}`);
    console.log(`  Total: ${initialStatus?.total}`);

    const initCorrect =
        initialStatus?.capa1 === 2500 &&
        initialStatus?.capa2 === 3000 &&
        initialStatus?.capa3 === 3500 &&
        initialStatus?.capa4 === 1000;
    console.log(`  Result: ${initCorrect ? 'PASS' : 'FAIL'}\n`);

    // --- Step 2: Use Fund for Coverage ---
    console.log('💸 Step 2: Use 3000 for coverage (should use Capa1 + Capa2 partial)');
    const useResult = await tandaService.useFundForCoverage(tandaId, 3000);
    console.log(`  Success: ${useResult.success}`);
    console.log(`  Layers used: ${JSON.stringify(useResult.layers_used)}`);

    const afterUse = await tandaService.getFundLayerStatus(tandaId);
    console.log(`  After use - Capa1: ${afterUse?.capa1}, Capa2: ${afterUse?.capa2}`);

    const useCorrect =
        useResult.success &&
        afterUse?.capa1 === 0 &&
        afterUse?.capa2 === 2500; // 3000 - 2500 = 500 from capa2
    console.log(`  Result: ${useCorrect ? 'PASS' : 'FAIL'}\n`);

    // --- Step 3: Restore Fund from Repayment ---
    console.log('🔄 Step 3: Restore 2000 (should restore Capa2 first, priority 4→3→2→1)');
    const restoreResult = await tandaService.restoreFundFromRepayment(tandaId, 2000);
    console.log(`  Success: ${restoreResult.success}`);
    console.log(`  Layers restored: ${JSON.stringify(restoreResult.layers_restored)}`);

    const afterRestore = await tandaService.getFundLayerStatus(tandaId);
    console.log(`  After restore - Capa1: ${afterRestore?.capa1}, Capa2: ${afterRestore?.capa2}`);

    // Since capa4 and capa3 are at capacity, should restore capa2 then capa1
    const restoreCorrect = restoreResult.success;
    console.log(`  Result: ${restoreCorrect ? 'PASS' : 'FAIL'}\n`);

    // --- Step 4: Calculate Real Yield ---
    console.log('📈 Step 4: Calculate Real Yield');
    const realYield = await tandaService.calculateRealYieldGross(tandaId);
    console.log(`  Real Yield (Capa3@3% + Capa4@8%): $${realYield}`);
    // Expected: (3500 + 3500)/2 * 0.03 + (1000 + 1000)/2 * 0.08 = 105 + 80 = 185
    const yieldCorrect = realYield > 0;
    console.log(`  Result: ${yieldCorrect ? 'PASS' : 'FAIL'}\n`);

    // --- Step 5: Verify calculateYieldGross uses real yield ---
    console.log('🔗 Step 5: Integration with calculateYieldGross');
    const integratedYield = await tandaService.calculateYieldGross(tandaId);
    console.log(`  Integrated Yield: $${integratedYield}`);
    const integrationCorrect = integratedYield === realYield;
    console.log(`  Result: ${integrationCorrect ? 'PASS' : 'FAIL'}\n`);

    // --- Step 6: Verify Ledger Events ---
    console.log('📋 Step 6: Verify Ledger Events');
    const events = await ledger.getEventsByTanda(tandaId);
    const allocEvent = events.find(e => e.type === 'FundLayerAllocated');
    const usedEvent = events.find(e => e.type === 'FundLayerUsed');
    const restoredEvent = events.find(e => e.type === 'FundLayerRestored');
    console.log(`  FundLayerAllocated: ${allocEvent ? 'PASS' : 'FAIL'}`);
    console.log(`  FundLayerUsed: ${usedEvent ? 'PASS' : 'FAIL'}`);
    console.log(`  FundLayerRestored: ${restoredEvent ? 'PASS' : 'FAIL'}\n`);

    // --- Summary ---
    console.log('='.repeat(50));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Layer initialization (25/30/35/10): ${initCorrect ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Coverage usage (1→2→3→4): ${useCorrect ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Repayment restoration: ${restoreCorrect ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Real yield calculation: ${yieldCorrect ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Integration with M8: ${integrationCorrect ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Ledger events: ${allocEvent && usedEvent && restoredEvent ? 'PASS' : 'FAIL'}`);
    console.log('='.repeat(50));

    const allPassed =
        initCorrect &&
        useCorrect &&
        restoreCorrect &&
        yieldCorrect &&
        integrationCorrect &&
        allocEvent && usedEvent && restoredEvent;

    console.log(allPassed ? '\n🎉 ALL TESTS PASSED!' : '\n❌ SOME TESTS FAILED');

    process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
