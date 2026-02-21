import { LedgerRepository } from '../infra/ledger';
import { Tanda, PoolType, Periodicity, TandaStatus } from './entities';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';

const logger = pino({ name: 'domain/tanda-service' });

export class TandaService {
    constructor(private ledger: LedgerRepository) { }

    async createTanda(params: {
        name: string;
        organizerId: string;
        amount: number;
        participants: number;
        periodicity: Periodicity;
        durationMonths: number;
        organizerParticipates?: boolean;
    }): Promise<Tanda> {
        // Module 5.2 Check
        const blockStatus = await this.isUserBlocked(params.organizerId);
        if (blockStatus.blocked) throw new Error(`User blocked: ${blockStatus.reason}`);

        const poolType: PoolType = params.durationMonths <= 9 ? 'SHORT' : 'LONG';
        const tandaId = uuidv4();
        const inviteCode = uuidv4().substring(0, 6).toUpperCase();
        const requiredInitialFund = params.amount * params.participants;
        const organizerParticipates = params.organizerParticipates !== false; // default true for backwards compatibility

        const eventPayload = {
            ...params,
            id: tandaId,
            poolType,
            inviteCode,
            requiredInitialFund,
            organizerParticipates,
            status: 'PENDING' as const
        };

        await this.ledger.recordEvent({
            type: 'TandaCreated',
            tanda_id: tandaId,
            user_id: params.organizerId,
            payload: eventPayload,
            timestamp: Date.now()
        });

        // Only join as participant if organizer participates
        if (organizerParticipates) {
            await this.joinTanda(tandaId, params.organizerId, 'ORGANIZER');
        }

        return {
            ...eventPayload,
            contributionAmount: params.amount,
            numberOfParticipants: params.participants,
            createdAt: Date.now(),
            currentParticipants: organizerParticipates ? 1 : 0,
            fundCollected: 0
        };
    }

    async joinTanda(tandaId: string, userId: string, role: string = 'MEMBER'): Promise<void> {
        await this.ledger.recordEvent({
            type: 'ParticipantInvited',
            tanda_id: tandaId,
            user_id: userId,
            payload: { role },
            timestamp: Date.now()
        });

        await this.ledger.recordEvent({
            type: 'ParticipantConfirmed',
            tanda_id: tandaId,
            user_id: userId,
            payload: { role },
            timestamp: Date.now()
        });
    }

    async registerInitialPayment(params: {
        tandaId: string;
        userId: string;
        amount: number;
        reference: string;
        method: string;
        adminId: string;
    }): Promise<void> {
        await this.ledger.recordEvent({
            type: 'ProofReceived',
            tanda_id: params.tandaId,
            user_id: params.userId,
            amount: params.amount,
            external_ref: params.reference,
            payload: { method: params.method },
            timestamp: Date.now()
        });
    }

    // --- MODULE 3 START ---

    async validatePayment(params: {
        proofEventId: string;
        tandaId: string;
        userId: string;
        organizerId: string;
        isValid: boolean;
    }): Promise<void> {
        if (!params.isValid) {
            await this.ledger.recordEvent({
                type: 'PaymentRejected',
                tanda_id: params.tandaId,
                user_id: params.userId,
                payload: { validator: params.organizerId, proofEventId: params.proofEventId },
                timestamp: Date.now()
            });
            return;
        }

        await this.ledger.recordEvent({
            type: 'PaymentValidated',
            tanda_id: params.tandaId,
            user_id: params.userId,
            payload: { validator: params.organizerId, proofEventId: params.proofEventId },
            timestamp: Date.now()
        });

        // Module 5.1: Check if this is a Replacement Initial Payment
        const db = await this.ledger.getDatabase();
        const pendingInvite = await db.get(
            `SELECT * FROM replacement_invites WHERE tanda_id = ? AND used_by_user_id = ? AND status = 'ACTIVE'`,
            [params.tandaId, params.userId]
        );

        if (pendingInvite) {
            // CONFIRM REPLACEMENT
            await db.run("UPDATE replacement_invites SET status = 'USED' WHERE code = ?", [pendingInvite.code]);

            await this.ledger.recordEvent({
                type: 'ReplacementConfirmed',
                tanda_id: params.tandaId,
                user_id: params.userId,
                timestamp: Date.now(),
                payload: { replacedUserId: pendingInvite.replaced_user_id }
            });

            await this.ledger.recordEvent({
                type: 'ParticipantConfirmed',
                tanda_id: params.tandaId,
                user_id: params.userId,
                timestamp: Date.now(),
                payload: { role: 'MEMBER', inheritedFrom: pendingInvite.replaced_user_id }
            });

            // Continue to record InitialFundDeposited
        }

        // Module 5 Check: if user was in Late Coverage, restore it.
        await this.checkRegularizationRestoration(params.tandaId, params.userId);

        const events = await this.ledger.getEventsByTanda(params.tandaId);
        const isFundComplete = events.find(e => e.type === 'InitialFundCompleted');

        if (isFundComplete) {
            await this.ledger.recordEvent({
                type: 'ContributionReceived',
                tanda_id: params.tandaId,
                user_id: params.userId,
                amount: 0, // Should fetch from proof or default
                payload: { proofEventId: params.proofEventId },
                timestamp: Date.now()
            });
        } else {
            await this.ledger.recordEvent({
                type: 'InitialFundDeposited',
                tanda_id: params.tandaId,
                user_id: params.userId,
                amount: 0,
                payload: {},
                timestamp: Date.now()
            });
        }

        await this.checkInitialFundComplete(params.tandaId);
    }

    private async checkInitialFundComplete(tandaId: string) {
        const events = await this.ledger.getEventsByTanda(tandaId);

        const participants = new Set<string>();
        const paidUsers = new Set<string>();
        let targetCount = 0;

        for (const e of events) {
            if (e.type === 'TandaCreated') targetCount = e.payload.participants;
            if (e.type === 'ParticipantConfirmed') participants.add(e.user_id!);
            if (e.type === 'InitialFundDeposited') paidUsers.add(e.user_id!);
        }

        if (paidUsers.size >= targetCount) {
            if (!events.find(e => e.type === 'InitialFundCompleted')) {
                await this.ledger.recordEvent({
                    type: 'InitialFundCompleted',
                    tanda_id: tandaId,
                    timestamp: Date.now(),
                    payload: {}
                });
            }
        }
    }

    async assignTurnOrder(tandaId: string, type: 'MANUAL' | 'RANDOM', manualOrder: string[]): Promise<void> {
        let order = manualOrder;

        if (type === 'RANDOM') {
            const events = await this.ledger.getEventsByTanda(tandaId);
            const participants = new Set<string>();
            events.forEach(e => {
                if (e.type === 'ParticipantConfirmed') participants.add(e.user_id!);
            });
            order = Array.from(participants).sort(() => Math.random() - 0.5);
        }

        await this.ledger.recordEvent({
            type: 'TurnOrderAssigned',
            tanda_id: tandaId,
            timestamp: Date.now(),
            payload: { method: type, order }
        });

        await this.activateTanda(tandaId, order);
    }

    private async activateTanda(tandaId: string, order: string[]) {
        const events = await this.ledger.getEventsByTanda(tandaId);
        const created = events.find(e => e.type === 'TandaCreated');
        const periodicity = created?.payload.periodicity || 'weekly';

        const intervalDays = periodicity === 'weekly' ? 7 : (periodicity === 'biweekly' ? 14 : 30);
        const startDate = Date.now() + (intervalDays * 24 * 60 * 60 * 1000);

        const schedule = order.map((userId, index) => ({
            round: index + 1,
            userId,
            date: startDate + (index * intervalDays * 24 * 60 * 60 * 1000)
        }));

        await this.ledger.recordEvent({
            type: 'CalendarCreated',
            tanda_id: tandaId,
            timestamp: Date.now(),
            payload: { schedule }
        });

        await this.ledger.recordEvent({
            type: 'TandaActivated',
            tanda_id: tandaId,
            timestamp: Date.now(),
            payload: { status: 'ACTIVE' }
        });
    }

    // --- MODULE 5 START ---

    async checkLatePayments() {
        const db = await this.ledger.getDatabase();
        // 1. Get Active Tandas via CalendarCreated
        const activeTandas = await db.all("SELECT * FROM events WHERE type = 'CalendarCreated'");

        for (const calEvent of activeTandas) {
            const tandaId = calEvent.tanda_id;
            const schedule = JSON.parse(calEvent.payload).schedule;

            // Rebuild Tanda State
            const events = await this.ledger.getEventsByTanda(tandaId);

            // Check each scheduled date
            for (const item of schedule) {
                // If Item is in past AND not paid AND not already handled (Late/Covered)
                // MVP: use timestamp. In real world, complex date math.
                if (Date.now() > item.date) {
                    await this.processScheduledItem(tandaId, item, events);
                }
            }
        }
    }

    private async processScheduledItem(tandaId: string, item: any, events: any[]) {
        const { userId, round, date } = item;

        // 1. Check if paid
        // Assuming we link payments to rounds via timestamp/period window or explicit tagging.
        // For MVP, simplistic: Do we have a PaymentValidated for this user AFTER the previous round date? 
        // Hack: Just check if we have enough validated payments for the rounds passed?
        // Better: Calendar Item has ID. Payment has Ref.
        // Let's assume we check if "PaymentValidated" exists around this date? 
        // CORRECT MVP APPROACH: We flag LATE if NO 'PaymentValidated' found, AND NO 'ContributionLate' found for this round.
        // We need a unique ID for the round to avoid duplicate events. Using `${tandaId}-${round}-${userId}`.

        const roundId = `${tandaId}-${round}-${userId}`;

        // Has this round been handled (Late or Paid)?
        // We flag LATE if NO 'ContributionReceived' found, AND NO 'ContributionLate' found for this round.

        const payments = events.filter(e => e.type === 'ContributionReceived' && e.user_id === userId);
        // Map payments to rounds? 
        // If payments.length < round number, we might be late.
        // Assumes sequential strictness.

        const isPaid = payments.length >= round; // Simplification

        if (isPaid) return;

        // Not paid. Check if already marked Late.
        const lateEvents = events.filter(e => e.type === 'ContributionLate' && e.user_id === userId);
        // Should check specific round.

        // To properly support specific rounds, we'd need to migrate PaymentValidated to include 'round'.
        // For Module 5 context "Over existing base", we'll infer:
        // If we haven't recorded 'ContributionLate' for this round specifically, do it.
        // We store 'round' in ContributionLate payload.

        const alreadyMarked = lateEvents.find(e => e.payload?.round === round);
        if (alreadyMarked) return;

        // IT IS LATE.
        // 2. Check Coverage Policy (Max 2)
        const coveredCount = lateEvents.filter(e => e.type === 'PoolCovered').length; // Simplify: each Late triggers Covered?
        // Actually we look for PoolCovered events for this user.

        // Wait, multiple lates for same user.
        const userCoverageEvents = await this.ledger.getDatabase().then(db => db.all(
            "SELECT * FROM events WHERE type = 'PoolCovered' AND user_id = ? AND tanda_id = ?", [userId, tandaId]
        ));
        const currentCount = userCoverageEvents.length;

        if (currentCount >= 2) {
            // DEFAULT
            await this.ledger.recordEvent({
                type: 'DefaultConfirmed',
                tanda_id: tandaId,
                user_id: userId,
                timestamp: Date.now(),
                payload: { round, reason: 'limit_exceeded' }
            });
            // Notify Organizer (TODO via return or event listener)
            logger.warn({ userId, tandaId }, 'User Defaulted');
            return;
        }

        // APPLY COVERAGE
        await this.ledger.recordEvent({
            type: 'ContributionLate',
            tanda_id: tandaId,
            user_id: userId,
            timestamp: Date.now(),
            payload: { round, roundId }
        });

        await this.ledger.recordEvent({
            type: 'PoolCovered',
            tanda_id: tandaId,
            user_id: userId,
            timestamp: Date.now(),
            payload: { policy_version: 'v1', coverage_count: currentCount + 1, round }
        });

        const windowDays = 3;
        const endTime = Date.now() + (windowDays * 24 * 60 * 60 * 1000);

        await this.ledger.recordEvent({
            type: 'RegularizationWindowStarted',
            tanda_id: tandaId,
            user_id: userId,
            timestamp: Date.now(),
            payload: { round, end_time: endTime }
        });

        // Notify
        logger.info({ userId, tandaId, round }, 'Coverage Applied. Window Started.');
    }

    async checkRegularizationWindows() {
        // Find Active Windows
        const db = await this.ledger.getDatabase();
        // Complex query: Get RegularizationWindowStarted that does NOT have matching ContributionRegularized OR DefaultConfirmed
        // Doing in JS for MVP simplicity
        const windows = await db.all("SELECT * FROM events WHERE type = 'RegularizationWindowStarted'");

        for (const w of windows) {
            const payload = JSON.parse(w.payload);
            const { round, end_time } = payload;
            const { tanda_id, user_id } = w;

            const events = await this.ledger.getEventsByTanda(tanda_id);

            // Check if closed
            const closed = events.find(e =>
                (e.type === 'ContributionRegularized' || e.type === 'DefaultConfirmed') &&
                e.user_id === user_id &&
                e.payload?.round === round // ideally match unique CheckId
            );

            if (closed) continue;

            const now = Date.now();

            // Check Expiry
            if (now > end_time) {
                await this.ledger.recordEvent({
                    type: 'DefaultConfirmed',
                    tanda_id,
                    user_id,
                    timestamp: now,
                    payload: { round, reason: 'window_expired' }
                });
                continue;
            }

            // Reminders (Day 2, Day 3)
            // Calculate Day 2 start: StartTime + 24h? 
            // Window is 3 days. 
            // Day 2 starts at Start + 24h.
            // Day 3 starts at Start + 48h.
            const start = w.timestamp;
            const hoursElapsed = (now - start) / (1000 * 60 * 60);

            if (hoursElapsed >= 48 && hoursElapsed < 72) {
                // Day 3 (Last Notice)
                // Check if already sent
                const sent = events.find(e => e.type === 'WindowFinalNoticeSent' && e.user_id === user_id && e.payload?.round === round);
                if (!sent) {
                    await this.ledger.recordEvent({
                        type: 'WindowFinalNoticeSent',
                        tanda_id,
                        user_id,
                        timestamp: now,
                        payload: { round }
                    });
                    // Notify User
                }
            } else if (hoursElapsed >= 24 && hoursElapsed < 48) {
                // Day 2 (Reminder)
                const sent = events.find(e => e.type === 'WindowReminderSent' && e.user_id === user_id && e.payload?.round === round);
                if (!sent) {
                    await this.ledger.recordEvent({
                        type: 'WindowReminderSent',
                        tanda_id,
                        user_id,
                        timestamp: now,
                        payload: { round, day: 2 }
                    });
                    // Notify User
                }
            }
        }
    }

    private async checkRegularizationRestoration(tandaId: string, userId: string) {
        // Called after PaymentValidated. 
        // Check if there is an Open Regularization Window for this user
        const events = await this.ledger.getEventsByTanda(tandaId);
        const windows = events.filter(e => e.type === 'RegularizationWindowStarted' && e.user_id === userId);

        for (const w of windows) {
            const { round } = w.payload;
            // Check if closed
            const closed = events.find(e => (e.type === 'ContributionRegularized' || e.type === 'DefaultConfirmed') && e.user_id === userId && e.payload?.round === round);

            if (!closed) {
                // RESTORE
                await this.ledger.recordEvent({
                    type: 'ContributionRegularized',
                    tanda_id: tandaId,
                    user_id: userId,
                    timestamp: Date.now(),
                    payload: { round }
                });

                await this.ledger.recordEvent({
                    type: 'CoverageRestored',
                    tanda_id: tandaId,
                    user_id: userId,
                    timestamp: Date.now(),
                    payload: { round }
                });

                logger.info({ userId, tandaId, round }, 'Coverage Restored / Regularized');
            }
        }
    }

    // --- MODULE 5 END ---

    // --- MODULE 5.1 START ---

    async checkDefaultReplacementEligibility(tandaId: string, defaultedUserId: string): Promise<{ eligible: boolean, reason?: string }> {
        const events = await this.ledger.getEventsByTanda(tandaId);

        // 1. Is Defaulted?
        const isDefault = events.find(e => e.type === 'DefaultConfirmed' && e.user_id === defaultedUserId);
        if (!isDefault) {
            return { eligible: false, reason: 'User not in default' };
        }

        // 2. Has Received Turn?
        const cal = events.find(e => e.type === 'CalendarCreated');
        if (!cal) return { eligible: false, reason: 'No calendar' };

        const schedule = cal.payload.schedule;
        const userTurn = schedule.find((s: any) => s.userId === defaultedUserId);

        if (!userTurn) return { eligible: false, reason: 'Turn not found' }; // Should not happen

        // If turn date is <= NOW, they received it (simplified). 
        // Or if 'PayoutProcessed' exists (future module). For MVP, use Calendar Date.
        if (Date.now() >= userTurn.date) {
            return { eligible: false, reason: 'ALREADY_RECEIVED_TURN' };
        }

        return { eligible: true };
    }

    async generateReplacementCode(tandaId: string, replacedUserId: string): Promise<string> {
        // Check eligibility first (caller should handle UI msg, but we double check)
        const eligibility = await this.checkDefaultReplacementEligibility(tandaId, replacedUserId);
        if (!eligibility.eligible) {
            await this.ledger.recordEvent({
                type: 'ReplacementNotAllowed',
                tanda_id: tandaId,
                user_id: replacedUserId,
                timestamp: Date.now(),
                payload: { reason: eligibility.reason }
            });
            throw new Error(eligibility.reason);
        }

        // Expel User (Logically)
        await this.ledger.recordEvent({
            type: 'ParticipantRemoved',
            tanda_id: tandaId,
            user_id: replacedUserId,
            timestamp: Date.now(),
            payload: { reason: 'DEFAULT' }
        });

        const code = uuidv4().substring(0, 8).toUpperCase();
        const db = await this.ledger.getDatabase();

        // Check if existing active code?
        // MVP: Insert new
        await db.run(
            `INSERT INTO replacement_invites (code, tanda_id, replaced_user_id, status, created_at) VALUES (?, ?, ?, 'ACTIVE', ?)`,
            [code, tandaId, replacedUserId, Date.now()]
        );

        await this.ledger.recordEvent({
            type: 'ReplacementCodeCreated',
            tanda_id: tandaId,
            payload: { code, replacedUserId },
            timestamp: Date.now()
        });

        return code;
    }

    async joinTandaAsReplacement(code: string, newUserId: string): Promise<{ success: boolean, tandaId?: string, msg?: string }> {
        const db = await this.ledger.getDatabase();
        const invite = await db.get("SELECT * FROM replacement_invites WHERE code = ? AND status = 'ACTIVE'", [code]);

        if (!invite) return { success: false, msg: 'Invalid or expired code' };

        // Record Join
        await this.ledger.recordEvent({
            type: 'ReplacementJoined',
            tanda_id: invite.tanda_id,
            user_id: newUserId,
            timestamp: Date.now(),
            payload: { replacedUserId: invite.replaced_user_id }
        });

        // Add as "REPLACEMENT_PENDING" role?
        // Or just ParticipantInvited/Confirmed but marked as pending validation?
        // We reuse 'ParticipantConfirmed' but we track status via 'ReplacementJoined' presence without 'ReplacementConfirmed'.
        // Actually, let's allow them to enter as MEMBER but we know they are replacement.

        await this.ledger.recordEvent({
            type: 'ParticipantInvited',
            tanda_id: invite.tanda_id,
            user_id: newUserId,
            timestamp: Date.now(),
            payload: { role: 'REPLACEMENT_PENDING', replacedUserId: invite.replaced_user_id }
        });

        // Start Payment Flow automatically? or let them pay?
        // We mark invite as USED later.

        // Update user_id in table to lock it?
        await db.run("UPDATE replacement_invites SET used_by_user_id = ? WHERE code = ?", [newUserId, code]);

        return { success: true, tandaId: invite.tanda_id };
    }

    // --- MODULE 5.1 END ---

    // --- MODULE 5.1 END ---

    // --- MODULE 5.2 START (Recovery Post-Turn) ---

    async isUserBlocked(userId: string): Promise<{ blocked: boolean, reason?: string }> {
        // Scan for unresolved defaults
        const events = await this.ledger.getEventsByUser(userId);

        // Find defaults
        const defaults = events.filter(e => e.type === 'DefaultConfirmed');
        if (defaults.length === 0) return { blocked: false };

        for (const def of defaults) {
            // Check if resolved
            const { tanda_id, payload } = def;
            const round = payload?.round; // If specific round

            // Resolution 1: Regularized (Paid)
            const regularized = events.find(e =>
                e.type === 'ContributionRegularized' &&
                e.tanda_id === tanda_id &&
                e.payload?.round === round
            );

            // Resolution 2: Reversed (Manual)
            const reversed = events.find(e =>
                e.type === 'DefaultReversed' &&
                e.tanda_id === tanda_id &&
                e.user_id === userId
                // Maybe match round? For MVP we assume Reversal clears "current status".
            );

            // Resolution 3: Removed (Expelled via 5.1)
            const removed = events.find(e =>
                e.type === 'ParticipantRemoved' &&
                e.tanda_id === tanda_id &&
                e.user_id === userId
            );

            if (!regularized && !reversed && !removed) {
                return { blocked: true, reason: 'Active Default requiring Recovery.' };
            }
        }

        return { blocked: false };
    }

    async reverseDefault(tandaId: string, defaultedUserId: string, organizerId: string, reason: string) {
        // Organizer check handled by handler
        await this.ledger.recordEvent({
            type: 'DefaultReversed',
            tanda_id: tandaId,
            user_id: defaultedUserId,
            timestamp: Date.now(),
            payload: { organizerId, reason }
        });

        await this.ledger.recordEvent({
            type: 'UserUnblocked',
            user_id: defaultedUserId,
            timestamp: Date.now(),
            payload: { reason: 'DEFAULT_REVERSED' }
        });
    }

    async registerUserNote(tandaId: string, userId: string, note: string) {
        await this.ledger.recordEvent({
            type: 'UserNoteRegistered',
            tanda_id: tandaId,
            user_id: userId,
            timestamp: Date.now(),
            payload: { note }
        });
    }

    async startRecoveryMode(tandaId: string, userId: string) {
        // Just a marker for tracking
        await this.ledger.recordEvent({
            type: 'RecoveryModeStarted',
            tanda_id: tandaId,
            user_id: userId,
            timestamp: Date.now(),
            payload: { end_time: Date.now() + (3 * 24 * 60 * 60 * 1000) } // 3 more days? Or unlimited?
        });
    }

    // --- MODULE 5.2 END ---

    // --- MODULE 4 START ---

    async payPeriodic(params: {
        userId: string;
        tandaId: string;
        amountFiat: number;
    }): Promise<{ success: boolean; msg: string; periodId?: number; timing?: string }> {
        const { userId, tandaId, amountFiat } = params;
        const events = await this.ledger.getEventsByTanda(tandaId);

        // 1. Validate Group Active
        const activated = events.find(e => e.type === 'TandaActivated');
        if (!activated) {
            return { success: false, msg: '⚠️ Esta tanda no está activa. Revisa el panel de estado.' };
        }

        // 2. Validate User belongs to group
        const isParticipant = events.find(e => e.type === 'ParticipantConfirmed' && e.user_id === userId);
        if (!isParticipant) {
            return { success: false, msg: '⚠️ No perteneces a esta tanda.' };
        }

        // 3. Check if REPLACED (Module 5.1)
        const replaced = await this.isUserReplaced(tandaId, userId);
        if (replaced) {
            return { success: false, msg: '⚠️ Tu participación fue reemplazada por default. Este pago ya no puede aplicarse aquí. Te llevo a recuperación.' };
        }

        // 4. Get due_amount from TandaCreated
        const created = events.find(e => e.type === 'TandaCreated');
        const dueAmountFiat = created?.payload.amount || 0;

        // 5. Convert to units (1:1 MVP)
        const amountUnits = amountFiat;
        const dueAmountUnits = dueAmountFiat;

        // 6. Validate exact amount (R2)
        if (amountUnits !== dueAmountUnits) {
            return { success: false, msg: `❌ El monto debe ser exactamente $${dueAmountFiat}. Intenta de nuevo.` };
        }

        // 7. Select target period (R7)
        const targetPeriod = await this.selectTargetPeriod(userId, tandaId, events);
        if (!targetPeriod) {
            return { success: false, msg: '⚠️ No puedo identificar el periodo. Pide al organizador revisar el calendario.' };
        }

        // 8. Calculate timing
        const timing = this.getPaymentTiming(targetPeriod.periodEnd, targetPeriod.graceEnd);

        // 9. Check if there was coverage for this period
        const coverageEvent = events.find(e =>
            e.type === 'PoolCovered' &&
            e.user_id === userId &&
            e.payload?.round === targetPeriod.round
        );

        // 10. Apply payment
        if (coverageEvent) {
            // Repay coverage first (R6)
            await this.ledger.recordEvent({
                type: 'CoverageRepaid',
                tanda_id: tandaId,
                user_id: userId,
                amount: dueAmountUnits,
                timestamp: Date.now(),
                payload: {
                    round: targetPeriod.round,
                    repayUnits: dueAmountUnits,
                    timing
                }
            });

            await this.ledger.recordEvent({
                type: 'ContributionRegularized',
                tanda_id: tandaId,
                user_id: userId,
                amount: dueAmountUnits,
                timestamp: Date.now(),
                payload: { round: targetPeriod.round, coverageRepaid: true }
            });

            // Restore coverage capacity (already handled via CoverageRestored in module 5)
            await this.checkRegularizationRestoration(tandaId, userId);

            return {
                success: true,
                msg: `✅ Pago recibido: $${amountFiat}. Se aplicó a reponer la cobertura del Periodo ${targetPeriod.round}. Estás al corriente.`,
                periodId: targetPeriod.round,
                timing
            };
        } else {
            // Normal payment
            await this.ledger.recordEvent({
                type: 'PeriodicPaymentRecorded',
                tanda_id: tandaId,
                user_id: userId,
                amount: dueAmountUnits,
                timestamp: Date.now(),
                payload: {
                    round: targetPeriod.round,
                    timing,
                    displayAmountFiat: amountFiat
                }
            });

            // Also record as ContributionReceived for compatibility with existing logic
            await this.ledger.recordEvent({
                type: 'ContributionReceived',
                tanda_id: tandaId,
                user_id: userId,
                amount: dueAmountUnits,
                timestamp: Date.now(),
                payload: { round: targetPeriod.round, timing }
            });

            // Generate message based on timing
            let msg: string;
            if (timing === 'ON_TIME') {
                msg = `✅ Pago recibido: $${amountFiat}. Periodo ${targetPeriod.round} cubierto. Estás al corriente.`;
            } else if (timing === 'GRACE') {
                msg = `✅ Pago recibido en ventana de gracia: $${amountFiat}. Periodo ${targetPeriod.round} cubierto. Estás al corriente.`;
            } else {
                msg = `✅ Pago tardío recibido: $${amountFiat}. Periodo ${targetPeriod.round} regularizado. Estás al corriente.`;
            }

            return {
                success: true,
                msg,
                periodId: targetPeriod.round,
                timing
            };
        }
    }

    private async selectTargetPeriod(userId: string, tandaId: string, events: any[]): Promise<{
        round: number;
        periodEnd: number;
        graceEnd: number;
    } | null> {
        // Get calendar
        const calendarEvent = events.find(e => e.type === 'CalendarCreated');
        if (!calendarEvent) return null;

        const schedule = calendarEvent.payload.schedule;
        const graceDays = 3;

        // Get all payments made by this user
        const payments = events.filter(e =>
            (e.type === 'ContributionReceived' || e.type === 'PeriodicPaymentRecorded' || e.type === 'ContributionRegularized') &&
            e.user_id === userId
        );
        const paidRounds = new Set(payments.map(p => p.payload?.round).filter(Boolean));

        // Find oldest unpaid period (R7)
        for (const item of schedule) {
            if (!paidRounds.has(item.round)) {
                // This round is unpaid
                const periodEnd = item.date;
                const graceEnd = periodEnd + (graceDays * 24 * 60 * 60 * 1000);

                return {
                    round: item.round,
                    periodEnd,
                    graceEnd
                };
            }
        }

        // All periods paid - check if there's a current/future period
        const now = Date.now();
        const currentPeriod = schedule.find((s: any) => s.date > now);
        if (currentPeriod) {
            return {
                round: currentPeriod.round,
                periodEnd: currentPeriod.date,
                graceEnd: currentPeriod.date + (graceDays * 24 * 60 * 60 * 1000)
            };
        }

        return null;
    }

    private getPaymentTiming(periodEnd: number, graceEnd: number): 'ON_TIME' | 'GRACE' | 'LATE' {
        const now = Date.now();
        if (now <= periodEnd) return 'ON_TIME';
        if (now <= graceEnd) return 'GRACE';
        return 'LATE';
    }

    private async isUserReplaced(tandaId: string, userId: string): Promise<boolean> {
        const events = await this.ledger.getEventsByTanda(tandaId);
        return events.some(e => e.type === 'ParticipantRemoved' && e.user_id === userId);
    }

    async getUserPaymentStatus(userId: string, tandaId: string): Promise<'CURRENT' | 'IN_GRACE' | 'LATE' | 'REPLACED'> {
        // Check if replaced
        if (await this.isUserReplaced(tandaId, userId)) return 'REPLACED';

        const events = await this.ledger.getEventsByTanda(tandaId);
        const calendarEvent = events.find(e => e.type === 'CalendarCreated');
        if (!calendarEvent) return 'CURRENT';

        const schedule = calendarEvent.payload.schedule;
        const graceDays = 3;

        // Get all payments
        const payments = events.filter(e =>
            (e.type === 'ContributionReceived' || e.type === 'PeriodicPaymentRecorded' || e.type === 'ContributionRegularized') &&
            e.user_id === userId
        );
        const paidRounds = new Set(payments.map(p => p.payload?.round).filter(Boolean));

        const now = Date.now();

        // Check each past period
        for (const item of schedule) {
            if (item.date < now && !paidRounds.has(item.round)) {
                // Unpaid past period
                const graceEnd = item.date + (graceDays * 24 * 60 * 60 * 1000);
                if (now > graceEnd) return 'LATE';
                return 'IN_GRACE';
            }
        }

        return 'CURRENT';
    }

    async getPendingPeriods(userId: string, tandaId: string): Promise<{ round: number; status: string }[]> {
        const events = await this.ledger.getEventsByTanda(tandaId);
        const calendarEvent = events.find(e => e.type === 'CalendarCreated');
        if (!calendarEvent) return [];

        const schedule = calendarEvent.payload.schedule;
        const graceDays = 3;
        const now = Date.now();

        // Get paid rounds
        const payments = events.filter(e =>
            (e.type === 'ContributionReceived' || e.type === 'PeriodicPaymentRecorded' || e.type === 'ContributionRegularized') &&
            e.user_id === userId
        );
        const paidRounds = new Set(payments.map(p => p.payload?.round).filter(Boolean));

        // Get covered rounds
        const covered = events.filter(e => e.type === 'PoolCovered' && e.user_id === userId);
        const coveredRounds = new Set(covered.map(c => c.payload?.round).filter(Boolean));

        const pending: { round: number; status: string }[] = [];

        for (const item of schedule) {
            if (item.date < now && !paidRounds.has(item.round)) {
                const graceEnd = item.date + (graceDays * 24 * 60 * 60 * 1000);
                let status = 'UNPAID';
                if (coveredRounds.has(item.round)) status = 'COVERED';
                else if (now > graceEnd) status = 'LATE';
                else if (now > item.date) status = 'IN_GRACE';

                pending.push({ round: item.round, status });
            }
        }

        return pending;
    }

    // --- MODULE 4 END ---

    // --- MODULE 6 START ---

    async getStatusPanel(userId: string, tandaId: string): Promise<{ success: boolean; panel: string }> {
        const events = await this.ledger.getEventsByTanda(tandaId);

        // Check tanda exists and is active
        const created = events.find(e => e.type === 'TandaCreated');
        if (!created) {
            return { success: false, panel: '⚠️ No tienes una tanda activa en este momento.' };
        }

        const activated = events.find(e => e.type === 'TandaActivated');
        if (!activated) {
            return { success: false, panel: '⚠️ Esta tanda no está activa.' };
        }

        // Determine role
        const role = await this.getUserRole(userId, tandaId, events);
        if (!role) {
            return { success: false, panel: '⚠️ No puedo determinar tu rol en esta tanda.' };
        }

        // Get tanda info
        const tandaName = created.payload.name;
        const cuota = created.payload.amount;

        // Get current period info
        const periodInfo = await this.getCurrentPeriod(tandaId, events);
        const fundStatus = await this.getFundStatus(tandaId, events);

        if (role === 'ORGANIZER') {
            // Organizer panel
            const summary = await this.getTandaSummary(tandaId, events);

            let panel = `📊 *Estado general de la tanda*\n\n`;
            panel += `*${tandaName}*\n`;
            panel += `Periodo actual: ${periodInfo.current} de ${periodInfo.total}\n\n`;
            panel += `*Usuarios:*\n`;
            panel += `• ✅ Pagados: ${summary.paid}\n`;
            panel += `• ⏳ En gracia: ${summary.inGrace}\n`;
            panel += `• ⚠️ En atraso: ${summary.late}\n`;
            panel += `• 🚫 Reemplazados: ${summary.replaced}\n\n`;

            if (summary.lastEvent) {
                panel += `*Último evento:*\n`;
                panel += `• ${summary.lastEvent}\n\n`;
            }

            panel += `*Fondo de seguridad:*\n`;
            panel += `• Estado: ${fundStatus.emoji} ${fundStatus.label}\n`;
            panel += `• Monto disponible: $${fundStatus.amount}`;

            return { success: true, panel };
        } else {
            // Participant panel
            const userStatus = await this.getUserPaymentStatus(userId, tandaId);
            const statusMap: Record<string, string> = {
                'CURRENT': '✅ Al corriente',
                'IN_GRACE': '⏳ Pago pendiente',
                'LATE': '⚠️ En atraso (cubierto por el fondo)',
                'REPLACED': '🚫 Reemplazado por default'
            };

            let panel = `📊 *Estado de tu tanda*\n\n`;
            panel += `*${tandaName}*\n`;
            panel += `Periodo actual: ${periodInfo.current} de ${periodInfo.total}\n`;
            panel += `Cuota: $${cuota}\n`;
            panel += `Estado: ${statusMap[userStatus] || userStatus}\n`;
            panel += `Vence: ${periodInfo.deadline}\n\n`;

            // Check for relevant previous period
            const pending = await this.getPendingPeriods(userId, tandaId);
            if (pending.length > 0) {
                const lastPending = pending[0];
                const statusLabel = lastPending.status === 'COVERED' ? 'Cubierto por el fondo' :
                    (lastPending.status === 'LATE' ? 'En atraso' : 'Pendiente');
                panel += `*Periodo anterior (${lastPending.round}):*\n`;
                panel += `• Estado: ${statusLabel}\n\n`;
            }

            panel += `Fondo de seguridad: ${fundStatus.emoji} ${fundStatus.label}`;

            return { success: true, panel };
        }
    }

    async getTandaSummary(tandaId: string, events?: any[]): Promise<{
        paid: number;
        inGrace: number;
        late: number;
        replaced: number;
        lastEvent: string | null;
    }> {
        if (!events) {
            events = await this.ledger.getEventsByTanda(tandaId);
        }

        // Get all participants
        const participants = events
            .filter(e => e.type === 'ParticipantConfirmed')
            .map(e => e.user_id!);

        let paid = 0, inGrace = 0, late = 0, replaced = 0;

        for (const userId of participants) {
            const status = await this.getUserPaymentStatus(userId, tandaId);
            if (status === 'CURRENT') paid++;
            else if (status === 'IN_GRACE') inGrace++;
            else if (status === 'LATE') late++;
            else if (status === 'REPLACED') replaced++;
        }

        // Find last relevant event
        const relevantTypes = ['PoolCovered', 'ContributionRegularized', 'DefaultConfirmed', 'ParticipantRemoved'];
        const lastRelevant = events.reverse().find(e => relevantTypes.includes(e.type));
        let lastEvent: string | null = null;

        if (lastRelevant) {
            const userShort = lastRelevant.user_id?.substring(0, 8) || 'Usuario';
            const eventMap: Record<string, string> = {
                'PoolCovered': `${userShort}... → Cobertura activada`,
                'ContributionRegularized': `${userShort}... → Regularizado`,
                'DefaultConfirmed': `${userShort}... → Default confirmado`,
                'ParticipantRemoved': `${userShort}... → Reemplazado`
            };
            lastEvent = eventMap[lastRelevant.type] || null;
        }

        return { paid, inGrace, late, replaced, lastEvent };
    }

    async getFundStatus(tandaId: string, events?: any[]): Promise<{
        emoji: string;
        label: string;
        amount: number;
    }> {
        if (!events) {
            events = await this.ledger.getEventsByTanda(tandaId);
        }

        // Calculate fund status based on events
        const created = events.find(e => e.type === 'TandaCreated');
        const initialFund = created?.payload.requiredInitialFund || 0;

        // Count active coverages (PoolCovered without matching ContributionRegularized)
        const coverages = events.filter(e => e.type === 'PoolCovered');
        const regularizations = events.filter(e => e.type === 'ContributionRegularized');
        const repayments = events.filter(e => e.type === 'CoverageRepaid');

        // Simple calculation: each coverage uses cuota, each repayment restores it
        const cuota = created?.payload.amount || 0;
        const usedAmount = coverages.length * cuota;
        const restoredAmount = repayments.length * cuota;
        const currentAmount = initialFund - usedAmount + restoredAmount;

        // Determine status
        const activeCoverages = coverages.length - regularizations.length;

        if (activeCoverages === 0 && usedAmount === restoredAmount) {
            return { emoji: '🟢', label: 'Estable', amount: currentAmount };
        } else if (activeCoverages > 0) {
            return { emoji: '🟡', label: 'En uso', amount: currentAmount };
        } else {
            return { emoji: '🔴', label: 'En recuperación', amount: currentAmount };
        }
    }

    async getUserRole(userId: string, tandaId: string, events?: any[]): Promise<'ORGANIZER' | 'MEMBER' | null> {
        if (!events) {
            events = await this.ledger.getEventsByTanda(tandaId);
        }

        const participation = events.find(e =>
            e.type === 'ParticipantConfirmed' && e.user_id === userId
        );

        if (!participation) return null;

        return participation.payload.role === 'ORGANIZER' ? 'ORGANIZER' : 'MEMBER';
    }

    async getCurrentPeriod(tandaId: string, events?: any[]): Promise<{
        current: number;
        total: number;
        deadline: string;
    }> {
        if (!events) {
            events = await this.ledger.getEventsByTanda(tandaId);
        }

        const calendar = events.find(e => e.type === 'CalendarCreated');
        if (!calendar) {
            return { current: 0, total: 0, deadline: 'N/A' };
        }

        const schedule = calendar.payload.schedule;
        const total = schedule.length;
        const now = Date.now();

        // Find current period (first one with date > now, or last one)
        let currentPeriod = schedule[0];
        for (const item of schedule) {
            if (item.date > now) {
                currentPeriod = item;
                break;
            }
            currentPeriod = item;
        }

        const deadline = new Date(currentPeriod.date).toLocaleDateString('es-MX', {
            day: 'numeric',
            month: 'short'
        });

        return {
            current: currentPeriod.round,
            total,
            deadline
        };
    }

    // --- MODULE 6 END ---

    // --- MODULE 7 START ---

    async getLedgerView(userId: string, tandaId: string, options: {
        limit?: number;
        offset?: number;
        filter?: string;
    } = {}): Promise<{ entries: string[]; hasMore: boolean; total: number }> {
        const limit = options.limit || 5;
        const offset = options.offset || 0;
        const filter = options.filter;

        const events = await this.ledger.getEventsByTanda(tandaId);
        const role = await this.getUserRole(userId, tandaId, events);

        if (!role) {
            return { entries: ['⚠️ No tienes acceso a este ledger.'], hasMore: false, total: 0 };
        }

        // Filter only displayable event types
        const displayableTypes = [
            'PeriodicPaymentRecorded', 'ContributionReceived', 'ContributionRegularized',
            'PoolCovered', 'CoverageRepaid', 'LateMarked', 'DefaultConfirmed',
            'ParticipantRemoved', 'ParticipantConfirmed', 'ReplacementJoined',
            'TandaActivated', 'TurnPaid'
        ];

        let filtered = events
            .filter(e => displayableTypes.includes(e.type))
            .reverse(); // Most recent first

        // Role-based filtering
        if (role === 'MEMBER') {
            filtered = filtered.filter(e => e.user_id === userId);
        }

        // Apply type filter
        if (filter) {
            const filterMap: Record<string, string[]> = {
                'pagos': ['PeriodicPaymentRecorded', 'ContributionReceived', 'ContributionRegularized'],
                'coberturas': ['PoolCovered', 'CoverageRepaid'],
                'atrasos': ['LateMarked', 'DefaultConfirmed'],
                'usuarios': ['ParticipantConfirmed', 'ParticipantRemoved', 'ReplacementJoined']
            };
            const filterTypes = filterMap[filter.toLowerCase()];
            if (filterTypes) {
                filtered = filtered.filter(e => filterTypes.includes(e.type));
            }
        }

        const total = filtered.length;
        const paginated = filtered.slice(offset, offset + limit);
        const hasMore = offset + limit < total;

        const entries = paginated.map(e => this.formatLedgerEntry(e, role));

        return { entries, hasMore, total };
    }

    formatLedgerEntry(event: any, role: 'ORGANIZER' | 'MEMBER'): string {
        const date = new Date(event.timestamp).toLocaleDateString('es-MX', {
            day: '2-digit',
            month: '2-digit'
        });

        const amount = event.amount || event.payload?.amount || event.payload?.cuota || '';
        const amountStr = amount ? ` — $${amount}` : '';
        const round = event.payload?.round ? ` P${event.payload.round}` : '';
        const userShort = event.user_id ? event.user_id.substring(0, 8) + '...' : '';

        const typeMap: Record<string, string> = {
            'PeriodicPaymentRecorded': 'Pago periódico',
            'ContributionReceived': 'Pago recibido',
            'ContributionRegularized': 'Pago regularizado',
            'PoolCovered': 'Cobertura activada',
            'CoverageRepaid': 'Reposición cobertura',
            'LateMarked': 'Marcado en atraso',
            'DefaultConfirmed': 'Default confirmado',
            'ParticipantRemoved': 'Usuario reemplazado',
            'ParticipantConfirmed': 'Usuario unido',
            'ReplacementJoined': 'Reemplazo unido',
            'TandaActivated': 'Tanda activada',
            'TurnPaid': 'Turno pagado'
        };

        const typeName = typeMap[event.type] || event.type;

        if (role === 'ORGANIZER') {
            return `• ${date} — ${userShort} — ${typeName}${round}${amountStr}`;
        } else {
            return `• ${date} — ${typeName}${round}${amountStr}`;
        }
    }

    async getLedgerExport(tandaId: string): Promise<any[]> {
        const events = await this.ledger.getEventsByTanda(tandaId);
        return events.map(e => ({
            ledger_id: e.id,
            group_id: e.tanda_id,
            user_id: e.user_id || 'system',
            period_id: e.payload?.round || null,
            entry_type: e.type,
            amount_units: e.amount || 0,
            timestamp: new Date(e.timestamp).toISOString(),
            meta: e.payload
        }));
    }

    // --- MODULE 7 END ---

    // --- MODULE 8 START ---

    async closeTanda(tandaId: string, organizerId: string): Promise<{ success: boolean; msg: string }> {
        const events = await this.ledger.getEventsByTanda(tandaId);

        // Check if organizer
        const role = await this.getUserRole(organizerId, tandaId, events);
        if (role !== 'ORGANIZER') {
            return { success: false, msg: '❌ Solo el organizador puede cerrar la tanda.' };
        }

        // Check idempotency - already closed?
        const alreadyClosed = events.find(e => e.type === 'TandaClosed');
        if (alreadyClosed) {
            return { success: false, msg: '⚠️ Esta tanda ya fue cerrada.' };
        }

        // Check if ready to close
        const readyCheck = await this.isTandaReadyToClose(tandaId, events);
        if (!readyCheck.ready) {
            return { success: false, msg: `⚠️ ${readyCheck.reason}` };
        }

        const closeTimestamp = Date.now();

        // Calculate yield
        const yieldGross = await this.calculateYieldGross(tandaId, events);
        const losses = await this.calculateLosses(tandaId, events);
        const yieldNet = yieldGross - losses;

        await this.ledger.recordEvent({
            type: 'YieldCalculated',
            tanda_id: tandaId,
            timestamp: closeTimestamp,
            payload: { yield_gross: yieldGross, yield_net: yieldNet, losses, fees: 0 }
        });

        // Get eligible participants
        const eligibles = await this.getEligibleForRaffle(tandaId, events);

        if (yieldNet <= 0 || eligibles.length === 0) {
            const reason = yieldNet <= 0 ? 'yield_net <= 0' : 'no_eligibles';
            await this.ledger.recordEvent({
                type: 'YieldNotDistributed',
                tanda_id: tandaId,
                timestamp: closeTimestamp,
                payload: { reason, yield_net: yieldNet, eligible_count: eligibles.length }
            });

            await this.ledger.recordEvent({
                type: 'TandaClosed',
                tanda_id: tandaId,
                timestamp: closeTimestamp,
                payload: { yield_distributed: false }
            });

            return {
                success: true,
                msg: `✅ Tanda cerrada.\n\nRendimiento neto: $${yieldNet}\nNo hubo distribución (${reason === 'yield_net <= 0' ? 'sin rendimientos' : 'sin elegibles'}).`
            };
        }

        // Execute raffle
        const lastEvent = events[events.length - 1];
        const raffleResult = await this.executeRaffle(eligibles, tandaId, closeTimestamp, lastEvent.id || '');

        await this.ledger.recordEvent({
            type: 'RaffleDrawn',
            tanda_id: tandaId,
            timestamp: closeTimestamp,
            payload: {
                seed_hash: raffleResult.seedHash,
                eligible_count: eligibles.length,
                eligibles_hash: raffleResult.eligiblesHash
            }
        });

        await this.ledger.recordEvent({
            type: 'RaffleWinnerSelected',
            tanda_id: tandaId,
            user_id: raffleResult.winner,
            timestamp: closeTimestamp,
            payload: { winner_index: raffleResult.winnerIndex }
        });

        await this.ledger.recordEvent({
            type: 'YieldAwarded',
            tanda_id: tandaId,
            user_id: raffleResult.winner,
            amount: yieldNet,
            timestamp: closeTimestamp,
            payload: { yield_net: yieldNet }
        });

        await this.ledger.recordEvent({
            type: 'TandaClosed',
            tanda_id: tandaId,
            timestamp: closeTimestamp,
            payload: { yield_distributed: true, winner: raffleResult.winner, amount: yieldNet }
        });

        const winnerShort = raffleResult.winner.substring(0, 10) + '...';
        return {
            success: true,
            msg: `✅ Tanda cerrada.\n\n🎉 Rendimiento neto: $${yieldNet}\n👥 Elegibles: ${eligibles.length}\n🏆 Ganador de la rifa: ${winnerShort}\n\nConsulta "Movimientos" para ver el detalle.`
        };
    }

    async isTandaReadyToClose(tandaId: string, events?: any[]): Promise<{ ready: boolean; reason?: string }> {
        if (!events) {
            events = await this.ledger.getEventsByTanda(tandaId);
        }

        const calendar = events.find(e => e.type === 'CalendarCreated');
        if (!calendar) {
            return { ready: false, reason: 'No hay calendario creado.' };
        }

        const schedule = calendar.payload.schedule;
        const lastPeriod = schedule[schedule.length - 1];
        const now = Date.now();

        if (now < lastPeriod.date) {
            const daysLeft = Math.ceil((lastPeriod.date - now) / (24 * 60 * 60 * 1000));
            return { ready: false, reason: `Faltan ${daysLeft} días para el último periodo.` };
        }

        return { ready: true };
    }

    async calculateYieldGross(tandaId: string, events?: any[]): Promise<number> {
        // Module 9: Use real yield from layers if available
        const realYield = await this.calculateRealYieldGross(tandaId);
        if (realYield > 0) {
            return realYield;
        }

        // Fallback: placeholder 5% if no layers initialized
        if (!events) {
            events = await this.ledger.getEventsByTanda(tandaId);
        }
        const created = events.find(e => e.type === 'TandaCreated');
        const initialFund = created?.payload.requiredInitialFund || 0;
        return Math.floor(initialFund * 0.05);
    }

    async calculateLosses(tandaId: string, events?: any[]): Promise<number> {
        if (!events) {
            events = await this.ledger.getEventsByTanda(tandaId);
        }

        const created = events.find(e => e.type === 'TandaCreated');
        const cuota = created?.payload.amount || 0;

        // Losses = coverages not repaid
        const coverages = events.filter(e => e.type === 'PoolCovered');
        const repayments = events.filter(e => e.type === 'CoverageRepaid');

        const unrepaidCount = coverages.length - repayments.length;
        return Math.max(0, unrepaidCount * cuota);
    }

    async getEligibleForRaffle(tandaId: string, events?: any[]): Promise<string[]> {
        if (!events) {
            events = await this.ledger.getEventsByTanda(tandaId);
        }

        // Get all participants
        const participants = events
            .filter(e => e.type === 'ParticipantConfirmed')
            .map(e => e.user_id!);

        const eligibles: string[] = [];

        for (const userId of participants) {
            // Check not REPLACED
            const removed = events.find(e => e.type === 'ParticipantRemoved' && e.user_id === userId);
            if (removed) continue;

            // Check is CURRENT (no pending periods, no unpaid coverages)
            const status = await this.getUserPaymentStatus(userId, tandaId);
            if (status !== 'CURRENT') continue;

            eligibles.push(userId);
        }

        return eligibles.sort(); // Sorted for deterministic order
    }

    async executeRaffle(eligibles: string[], tandaId: string, closeTimestamp: number, lastLedgerId: string): Promise<{
        winner: string;
        winnerIndex: number;
        seedHash: string;
        eligiblesHash: string;
    }> {
        // Build deterministic seed
        const eligibleCount = eligibles.length;
        const seedInput = `${tandaId}${closeTimestamp}${lastLedgerId}${eligibleCount}`;
        const seedHash = this.hashString(seedInput);

        // Convert hash to number for modulo
        const hashNum = parseInt(seedHash.substring(0, 8), 16);
        const winnerIndex = hashNum % eligibleCount;

        // Hash of sorted eligibles for audit
        const eligiblesHash = this.hashString(eligibles.join(','));

        return {
            winner: eligibles[winnerIndex],
            winnerIndex,
            seedHash,
            eligiblesHash
        };
    }

    private hashString(input: string): string {
        // Simple hash for MVP (in production use crypto)
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(16).padStart(8, '0');
    }

    // --- MODULE 8 END ---

    // --- MODULE 9 START ---

    async initializeFundLayers(tandaId: string, totalFund: number): Promise<void> {
        const db = await this.ledger.getDatabase();

        // Check if already exists
        const existing = await db.get(`SELECT * FROM fund_layers WHERE tanda_id = ?`, [tandaId]);
        if (existing) return;

        // Distribute according to percentages
        const capa1 = Math.floor(totalFund * 0.25);
        const capa2 = Math.floor(totalFund * 0.30);
        const capa3 = Math.floor(totalFund * 0.35);
        const capa4 = totalFund - capa1 - capa2 - capa3; // Remainder to Capa 4

        await db.run(`
            INSERT INTO fund_layers (tanda_id, capa1_balance, capa2_balance, capa3_balance, capa4_balance, capa3_initial, capa4_initial, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [tandaId, capa1, capa2, capa3, capa4, capa3, capa4, Date.now()]);

        await this.ledger.recordEvent({
            type: 'FundLayerAllocated',
            tanda_id: tandaId,
            timestamp: Date.now(),
            payload: {
                total: totalFund,
                capa1, capa2, capa3, capa4,
                percentages: [25, 30, 35, 10]
            }
        });
    }

    async useFundForCoverage(tandaId: string, amount: number): Promise<{ success: boolean; layers_used: any[] }> {
        const db = await this.ledger.getDatabase();
        const layers = await db.get(`SELECT * FROM fund_layers WHERE tanda_id = ?`, [tandaId]);

        if (!layers) {
            return { success: false, layers_used: [] };
        }

        let remaining = amount;
        const used: any[] = [];
        const balances = {
            capa1: layers.capa1_balance,
            capa2: layers.capa2_balance,
            capa3: layers.capa3_balance,
            capa4: layers.capa4_balance
        };

        // Priority: 1 → 2 → 3 → 4
        const priority = ['capa1', 'capa2', 'capa3', 'capa4'] as const;

        for (const capa of priority) {
            if (remaining <= 0) break;
            const available = balances[capa];
            if (available > 0) {
                const toUse = Math.min(available, remaining);
                balances[capa] -= toUse;
                remaining -= toUse;
                used.push({ layer: capa, amount: toUse });
            }
        }

        if (remaining > 0) {
            return { success: false, layers_used: [] }; // Insufficient funds
        }

        await db.run(`
            UPDATE fund_layers SET capa1_balance = ?, capa2_balance = ?, capa3_balance = ?, capa4_balance = ?, updated_at = ?
            WHERE tanda_id = ?
        `, [balances.capa1, balances.capa2, balances.capa3, balances.capa4, Date.now(), tandaId]);

        await this.ledger.recordEvent({
            type: 'FundLayerUsed',
            tanda_id: tandaId,
            amount,
            timestamp: Date.now(),
            payload: { layers_used: used, remaining_balances: balances }
        });

        return { success: true, layers_used: used };
    }

    async restoreFundFromRepayment(tandaId: string, amount: number): Promise<{ success: boolean; layers_restored: any[] }> {
        const db = await this.ledger.getDatabase();
        const layers = await db.get(`SELECT * FROM fund_layers WHERE tanda_id = ?`, [tandaId]);

        if (!layers) {
            return { success: false, layers_restored: [] };
        }

        // Get initial allocations to know max capacity per layer
        const events = await this.ledger.getEventsByTanda(tandaId);
        const allocEvent = events.find(e => e.type === 'FundLayerAllocated');
        if (!allocEvent) {
            return { success: false, layers_restored: [] };
        }

        const maxCapacity = {
            capa1: allocEvent.payload.capa1,
            capa2: allocEvent.payload.capa2,
            capa3: allocEvent.payload.capa3,
            capa4: allocEvent.payload.capa4
        };

        let remaining = amount;
        const restored: any[] = [];
        const balances = {
            capa1: layers.capa1_balance,
            capa2: layers.capa2_balance,
            capa3: layers.capa3_balance,
            capa4: layers.capa4_balance
        };

        // Priority: 4 → 3 → 2 → 1 (inverse for restoration)
        const priority = ['capa4', 'capa3', 'capa2', 'capa1'] as const;

        for (const capa of priority) {
            if (remaining <= 0) break;
            const deficit = maxCapacity[capa] - balances[capa];
            if (deficit > 0) {
                const toRestore = Math.min(deficit, remaining);
                balances[capa] += toRestore;
                remaining -= toRestore;
                restored.push({ layer: capa, amount: toRestore });
            }
        }

        await db.run(`
            UPDATE fund_layers SET capa1_balance = ?, capa2_balance = ?, capa3_balance = ?, capa4_balance = ?, updated_at = ?
            WHERE tanda_id = ?
        `, [balances.capa1, balances.capa2, balances.capa3, balances.capa4, Date.now(), tandaId]);

        await this.ledger.recordEvent({
            type: 'FundLayerRestored',
            tanda_id: tandaId,
            amount,
            timestamp: Date.now(),
            payload: { layers_restored: restored, restored_balances: balances }
        });

        return { success: true, layers_restored: restored };
    }

    async calculateRealYieldGross(tandaId: string): Promise<number> {
        const db = await this.ledger.getDatabase();
        const layers = await db.get(`SELECT * FROM fund_layers WHERE tanda_id = ?`, [tandaId]);

        if (!layers) {
            return 0;
        }

        // Option A: (initial + final) / 2
        const capa3Avg = (layers.capa3_initial + layers.capa3_balance) / 2;
        const capa4Avg = (layers.capa4_initial + layers.capa4_balance) / 2;

        // Yield rates (simulated for MVP)
        const yieldRate3 = 0.03; // 3%
        const yieldRate4 = 0.08; // 8%

        const yield3 = capa3Avg * yieldRate3;
        const yield4 = capa4Avg * yieldRate4;

        return Math.floor(yield3 + yield4);
    }

    async getFundLayerStatus(tandaId: string): Promise<{
        capa1: number;
        capa2: number;
        capa3: number;
        capa4: number;
        total: number;
    } | null> {
        const db = await this.ledger.getDatabase();
        const layers = await db.get(`SELECT * FROM fund_layers WHERE tanda_id = ?`, [tandaId]);

        if (!layers) return null;

        return {
            capa1: layers.capa1_balance,
            capa2: layers.capa2_balance,
            capa3: layers.capa3_balance,
            capa4: layers.capa4_balance,
            total: layers.capa1_balance + layers.capa2_balance + layers.capa3_balance + layers.capa4_balance
        };
    }

    // --- MODULE 9 END ---

    // --- MODULE 10 START ---

    async evaluateReminders(tandaId: string, sendMessage: (to: string, msg: string) => Promise<void>): Promise<{
        sent: number;
        skipped: number;
    }> {
        const events = await this.ledger.getEventsByTanda(tandaId);
        const db = await this.ledger.getDatabase();

        // Get calendar
        const calendar = events.find(e => e.type === 'CalendarCreated');
        if (!calendar) return { sent: 0, skipped: 0 };

        const schedule = calendar.payload.schedule;
        const created = events.find(e => e.type === 'TandaCreated');
        const cuota = created?.payload.amount || 0;

        // Get current period from schedule
        const now = Date.now();
        let currentPeriod: { round: number; date: number } | null = null;
        for (let i = schedule.length - 1; i >= 0; i--) {
            if (now >= schedule[i].date) {
                currentPeriod = schedule[i];
                break;
            }
        }
        if (!currentPeriod && schedule.length > 0) {
            currentPeriod = schedule[0];
        }
        if (!currentPeriod) return { sent: 0, skipped: 0 };

        const periodId = currentPeriod.round;
        const dueDate = currentPeriod.date;
        const graceEnd = dueDate + (3 * 24 * 60 * 60 * 1000); // 3 days grace

        // Get participants
        const participants = events
            .filter(e => e.type === 'ParticipantConfirmed')
            .map(e => e.user_id!);

        let sent = 0;
        let skipped = 0;

        for (const userId of participants) {
            // Skip if replaced
            const removed = events.find(e => e.type === 'ParticipantRemoved' && e.user_id === userId);
            if (removed) {
                skipped++;
                continue;
            }

            // Check payment status
            const status = await this.getUserPaymentStatus(userId, tandaId);
            if (status === 'CURRENT') {
                skipped++;
                continue; // Already paid
            }

            const flags = await this.getReminderFlags(tandaId, userId, periodId);
            const oneDayMs = 24 * 60 * 60 * 1000;

            // E1: T-1 (1 day before)
            if (!flags.sent_E1 && now >= dueDate - oneDayMs && now < dueDate) {
                await sendMessage(userId, this.getReminderMessage('E1', periodId, cuota));
                await this.setReminderFlag(tandaId, userId, periodId, 'E1');
                sent++;
            }

            // E2: T-0 (due day)
            if (!flags.sent_E2 && now >= dueDate && now < dueDate + oneDayMs) {
                await sendMessage(userId, this.getReminderMessage('E2', periodId, cuota));
                await this.setReminderFlag(tandaId, userId, periodId, 'E2');
                sent++;
            }

            // E3: Grace start (past due, first day of grace)
            if (!flags.sent_E3 && now >= dueDate + oneDayMs && now < dueDate + (2 * oneDayMs)) {
                await sendMessage(userId, this.getReminderMessage('E3', periodId, cuota));
                await this.setReminderFlag(tandaId, userId, periodId, 'E3');
                sent++;
            }

            // E4: Last grace day
            if (!flags.sent_E4 && now >= graceEnd - oneDayMs && now < graceEnd) {
                await sendMessage(userId, this.getReminderMessage('E4', periodId, cuota));
                await this.setReminderFlag(tandaId, userId, periodId, 'E4');
                sent++;
            }
        }

        return { sent, skipped };
    }

    async getReminderFlags(tandaId: string, userId: string, periodId: number): Promise<{
        sent_E1: boolean;
        sent_E2: boolean;
        sent_E3: boolean;
        sent_E4: boolean;
    }> {
        const db = await this.ledger.getDatabase();
        const row = await db.get(
            `SELECT * FROM reminder_flags WHERE tanda_id = ? AND user_id = ? AND period_id = ?`,
            [tandaId, userId, periodId]
        );

        if (!row) {
            return { sent_E1: false, sent_E2: false, sent_E3: false, sent_E4: false };
        }

        return {
            sent_E1: !!row.sent_E1,
            sent_E2: !!row.sent_E2,
            sent_E3: !!row.sent_E3,
            sent_E4: !!row.sent_E4
        };
    }

    async setReminderFlag(tandaId: string, userId: string, periodId: number, event: 'E1' | 'E2' | 'E3' | 'E4'): Promise<void> {
        const db = await this.ledger.getDatabase();
        const column = `sent_${event}`;

        await db.run(`
            INSERT INTO reminder_flags (tanda_id, user_id, period_id, ${column}, updated_at)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(tanda_id, user_id, period_id) DO UPDATE SET ${column} = 1, updated_at = ?
        `, [tandaId, userId, periodId, Date.now(), Date.now()]);
    }

    async getOrganizerSummary(tandaId: string): Promise<{
        unpaid: number;
        inGrace: number;
        late: number;
        periodId: number;
    } | null> {
        const events = await this.ledger.getEventsByTanda(tandaId);

        const calendar = events.find(e => e.type === 'CalendarCreated');
        if (!calendar) return null;

        const schedule = calendar.payload.schedule;

        // Find current period from schedule
        const now = Date.now();
        let currentPeriod: { round: number; date: number } | null = null;
        for (let i = schedule.length - 1; i >= 0; i--) {
            if (now >= schedule[i].date) {
                currentPeriod = schedule[i];
                break;
            }
        }
        if (!currentPeriod && schedule.length > 0) {
            currentPeriod = schedule[0];
        }
        if (!currentPeriod) return null;

        const participants = events
            .filter(e => e.type === 'ParticipantConfirmed')
            .map(e => e.user_id!);

        let unpaid = 0;
        let inGrace = 0;
        let late = 0;

        for (const userId of participants) {
            const removed = events.find(e => e.type === 'ParticipantRemoved' && e.user_id === userId);
            if (removed) continue;

            const status = await this.getUserPaymentStatus(userId, tandaId);
            if (status === 'CURRENT') continue;
            if (status === 'IN_GRACE') inGrace++;
            else if (status === 'LATE') late++;
            else unpaid++;
        }

        return { unpaid, inGrace, late, periodId: currentPeriod.round };
    }

    private getReminderMessage(event: 'E1' | 'E2' | 'E3' | 'E4', periodId: number, cuota: number): string {
        switch (event) {
            case 'E1':
                return `⏰ *Recordatorio de pago*\nMañana vence tu aportación del Periodo ${periodId}.\nCuota: $${cuota}\n\nEscribe *PAGAR* para completar tu aportación o *ESTADO* para ver el detalle.`;
            case 'E2':
                return `📌 *Hoy vence tu pago*\nTu aportación del Periodo ${periodId} vence hoy.\nCuota: $${cuota}\n\nEscribe *PAGAR* para pagar ahora o *ESTADO* para ver el detalle.`;
            case 'E3':
                return `⚠️ *Pago pendiente (ventana de gracia)*\nNo se recibió tu pago del Periodo ${periodId}.\nAún puedes pagar dentro de la ventana de gracia (3 días) para evitar cobertura del fondo.\n\nEscribe *PAGAR* o *ESTADO*.`;
            case 'E4':
                return `🚨 *Último día para evitar cobertura*\nHoy es el último día para pagar el Periodo ${periodId} antes de que el fondo cubra tu aportación.\n\nEscribe *PAGAR* ahora o *ESTADO* para ver el detalle.`;
        }
    }

    getOrganizerReminderMessage(summary: { unpaid: number; inGrace: number; late: number; periodId: number }): string {
        return `📊 *Resumen de pagos (Periodo ${summary.periodId})*\nPendientes: ${summary.unpaid}\nEn gracia: ${summary.inGrace}\nEn atraso: ${summary.late}\n\nEscribe *ESTADO* para ver el panel completo.`;
    }

    // --- MODULE 10 END ---

    async getTandaByInviteCode(code: string): Promise<Tanda | null> {
        const creationEvents = await this.ledger.getAllTandaCreatedEvents();
        const match = creationEvents.find(e => e.payload.inviteCode === code);

        if (!match) return null;

        const p = match.payload;
        return {
            id: p.id,
            name: p.name,
            organizerId: p.organizerId,
            contributionAmount: p.amount,
            numberOfParticipants: p.numberOfParticipants || p.participants,
            periodicity: p.periodicity,
            durationMonths: p.durationMonths,
            poolType: p.poolType,
            status: p.status,
            inviteCode: p.inviteCode,
            createdAt: match.timestamp,
            currentParticipants: 1,
            fundCollected: 0,
            requiredInitialFund: p.requiredInitialFund
        };
    }
}
