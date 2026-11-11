// Ringkasan cuaca pagi: data cuaca gabungan, teks ringkasan, dan pengirimannya ke grup.
import { logger } from '../log.js';
import { fetchBmkg, fetchOpenMeteo, fetchEnsemble } from '../weather/sources.js';
import { alertKeys, withRainChance, fieldSlots, reportSlots } from '../weather/analysis.js';
import { morningMessage, unavailableMessage } from '../messages.js';
import { nowWib } from '../time.js';
import { getState, updateState, addLog, logForecast } from '../store.js';
import { botSend, notSent } from './send.js';

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
  // Bahaya yang sudah disebut di ringkasan (termasuk dini hari nanti) tidak diumumkan lagi sebagai perubahan
  return { text: morningMessage(bmkg, date, nowWib().hour), keys: alertKeys(reportSlots(bmkg.days, date)), slots };
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

let morningFailures = 0;
let lastMorningTry = 0;

/** Ringkasan pagi. Bila BMKG gagal, dicoba ulang tiap 5 menit; setelah 3 kali gagal dikirim pemberitahuan. */
export async function sendMorning({ force = false } = {}) {
  const { groupJid, morningSentOn, morningStatus } = getState();
  const now = nowWib();
  if (!groupJid) throw notSent('Grup penerima belum dipilih');
  if (morningSentOn === now.date && morningStatus === 'terkirim') throw notSent('Info cuaca hari ini sudah terkirim');
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
      addLog('pagi', `Belum terkirim, kirim manual: ${err.message}`);
    }
    throw err;
  }
  morningFailures = 0;
  updateState({ morningStatus: 'terkirim' });
  addLog('pagi', 'Terkirim ke grup');
}
