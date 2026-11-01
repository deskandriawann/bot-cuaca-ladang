// Satu bot per folder data. Dua proses yang memakai sesi WhatsApp yang sama saling bentrok
// (dan saling menimpa berkas sesi), lalu WhatsApp bisa mengeluarkan perangkat botnya.
//
// Bot yang berjalan memperbarui waktu berkas kunci tiap 30 detik. Kunci dianggap dipegang bot lain hanya bila
// PID-nya hidup DAN kuncinya masih diperbarui. Kunci dari bot yang berhenti mendadak (terminal ditutup, laptop
// tidur, crash) jadi basi dan diambil alih sendiri, walau nomor PID-nya sudah dipakai program lain oleh Windows.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const HEARTBEAT_MS = 30_000;
const STALE_MS = 90_000;

const lockFile = () => path.join(config.dataDir, 'bot.lock');
let heartbeat = null;

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function startHeartbeat(file) {
  clearInterval(heartbeat);
  heartbeat = setInterval(() => {
    try {
      const now = new Date();
      fs.utimesSync(file, now, now);
    } catch {
      // kunci hilang (misalnya dihapus manual): biarkan, releaseLock tetap aman
    }
  }, HEARTBEAT_MS);
  heartbeat.unref(); // tidak menahan program tetap hidup
}

export function acquireLock() {
  const file = lockFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
    startHeartbeat(file);
    return;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const other = Number(fs.readFileSync(file, 'utf8'));
  const fresh = Date.now() - fs.statSync(file).mtimeMs < STALE_MS;
  if (other && other !== process.pid && isProcessAlive(other) && fresh) {
    throw new Error(`Bot lain sudah berjalan dengan folder data yang sama (PID ${other}). Hentikan dulu bot itu. ` +
      `Bila bot itu baru saja berhenti mendadak, tunggu 2 menit lalu coba lagi.`);
  }
  // Kunci basi dari bot yang berhenti mendadak: ambil alih
  fs.writeFileSync(file, String(process.pid));
  startHeartbeat(file);
}

export function releaseLock() {
  clearInterval(heartbeat);
  heartbeat = null;
  try {
    if (Number(fs.readFileSync(lockFile(), 'utf8')) === process.pid) fs.rmSync(lockFile());
  } catch {
    // tidak ada kunci
  }
}
