// Dimuat paling awal oleh berkas tes: pengujian memakai pengaturan bawaan dan folder data sementara,
// jadi tidak terpengaruh .env pengguna dan tidak menyentuh data/ (sesi WhatsApp dan state asli).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BOT_IGNORE_ENV_FILE = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-cuaca-tes-'));

// Halaman pengelola diuji di port acak dengan kata sandi uji
export const ADMIN_PASSWORD = 'kata-sandi-uji-panjang';
process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
process.env.ADMIN_PORT = '0';

// Sesi masuk yang dibuat saat kata sandinya masih yang lama: harus gugur karena kata sandinya sudah diganti
export const OLD_SID = 'a'.repeat(64);
const salt = crypto.randomBytes(16).toString('hex');
const oldPrint = `${salt}:${crypto.scryptSync('kata-sandi-lama-sekali', Buffer.from(salt, 'hex'), 32).toString('hex')}`;
const oldSession = { [crypto.createHash('sha256').update(OLD_SID).digest('hex')]: Date.now() + 86_400_000 };
fs.writeFileSync(path.join(process.env.DATA_DIR, 'login-sessions.json'), JSON.stringify({ password: oldPrint, sessions: oldSession }));
