// Jawaban panggilan "halo tani ..." di grup.
import { config } from '../config.js';
import { logger } from '../log.js';
import { fetchBmkg, fetchOpenMeteo, fetchEnsemble } from '../weather/sources.js';
import { withRainChance } from '../weather/analysis.js';
import {
  dayDetailMessage, dayShortMessage, outlookMessage, helpMessage, tooFarMessage, unavailableMessage,
  pastMessage, unknownMessage, thanksMessage,
} from '../messages.js';
import { parseCall } from '../commands.js';
import { nowWib, addDays } from '../time.js';
import { getState, updateState, addLog } from '../store.js';
import { markRead } from '../whatsapp/connection.js';
import { botSend, linkPhase } from './send.js';

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

let lastReplyAt = 0;

/** Pesan grup dari wa: dijawab hanya di grup penerima (kapan saja), dengan jeda dan batas harian. */
export async function handleGroupMessage({ jid, text, msg }) {
  const state = getState();
  if (jid !== state.groupJid || linkPhase().phase === 'tenang') return;
  const now = nowWib();
  const call = parseCall(text, config.botName, now.date);
  if (!call) return;

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
    // Dicatat juga di halaman pengelola, agar pengurus tahu kenapa pertanyaan di grup tidak dijawab
    logger.info(`Panggilan tidak dijawab: ${err.message}`);
    addLog('tak_dijawab', `“${text.slice(0, 60)}”: ${err.message}`);
  }
}
