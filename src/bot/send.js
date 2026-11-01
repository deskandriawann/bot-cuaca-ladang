// Satu-satunya jalan bot mengirim pesan WhatsApp, beserta tahap nomor baru dan batas pesan harian.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { nowWib } from '../time.js';
import { getState, updateState } from '../store.js';
import { sendText, isConnected } from '../whatsapp/connection.js';

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
export function notSent(message) {
  const err = new Error(message);
  err.notSent = true;
  return err;
}

const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
const recentTexts = new Map(); // sidik teks → waktu kirim

/**
 * Jalan satu-satunya bot mengirim pesan WhatsApp. Menegakkan: hanya ke grup penerima, masa tenang,
 * batas pesan harian, dan tidak mengirim teks yang sama dua kali dalam 30 menit.
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
  const today = nowWib().date;
  const count = state.sent?.date === today ? state.sent.count : 0;
  const limit = dailyLimit(phase);
  if (count >= limit) throw notSent(`Hari ini bot sudah mengirim ${limit} pesan, batas amannya. Besok bisa mengirim lagi`);

  for (const [key, at] of recentTexts) if (Date.now() - at > DUPLICATE_WINDOW_MS) recentTexts.delete(key);
  const fingerprint = crypto.createHash('sha256').update(`${jid}\n${text}`).digest('hex');
  if (recentTexts.has(fingerprint)) throw notSent('Pesan yang sama baru saja dikirim, tidak perlu dikirim lagi');

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
