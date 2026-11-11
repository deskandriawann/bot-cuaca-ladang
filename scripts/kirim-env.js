// Mengirim pengaturan (.env) dari laptop ke server, lalu menyalakan ulang bot agar pengaturannya dipakai.
// Pakai: npm run kirim-env
// .env tidak pernah lewat GitHub (dikecualikan di .gitignore), tetapi dikirim langsung lewat SSH. Sebelum dikirim,
// perbedaannya ditampilkan (kata sandi tidak pernah ditampilkan) dan diminta persetujuan. .env lama di server
// disimpan sebagai .env.sebelumnya, dan dikembalikan sendiri bila bot mati dengan pengaturan baru.
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { parseEnv } from 'node:util';
import { dir, host, reportRestart, RESTART_AND_WAIT, ssh, step, stop } from './server.js';

const SECRETS = new Set(['ADMIN_PASSWORD']);

// 1. .env laptop. Tanda BOM dan akhir baris Windows dirapikan agar terbaca sama di server.
if (!fs.existsSync('.env')) stop('Belum ada file .env di folder ini. Salin dari .env.example lalu isi.');
const text = `${fs.readFileSync('.env', 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trimEnd()}\n`;
const local = parseEnv(text);
if (!local.ADMIN_PASSWORD || local.ADMIN_PASSWORD.length < 8) stop('ADMIN_PASSWORD di .env kosong atau kurang dari 8 karakter.');
// Di server halaman pengelola hanya dibuka lewat HTTPS (Caddy), dan sesi WhatsApp ada di folder data
if ((local.ADMIN_HOST || '127.0.0.1') !== '127.0.0.1') stop('Untuk server, ADMIN_HOST di .env harus 127.0.0.1. Ubah dulu, lalu ulangi.');
if ((local.DATA_DIR || 'data') !== 'data') stop('Untuk server, DATA_DIR di .env harus data (tempat sesi WhatsApp). Ubah dulu, lalu ulangi.');

// 2. Bandingkan dengan .env di server
step(`Membaca pengaturan di server (${host})...`);
const current = ssh(`cat ${dir}/.env`, { quiet: true });
if (!current.ok) stop(`Pengaturan di server tidak bisa dibaca:\n${current.err}\n\nCoba: ssh ${host}`);
const remote = parseEnv(current.out);
const shown = (value) => (value === undefined ? '(tidak ada)' : value === '' ? '(kosong)' : value);
const changes = [...new Set([...Object.keys(remote), ...Object.keys(local)])]
  .filter((key) => remote[key] !== local[key])
  .map((key) => (SECRETS.has(key) ? `  ${key}: diganti` : `  ${key}: ${shown(remote[key])} → ${shown(local[key])}`));
if (changes.length === 0) {
  console.log('\n✅ Pengaturan di server sudah sama dengan .env di laptop. Tidak ada yang dikirim.');
  process.exit(0);
}
console.log(`\nYang berubah di server:\n${changes.join('\n')}`);

// 3. Minta persetujuan
if (!process.stdin.isTTY) stop('Butuh persetujuan. Jalankan dari terminal: npm run kirim-env');
const ask = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = (await ask.question('\nKirim pengaturan ini ke server dan nyalakan ulang bot? (y/n) ')).trim().toLowerCase();
ask.close();
if (!['y', 'ya', 'yes'].includes(answer)) stop('Dibatalkan. Server tidak diubah.');

// 4. Kirim (.env lama disimpan dulu), lalu nyalakan ulang bot
step('Mengirim pengaturan...');
const upload = ssh(`set -e; cd ${dir}; umask 077; cp .env .env.sebelumnya; chmod 600 .env.sebelumnya; cat > .env.baru; mv .env.baru .env`,
  { input: text, quiet: true });
if (!upload.ok) stop(`Pengaturan gagal dikirim, server tidak diubah:\n${upload.err}`);

step('Menyalakan ulang bot dengan pengaturan baru (sekitar 1 menit)...');
const restart = ssh(`set -e\ncd ${dir}\n${RESTART_AND_WAIT}`);
if (restart.code === 3) {
  // Pengaturan baru membuat bot mati: kembalikan yang lama agar bot tetap berjalan
  ssh(`cd ${dir} && mv .env.sebelumnya .env && sudo systemctl restart bot-cuaca`, { quiet: true });
  stop('Bot mati dengan pengaturan baru, jadi pengaturan lama sudah dikembalikan dan bot dinyalakan lagi.\n' +
    '   Periksa .env di laptop (lihat log di atas), lalu ulangi.');
}
reportRestart(restart.code, 'Pengaturan baru sudah dipakai');
