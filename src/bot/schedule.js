// Jadwal ringkasan pagi: jam dasar (diatur pengurus, atau bawaan dari .env) ditambah menit acak yang tetap per hari.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { minuteLabel } from '../time.js';
import { getState, updateState } from '../store.js';

// Bila bot baru menyala setelah jadwal, ringkasan pagi tetap dikirim asal belum lewat 4 jam (bawaan 05.00-09.00)
const MORNING_LATE_MIN = 4 * 60;

// Jam kirim yang boleh dipilih pengurus. Batas akhir menjaga jam kirim plus menit acak tetap di hari yang sama.
export const SCHEDULE_EARLIEST = 3 * 60;
export const SCHEDULE_LATEST = 21 * 60;

/**
 * Angka acak 0 sampai max-1 yang tetap untuk kunci yang sama: menit kirim berbeda tiap hari
 * tanpa pola berurutan, tapi tidak berubah saat server dinyalakan ulang.
 */
export function stableJitter(key, max) {
  if (max <= 0) return 0;
  return crypto.createHash('sha256').update(key).digest().readUInt32BE(0) % max;
}

/** Jam dasar dari .env (MORNING_HOUR.MORNING_MINUTE), dalam menit sejak 00.00. */
export const defaultMorningBase = () => config.morningHour * 60 + config.morningMinute;

/** Jam dasar ringkasan pagi dalam menit sejak 00.00: diatur pengurus, atau bawaan dari .env. */
export function morningBase() {
  const schedule = getState().morningSchedule;
  return schedule ? schedule.hour * 60 + schedule.minute : defaultMorningBase();
}

/** Menit dalam sehari saat ringkasan pagi dikirim: jam dasar ditambah menit acak hari itu. */
export function morningAt(date) {
  return morningBase() + stableJitter(date, config.morningJitterMin);
}

/** now: nowWib(). Sudah waktunya ringkasan pagi: sejak jadwal hari ini sampai 4 jam setelah jam dasarnya. */
export function morningDue(now) {
  const minute = now.hour * 60 + now.minute;
  return minute >= morningAt(now.date) && minute < morningBase() + MORNING_LATE_MIN;
}

/** Rentang jam kirim dengan menit acaknya: '05.00-05.14', atau satu jam bila tanpa acak. */
export function morningRange() {
  const base = morningBase();
  return config.morningJitterMin > 1 ? `${minuteLabel(base)}-${minuteLabel(base + config.morningJitterMin - 1)}` : minuteLabel(base);
}

/** '06:30' atau '6.30' → menit sejak 00.00; null bila bukan jam atau di luar batas yang boleh dipilih. */
export function parseScheduleTime(text) {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(String(text ?? ''));
  if (!match || Number(match[2]) >= 60) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= SCHEDULE_EARLIEST && minutes <= SCHEDULE_LATEST ? minutes : null;
}

/** Menyimpan jam dasar pilihan pengurus; null = kembali ke bawaan dari .env. */
export function setMorningSchedule(minutes) {
  updateState({ morningSchedule: minutes == null ? null : { hour: Math.floor(minutes / 60), minute: minutes % 60 } });
}
