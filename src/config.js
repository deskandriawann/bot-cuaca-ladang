// Pengaturan bot. Nilai dibaca dari file .env (lihat .env.example).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT =path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
// Pengujian memakai pengaturan bawaan, tidak terpengaruh .env milik pengguna (lihat test/setup.js)
if (process.env.BOT_IGNORE_ENV_FILE !== '1' && fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = (key, fallback) => {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
};
const num = (key, fallback) => {
  const value = Number(env(key, fallback));
  if (Number.isNaN(value)) throw new Error(`${key} harus berupa angka`);
  return value;
};

export const config = {
  // otomatis: bot mengirim sendiri lewat Baileys (ada risiko blokir).
  // manual: Baileys tidak dinyalakan sama sekali; pengurus mengirim lewat tombol di halaman pengelola (tanpa risiko).
  waMode: env('WA_MODE', 'otomatis').toLowerCase(),

  // Kata panggilan bot di grup: "halo <BOT_NAME> cuaca besok"
  botName: env('BOT_NAME', 'tani').toLowerCase(),
  groupLabel: env('GROUP_LABEL', 'Kelompok Tani Nawungan 2'),
  placeName: env('PLACE_NAME', 'Selopamioro'),

  // Kode wilayah BMKG tingkat desa (adm4) dan koordinat untuk Open-Meteo
  adm4: env('BMKG_ADM4', '34.02.10.2001'),
  latitude: num('LATITUDE', -7.9617),
  longitude: num('LONGITUDE', 110.3963),
  detailLink: env('DETAIL_LINK', 'https://www.bmkg.go.id/cuaca/prakiraan-cuaca/34.02.10.2001'),

  // Jadwal (jam WIB). Menit kirim diacak tiap hari agar tidak tepat sama setiap pagi.
  morningHour: num('MORNING_HOUR', 5),
  morningJitterMin: num('MORNING_JITTER_MIN', 15),
  checkStartHour: num('CHECK_START_HOUR', 6),
  checkEndHour: num('CHECK_END_HOUR', 18),
  maxUpdatesPerDay: num('MAX_UPDATES_PER_DAY', 3),

  // Angin dianggap kencang mulai kecepatan ini (km/jam)
  strongWindKmh: num('STRONG_WIND_KMH', 30),

  // Hujan dianggap pasti bila peluang hujan (ensembel 5 pusat cuaca dunia) minimal sekian persen. Hujan sedang/lebat
  // yang pasti diberi peringatan "potensi hujan"; yang belum pasti, dan hujan ringan, cukup jadi info.
  rainSurePercent: num('RAIN_SURE_PERCENT', 70),

  // Pengaman anti-blokir. Setelah nomor tertaut: masa tenang (diam total), lalu masa pemanasan
  // (hanya ringkasan pagi dan sedikit jawaban, tanpa pemberitahuan mendadak), lalu normal.
  quietHoursAfterLink: num('QUIET_HOURS_AFTER_LINK', 24),
  warmupDays: num('WARMUP_DAYS', 7),
  warmupMaxMessagesPerDay: num('WARMUP_MAX_MESSAGES_PER_DAY', 3),
  maxMessagesPerDay: num('MAX_MESSAGES_PER_DAY', 40),     // semua pesan keluar, termasuk kirim manual dari halaman pengelola
  maxLinkAttemptsPerDay: num('MAX_LINK_ATTEMPTS_PER_DAY', 3),
  maxConnectsPerHour: num('MAX_CONNECTS_PER_HOUR', 6),     // pemutus bila bot terus menyambung ulang (misalnya crash berulang)
  replyCooldownSec: num('REPLY_COOLDOWN_SEC', 30),        // jeda minimal antar-balasan di grup
  maxRepliesPerDay: num('MAX_REPLIES_PER_DAY', 30),
  replyStartHour: num('REPLY_START_HOUR', 5),             // di luar jam ini panggilan tidak dijawab (seperti orang tidur)
  replyEndHour: num('REPLY_END_HOUR', 21),
  // Tautan dalam pesan otomatis dari nomor bot umum dianggap sinyal spam. Bawaan: tanpa tautan;
  // tautan rincian ditaruh di deskripsi grup dan di teks kirim manual.
  linkInAutoMessages: env('LINK_IN_AUTO_MESSAGES', 'false').toLowerCase() === 'true',

  // Mode develop (npm run dev): pesan uji dititipkan ke bot utama yang tersambung ke WhatsApp,
  // jadi memakai nomor dan sesi yang sama tanpa sambungan kedua. Diisi otomatis oleh scripts/dev.js.
  mainBotUrl: env('MAIN_BOT_URL', ''),
  mainBotTokenFile: env('MAIN_BOT_TOKEN_FILE', ''),

  // Halaman pengelola. ADMIN_HOST=127.0.0.1 bila diakses lewat reverse proxy HTTPS di server yang sama.
  adminHost: env('ADMIN_HOST', '0.0.0.0'),
  adminPort: num('ADMIN_PORT', 3000),
  adminPassword: env('ADMIN_PASSWORD', ''),

  dataDir: path.resolve(ROOT, env('DATA_DIR', 'data')),
  timezone: 'Asia/Jakarta',
};

if (!['otomatis', 'manual'].includes(config.waMode)) {
  throw new Error(`WA_MODE harus "otomatis" atau "manual", bukan "${config.waMode}"`);
}

export const paths = {
  auth: path.join(config.dataDir, 'auth'),
  state: path.join(config.dataDir, 'state.json'),
  forecastLog: path.join(config.dataDir, 'prakiraan.json'),
};
