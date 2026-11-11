// Jawaban panggilan "halo tani ..." di grup. Setiap panggilan dijawab dengan membalas pesannya, lewat antrean.
import { config } from '../config.js';
import { logger } from '../log.js';
import { fetchBmkg, fetchOpenMeteo, fetchEnsemble } from '../weather/sources.js';
import { withRainChance } from '../weather/analysis.js';
import {
  dayDetailMessage, dayShortMessage, outlookMessage, helpMessage, tooFarMessage, unavailableMessage,
  pastMessage, unknownMessage, thanksMessage, alreadyAnsweredMessage, helpAgainMessage, notUnderstoodAgainMessage,
  daySubject, OUTLOOK_SUBJECT,
} from '../messages.js';
import { parseCall } from '../commands.js';
import { nowWib, addDays } from '../time.js';
import { getState, addLog } from '../store.js';
import { markRead, isConnected } from '../whatsapp/connection.js';
import { botSend, hourlyFreeAt } from './send.js';

const BMKG_DAYS = 3;
const MAX_DAYS = 10;
const REPEAT_WINDOW_MS = 30 * 60 * 1000; // pertanyaan yang sama dalam rentang ini cukup dijawab "sudah dijawab di atas"
const MAX_WAIT_MS = 2 * 60 * 60 * 1000;  // panggilan yang menunggu lebih lama dari ini sudah basi
const MAX_PENDING = 50;                  // pengaman bila grup dibanjiri panggilan
const RECHECK_MS = 30_000;               // jeda memeriksa lagi saat bot terputus atau batas per jam tercapai

/** Menyusun jawaban untuk satu panggilan. Sumber data bisa diganti untuk pengujian. */
export async function answer(call, today, { getBmkg = fetchBmkg, getOm = fetchOpenMeteo, getEnsemble = fetchEnsemble } = {}) {
  if (call.kind === 'help') return helpMessage(today);
  if (call.kind === 'unknown') return unknownMessage(today, call.question);
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

/** Pokok pertanyaan, untuk mengenali pertanyaan yang sama; null bila jawabannya pendek dan boleh diulang. */
function topicOf(call, today) {
  if (call.kind === 'day' && call.offset < MAX_DAYS) return `hari ${addDays(today, call.offset)}`;
  if (call.kind === 'outlook') return `10 hari ${today}`;
  if (call.kind === 'help' || call.kind === 'unknown') return 'cara bertanya';
  return null;
}

const answered = new Map(); // grup + pokok pertanyaan → { at, hhmm } jawaban lengkap terakhir

function recentAnswer(jid, topic) {
  const last = topic && answered.get(`${jid} ${topic}`);
  return last && Date.now() - last.at < REPEAT_WINDOW_MS ? last : null;
}

/**
 * Teks balasan untuk satu panggilan. Pertanyaan yang baru saja dijawab lengkap cukup ditunjukkan ke jawaban
 * sebelumnya, agar grup yang ramai tidak dibanjiri pesan panjang yang isinya sama.
 */
export async function replyText({ jid, call, today }, sources) {
  const topic = topicOf(call, today);
  const last = recentAnswer(jid, topic);
  if (last) {
    if (call.kind === 'day') return { text: alreadyAnsweredMessage(daySubject(addDays(today, call.offset), call.offset), last.hhmm) };
    if (call.kind === 'outlook') return { text: alreadyAnsweredMessage(OUTLOOK_SUBJECT, last.hhmm) };
    if (call.kind === 'help') return { text: helpAgainMessage(today, last.hhmm) };
    return { text: notUnderstoodAgainMessage(today, last.hhmm, call.question) };
  }
  const text = await answer(call, today, sources);
  // Data gagal diambil tidak dicatat, agar pertanyaan berikutnya mencoba lagi
  return { text, topic: text === unavailableMessage() ? null : topic };
}

/** Mencatat jawaban lengkap yang sudah terkirim, untuk mengenali pertanyaan yang sama sesudahnya. */
export function rememberAnswer(jid, topic, at = Date.now()) {
  for (const [key, last] of answered) if (Date.now() - last.at >= REPEAT_WINDOW_MS) answered.delete(key);
  if (topic) answered.set(`${jid} ${topic}`, { at, hhmm: nowWib(new Date(at)).hhmm });
}

const pending = [];     // panggilan yang menunggu dijawab, urut kedatangan
const seen = new Set(); // id pesan yang sudah masuk antrean (pesan bisa datang dua kali saat menyambung ulang)
let working = false;
let waitLogged = false;

/**
 * Pesan grup dari wa: setiap panggilan di grup penerima masuk antrean dan dijawab satu per satu, kapan saja.
 * mentioned: nomor bot di-tag, jadi pesannya dianggap panggilan walau tanpa "halo <nama bot>".
 */
export async function handleGroupMessage({ jid, text, msg, at = Date.now(), mentioned = false }) {
  if (jid !== getState().groupJid) return;
  if (Date.now() - at > MAX_WAIT_MS) return; // pesan lama yang baru tersampaikan setelah bot lama terputus
  const today = nowWib(new Date(at)).date;
  const call = parseCall(text, config.botName, today, { mentioned });
  if (!call) return;

  const id = msg?.key?.id;
  if (id) {
    if (seen.has(id)) return;
    seen.add(id);
    if (seen.size > 500) seen.delete(seen.values().next().value);
  }
  if (pending.length >= MAX_PENDING) {
    addLog('tak_dijawab', `“${text.slice(0, 60)}”: terlalu banyak pertanyaan sekaligus`);
    return;
  }
  pending.push({ jid, text, msg, at, today, call });
  work().catch((err) => logger.error(err, 'Antrean jawaban berhenti'));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Menjawab antrean satu per satu. Saat bot terputus atau batas per jam tercapai, panggilan menunggu, tidak dibuang. */
async function work() {
  if (working) return;
  working = true;
  try {
    while (pending.length > 0) {
      const item = pending[0];
      const state = getState();
      if (item.jid !== state.groupJid) {
        pending.shift();
        continue;
      }
      if (Date.now() - item.at > MAX_WAIT_MS) {
        pending.shift();
        addLog('tak_dijawab', `“${item.text.slice(0, 60)}”: sudah menunggu lebih dari 2 jam`);
        continue;
      }
      const freeAt = hourlyFreeAt(state);
      if (!isConnected() || freeAt) {
        if (freeAt && !waitLogged) {
          waitLogged = true;
          addLog('antrean', `${pending.length} pertanyaan dijawab mulai pukul ${nowWib(new Date(freeAt)).hhmm} WIB, setelah batas pesan per jam terbuka lagi`);
        }
        await sleep(RECHECK_MS);
        continue;
      }
      waitLogged = false;
      pending.shift();
      await reply(item);
    }
  } finally {
    working = false;
  }
}

async function reply(item) {
  const { jid, text, msg } = item;
  await markRead(msg);
  try {
    const { text: replyBody, topic } = await replyText(item);
    await botSend(jid, replyBody, msg);
    rememberAnswer(jid, topic);
    addLog('jawaban', text.slice(0, 80));
  } catch (err) {
    if (err.notSent && (!isConnected() || hourlyFreeAt(getState()))) {
      pending.unshift(item); // belum terkirim karena sambungan atau batas per jam: coba lagi nanti
      return;
    }
    // Dicatat juga di halaman pengelola, agar pengurus tahu kenapa pertanyaan di grup tidak dijawab
    logger.info(`Panggilan tidak dijawab: ${err.message}`);
    addLog('tak_dijawab', `“${text.slice(0, 60)}”: ${err.message}`);
  }
}
