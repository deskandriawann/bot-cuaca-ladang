// Mode develop: dimuat ulang otomatis setiap kode disimpan (npm run dev), TANPA sambungan WhatsApp sendiri.
// Aman dimuat ulang berkali-kali: tidak menyambung ke WhatsApp, tidak memakai pemutus sambung ulang,
// dan memakai folder data-dev/ sendiri (sesi WhatsApp di data/ tidak disentuh).
// Pesan uji dititipkan ke bot utama (npm start) yang sudah tersambung, jadi memakai nomor dan sesi yang sama.
// Halaman: http://localhost:3001. Bot utama tetap berjalan di portnya sendiri (bawaan 3000).
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
const mainEnv = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};

process.env.WA_MODE = 'manual';
process.env.ADMIN_PORT = process.env.DEV_PORT || '3001';
process.env.ADMIN_HOST = process.env.DEV_HOST || '127.0.0.1'; // halaman develop hanya untuk komputer ini
process.env.DATA_DIR = process.env.DEV_DATA_DIR || 'data-dev';
process.env.MAIN_BOT_URL ||= `http://127.0.0.1:${mainEnv.ADMIN_PORT || '3000'}`;
process.env.MAIN_BOT_TOKEN_FILE ||= path.resolve(root, mainEnv.DATA_DIR || 'data', 'api-token');

await import('../src/index.js');
