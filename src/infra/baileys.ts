import { makeWASocket, useMultiFileAuthState, DisconnectReason, WASocket, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs';
const qrcode = require('qrcode-terminal');

const logger = pino({ name: 'infra/baileys' });

export class WhatsAppService {
    private sock: WASocket | undefined;
    private messageHandler: ((msg: any) => Promise<void>) | undefined;

    constructor() { }

    async connect(): Promise<void> {
        const authPath = path.resolve('./auth_info');
        if (!fs.existsSync(authPath)) {
            fs.mkdirSync(authPath, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        const { version, isLatest } = await fetchLatestBaileysVersion();

        logger.info(`Using Baileys v${version.join('.')} (isLatest: ${isLatest})`);

        this.sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }) as any,
            browser: ['Desktop', 'Chrome', '114.0.5735.199'],
            generateHighQualityLinkPreview: true,
            markOnlineOnConnect: true,
            syncFullHistory: false
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            // Handle QR code
            if (qr) {
                console.log('\n📱 Escanea este código QR con WhatsApp:\n');
                qrcode.generate(qr, { small: true });
                console.log('\n👆 Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo\n');
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`\n⚠️ Conexión cerrada. Código: ${statusCode}`);

                if (shouldReconnect) {
                    console.log('🔄 Reconectando en 5 segundos...');
                    setTimeout(() => this.connect(), 5000);
                } else {
                    console.log('❌ Sesión cerrada. Borra ./auth_info y vuelve a ejecutar.');
                }
            } else if (connection === 'open') {
                console.log('\n✅ ¡WhatsApp conectado exitosamente!\n');
                logger.info('WhatsApp Connection Opened!');
            }
        });

        this.sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;

            for (const msg of m.messages) {
                if (!msg.message) continue;
                if (msg.key.fromMe) continue;

                if (this.messageHandler) {
                    try {
                        await this.messageHandler(msg);
                    } catch (e) {
                        logger.error(e, 'Error handling message');
                    }
                }
            }
        });
    }

    onMessage(handler: (msg: any) => Promise<void>) {
        this.messageHandler = handler;
    }

    async sendMessage(to: string, text: string): Promise<void> {
        if (!this.sock) {
            logger.error('Cannot send message: Socket not initialized');
            return;
        }
        await this.sock.sendMessage(to, { text });
    }
}
