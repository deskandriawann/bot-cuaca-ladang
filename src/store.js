// Penyimpanan pengaturan dan catatan pengiriman di data/state.json.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';

const DEFAULT_STATE = {
  groupJid: null,      // grup tujuan, dipilih di halaman pengelola
  groupName: null,
  phone: null,         // nomor bot terakhir yang didaftarkan
  linkedAt: null,      // waktu nomor terakhir berhasil ditautkan (awal masa tenang)
  sessionRevoked: null, // { at, code } bila sesi dikeluarkan WhatsApp (401/403); tidak dipakai login lagi
  linkAttempts: { date: null, count: 0 }, // percobaan penautan hari ini
  testedFor: null,     // "linkedAt|groupJid" saat pesan uji terakhir terkirim (langkah terakhir menyambungkan bot)
  connects: [],        // waktu sambung ke WhatsApp dalam 1 jam terakhir (pemutus sambung ulang)
  sent: { date: null, count: 0 }, // jumlah pesan keluar hari ini
  recentSends: [],     // waktu pesan keluar dalam 1 jam terakhir (batas per jam)
  morningSentOn: null, // tanggal ringkasan pagi terakhir dicoba kirim
  morningStatus: null, // mengirim | terkirim | gagal
  morningSchedule: null, // { hour, minute } jam kirim ringkasan dari halaman pengelola; null = MORNING_HOUR/MINUTE di .env
  morningEnabled: true, // false = info pagi dan peringatan cuaca tidak dikirim; bot hanya menjawab pertanyaan
  alerts: { date: null, keys: [], updates: 0 }, // bahaya yang sudah diumumkan hari ini
  replies: { date: null, count: 0 },             // jumlah balasan panggilan hari ini
  log: [],             // catatan pengiriman terbaru
};

let state = load();

function load() {
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(paths.state, 'utf8')) };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function save() {
  fs.mkdirSync(path.dirname(paths.state), { recursive: true });
  const tmp = `${paths.state}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, paths.state);
}

export function getState() {
  return state;
}

export function updateState(patch) {
  state = { ...state, ...patch };
  save();
  return state;
}

// Catatan prakiraan harian (BMKG dan peluang tiap pusat cuaca) di data/prakiraan.json. Belum dipakai untuk
// menghitung; disimpan sejak sekarang agar nanti bisa dibandingkan dengan hujan yang benar-benar turun
// untuk menilai sumber mana yang paling tepat di Selopamioro. BMKG tidak menyimpan prakiraan lamanya.
const FORECAST_LOG_DAYS = 365;

export function logForecast(entry) {
  let entries = [];
  try {
    entries = JSON.parse(fs.readFileSync(paths.forecastLog, 'utf8'));
  } catch {
    // belum ada atau rusak: mulai baru
  }
  entries = [...entries.filter((e) => e.date !== entry.date), entry].slice(-FORECAST_LOG_DAYS);
  fs.mkdirSync(path.dirname(paths.forecastLog), { recursive: true });
  const tmp = `${paths.forecastLog}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries));
  fs.renameSync(tmp, paths.forecastLog);
}

export function addLog(kind, detail) {
  const entry = { at: new Date().toISOString(), kind, detail };
  state.log = [entry, ...state.log].slice(0, 50);
  save();
  return entry;
}
