// Satu bot per folder data. Dua proses yang memakai sesi WhatsApp yang sama saling bentrok
// (dan saling menimpa berkas sesi), lalu WhatsApp bisa mengeluarkan perangkat botnya.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const lockFile = () => path.join(config.dataDir, 'bot.lock');

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export function acquireLock() {
  const file = lockFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
    return;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const other = Number(fs.readFileSync(file, 'utf8'));
  if (other && other !== process.pid && isProcessAlive(other)) {
    throw new Error(`Bot lain sudah berjalan dengan folder data yang sama (PID ${other}). Hentikan dulu bot itu. ` +
      `Bila yakin tidak ada bot yang berjalan, hapus ${file}.`);
  }
  // Kunci basi dari bot yang crash: ambil alih
  fs.writeFileSync(file, String(process.pid));
}

export function releaseLock() {
  try {
    if (Number(fs.readFileSync(lockFile(), 'utf8')) === process.pid) fs.rmSync(lockFile());
  } catch {
    // tidak ada kunci
  }
}
