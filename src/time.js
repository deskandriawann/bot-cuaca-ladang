// Penanganan waktu WIB. WIB selalu UTC+7 (tanpa musim panas), jadi cukup digeser 7 jam.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** Waktu sekarang dalam WIB: { date: 'YYYY-MM-DD', hour, minute, hhmm: '05.00' } */
export function nowWib(now = new Date()) {
  const d = new Date(now.getTime() + WIB_OFFSET_MS);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  return {
    date: d.toISOString().slice(0, 10),
    hour,
    minute,
    hhmm: `${pad(hour)}.${pad(minute)}`,
  };
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayIndex(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** 'Sabtu, 14 November 2026' */
export function longDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${HARI[d.getUTCDay()]}, ${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 'Sab 14 Nov' */
export function shortDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${HARI[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${BULAN[d.getUTCMonth()].slice(0, 3)}`;
}

export function hourLabel(hour) {
  return `${pad(hour)}.00`;
}

/** Menit sejak 00.00 → jam: 340 → '05.40' */
export function minuteLabel(minutes) {
  return `${pad(Math.floor(minutes / 60))}.${pad(minutes % 60)}`;
}

export function pad(n) {
  return String(n).padStart(2, '0');
}
