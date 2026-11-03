// Mengenali panggilan di grup: "halo <nama bot>" lalu pertanyaan bebas. Harinya dikenali sendiri dari kalimat:
// "besok", "lusa", "sabtu", "tanggal 5", "5 november", "5/11", "3 hari lagi", "10 hari", termasuk bahasa Jawa
// sehari-hari ("sesuk", "setu", "rebo"). Sapaan tetap wajib agar obrolan biasa di grup tidak dijawab bot;
// tag nomor bot di depannya ("@Info Cuaca halo tani besok") boleh.
import { addDays, weekdayIndex } from './time.js';

const MAX_DAYS = 10;

// Urutan sama dengan getUTCDay(): 0 = Minggu
const WEEKDAYS = [
  ['minggu', 'ahad'], ['senin', 'senen'], ['selasa', 'seloso'], ['rabu', 'rebo'],
  ['kamis', 'kemis'], ['jumat', 'jemuah', 'jumuah'], ['sabtu', 'setu'],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];
const MONTH_ALIASES = { agt: 8, ags: 8, aug: 8, oct: 10, dec: 12 };

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 'november' / 'nov' / 'agt' → 11 / 11 / 8; null bila bukan nama bulan */
function monthOf(word) {
  const prefix = word.slice(0, 3);
  const i = MONTHS.indexOf(prefix);
  return i !== -1 ? i + 1 : MONTH_ALIASES[prefix] ?? null;
}

/**
 * Mengurai pesan grup. Mengembalikan null bila pesan bukan panggilan untuk bot.
 * Hasil: { kind: 'day', offset } | { kind: 'outlook' } | { kind: 'help' } | { kind: 'too_far' }
 *      | { kind: 'past' } | { kind: 'thanks' } | { kind: 'unknown' }
 * offset 0 = hari ini (hari ke-1).
 */
export function parseCall(text, botName, today) {
  const greeting = new RegExp(`^\\s*(?:@\\S+\\s+)*(hal+o+|hel+o+|hai+|hay|hi|hei|hey)[\\s,]+${escapeRegex(botName)}(?![\\p{L}\\p{N}])(.*)$`, 'isu');
  const match = String(text ?? '').match(greeting);
  if (!match) return null;

  // Tanda petik dibuang dulu (jum'at → jumat); tanggal angka (5/11, 5-11-2026) dibaca sebelum tanda baca dibuang
  const raw = match[2].toLowerCase().replace(/['’`]/g, '');
  const numeric = raw.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-]\d{2,4})?\b/);
  const rest = raw
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\bcuaca\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const has = (pattern) => pattern.test(rest);

  if (has(/\b(bantuan|menu|help|cara|panduan)\b/)) return { kind: 'help' };

  const later = rest.match(/\b(\d{1,2}) ?hari (lagi|maneh)\b/);
  if (later) return byOffset(Number(later[1]));
  if (has(/\b\d+ ?hari\b|\b(seminggu|sepekan|sepuluh hari|minggu ini|minggu depan|pekan ini|pekan depan|ke ?depan)\b/)) {
    return { kind: 'outlook' };
  }

  if (numeric) return byDate(today, Number(numeric[1]), Number(numeric[2]));
  for (const [, day, word] of rest.matchAll(/\b(\d{1,2}) ([a-z]+)/g)) {
    const month = monthOf(word);
    if (month) return byDate(today, Number(day), month);
  }
  const dated = rest.match(/\b(?:tanggal|tgl|tg) ?(\d{1,2})\b/);
  if (dated) return byDate(today, Number(dated[1]));

  if (has(/\blusa\b/)) return { kind: 'day', offset: 2 };
  if (has(/\b(besok|besuk|bsk|sesuk|mbenjang)\b/)) return { kind: 'day', offset: 1 };
  if (has(/\b(hari ini|sekarang|saiki|dinten menika|nanti|mengko|pagi ini|siang ini|sore ini|malam ini)\b/)) {
    return { kind: 'day', offset: 0 };
  }
  if (has(/\b(kemarin|kemaren|wingi)\b/)) return { kind: 'past' };

  const weekday = WEEKDAYS.findIndex((names) => names.some((name) => new RegExp(`\\b${name}\\b`).test(rest)));
  if (weekday !== -1) {
    const offset = (weekday - weekdayIndex(today) + 7) % 7;
    return { kind: 'day', offset: offset === 0 && has(/\bdepan\b/) ? 7 : offset };
  }

  // Angka saja dibaca sebagai tanggal ("halo tani 5"), kecuali jam ("jam 3")
  const bare = rest.match(/(?<!\b(?:jam|pukul|pkl) ?)\b(\d{1,2})\b/);
  if (bare) return byDate(today, Number(bare[1]));

  // Tanpa hari yang disebut berarti hari ini: "halo tani", "halo tani hujan nggak?"
  if (rest === '' || has(/\b(hujan|udan|gerimis|panas|cerah|mendung|angin|petir|gludhug|terang)\b/)) {
    return { kind: 'day', offset: 0 };
  }
  if (has(/\b(terima ?kasih|makasih|trims|thanks|suwun|nuwun)\b/)) return { kind: 'thanks' };
  return { kind: 'unknown' };
}

function byOffset(offset) {
  return offset < MAX_DAYS ? { kind: 'day', offset } : { kind: 'too_far' };
}

/** Tanggal (dan bulan bila disebut) terdekat dalam 10 hari ke depan; 'past' bila jatuh dalam 7 hari terakhir. */
function byDate(today, day, month = null) {
  const matches = (date) => Number(date.slice(8)) === day && (!month || Number(date.slice(5, 7)) === month);
  for (let offset = 0; offset < MAX_DAYS; offset++) {
    if (matches(addDays(today, offset))) return { kind: 'day', offset };
  }
  for (let offset = 1; offset <= 7; offset++) {
    if (matches(addDays(today, -offset))) return { kind: 'past' };
  }
  return { kind: 'too_far' };
}
