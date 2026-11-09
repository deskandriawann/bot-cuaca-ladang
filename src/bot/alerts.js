// Pemberitahuan perubahan mendadak (bahaya baru dari BMKG) dan pengingat menjelang hujan lebat.
import { config } from '../config.js';
import { alertKeys, isHeavyRain, isFieldSlot, SLOT_HOURS } from '../weather/analysis.js';
import { updateMessage, rainSoonMessage } from '../messages.js';
import { nowWib } from '../time.js';
import { getState, updateState, addLog } from '../store.js';
import { botSend } from './send.js';
import { fetchWeather } from './morning.js';

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

/**
 * Membandingkan data terbaru dengan yang sudah diumumkan. Kirim bila ada bahaya baru, atau bila hujan lebat
 * yang pasti akan segera turun. Paling banyak satu pesan per pemeriksaan.
 */
export async function checkChanges() {
  const state = getState();
  const now = nowWib();
  if (!state.groupJid || state.morningEnabled === false || state.morningSentOn !== now.date) return;

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
