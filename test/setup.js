// Dimuat paling awal oleh berkas tes: pengujian memakai pengaturan bawaan dan folder data sementara,
// jadi tidak terpengaruh .env pengguna dan tidak menyentuh data/ (sesi WhatsApp dan state asli).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BOT_IGNORE_ENV_FILE = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-cuaca-tes-'));
