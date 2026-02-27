import { WhatsAppService } from '../infra/baileys';
import { SessionRepository } from '../infra/session-repo';
import { TandaService } from '../domain/tanda-service';
import { LedgerRepository } from '../infra/ledger';
import pino from 'pino';

const logger = pino({ name: 'app/handler' });

export class MessageHandler {
    constructor(
        private wa: WhatsAppService,
        private sessions: SessionRepository,
        private tandaService: TandaService,
        private ledger: LedgerRepository
    ) { }

    async handle(msg: any) {
        const remoteJid = msg.key.remoteJid;
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
        const userId = remoteJid?.replace('@s.whatsapp.net', '') || '';

        if (!remoteJid || !userId) return;

        const input = text.trim();
        const cleanInput = input.toLowerCase();

        logger.info({ userId, input }, 'Processing message');

        if (this.isGlobalEscape(cleanInput)) {
            await this.handleGlobalEscape(userId, remoteJid);
            return;
        }

        const session = await this.sessions.getState(userId);

        if (session && session.state !== 'IDLE') {
            await this.handleFlow(session, input, remoteJid, msg);
            return;
        }

        await this.handleMenuSelection(input, remoteJid, userId);
    }

    private isGlobalEscape(input: string): boolean {
        const escapeKeywords = ['menu', '0', 'cancelar', 'inicio', 'volver', 'salir'];
        return escapeKeywords.includes(input);
    }

    private async handleGlobalEscape(userId: string, to: string) {
        await this.sessions.clearState(userId);
        await this.ledger.recordEvent({
            type: 'FlowCancelled',
            user_id: userId,
            payload: { reason: 'user_escape' },
            timestamp: Date.now()
        });
        await this.showMainMenu(to, userId);
    }

    private async handleMenuSelection(input: string, to: string, userId: string) {
        const clean = input.toLowerCase();

        await this.ledger.recordEvent({
            type: 'IntentSelected',
            user_id: userId,
            payload: { input },
            timestamp: Date.now()
        });

        // Check if this is the user's first interaction (no previous MenuShown events)
        const userEvents = await this.ledger.getEventsByUser(userId);
        const previousMenus = userEvents.filter(e => e.type === 'MenuShown');
        const isFirstMessage = previousMenus.length === 0;

        // First message ever → show menu directly, no matter what they wrote
        if (isFirstMessage) {
            await this.showMainMenu(to, userId);
            return;
        }

        switch (true) {
            case clean === '1' || clean.includes('crear'):
                await this.startFlow(userId, 'CREATING_TANDA_NAME', {}, to, 'Creating Tanda');
                await this.wa.sendMessage(to, '🌟 *Crear Nueva Tanda*\n\n¿Cómo quieres nombrar a tu tanda?');
                break;
            case clean === '2' || clean.includes('unirme'):
                await this.startFlow(userId, 'JOINING_TANDA_CODE', {}, to, 'Joining Tanda');
                await this.wa.sendMessage(to, '🔗 *Unirse a una Tanda*\n\nPor favor escribe el *Código de Invitación* (ej. A1B2C3).');
                break;
            case clean === '3' || clean.includes('ver mis tandas'):
                await this.showMyTandas(to, userId);
                break;
            case clean === '4' || clean.includes('pagar'):
                await this.handlePaymentIntent(userId, to);
                break;
            case clean === '5':
                await this.wa.sendMessage(to, '📅 *Calendario* (En construcción).');
                break;
            case clean === '6' || clean === 'estado' || clean === 'ver estado' || clean.includes('mi tanda'):
                await this.handleStatusPanel(userId, to);
                break;
            case clean === '7' || clean === 'ledger' || clean === 'movimientos' || clean === 'historial' || clean.includes('ver movimientos'):
                await this.handleLedgerQuery(userId, to);
                break;
            case clean === '8':
                await this.handleOrganizerPanel(userId, to);
                break;
            case clean === 'nota':
                await this.startFlow(userId, 'SUBMIT_USER_NOTE', {}, to, 'User Note');
                await this.wa.sendMessage(to, 'Escribe tu mensaje para el organizador:');
                break;
            default:
                // Any other input (including greetings) results in showing the menu directly
                await this.showMainMenu(to, userId);
                break;
        }
    }

    private async startFlow(userId: string, state: string, context: any, to: string, flowName: string) {
        await this.sessions.setState(userId, state, context);
        await this.ledger.recordEvent({
            type: 'FlowStarted',
            user_id: userId,
            payload: { flow: flowName, initial_state: state },
            timestamp: Date.now()
        });
    }

    private async handlePaymentIntent(userId: string, to: string) {
        const userEvents = await this.ledger.getEventsByUser(userId);
        const tandaIds = [...new Set(userEvents.map(e => e.tanda_id).filter(id => id))];

        if (tandaIds.length === 0) {
            await this.wa.sendMessage(to, 'No estás en ninguna tanda activa.');
            return;
        }

        // For MVP: Use first active tanda
        const tandaId = tandaIds[0] as string;
        const events = await this.ledger.getEventsByTanda(tandaId);

        // Check if tanda is activated (has calendar)
        const hasCalendar = events.some(e => e.type === 'CalendarCreated');
        const hasInitialFund = events.some(e => e.type === 'InitialFundCompleted');

        if (!hasCalendar) {
            // Initial payment flow (pre-activation)
            await this.wa.sendMessage(to, '📌 *Depósito Inicial*\n\nEste depósito sirve como respaldo del grupo para que, si alguien se atrasa, la tanda no se detenga. Al finalizar la tanda, tu depósito se devuelve.');
            await this.startFlow(userId, 'PAYMENT_PROOF', { tandaId }, to, 'Payment');
            await this.wa.sendMessage(to, '💰 *Registrar Pago*\n\nSube tu comprobante (Foto o texto).');
            return;
        }

        // Periodic payment flow (post-activation)
        const status = await this.tandaService.getUserPaymentStatus(userId, tandaId);
        const created = events.find(e => e.type === 'TandaCreated');
        const dueAmount = created?.payload.amount || 0;

        let statusEmoji = '✅';
        let statusText = 'AL CORRIENTE';
        if (status === 'IN_GRACE') { statusEmoji = '⏳'; statusText = 'EN GRACIA'; }
        if (status === 'LATE') { statusEmoji = '⚠️'; statusText = 'ATRASADO'; }
        if (status === 'REPLACED') { statusEmoji = '🚫'; statusText = 'REEMPLAZADO'; }

        if (status === 'REPLACED') {
            await this.wa.sendMessage(to, `${statusEmoji} *Estado: ${statusText}*\n\nTu participación fue reemplazada por default. Escribe "nota" para enviar un mensaje al organizador.`);
            return;
        }

        // Get pending periods
        const pending = await this.tandaService.getPendingPeriods(userId, tandaId);

        let pendingMsg = '';
        if (pending.length > 0) {
            pendingMsg = `\n\n📋 *Periodos Pendientes:*\n`;
            for (const p of pending) {
                const icon = p.status === 'COVERED' ? '🛡️' : (p.status === 'LATE' ? '⚠️' : '⏳');
                pendingMsg += `${icon} Periodo ${p.round}: ${p.status}\n`;
            }
        }

        await this.wa.sendMessage(to, `💰 *Pagar Cuota Periódica*\n\n${statusEmoji} Estado: *${statusText}*\n💵 Cuota: *$${dueAmount}*${pendingMsg}\n\n¿Deseas pagar $${dueAmount}?\n*1.* ✅ Sí, pagar\n*2.* ❌ Cancelar`);

        await this.startFlow(userId, 'PERIODIC_PAYMENT_CONFIRM', { tandaId, dueAmount }, to, 'Periodic Payment');
    }

    private async handleStatusPanel(userId: string, to: string) {
        const userEvents = await this.ledger.getEventsByUser(userId);
        const tandaIds = [...new Set(userEvents.map(e => e.tanda_id).filter(id => id))];

        if (tandaIds.length === 0) {
            await this.wa.sendMessage(to, '⚠️ No tienes una tanda activa en este momento.');
            return;
        }

        // If multiple tandas, ask user to select one
        if (tandaIds.length > 1) {
            const tandaOptions: string[] = [];
            for (let i = 0; i < tandaIds.length; i++) {
                const events = await this.ledger.getEventsByTanda(tandaIds[i] as string);
                const created = events.find(e => e.type === 'TandaCreated');
                const name = created?.payload?.name || `Tanda ${i + 1}`;
                tandaOptions.push(`${i + 1}. ${name}`);
            }

            await this.sessions.setState(userId, 'SELECTING_TANDA_FOR_STATUS', { tandaIds });
            await this.wa.sendMessage(to, `📋 *Estás en varias tandas*\n\n¿Cuál quieres ver?\n\n${tandaOptions.join('\n')}\n\nResponde con un número.`);
            return;
        }

        // Single tanda - show status directly
        const tandaId = tandaIds[0] as string;
        const result = await this.tandaService.getStatusPanel(userId, tandaId);
        await this.wa.sendMessage(to, result.panel);
    }

    private async handleLedgerQuery(userId: string, to: string, options: { offset?: number; filter?: string } = {}) {
        const userEvents = await this.ledger.getEventsByUser(userId);
        const tandaIds = [...new Set(userEvents.map(e => e.tanda_id).filter(id => id))];

        if (tandaIds.length === 0) {
            await this.wa.sendMessage(to, '⚠️ No tienes una tanda activa.');
            return;
        }

        const tandaId = tandaIds[0] as string;
        const role = await this.tandaService.getUserRole(userId, tandaId);

        const result = await this.tandaService.getLedgerView(userId, tandaId, {
            limit: 5,
            offset: options.offset || 0,
            filter: options.filter
        });

        const header = role === 'ORGANIZER' ? '📒 *Ledger de la tanda*' : '📒 *Tus últimos movimientos*';
        let msg = `${header}\n\n`;

        if (result.entries.length === 0) {
            msg += 'No hay movimientos registrados.';
        } else {
            msg += result.entries.join('\n');
        }

        msg += '\n\n*Filtrar por:*\n• Pagos\n• Coberturas\n• Atrasos';

        if (result.hasMore) {
            msg += '\n\nEscribe *"Ver más"* para continuar.';
            await this.startFlow(userId, 'LEDGER_PAGINATE', {
                tandaId,
                offset: (options.offset || 0) + 5,
                filter: options.filter
            }, to, 'Ledger Pagination');
        }

        await this.wa.sendMessage(to, msg);
    }

    private async handleOrganizerPanel(userId: string, to: string) {
        // Fetch all generated proofs for user's organized tandas
        const db = await this.ledger.getDatabase();

        // 1. Get Tandas I organize
        const myTandas = await db.all(`SELECT tanda_id FROM events WHERE type = 'TandaCreated' AND user_id = ?`, [userId]);
        const tandaIds = myTandas.map(row => row.tanda_id).map(id => `'${id}'`).join(',');

        if (!tandaIds) {
            await this.wa.sendMessage(to, 'No organizas ninguna tanda.');
            return;
        }

        // MODULE 5.1: Check Defaults
        const defaults = await db.all(`
            SELECT * FROM events 
            WHERE tanda_id IN (${tandaIds}) 
            AND type = 'DefaultConfirmed'
        `);

        // Filter out those who are Removed
        // (Expensive check in loop, MVP ok)
        const activeDefaults = [];
        for (const def of defaults) {
            const removed = await db.get(`SELECT * FROM events WHERE type = 'ParticipantRemoved' AND user_id = ? AND tanda_id = ?`, [def.user_id, def.tanda_id]);
            if (!removed) activeDefaults.push(def);
        }

        if (activeDefaults.length > 0) {
            const defItem = activeDefaults[0];

            // Module 5.1/5.2 Check Eligibility
            const eligibility = await this.tandaService.checkDefaultReplacementEligibility(defItem.tanda_id, defItem.user_id);

            if (eligibility.eligible) {
                // Case A: Replacement Allowed
                await this.startFlow(userId, 'ORGANIZER_HANDLE_DEFAULT', {
                    tandaId: defItem.tanda_id,
                    defaultedUserId: defItem.user_id,
                    mode: 'REPLACE'
                }, to, 'Handle Default Replace');

                await this.wa.sendMessage(to, `⚠️ *Participante en Default*\nUsuario: ${defItem.user_id}\n\n¿Qué deseas hacer?\n1. 🚫 Expulsar y Reemplazar\n2. ⏭️ Mantener (Ignorar)`);
            } else {
                // Case B: Post-Turn Recovery
                await this.startFlow(userId, 'ORGANIZER_HANDLE_DEFAULT', {
                    tandaId: defItem.tanda_id,
                    defaultedUserId: defItem.user_id,
                    mode: 'RECOVERY'
                }, to, 'Handle Default Recovery');

                await this.wa.sendMessage(to, `⚠️ *Incumplimiento Post-Turno*\nUsuario: ${defItem.user_id}\n⚠️ *YA COBRÓ SU TURNO*. No se puede reemplazar.\n\nOpciones:\n1. 🩹 Iniciar Modo Recuperación\n2. 📝 Ver/Registrar Nota\n3. ↩️ Revertir Default (Manual)\n4. ⏭️ Cerrar`);
            }
            return;
        }

        // 2. Get Proofs and Validations
        const rows = await db.all(`
            SELECT * FROM events 
            WHERE tanda_id IN (${tandaIds}) 
            AND type IN ('ProofReceived', 'PaymentValidated', 'PaymentRejected')
        `);

        const proofs = rows.filter(r => r.type === 'ProofReceived');
        const validations = rows.filter(r => r.type === 'PaymentValidated' || r.type === 'PaymentRejected');

        const processedProofIds = new Set(validations.map(v => {
            const p = JSON.parse(v.payload);
            return p.proofEventId;
        }));

        const pendingProofs = proofs.filter(p => !processedProofIds.has(p.uuid));

        if (pendingProofs.length === 0) {
            // Check if any tanda is ready to close
            for (const t of myTandas) {
                const tandaId = t.tanda_id;
                const readyCheck = await this.tandaService.isTandaReadyToClose(tandaId);
                if (readyCheck.ready) {
                    await this.startFlow(userId, 'CLOSE_TANDA_CONFIRM', { tandaId }, to, 'Close Tanda');
                    await this.wa.sendMessage(to, `🎉 *Tanda lista para cerrar*\n\nLa tanda ha completado todos los periodos.\n\n¿Deseas cerrar la tanda y ejecutar la rifa de rendimientos?\n\n*1.* ✅ Sí, cerrar tanda\n*2.* ❌ No, mantener abierta`);
                    return;
                }
            }
            await this.checkPendingTurnOrder(userId, to);
            return;
        }

        // Show first pending proof
        const p = pendingProofs[0];
        const evt = {
            id: p.uuid,
            tandaId: p.tanda_id,
            userId: p.user_id,
            val: p.amount || '?',
            ref: p.external_ref
        };

        await this.startFlow(userId, 'ORGANIZER_VALIDATE', { proof: evt }, to, 'Organizer Validation');
        await this.wa.sendMessage(to, `👮 *Validar Pago*\n\nUsuario: ${evt.userId}\nTanda: ${evt.tandaId}\nRef: ${evt.ref}\n\nResponde:\n1. Validar\n2. Rechazar`);
    }

    private async checkPendingTurnOrder(userId: string, to: string) {
        // Check for tandas that are fully funded but not activated
        const db = await this.ledger.getDatabase();
        const rows = await db.all(`
            SELECT * FROM events 
            WHERE type = 'InitialFundCompleted'
            AND tanda_id IN (SELECT tanda_id FROM events WHERE type = 'TandaCreated' AND user_id = ?)
            AND tanda_id NOT IN (SELECT tanda_id FROM events WHERE type = 'TurnOrderAssigned')
        `, [userId]);

        if (rows.length === 0) {
            await this.wa.sendMessage(to, '👮 *Panel Organizador*\n\nNo hay acciones pendientes.');
            return;
        }

        const tandaId = rows[0].tanda_id; // Pick first
        await this.startFlow(userId, 'ASSIGN_TURN_ORDER', { tandaId }, to, 'Assign Turn Order');
        await this.wa.sendMessage(to, '🎉 *¡Fondo Completado!* todos han pagado.\n\n¿Cómo definimos el orden de turnos?\n1. Aleatorio (Bot decide)\n2. Manual (Yo decido)');
    }

    private async handleFlow(session: any, input: string, to: string, msgObject: any) {
        const { state, context, userId } = session;

        try {
            // ... (Previous flows)
            if (state === 'ASSIGN_TURN_ORDER') {
                if (input === '1') {
                    await this.tandaService.assignTurnOrder(context.tandaId, 'RANDOM', []);
                    await this.wa.sendMessage(to, '🎲 *Orden Aleatorio Asignado*.\n📅 Calendario Generado.\n🚀 *¡Tanda Activada!*');
                } else if (input === '2') {
                    await this.wa.sendMessage(to, '✏️ (Modo Manual no implementado en MVP - Usando Aleatorio)');
                    await this.tandaService.assignTurnOrder(context.tandaId, 'RANDOM', []);
                    await this.wa.sendMessage(to, '🎲 *Orden Aleatorio Asignado*.\n📅 Calendario Generado.\n🚀 *¡Tanda Activada!*');
                } else {
                    await this.wa.sendMessage(to, 'Opcion invalida');
                    return;
                }
                await this.sessions.clearState(userId);
                return;
            }

            if (state === 'SELECTING_TANDA_FOR_STATUS') {
                const selection = parseInt(input.trim());
                const tandaIds = context.tandaIds || [];

                if (isNaN(selection) || selection < 1 || selection > tandaIds.length) {
                    await this.wa.sendMessage(to, `❌ Selección inválida. Elige un número del 1 al ${tandaIds.length}.`);
                    return;
                }

                const selectedTandaId = tandaIds[selection - 1];
                await this.sessions.clearState(userId);
                const result = await this.tandaService.getStatusPanel(userId, selectedTandaId);
                await this.wa.sendMessage(to, result.panel);
                return;
            }

            if (state.startsWith('CREATING_TANDA')) {
                await this.handleCreateTandaFlow(session, input, to);
                return;
            }
            if (state === 'JOINING_TANDA_CODE') {
                const code = input.trim().toUpperCase();

                // Try Replacement First
                const repResult = await this.tandaService.joinTandaAsReplacement(code, userId);
                if (repResult.success) {
                    await this.wa.sendMessage(to, `🔄 *Unido como Reemplazo*\n\nHas tomado un lugar disponible. Ahora debes realizar tu *Depósito Inicial* completo para confirmar tu posición.`);
                    // Immediate Payment Flow
                    await this.sessions.setState(userId, 'PAYMENT_PROOF', { tandaId: repResult.tandaId });
                    await this.wa.sendMessage(to, '💰 *Registrar Pago*\n\nSube tu comprobante (Foto o texto).');
                    return;
                }

                const tanda = await this.tandaService.getTandaByInviteCode(code);
                if (!tanda) {
                    await this.wa.sendMessage(to, '❌ Código no encontrado. Intenta de nuevo.');
                    return;
                }
                await this.sessions.setState(userId, 'JOINING_TANDA_NAME', { tandaId: tanda.id });
                await this.wa.sendMessage(to, `✅ *Código verificado!*\n\nTe estás uniendo a la tanda *${tanda.name}*.\n\n¿Cuál es tu *nombre completo*? (Este nombre lo verá el organizador).`);
                return;
            }

            if (state === 'JOINING_TANDA_NAME') {
                const name = input.trim();
                const tandaId = context.tandaId;

                if (name.length < 3) {
                    await this.wa.sendMessage(to, '⚠️ Por favor escribe tu nombre completo para que el organizador pueda identificarte.');
                    return;
                }

                const tandaEvents = await this.ledger.getEventsByTanda(tandaId);
                const createdEvent = tandaEvents.find(e => e.type === 'TandaCreated');

                if (!createdEvent) {
                    await this.wa.sendMessage(to, '❌ Error al recuperar la información de la tanda. Intenta de nuevo.');
                    await this.sessions.clearState(userId);
                    return;
                }

                const tandaName = createdEvent.payload.name;
                const cuota = createdEvent.payload.amount || 0;
                const participantes = createdEvent.payload.participants || 0;
                const periodicidad = createdEvent.payload.periodicity || 'weekly';
                const periName = periodicidad === 'weekly' ? 'Semanal' : (periodicidad === 'biweekly' ? 'Quincenal' : 'Mensual');

                await this.tandaService.joinTanda(tandaId, userId, 'MEMBER', name);
                await this.sessions.clearState(userId);

                // Count current members (including the one who just joined)
                const joinEvents = tandaEvents.filter(e => e.type === 'ParticipantConfirmed');
                const currentMembers = joinEvents.length + 1; // +1 for the current join

                const isFull = currentMembers >= participantes;

                if (isFull) {
                    // Tanda is full - notify new member
                    await this.wa.sendMessage(to, `✅ *¡Bienvenido, ${name}!* Te has unido a *${tandaName}*.\n\n📋 *Detalles de la tanda:*\n💵 Cuota: *$${cuota}*\n📅 Periodicidad: *${periName}*\n👥 Participantes: *${currentMembers}/${participantes}* ✅ ¡Completa!\n\n🎉 *La tanda está completa.*\nEl organizador les indicará los siguientes pasos para el *depósito inicial*.`);

                    // Notify organizer that tanda is full
                    const organizerId = createdEvent.user_id;
                    if (organizerId) {
                        const organizerJid = organizerId.includes('@') ? organizerId : `${organizerId}@s.whatsapp.net`;
                        await this.wa.sendMessage(organizerJid, `🎉 *¡Tu tanda "${tandaName}" está completa!*\n\n🔔 *${name}* fue el último en unirse.\n\n👥 *${currentMembers}/${participantes}* participantes confirmados.\n\n📋 *Siguiente paso:*\nAhora debes solicitar el *Depósito Inicial* a todos los participantes. Usa la opción *8* para gestionar pagos.`);
                    }

                    // Notify all other existing participants
                    // Note: joinEvents doesn't include the current one yet as it was just recorded
                    const allParticipantIds = joinEvents
                        .map(e => e.user_id)
                        .filter(id => id && id !== userId && id !== createdEvent.user_id);

                    for (const pId of allParticipantIds) {
                        const pJid = pId!.includes('@') ? pId! : `${pId}@s.whatsapp.net`;
                        await this.wa.sendMessage(pJid, `🎉 *¡La tanda "${tandaName}" está completa!*\n\n🔔 *${name}* se acaba de unir.\n\n👥 *${currentMembers}/${participantes}* participantes confirmados.\n\nEl organizador les indicará los pasos para el *depósito inicial* pronto.`);
                    }
                } else {
                    // Tanda not full yet
                    await this.wa.sendMessage(to, `✅ *¡Bienvenido, ${name}!* Te has unido a *${tandaName}*.\n\n📋 *Detalles de la tanda:*\n💵 Cuota: *$${cuota}*\n📅 Periodicidad: *${periName}*\n👥 Participantes: *${currentMembers}/${participantes}*\n\n⏳ Cuando la tanda esté completa, te pediremos el *depósito inicial*.`);

                    // Notify organizer of new participant
                    const organizerId = createdEvent.user_id;
                    if (organizerId && organizerId !== userId) {
                        const organizerJid = organizerId.includes('@') ? organizerId : `${organizerId}@s.whatsapp.net`;
                        await this.wa.sendMessage(organizerJid, `🔔 *Nuevo participante: ${name}*\n\nSe unió a tu tanda *${tandaName}*.\n\n👥 Ahora hay *${currentMembers}/${participantes}* participantes.\n\n⏳ Faltan *${participantes - currentMembers}* para completar.`);
                    }
                }
                return;
            }
            if (state === 'PAYMENT_PROOF') {
                const desc = input || 'Media';
                await this.tandaService.registerInitialPayment({
                    tandaId: context.tandaId, userId, amount: 0, reference: desc, method: 'WHATSAPP', adminId: 'PENDING'
                });
                await this.sessions.clearState(userId);
                await this.wa.sendMessage(to, '📩 *Recibido*. El organizador validará pronto.');
                return;
            }

            if (state === 'ORGANIZER_VALIDATE') {
                const proof = context.proof;
                if (input === '1') {
                    await this.tandaService.validatePayment({
                        proofEventId: proof.id, tandaId: proof.tandaId, userId: proof.userId, organizerId: userId, isValid: true
                    });
                    await this.wa.sendMessage(to, '✅ Pago Validado.');
                } else if (input === '2') {
                    await this.tandaService.validatePayment({
                        proofEventId: proof.id, tandaId: proof.tandaId, userId: proof.userId, organizerId: userId, isValid: false
                    });
                    await this.wa.sendMessage(to, '❌ Pago Rechazado.');
                } else {
                    await this.wa.sendMessage(to, 'Opción inválida (1/2).');
                    return;
                }
                await this.sessions.clearState(userId);
                await this.wa.sendMessage(to, 'Escribe 8 para seguir validando.');
                return;
            }

            if (state === 'ORGANIZER_HANDLE_DEFAULT') {
                if (context.mode === 'REPLACE') {
                    if (input === '1') {
                        try {
                            const code = await this.tandaService.generateReplacementCode(context.tandaId, context.defaultedUserId);
                            await this.wa.sendMessage(to, `🚫 Participante expulsado.\n🔑 *Código de Reemplazo*: ${code}\n\nCompártelo con el nuevo integrante.`);
                        } catch (e: any) {
                            await this.wa.sendMessage(to, `❌ No se pudo reemplazar: ${e.message}`);
                        }
                    } else {
                        await this.wa.sendMessage(to, '⏭️ Mantenido en la tanda.');
                    }
                } else if (context.mode === 'RECOVERY') {
                    if (input === '1') {
                        await this.tandaService.startRecoveryMode(context.tandaId, context.defaultedUserId);
                        await this.wa.sendMessage(to, '✅ Modo Recuperación Iniciado.');
                    } else if (input === '2') {
                        await this.sessions.setState(userId, 'ORGANIZER_NOTE', context);
                        await this.wa.sendMessage(to, 'Escribe la nota o acuerdo:');
                        return;
                    } else if (input === '3') {
                        await this.tandaService.reverseDefault(context.tandaId, context.defaultedUserId, userId, 'Manual Reversal by Organizer');
                        await this.wa.sendMessage(to, '↩️ Default Revertido. Usuario desbloqueado.');
                    } else {
                        await this.wa.sendMessage(to, 'Cerrado.');
                    }
                }
                await this.sessions.clearState(userId);
                return;
            }

            if (state === 'ORGANIZER_NOTE') {
                await this.tandaService.registerUserNote(context.tandaId, context.defaultedUserId, input);
                await this.wa.sendMessage(to, '📝 Nota guardada.');
                await this.sessions.clearState(userId);
                return;
            }

            // Module 4: Periodic Payment Confirmation
            if (state === 'PERIODIC_PAYMENT_CONFIRM') {
                if (input === '1') {
                    const result = await this.tandaService.payPeriodic({
                        userId,
                        tandaId: context.tandaId,
                        amountFiat: context.dueAmount
                    });
                    await this.wa.sendMessage(to, result.msg);
                } else {
                    await this.wa.sendMessage(to, '❌ Pago cancelado.');
                }
                await this.sessions.clearState(userId);
                return;
            }

            // Module 7: Ledger Pagination
            if (state === 'LEDGER_PAGINATE') {
                const cleanInput = input.toLowerCase();
                if (cleanInput === 'ver más' || cleanInput === 'ver mas' || cleanInput === 'siguiente') {
                    await this.handleLedgerQuery(userId, to, {
                        offset: context.offset,
                        filter: context.filter
                    });
                } else if (['pagos', 'coberturas', 'atrasos', 'usuarios'].includes(cleanInput)) {
                    await this.handleLedgerQuery(userId, to, { offset: 0, filter: cleanInput });
                } else {
                    await this.wa.sendMessage(to, 'Escribe "Ver más" o un filtro (Pagos, Coberturas, Atrasos).');
                    return;
                }
                await this.sessions.clearState(userId);
                return;
            }

            // Module 8: Close Tanda Confirmation
            if (state === 'CLOSE_TANDA_CONFIRM') {
                if (input === '1') {
                    const result = await this.tandaService.closeTanda(context.tandaId, userId);
                    await this.wa.sendMessage(to, result.msg);
                } else {
                    await this.wa.sendMessage(to, '⏸️ Cierre cancelado. La tanda permanece abierta.');
                }
                await this.sessions.clearState(userId);
                return;
            }

            if (state === 'SUBMIT_USER_NOTE') {
                // Context needs tandaId? Or we search active defaults for user?
                // For MVP assuming 1 active default context or infer
                const status = await this.tandaService.isUserBlocked(userId);
                if (status.blocked) {
                    // We find the tanda where they defaulted
                    // Simplified: Just record generic note or find last default
                    const events = await this.ledger.getEventsByUser(userId);
                    const lastDefault = events.reverse().find(e => e.type === 'DefaultConfirmed');
                    if (lastDefault) {
                        await this.tandaService.registerUserNote(lastDefault.tanda_id!, userId, input);
                        await this.wa.sendMessage(to, '📩 Nota enviada al organizador.');
                    } else {
                        await this.wa.sendMessage(to, 'No encontré el incidente activo.');
                    }
                }
                await this.sessions.clearState(userId);
                return;
            }

            await this.sessions.clearState(userId);
            await this.showMainMenu(to, userId);
        } catch (err) {
            logger.error(err, 'Flow Error');
            await this.handleGlobalEscape(userId, to);
        }
    }

    private async handleCreateTandaFlow(session: any, input: string, to: string) {
        const { state, context, userId } = session;
        if (state === 'CREATING_TANDA_NAME') {
            context.name = input;
            await this.sessions.setState(userId, 'CREATING_TANDA_AMOUNT', context);
            await this.wa.sendMessage(to, `Nombre: ${input}. ¿Monto?`);
            return;
        }
        if (state === 'CREATING_TANDA_AMOUNT') {
            context.amount = parseFloat(input);
            await this.sessions.setState(userId, 'CREATING_TANDA_PARTICIPANTS', context);
            await this.wa.sendMessage(to, '¿Participantes?');
            return;
        }
        if (state === 'CREATING_TANDA_PARTICIPANTS') {
            context.participants = parseInt(input);
            await this.sessions.setState(userId, 'CREATING_TANDA_PERIODICITY', context);
            await this.wa.sendMessage(to, 'Periodicidad: 1.Semanal 2.Quincenal 3.Mensual');
            return;
        }
        if (state === 'CREATING_TANDA_PERIODICITY') {
            const periodicityMap: Record<string, string> = { '1': 'weekly', '2': 'biweekly', '3': 'monthly' };
            context.periodicity = periodicityMap[input] || 'weekly';

            // Calculate duration automatically based on participants and periodicity
            // Weekly: participants weeks ≈ participants/4 months
            // Biweekly: participants * 2 weeks ≈ participants/2 months
            // Monthly: participants months
            const participants = context.participants || 10;
            if (context.periodicity === 'weekly') {
                context.duration = Math.ceil(participants / 4);
            } else if (context.periodicity === 'biweekly') {
                context.duration = Math.ceil(participants / 2);
            } else {
                context.duration = participants;
            }

            await this.sessions.setState(userId, 'CREATING_TANDA_CONFIRM', context);

            const periName = context.periodicity === 'weekly' ? 'Semanal' : (context.periodicity === 'biweekly' ? 'Quincenal' : 'Mensual');
            await this.wa.sendMessage(to, `📋 *Resumen de tu tanda:*\n\n📝 Nombre: *${context.name}*\n💵 Cuota: *$${context.amount}*\n👥 Participantes: *${context.participants}*\n📅 Periodicidad: *${periName}*\n⏰ Duración: *~${context.duration} meses*\n\n¿Confirmas? (SI/NO)`);
            return;
        }
        if (state === 'CREATING_TANDA_CONFIRM') {
            const normalized = input.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const isConfirmed = normalized.includes('si') || normalized === 's' || normalized === 'yes' || normalized === 'ok';
            if (isConfirmed) {
                await this.sessions.setState(userId, 'CREATING_TANDA_ORGANIZER_PARTICIPATES', context);
                await this.wa.sendMessage(to, `👤 *¿Participarás en esta tanda?*\n\n1. Sí, seré participante\n2. No, solo voy a organizarla`);
            } else {
                await this.wa.sendMessage(to, 'Cancelado.');
                await this.sessions.clearState(userId);
            }
            return;
        }
        if (state === 'CREATING_TANDA_ORGANIZER_PARTICIPATES') {
            const organizerParticipates = input === '1' || input.toLowerCase().includes('si');
            context.organizerParticipates = organizerParticipates;

            const t = await this.tandaService.createTanda({
                name: context.name, organizerId: userId, amount: context.amount, participants: context.participants, periodicity: context.periodicity, durationMonths: context.duration, organizerParticipates
            });

            const initialCount = organizerParticipates ? '1' : '0';
            await this.wa.sendMessage(to, `✅ *¡Tanda "${context.name}" creada!*

🎯 *Siguiente paso:*
Comparte este código con los demás participantes:

🔑 *${t.inviteCode}*

👥 Participantes: *${initialCount}/${context.participants}*

Cuando todos se unan, les pediré el *DEPÓSITO INICIAL*.
Este depósito crea el Fondo de Seguridad que protege la tanda y se devuelve al finalizar el ciclo si no fue utilizado.`);
            await this.sessions.clearState(userId);
        }
    }

    private async showMainMenu(to: string, userId: string) {
        await this.wa.sendMessage(to, `👋 Antaria
¿Qué quieres hacer?

1. Crear tanda
2. Unirme a una tanda (con código)
3. Ver mis tandas
4. Registrar pago
5. Ver calendario de pagos
6. Ver estado de mi tanda y fondo
7. Ayuda
8. Organizador: Validar pagos

Responde con un número.`);
        await this.ledger.recordEvent({ type: 'MenuShown', user_id: userId, timestamp: Date.now(), payload: {} });
    }

    private async showMyTandas(to: string, userId: string) {
        const events = await this.ledger.getEventsByUser(userId);
        const count = new Set(events.map(e => e.tanda_id).filter(id => id)).size;
        await this.wa.sendMessage(to, `📋 Estás en ${count} tandas.`);
    }
}
