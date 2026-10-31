// Logika bot: ringkasan pagi, pemeriksaan perubahan mendadak, dan jawaban panggilan di grup.
import crypto from 'node:crypto';
import pino from 'pino';
import { config } from './config.js';
import { fetchBmkg, fetchOpenMeteo, fetchEnsemble } from './weather/sources.js';
import { alertKeys, withRainChance, isHeavyRain, isFieldSlot, fieldSlots, SLOT_HOURS } from './weather/analysis.js';
import {
  morningMessage, dayDetailMessage, dayShortMessage, outlookMessage, updateMessage, rainSoonMessage,
  helpMessage, tooFarMessage, unavailableMessage, pastMessage, unknownMessage, thanksMessage,
} from './messages.js';
import { parseCall } from './commands.js';
import { nowWib, addDays } from './time.js';
import { getState, updateState, addLog, logForecast } from './store.js';
import { sendText, isConnected, markRead } from './wa.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const BMKG_DAYS = 3;
const MAX_DAYS = 10;

/** Menyusun jawaban untuk satu panggilan. Sumber data bisa diganti untuk pengujian. */
export async function answer(call, today, { getBmkg = fetchBmkg, getOm = fetchOpenMeteo, getEnsemble = fetchEnsemble } = {}) {
  if (call.kind === 'help') return helpMessage(today);
  if (call.kind === 'unknown') return unknownMessage(today);
  if (call.kind === 'past') return pastMessage();
  if (call.kind === 'thanks') return thanksMessage();
  if (call.kind === 'too_far' || (call.kind === 'day' && call.offset >= MAX_DAYS)) return tooFarMessage(today);

  if (call.kind === 'outlook') {
    const [bmkg, om, ensemble] = await Promise.allSettled([getBmkg(), getOm(), getEnsemble()]);
    if (bmkg.status === 'rejected' && om.status === 'rejected') return unavailableMessage();
    const dates = Array.from({ length: MAX_DAYS }, (_, i) => addDays(today, i));
    const rated = bmkg.value && withRainChance(bmkg.value, { ensemble: ensemble.value, om: om.value });
    return outlookMessage(rated ?? null, om.value ?? null, dates);
  }

  const date = addDays(today, call.offset);
  // Open-Meteo diminta bersamaan: peluang hujan cadangan untuk hari BMKG, atau gambaran umum bila BMKG gagal
  const omRequest = getOm();
  omRequest.catch(() => {});
  if (call.offset < BMKG_DAYS) {
    try {
      const [bmkg, ensemble, om] = await Promise.all([getBmkg(), getEnsemble().catch(() => null), omRequest.catch(() => null)]);
      if (bmkg.days[date]?.length) return dayDetailMessage(withRainChance(bmkg, { ensemble, om }), date, call.offset);
    } catch (err) {
      logger.warn(`BMKG gagal: ${err.message}`);
    }
  }
  try {
    return dayShortMessage(await omRequest, date, call.offset);
  } catch (err) {
    logger.warn(`Open-Meteo gagal: ${err.message}`);
    return unavailableMessage();
  }
}

/**
 * Tahap nomor bot sejak terakhir ditautkan, agar nomor baru tidak langsung terlihat seperti pengirim massal:
 *   tenang     (QUIET_HOURS_AFTER_LINK jam)  bot tidak mengirim apa pun
 *   pemanasan  (WARMUP_DAYS hari)            hanya ringkasan pagi dan sedikit jawaban; tanpa pemberitahuan mendadak
 *   normal                                   semua fitur
 */
export function linkPhase(linkedAt = getState().linkedAt, now = Date.now()) {
  if (!linkedAt) return { phase: 'normal', until: null };
  const quietEnd = new Date(linkedAt).getTime() + config.quietHoursAfterLink * 60 * 60 * 1000;
  const warmEnd = quietEnd + config.warmupDays * 24 * 60 * 60 * 1000;
  if (now < quietEnd) return { phase: 'tenang', until: new Date(quietEnd) };
  if (now < warmEnd) return { phase: 'pemanasan', until: new Date(warmEnd) };
  return { phase: 'normal', until: null };
}

export function dailyLimit(phase = linkPhase().phase) {
  return phase === 'pemanasan' ? config.warmupMaxMessagesPerDay : config.maxMessagesPerDay;
}

/** Kesalahan yang terjadi sebelum pesan keluar: aman untuk dicoba lagi. */
function notSent(message) {
  const err = new Error(message);
  err.notSent = true;
  return err;
}

const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
const recentTexts = new Map(); // sidik teks → waktu kirim

/**
 * Jalan satu-satunya bot mengirim pesan WhatsApp. Menegakkan: hanya ke grup tujuan, masa tenang,
 * batas pesan harian, dan tidak mengirim teks yang sama dua kali dalam 30 menit.
 */
export async function botSend(jid, text, quoted) {
  const state = getState();
  if (!state.groupJid || jid !== state.groupJid) throw notSent('Bot hanya boleh mengirim ke grup tujuan');
  if (!isConnected()) throw notSent('Bot belum tersambung ke WhatsApp');
  const { phase, until } = linkPhase();
  if (phase === 'tenang') {
    throw notSent(`Masa tenang nomor baru sampai ${nowWib(until).hhmm} WIB ${nowWib(until).date}. Pakai kirim manual.`);
  }
  const today = nowWib().date;
  const count = state.sent?.date === today ? state.sent.count : 0;
  const limit = dailyLimit(phase);
  if (count >= limit) throw notSent(`Batas ${limit} pesan hari ini sudah tercapai`);

  for (const [key, at] of recentTexts) if (Date.now() - at > DUPLICATE_WINDOW_MS) recentTexts.delete(key);
  const fingerprint = crypto.createHash('sha256').update(`${jid}\n${text}`).digest('hex');
  if (recentTexts.has(fingerprint)) throw notSent('Pesan yang sama baru saja dikirim');

  updateState({ sent: { date: today, count: count + 1 } });
  recentTexts.set(fingerprint, Date.now());
  try {
    await sendText(jid, text, quoted);
  } catch (err) {
    if (err.notSent) {
      // Pesan belum keluar: kembalikan hitungan agar bisa dicoba lagi
      recentTexts.delete(fingerprint);
      const now = getState().sent;
      if (now?.date === today) updateState({ sent: { date: today, count: Math.max(0, now.count - 1) } });
    }
    throw err;
  }
}

let lastReplyAt = 0;

export async function handleGroupMessage({ jid, text, msg }) {
  const state = getState();
  if (jid !== state.groupJid || linkPhase().phase === 'tenang') return;
  const now = nowWib();
  const call = parseCall(text, config.botName, now.date);
  if (!call) return;

  // Malam hari tidak menjawab, seperti orang yang sedang tidur
  if (now.hour < config.replyStartHour || now.hour >= config.replyEndHour) return;

  // Panggilan beruntun atau terlalu banyak dalam sehari diabaikan, agar bot tidak terlihat seperti spam
  if (Date.now() - lastReplyAt < config.replyCooldownSec * 1000) return;
  const replies = state.replies?.date === now.date ? state.replies.count : 0;
  if (replies >= config.maxRepliesPerDay) return;
  lastReplyAt = Date.now();
  updateState({ replies: { date: now.date, count: replies + 1 } });

  await markRead(msg);
  try {
    await botSend(jid, await answer(call, now.date), msg);
    addLog('jawaban', text.slice(0, 80));
  } catch (err) {
    logger.info(`Panggilan tidak dijawab: ${err.message}`);
  }
}

/** BMKG ditambah peluang hujan (ensembel, cadangannya Open-Meteo). Bila keduanya gagal, BMKG saja. */
export async function fetchWeather({ maxAgeMs } = {}) {
  const optional = (request, name) => request.catch((err) => {
    logger.warn(`${name} gagal, dilewati: ${err.message}`);
    return null;
  });
  const [bmkg, ensemble, om] = await Promise.all([
    fetchBmkg({ maxAgeMs }),
    optional(fetchEnsemble(), 'Ensembel'),
    optional(fetchOpenMeteo(), 'Open-Meteo'),
  ]);
  return withRainChance(bmkg, { ensemble, om });
}

/** Teks ringkasan pagi, daftar bahaya yang diumumkan di dalamnya, dan slot hari itu (untuk dicatat). */
export async function buildMorning(date = nowWib().date, { maxAgeMs } = {}) {
  const bmkg = await fetchWeather({ maxAgeMs });
  const slots = bmkg.days[date] ?? [];
  return { text: morningMessage(bmkg, date), keys: alertKeys(slots), slots };
}

/** Prakiraan jam kerja yang dikirim pagi ini dicatat, untuk dinilai ketepatannya kelak. */
function recordForecast(date, slots) {
  try {
    logForecast({
      date,
      at: new Date().toISOString(),
      slots: fieldSlots(slots).map((s) => ({ hour: s.hour, desc: s.desc, chance: s.rainChance ?? null, models: s.rainModels ?? null })),
    });
  } catch (err) {
    logger.warn(`Catatan prakiraan gagal disimpan: ${err.message}`);
  }
}

const soonKey = (slot) => `${slot.date} ${slot.hour} segera`;

/**
 * Yang perlu dikirim saat pemeriksaan per jam:
 *   fresh: bahaya yang baru muncul di prakiraan (hujan lebat hanya bila pasti), belum diumumkan
 *   soon:  hujan lebat atau hujan petir pasti yang mulai jam ini atau jam berikutnya, belum diingatkan
 */
export function pendingAlerts(remaining, announced, hour) {
  const fresh = alertKeys(remaining).filter((key) => !announced.includes(key));
  const soon = remaining.find((s) => isFieldSlot(s) && (s.hour === hour || s.hour === hour + 1)
    && isHeavyRain(s) && !announced.includes(soonKey(s)));
  return { fresh, soon: soon ?? null };
}

let morningFailures = 0;
let lastMorningTry = 0;

/** Ringkasan pagi. Bila BMKG gagal, dicoba ulang tiap 5 menit; setelah 3 kali gagal dikirim pemberitahuan. */
export async function sendMorning({ force = false } = {}) {
  const { groupJid, morningSentOn, morningStatus } = getState();
  const now = nowWib();
  if (!groupJid) throw notSent('Grup tujuan belum dipilih');
  if (morningSentOn === now.date && morningStatus === 'terkirim') throw notSent('Ringkasan hari ini sudah terkirim');
  if (!force && Date.now() - lastMorningTry < 5 * 60_000) return;
  lastMorningTry = Date.now();

  let text;
  let keys = [];
  try {
    let slots;
    ({ text, keys, slots } = await buildMorning(now.date, { maxAgeMs: 0 }));
    morningFailures = 0;
    recordForecast(now.date, slots);
  } catch (err) {
    logger.warn(`Ringkasan pagi: BMKG gagal (${err.message})`);
    if (++morningFailures < 3 && !force) return;
    text = unavailableMessage();
  }

  // Dicatat sebelum dikirim: lebih baik sekali tidak terkirim (pengurus kirim manual) daripada terkirim dua kali
  updateState({ morningSentOn: now.date, morningStatus: 'mengirim', alerts: { date: now.date, keys, updates: 0 } });
  try {
    await botSend(groupJid, text);
  } catch (err) {
    if (err.notSent) {
      updateState({ morningSentOn: null, morningStatus: null });
    } else {
      updateState({ morningStatus: 'gagal' });
      addLog('pagi', `Gagal, kirim manual: ${err.message}`);
    }
    throw err;
  }
  morningFailures = 0;
  updateState({ morningStatus: 'terkirim' });
  addLog('pagi', `Ringkasan ${now.date}`);
}

/**
 * Membandingkan data terbaru dengan yang sudah diumumkan. Kirim bila ada bahaya baru, atau bila hujan lebat
 * yang pasti akan segera turun. Paling banyak satu pesan per pemeriksaan.
 */
export async function checkChanges() {
  const state = getState();
  const now = nowWib();
  if (!state.groupJid || state.morningSentOn !== now.date || linkPhase().phase !== 'normal') return;

  const alerts = state.alerts.date === now.date ? state.alerts : { date: now.date, keys: [], updates: 0 };
  if (alerts.updates >= config.maxUpdatesPerDay) return;

  const bmkg = await fetchWeather({ maxAgeMs: 0 });
  const remaining = (bmkg.days[now.date] ?? []).filter((s) => s.hour + SLOT_HOURS > now.hour);
  const { fresh, soon } = pendingAlerts(remaining, alerts.keys, now.hour);
  if (fresh.length === 0 && !soon) return;

  // Pemberitahuan bahaya baru yang menyebut jam hujan itu sekaligus menjadi pengingatnya
  const covered = soon && fresh.some((key) => key.startsWith(`${soon.date} ${soon.hour} `));
  const keys = [...fresh, ...(soon && (fresh.length === 0 || covered) ? [soonKey(soon)] : [])];
  // Dicatat sebelum dikirim agar yang sama tidak diumumkan dua kali
  updateState({ alerts: { date: now.date, keys: [...alerts.keys, ...keys], updates: alerts.updates + 1 } });
  const text = fresh.length > 0
    ? updateMessage(bmkg.place, remaining, fresh, now.hhmm)
    : rainSoonMessage(bmkg.place, soon, now.hour, now.hhmm);
  try {
    await botSend(state.groupJid, text);
  } catch (err) {
    if (err.notSent) updateState({ alerts });
    throw err;
  }
  addLog('pembaruan', keys.join(', '));
}

/**
 * Angka acak 0 sampai max-1 yang tetap untuk kunci yang sama: menit kirim berbeda tiap hari
 * tanpa pola berurutan, tapi tidak berubah saat server dinyalakan ulang.
 */
export function stableJitter(key, max) {
  if (max <= 0) return 0;
  return crypto.createHash('sha256').update(key).digest().readUInt32BE(0) % max;
}

let lastCheckHour = null;

/** Dipanggil tiap 30 detik. Ringkasan pagi tetap dikirim bila server baru menyala sebelum pukul 09.00. */
export async function tick() {
  if (!isConnected() || linkPhase().phase === 'tenang') return;
  const now = nowWib();
  const { morningSentOn, groupJid } = getState();
  if (!groupJid) return;

  const morningMinute = stableJitter(now.date, config.morningJitterMin);
  const morningDue = now.hour > config.morningHour
    || (now.hour === config.morningHour && now.minute >= morningMinute);
  if (morningSentOn !== now.date && morningDue && now.hour < 9) {
    await sendMorning();
    return;
  }

  const hourKey = `${now.date} ${now.hour}`;
  const checkDue = now.minute >= stableJitter(hourKey, 30);
  if (now.hour >= config.checkStartHour && now.hour <= config.checkEndHour && checkDue && lastCheckHour !== hourKey) {
    lastCheckHour = hourKey;
    await checkChanges();
  }
}

export function startScheduler() {
  const run = () => tick().catch((err) => logger.error(`Penjadwal: ${err.message}`));
  run();
  return setInterval(run, 30_000);
}
