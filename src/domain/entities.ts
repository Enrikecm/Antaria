export type TandaStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type PoolType = 'SHORT' | 'LONG';
export type Periodicity = 'weekly' | 'biweekly' | 'monthly';

// Module 4: Pago Periódico
export type PaymentTiming = 'ON_TIME' | 'GRACE' | 'LATE';
export type PaymentStatus = 'UNPAID' | 'PAID' | 'COVERED' | 'LATE_PAID' | 'COVERAGE_REPAID';
export type UserPaymentStatus = 'CURRENT' | 'IN_GRACE' | 'LATE' | 'REPLACED';

export interface User {
    id: string; // Phone number or internal ID
    name: string;
    alias?: string;
    score: number; // For MVP: simple reliability score
}

export interface Tanda {
    id: string; // UUID
    name: string;
    organizerId: string;
    contributionAmount: number;
    numberOfParticipants: number;
    periodicity: Periodicity;
    durationMonths: number;
    poolType: PoolType;
    status: TandaStatus;
    inviteCode: string;
    createdAt: number;

    // Dynamic fields derived from events
    currentParticipants: number;
    fundCollected: number;
    requiredInitialFund: number;
    turnOrder?: string[];
    schedule?: { date: number, userId: string, round: number }[];
}

export interface Pool {
    id: string;
    type: PoolType;
    totalBalance: number;
    // MVP: Just logical aggregation
}
