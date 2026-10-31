// Penilaian kondisi cuaca: hujan, petir, angin kencang, dan jam aman ke ladang.
import { config } from '../config.js';

// Penilaian memakai teks keterangan BMKG (weather_desc), bukan kode angka: di API publik
// kode 61 berketerangan "Hujan Ringan" dan 63 "Hujan Sedang", berbeda dari tabel kode yang sering dikutip.
const CONDITIONS = [
  // [kelas, pola keterangan, tingkat keburukan]
  ['petir', /petir/i, 9],
  ['hujan_lebat', /hujan lebat/i, 8],
  ['hujan_sedang', /hujan sedang/i, 7],
  ['hujan_ringan', /hujan|gerimis/i, 6],
  ['kabut', /kabut|kabur|asap/i, 4],
  ['berawan_tebal', /berawan tebal/i, 3],
  ['berawan', /^berawan/i, 2],
  ['cerah_berawan', /cerah berawan/i, 1],
];

/** Kelas cuaca satu slot: 'petir', 'hujan_lebat', 'hujan_sedang', 'hujan_ringan', 'kabut', ..., 'cerah' */
export function condition(slot) {
  return CONDITIONS.find(([, pattern]) => pattern.test(slot.desc ?? ''))?.[0] ?? 'cerah';
}

// Waktu kerja di ladang 06.00-18.00. Tiap slot BMKG mewakili 3 jam sejak jamnya (08 = 08.00-11.00).
// Jam slot BMKG sering bergeser (pernah 06, 09, 12, 15; 05, 08, 11, 14, 17; dan 07, 10, 13, 16),
// jadi slot dihitung jam kerja bila waktunya bersinggungan dengan 06.00-18.00, bukan dari jam tertentu.
const WORK_START = 6;
const WORK_END = 18;
export const SLOT_HOURS = 3;
export const isFieldSlot = (slot) => slot.hour < WORK_END && slot.hour + SLOT_HOURS > WORK_START;

/** Rentang jam dipotong ke waktu kerja: [5, 11] → [6, 11] */
const clampWork = ([from, to]) => [Math.max(from, WORK_START), Math.min(to, WORK_END)];

export const PERIODS = [
  { name: 'Pagi', from: 6, to: 12 },
  { name: 'Siang', from: 12, to: 15 },
  { name: 'Sore', from: 15, to: 18 },
];

// Jenis bahaya yang memicu pemberitahuan perubahan mendadak (hujan lebat hanya bila pasti, lihat hazardsOf)
const ALERT_TYPES = new Set(['petir', 'hujan_lebat', 'angin']);

const HAZARD_LABEL = {
  petir: 'Hujan petir',
  hujan_lebat: 'Hujan lebat',
  hujan_sedang: 'Hujan sedang',
  angin: 'Angin kencang',
};

export const isRain = (slot) => condition(slot).startsWith('hujan') || condition(slot) === 'petir';
export const isThunder = (slot) => condition(slot) === 'petir';

// Hujan yang terasa: minimal 1 mm dalam 3 jam slot. Ambang 0,1 mm membuat peluang terlalu tinggi, karena
// model global cenderung memprakirakan gerimis tipis terlalu sering di daerah tropis.
const RAIN_MM = 1;

/** Persentase anggota ensembel satu pusat cuaca yang hujannya minimal RAIN_MM dalam 3 jam slot; null bila data tidak lengkap. */
function ensembleChance(hours, slot) {
  const perHour = Array.from({ length: SLOT_HOURS }, (_, i) => hours?.[slot.date]?.[slot.hour + i]);
  if (perHour.some((values) => !values)) return null;
  const totals = perHour[0]
    .map((_, member) => perHour.reduce((sum, values) => sum + (values[member] ?? NaN), 0))
    .filter((total) => !Number.isNaN(total));
  if (totals.length === 0) return null;
  return (100 * totals.filter((total) => total >= RAIN_MM).length) / totals.length;
}

/**
 * Peluang hujan ditempelkan ke tiap slot BMKG sebagai rainChance (persen); BMKG sendiri tidak memberi peluang.
 * Utama: rata-rata peluang ensembel beberapa pusat cuaca dunia, bobot sama per pusat (rincian di rainModels).
 * Cadangan bila ensembel gagal: peluang hujan Open-Meteo biasa, terbesar dalam 3 jam slot.
 */
export function withRainChance(bmkg, { ensemble, om } = {}) {
  if (!ensemble?.models && !om?.hours) return bmkg;
  const days = {};
  for (const [date, slots] of Object.entries(bmkg.days)) {
    days[date] = slots.map((slot) => {
      const models = Object.entries(ensemble?.models ?? {})
        .map(([name, hours]) => [name, ensembleChance(hours, slot)])
        .filter(([, chance]) => chance != null);
      if (models.length > 0) {
        const mean = models.reduce((sum, [, chance]) => sum + chance, 0) / models.length;
        const rainModels = Object.fromEntries(models.map(([name, chance]) => [name, Math.round(chance)]));
        return { ...slot, rainChance: Math.round(mean), rainModels };
      }
      const chances = Array.from({ length: SLOT_HOURS }, (_, i) => om?.hours?.[date]?.[slot.hour + i]).filter((c) => c != null);
      return chances.length > 0 ? { ...slot, rainChance: Math.max(...chances) } : slot;
    });
  }
  return { ...bmkg, days };
}

/** Hujan pasti: peluang minimal RAIN_SURE_PERCENT. Tanpa data peluang, keterangan BMKG saja yang dipakai. */
export const isSureRain = (slot) => slot.rainChance == null || slot.rainChance >= config.rainSurePercent;

/** Hujan sedang, lebat, atau hujan petir yang pasti: diberi peringatan "potensi hujan". */
export const isRainWarning = (slot) => ['hujan_sedang', 'hujan_lebat', 'petir'].includes(condition(slot)) && isSureRain(slot);

/** Hujan lebat atau hujan petir yang pasti: diingatkan lagi menjelang turun. */
export const isHeavyRain = (slot) => ['hujan_lebat', 'petir'].includes(condition(slot)) && isSureRain(slot);

/** Makin besar makin buruk; dipakai untuk memilih kondisi terburuk dalam satu rentang waktu. */
function severity(slot) {
  return CONDITIONS.find(([name]) => name === condition(slot))?.[2] ?? 0;
}

export function hazardsOf(slot) {
  const found = [];
  const cond = condition(slot);
  // Petir selalu bahaya (keselamatan). Hujan sedang dan lebat hanya bila pasti; yang belum pasti cukup jadi info.
  if (cond === 'petir' || ((cond === 'hujan_lebat' || cond === 'hujan_sedang') && isSureRain(slot))) found.push(cond);
  if (slot.windKmh >= config.strongWindKmh) found.push('angin');
  return found;
}

export const hazardLabel = (type) => HAZARD_LABEL[type];
export const isSafe = (slot) => hazardsOf(slot).length === 0;

export function fieldSlots(slots) {
  return slots.filter(isFieldSlot);
}

/**
 * Rentang jam aman ke ladang dari slot BMKG, misalnya [[6, 12], [15, 18]], dipotong ke waktu kerja.
 * Mengembalikan null bila tidak ada slot jam kerja (misal sudah malam).
 */
export function safeWindows(slots) {
  const field = fieldSlots(slots);
  if (field.length === 0) return null;
  const windows = [];
  for (const slot of field) {
    if (!isSafe(slot)) continue;
    const last = windows.at(-1);
    if (last && last[1] === slot.hour) last[1] = slot.hour + SLOT_HOURS;
    else windows.push([slot.hour, slot.hour + SLOT_HOURS]);
  }
  return windows.map(clampWork);
}

// Menyemprot pestisida sebaiknya saat angin tenang (umumnya di bawah sekitar 15 km/jam) dan tidak
// disusul hujan, agar semprotan tidak terbawa angin atau tercuci hujan.
const SPRAY_MAX_WIND_KMH = 15;

/**
 * Rentang jam pertama yang baik untuk menyemprot, misalnya [6, 12]: slot jam kerja tanpa hujan dan bahaya,
 * angin di bawah SPRAY_MAX_WIND_KMH, dan slot sesudahnya tidak hujan. null bila tidak ada.
 */
export function sprayWindow(slots) {
  let window = null;
  for (const slot of fieldSlots(slots)) {
    const next = slots.find((s) => s.hour === slot.hour + SLOT_HOURS);
    const good = !isRain(slot) && isSafe(slot) && slot.windKmh < SPRAY_MAX_WIND_KMH && !(next && isRain(next));
    if (good && !window) window = [slot.hour, slot.hour + SLOT_HOURS];
    else if (good && window[1] === slot.hour) window[1] = slot.hour + SLOT_HOURS;
    else if (window) break;
  }
  return window && clampWork(window);
}

/** Slot dengan kondisi terburuk; bila sama buruknya, yang paling awal. */
export function worstSlot(slots) {
  return slots.reduce((worst, s) => (severity(s) > severity(worst) ? s : worst), slots[0]);
}

export function strongestWind(slots) {
  return slots.reduce((max, s) => (s.windKmh > max.windKmh ? s : max), slots[0]);
}

export function tempRange(slots) {
  const temps = slots.map((s) => s.temp);
  return [Math.min(...temps), Math.max(...temps)];
}

/** Kunci bahaya untuk membandingkan prakiraan lama dan baru: 'YYYY-MM-DD 15 petir' */
export function alertKeys(slots) {
  const keys = [];
  for (const slot of fieldSlots(slots)) {
    for (const type of hazardsOf(slot)) {
      if (ALERT_TYPES.has(type)) keys.push(`${slot.date} ${slot.hour} ${type}`);
    }
  }
  return keys;
}

const COMPASS = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'];
const COMPASS_CODES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function windFromText(code) {
  const i = COMPASS_CODES.indexOf(String(code).toUpperCase());
  return i === -1 ? null : COMPASS[i];
}

export function windFromDegrees(deg) {
  return COMPASS[Math.round(deg / 45) % 8];
}

// Kode cuaca WMO yang dipakai Open-Meteo
export function wmoText(code) {
  if (code === 0) return 'Cerah';
  if (code === 1 || code === 2) return 'Cerah berawan';
  if (code === 3) return 'Berawan';
  if (code === 45 || code === 48) return 'Berkabut';
  if (code >= 51 && code <= 57) return 'Gerimis';
  if (code === 61 || code === 80) return 'Hujan ringan';
  if (code === 63 || code === 81) return 'Hujan sedang';
  if (code === 65 || code === 82 || code === 66 || code === 67) return 'Hujan lebat';
  if (code >= 95) return 'Hujan petir';
  return 'Berawan';
}
