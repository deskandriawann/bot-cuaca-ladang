// Titik masuk: halaman pengelola, sambungan WhatsApp, dan penjadwal.
import { config } from './config.js';
import { acquireLock, releaseLock } from './lock.js';
import { startAdmin } from './admin/server.js';
import { startExisting, onGroupMessage, shutdown } from './whatsapp/connection.js';
import { handleGroupMessage } from './bot/replies.js';
import { startScheduler } from './bot/scheduler.js';

console.log(`Bot cuaca ${config.placeName} (panggilan: "halo ${config.botName}", mode ${config.waMode})`);

// Berkas baru (sesi WhatsApp, state, sesi masuk) hanya bisa dibaca pemiliknya. Tidak berpengaruh di Windows.
process.umask(0o077);

// Satu bot per folder data: dua bot dengan sesi yang sama saling bentrok di WhatsApp
try {
  acquireLock();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Galat yang lolos cukup dicatat; program yang crash lalu menyala ulang berarti sambung ulang ke WhatsApp,
// dan sambung ulang beruntun terlihat mencurigakan.
process.on('unhandledRejection', (err) => console.error('Galat tak tertangani:', err));

// Ctrl+C atau systemd stop: tutup sambungan biasa (sesi tetap berlaku) dan tunggu berkas sesi selesai ditulis
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log('Menghentikan bot dengan rapi, sesi WhatsApp tetap tersimpan…');
  const force = setTimeout(() => process.exit(0), 5_000);
  try {
    await shutdown();
  } finally {
    clearTimeout(force);
    releaseLock();
    process.exit(0);
  }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop); // Windows: jendela terminal ditutup (Windows memberi waktu sekitar 10 detik)

startAdmin();
if (config.waMode === 'otomatis') {
  onGroupMessage(handleGroupMessage);
  await startExisting();
  startScheduler();
} else {
  console.log('Mode manual: bot tidak tersambung ke WhatsApp. Kirim lewat halaman pengelola, menu Kirim manual.');
}
