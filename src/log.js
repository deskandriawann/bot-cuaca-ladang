// Log bot (pino), dipakai bersama semua bagian. LOG_LEVEL=debug untuk rincian.
// Sambungan WhatsApp (Baileys) memakai log sendiri, lihat BAILEYS_LOG_LEVEL di whatsapp/connection.js.
import pino from 'pino';

export const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
