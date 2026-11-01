// Penjadwal: tiap 30 detik memeriksa apakah sudah waktunya ringkasan pagi atau pemeriksaan perubahan per jam.
import { config } from '../config.js';
import { logger } from '../log.js';
import { nowWib } from '../time.js';
import { getState } from '../store.js';
import { isConnected } from '../whatsapp/connection.js';
import { linkPhase } from './send.js';
import { sendMorning } from './morning.js';
import { checkChanges } from './alerts.js';
import { morningDue, stableJitter } from './schedule.js';

let lastCheckHour = null;

async function tick() {
  if (!isConnected() || linkPhase().phase === 'tenang') return;
  const now = nowWib();
  const { morningSentOn, groupJid } = getState();
  if (!groupJid) return;

  if (morningSentOn !== now.date && morningDue(now)) {
    await sendMorning();
    return;
  }

  // Pemeriksaan per jam pada menit acak (tetap per jam), selama jam kerja
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
