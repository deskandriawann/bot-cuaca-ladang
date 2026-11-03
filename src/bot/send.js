// Satu-satunya jalan bot mengirim pesan WhatsApp, beserta tahap nomor baru dan batas pesan per jam dan per hari.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { nowWib } from '../time.js';
import { getState, updateState } from '../store.js';
import { sendText, isConnected } from '../whatsapp/connection.js';

/**
 * Tahap nomor bot sejak terakhir ditautkan, agar nomor baru tidak langsung terlihat seperti pengirim massal:
 *   tenang     (QUIET_HOURS_AFTER_LINK jam)  bot tidak mengirim apa pun
 *   pemanasan  (WARMUP_DAYS hari)            paling banyak WARMUP_MAX_MESSAGES_PER_HOUR pesan per jam; tanpa pemberitahuan mendadak
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

const HOUR_MS = 60 * 60 * 1000;

/**
 * Batas pesan keluar. Per jam: mencegah pesan beruntun (lebih ketat saat pemanasan). Per hari: batas total.
 * Batas per jam, bukan per hari, saat pemanasan: satu pagi yang ramai tidak membuat bot diam sampai besok.
 */
export function sendLimits(phase = linkPhase().phase) {
  return {
    perHour: phase === 'pemanasan' ? config.warmupMaxMessagesPerHour : config.maxMessagesPerHour,
    perDay: config.maxMessagesPerDay,
  };
}

const sentWithinHour = (state, now) => (state.recentSends ?? []).filter((t) => now - t < HOUR_MS);

/** Waktu (ms) batas per jam terbuka lagi, atau null bila belum tercapai. */
export function hourlyFreeAt(state, phase = linkPhase().phase, now = Date.now()) {
  const recent = sentWithinHour(state, now);
  return recent.length >= sendLimits(phase).perHour ? Math.min(...recent) + HOUR_MS : null;
}

/** Batas yang sudah tercapai, sebagai kalimat untuk pengurus; null bila bot masih boleh mengirim. */
export function limitReason(state, phase, now = Date.now()) {
  const { perHour, perDay } = sendLimits(phase);
  const today = nowWib(new Date(now)).date;
  if ((state.sent?.date === today ? state.sent.count : 0) >= perDay) {
    return `Hari ini bot sudah mengirim ${perDay} pesan, batas amannya. Besok bisa mengirim lagi`;
  }
  const freeAt = hourlyFreeAt(state, phase, now);
  if (freeAt) return `Bot sudah mengirim ${perHour} pesan dalam 1 jam terakhir. Bisa mengirim lagi pukul ${nowWib(new Date(freeAt)).hhmm} WIB`;
  return null;
}

/** Kesalahan yang terjadi sebelum pesan keluar: aman untuk dicoba lagi. */
export function notSent(message) {
  const err = new Error(message);
  err.notSent = true;
  return err;
}

const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
const recentTexts = new Map(); // sidik teks → waktu kirim

/**
 * Jalan satu-satunya bot mengirim pesan WhatsApp. Menegakkan: hanya ke grup penerima, masa tenang,
 * batas pesan per jam dan per hari, dan tidak mengirim teks yang sama dua kali dalam 30 menit
 * (jawaban untuk pesan anggota yang berbeda tidak dianggap sama).
 */
export async function botSend(jid, text, quoted) {
  const state = getState();
  if (!state.groupJid || jid !== state.groupJid) throw notSent('Bot hanya boleh mengirim ke grup penerima');
  if (!isConnected()) throw notSent('Bot belum tersambung ke WhatsApp. Tunggu sebentar, atau kirim lewat Buka teks cuaca hari ini');
  const { phase, until } = linkPhase();
  if (phase === 'tenang') {
    const end = nowWib(until);
    throw notSent(`Nomor bot masih baru dan perlu diam dulu sampai ${end.date.slice(8)}/${end.date.slice(5, 7)} pukul ${end.hhmm} WIB. ` +
      'Sementara itu, kirim lewat Buka teks cuaca hari ini');
  }
  const reason = limitReason(state, phase);
  if (reason) throw notSent(reason);

  for (const [key, at] of recentTexts) if (Date.now() - at > DUPLICATE_WINDOW_MS) recentTexts.delete(key);
  const fingerprint = crypto.createHash('sha256').update(`${jid}\n${quoted?.key?.id ?? ''}\n${text}`).digest('hex');
  if (recentTexts.has(fingerprint)) throw notSent('Pesan yang sama baru saja dikirim, tidak perlu dikirim lagi');

  const today = nowWib().date;
  const count = state.sent?.date === today ? state.sent.count : 0;
  const sentAt = Date.now();
  updateState({ sent: { date: today, count: count + 1 }, recentSends: [...sentWithinHour(state, sentAt), sentAt] });
  recentTexts.set(fingerprint, sentAt);
  try {
    await sendText(jid, text, quoted);
  } catch (err) {
    if (err.notSent) {
      // Pesan belum keluar: kembalikan hitungan agar bisa dicoba lagi
      recentTexts.delete(fingerprint);
      const { sent, recentSends = [] } = getState();
      updateState({
        recentSends: recentSends.filter((t) => t !== sentAt),
        ...(sent?.date === today ? { sent: { date: today, count: Math.max(0, sent.count - 1) } } : {}),
      });
    }
    throw err;
  }
}
