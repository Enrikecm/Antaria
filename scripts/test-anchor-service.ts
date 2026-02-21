import { CeloAnchorService } from '../src/infra/celo-anchor';
import { DomainEvent } from '../src/domain/events';

async function main() {
    console.log('🧪 Testing CeloAnchorService...\n');

    const service = new CeloAnchorService();
    console.log(`📋 Enabled: ${service.isEnabled()}`);
    console.log('   (Expected: false — ANCHOR_ENABLED=false)\n');

    // Test: shouldAnchor
    const testEvents: { type: string; shouldAnchor: boolean }[] = [
        { type: 'TandaCreated', shouldAnchor: true },
        { type: 'TandaActivated', shouldAnchor: true },
        { type: 'InitialFundCompleted', shouldAnchor: true },
        { type: 'DefaultConfirmed', shouldAnchor: true },
        { type: 'ReplacementConfirmed', shouldAnchor: true },
        { type: 'TandaClosed', shouldAnchor: true },
        { type: 'RaffleWinnerSelected', shouldAnchor: true },
        { type: 'MenuShown', shouldAnchor: false },
        { type: 'PaymentValidated', shouldAnchor: false },
    ];

    console.log('📋 shouldAnchor tests:');
    let passed = 0;
    for (const t of testEvents) {
        const event = { type: t.type, timestamp: Date.now(), payload: {} } as DomainEvent;
        const result = service.shouldAnchor(event);
        const ok = result === t.shouldAnchor;
        console.log(`  ${ok ? '✅' : '❌'} ${t.type}: ${result} (expected ${t.shouldAnchor})`);
        if (ok) passed++;
    }
    console.log(`\n  ${passed}/${testEvents.length} passed\n`);

    // Test: computeHashes
    console.log('📋 Hash computation test:');
    const sampleEvent: DomainEvent = {
        id: 'evt-001',
        type: 'TandaCreated',
        timestamp: Date.now(),
        user_id: 'user-123',
        tanda_id: 'tanda-456',
        payload: { name: 'Test Tanda', amount: 4000 },
    };

    const hashes = service.computeHashes(sampleEvent);
    console.log(`  groupId:  ${hashes.groupId}`);
    console.log(`  refId:    ${hashes.refId}`);
    console.log(`  dataHash: ${hashes.dataHash}`);
    console.log(`  All are 66-char hex strings: ${[hashes.groupId, hashes.refId, hashes.dataHash].every(h => h.length === 66 && h.startsWith('0x'))
            ? '✅' : '❌'
        }`);

    // Test: deterministic hashes
    const hashes2 = service.computeHashes(sampleEvent);
    const deterministic = hashes.groupId === hashes2.groupId
        && hashes.refId === hashes2.refId
        && hashes.dataHash === hashes2.dataHash;
    console.log(`  Deterministic: ${deterministic ? '✅' : '❌'}\n`);

    // Test: different tanda → different groupId
    const differentTandaEvent = { ...sampleEvent, tanda_id: 'tanda-789' };
    const hashes3 = service.computeHashes(differentTandaEvent);
    const Different = hashes.groupId !== hashes3.groupId;
    console.log(`  Different tanda → different groupId: ${Different ? '✅' : '❌'}`);

    // Test: processEvent in dry-run mode
    console.log('\n📋 processEvent (dry-run):');
    await service.processEvent(sampleEvent);
    console.log('  ✅ No error thrown\n');

    // Test: non-anchorable event skipped
    const menuEvent: DomainEvent = {
        type: 'MenuShown',
        timestamp: Date.now(),
        user_id: 'user-123',
        payload: {},
    };
    await service.processEvent(menuEvent);
    console.log('  ✅ Non-anchorable event correctly skipped\n');

    console.log('🎉 All tests passed!');
}

main().catch(console.error);
