// Mengenali panggilan di grup: "halo <nama bot>" lalu pertanyaan bebas, atau tag (@) nomor bot lalu pertanyaannya.
// Harinya dikenali sendiri dari kalimat: "besok", "lusa", "sabtu", "tanggal 5", "5 november", "5/11", "3 hari lagi",
// "10 hari", termasuk bahasa Jawa sehari-hari ("sesuk", "setu", "rebo") dan salah ketik ringan ("hlo tani besk").
// Tanpa sapaan atau tag, pesan tidak dijawab, agar obrolan biasa di grup tidak dibalas bot.
import { addDays, weekdayIndex } from './time.js';

const MAX_DAYS = 10;

// Urutan sama dengan getUTCDay(): 0 = Minggu
const WEEKDAYS = [
  ['minggu', 'ahad'], ['senin', 'senen'], ['selasa', 'seloso'], ['rabu', 'rebo'],
  ['kamis', 'kemis'], ['jumat', 'jemuah', 'jumuah'], ['sabtu', 'setu'],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'];
const MONTH_ALIASES = { agt: 8, ags: 8, aug: 8, oct: 10, nop: 11, dec: 12, peb: 2 };

const GREETINGS = ['halo', 'helo', 'hai', 'hay', 'hi', 'hei', 'hey'];

// Kata kunci yang dibetulkan bila salah ketik satu huruf ("besk" → besok, "ujan" → hujan)
const KEYWORDS = [
  'besok', 'besuk', 'sesuk', 'lusa', 'kemarin', 'kemaren', 'sekarang', 'nanti', 'mengko', 'saiki',
  'pagi', 'siang', 'sore', 'malam', 'tanggal', 'pekan', 'depan', 'menu', 'bantuan', 'panduan', ...WEEKDAYS.flat(),
  'januari', 'februari', 'maret', 'april', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember',
  'hujan', 'udan', 'gerimis', 'panas', 'cerah', 'mendung', 'angin', 'petir', 'terang', 'gerah', 'sejuk', 'dingin', 'adem',
  'makasih', 'terima', 'kasih',
];
// Kata sehari-hari yang hanya beda satu huruf dari kata kunci: dibiarkan ("kami" bukan "kamis", "terong" bukan "terang")
const COMMON_WORDS = new Set([
  'kami', 'ingin', 'malas', 'hutan', 'kamus', 'kumis', 'selama', 'terong', 'tenang', 'pakan', 'tanggul', 'sesak',
  'petik', 'merah', 'kemas', 'pesan', 'sabut', 'santi',
]);
// Salah ketik pendek yang sering muncul
const SHORT_TYPOS = { lsa: 'lusa' };

const WEATHER_WORD = /^(hujan|udan|gerimis|panas|cerah|mendung|angin|petir|gludhug|terang|gerah|sejuk|dingin|adem)$/;
// Kata tanya yang boleh menyertai tanggal berupa angka saja ("halo tani 5 gimana?")
const QUESTION_WORDS = new Set([
  'ga', 'gak', 'nggak', 'ngga', 'enggak', 'tidak', 'ya', 'gimana', 'bagaimana', 'apa', 'apakah', 'kah', 'nanti', 'tanggal', 'tgl',
]);

/** 'hallooo' → 'halo': huruf yang diketik berulang dihitung satu. */
const squeeze = (word) => word.toLowerCase().replace(/(\p{L})\1+/gu, '$1');
const sameLetters = (a, b) => [...a].sort().join('') === [...b].sort().join('');

/** Beda satu ketikan: satu huruf salah, kurang, atau lebih, atau dua huruf bersebelahan tertukar. */
export function oneTypoApart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff = [...a].map((c, i) => (c === b[i] ? -1 : i)).filter((i) => i !== -1);
    return diff.length === 1 || (diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]);
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return [...long].some((_, i) => long.slice(0, i) + long.slice(i + 1) === short);
}

/** halo, hallo, helo, hai, hi, ... juga salah ketik "hlo", "hlao". */
function isGreeting(word) {
  const w = squeeze(word);
  return GREETINGS.includes(w) || (w.length >= 3 && w[0] === 'h' && oneTypoApart(w, 'halo'));
}

/**
 * Nama bot, juga bila huruf diulang ("tanii") atau dua huruf tertukar ("tnai"). Huruf yang salah atau kurang
 * tidak diterima: "halo tari" dan "halo dani" itu menyapa orang, bukan bot.
 */
function isBotName(word, botName) {
  const w = squeeze(word);
  const name = squeeze(botName);
  return w === name || (name.length >= 4 && oneTypoApart(w, name) && sameLetters(w, name));
}

/** Kalimat sesudah sapaan dan nama bot, atau null bila pesan tidak diawali "halo <nama bot>". */
function afterGreeting(body, botName) {
  const words = body.match(/^(\p{L}+)[\s,]+(\p{L}+)(?![\p{L}\p{N}])(.*)$/su);
  if (words && isGreeting(words[1]) && isBotName(words[2], botName)) return words[3];
  // Nama bot lebih dari satu kata: harus persis
  const exact = body.match(new RegExp(`^(\\p{L}+)[\\s,]+${escapeRegex(botName)}(?![\\p{L}\\p{N}])(.*)$`, 'isu'));
  return exact && isGreeting(exact[1]) ? exact[2] : null;
}

/**
 * Kata kunci untuk kata yang salah ketik satu huruf; kata yang benar tidak berubah. Kata kunci 4 huruf hanya bila
 * dua hurufnya tertukar ("lusa" ← "lsua"), sebab beda satu huruf dari kata 4 huruf sering kata lain ("lupa", "satu", "abu").
 */
function fixWord(word) {
  if (SHORT_TYPOS[word]) return SHORT_TYPOS[word];
  if (word.length < 4 || KEYWORDS.includes(word) || COMMON_WORDS.has(word)) return word;
  if (KEYWORDS.includes(squeeze(word))) return squeeze(word);
  return KEYWORDS.find((k) => oneTypoApart(word, k) && (k.length >= 5 || sameLetters(word, k))) ?? word;
}

const fixTypos = (text) => text.toLowerCase().replace(/\p{L}+/gu, fixWord);

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
 *      | { kind: 'past' } | { kind: 'thanks' } | { kind: 'unknown', question }
 * offset 0 = hari ini (hari ke-1). question: kalimat yang tidak dikenali, untuk diulang di jawaban.
 * mentioned: nomor bot di-tag (@) di pesan ini, jadi sapaan "halo <nama bot>" tidak wajib.
 */
export function parseCall(text, botName, today, { mentioned = false } = {}) {
  // Tag (@nomor) dibuang dari kalimat; tag ke nomor bot sudah ditandai lewat mentioned
  const body = String(text ?? '').replace(/@\S+/g, ' ').trim();
  let rest = afterGreeting(body, botName);
  if (rest == null) {
    if (!mentioned) return null;
    rest = body.replace(/^(\p{L}+)[\s,!.]*/u, (all, word) => (isGreeting(word) ? '' : all));
  }
  const call = understand(fixTypos(rest), today);
  // Yang tidak dikenali diulang apa adanya (sebelum dibetulkan) di jawaban
  return call.kind !== 'unknown' ? call : { kind: 'unknown', question: rest.replace(/^[\s,.!?:;-]+/, '').replace(/\s+/g, ' ').trim() };
}

/** Isi pertanyaan sesudah sapaan: hari yang ditanya, atau jenis pertanyaan lain. */
function understand(question, today) {
  // Tanda petik dibuang dulu (jum'at → jumat); tanggal angka (5/11, 5-11-2026) dibaca sebelum tanda baca dibuang
  const raw = question.toLowerCase().replace(/['’`]/g, '');
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

  // Angka saja dibaca sebagai tanggal ("halo tani 5", "halo tani 5 hujan ga"), kecuali jam ("jam 3")
  // dan kalimat tentang hal lain ("pesan pecel lele 1")
  const bare = rest.match(/(?<!\b(?:jam|pukul|pkl) ?)\b(\d{1,2})\b/);
  const others = bare ? rest.replace(bare[0], ' ').split(' ').filter(Boolean) : [];
  if (bare && others.every((word) => QUESTION_WORDS.has(word) || WEATHER_WORD.test(word))) return byDate(today, Number(bare[1]));

  // Tanpa hari yang disebut berarti hari ini: "halo tani", "halo tani hujan nggak?"
  if (rest === '' || rest.split(' ').some((word) => WEATHER_WORD.test(word))) {
    return { kind: 'day', offset: 0 };
  }
  if (has(/\b(terima ?kasih|trima ?kasih|makasih|makasi|maksih|mksh|trims|thanks|thx|tq|suwun|nuwun)\b/)) return { kind: 'thanks' };
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
