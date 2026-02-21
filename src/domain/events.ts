export type EventType =
    | 'TandaCreated'
    | 'ParticipantInvited'
    | 'ParticipantConfirmed'
    | 'TandaActivated'
    | 'InitialFundInstructed'
    | 'ProofReceived'
    | 'PaymentValidated'
    | 'PaymentRejected'
    | 'InitialFundDeposited'
    | 'InitialFundCompleted'
    | 'ContributionScheduled'
    | 'ContributionReceived'
    | 'ContributionLate'
    | 'PoolCovered'
    | 'ContributionRegularized'
    | 'DefaultConfirmed'
    | 'YieldRecorded'
    | 'TandaFinalized'
    // Router / UX Events
    | 'MenuShown'
    | 'IntentSelected'
    | 'FlowStarted'
    | 'FlowCancelled'
    | 'FlowCancelled'
    | 'ConversationStateUpdated'
    // Module 3
    | 'TurnOrderAssigned'
    | 'CalendarCreated'
    // Module 5
    | 'ContributionLate'
    | 'PoolCovered'
    | 'RegularizationWindowStarted'
    | 'WindowReminderSent'
    | 'WindowFinalNoticeSent'
    | 'ContributionRegularized'
    | 'CoverageRestored'
    | 'DefaultConfirmed'
    | 'DefaultImpactRegistered'
    | 'OrganizerNotifiedLate'
    | 'UserNoteRegistered'
    // Module 5.1
    | 'ParticipantRemoved'
    | 'ReplacementCodeCreated'
    | 'ReplacementJoined'
    | 'ReplacementConfirmed'
    | 'ReplacementNotAllowed'
    // Module 5.2
    | 'RecoveryModeStarted'
    | 'DefaultReversed'
    | 'UserBlockedForNewTandas'
    | 'UserUnblocked'
    // Module 4
    | 'PeriodicPaymentRecorded'
    | 'CoverageRepaid'
    // Module 8
    | 'YieldCalculated'
    | 'YieldNotDistributed'
    | 'RaffleDrawn'
    | 'RaffleWinnerSelected'
    | 'YieldAwarded'
    | 'TandaClosed'
    // Module 9
    | 'FundLayerAllocated'
    | 'FundLayerUsed'
    | 'FundLayerRestored';

export interface DomainEvent {
    id?: string;
    type: EventType;
    payload: any;
    timestamp: number;
    user_id?: string;
    tanda_id?: string;
    pool_id?: string;
    amount?: number;
    external_ref?: string;
}
