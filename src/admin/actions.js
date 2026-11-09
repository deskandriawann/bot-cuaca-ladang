// Tindakan dari formulir halaman pengelola. Tiap tindakan menerima isian formulir dan mengembalikan alamat tujuan
// (dengan pesan bertanda tangan); galat yang lolos ditampilkan sebagai "Gagal: ..." oleh server.js.
import { config } from '../config.js';
import { minuteLabel, nowWib } from '../time.js';
import { getState, updateState, addLog } from '../store.js';
import { startLinking, requestPairingCode, listGroups, isConnected, hasLinkedSession } from '../whatsapp/connection.js';
import { botSend } from '../bot/send.js';
import { sendMorning } from '../bot/morning.js';
import {
  SCHEDULE_EARLIEST, SCHEDULE_LATEST, morningAt, morningDue, morningRange, parseScheduleTime, setMorningSchedule,
} from '../bot/schedule.js';
import { withFlash } from './security.js';
import { morningTime } from './format.js';
import { testKey, testText } from './dashboard.js';
import { MANUAL_TEXTS, buildText } from './pages.js';
import { devBridge, mainBot } from './dev.js';

const home = (msg) => withFlash('/', msg);

/** 0812-3456-7890 / +62 812 3456 7890 → 6281234567890 */
export function normalizePhone(input) {
  let digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  return /^62\d{8,13}$/.test(digits) ? digits : null;
}

async function startLink(form) {
  const retry = (msg) => withFlash('/ganti-nomor', msg);
  const phone = normalizePhone(form.phone ?? '');
  if (!phone) return retry('Nomor tidak valid. Contoh: 081234567890');
  if (!['cek_profil', 'cek_pin', 'cek_kontak', 'cek_qr'].every((key) => form[key] === '1')) {
    return retry('Centang semua persiapan sebelum menautkan');
  }
  if (hasLinkedSession() && form.confirm !== '1') return retry('Centang konfirmasi untuk melepas nomor yang sekarang tertaut');
  try {
    await startLinking(phone);
  } catch (err) {
    return retry(err.message);
  }
  return '/tautan';
}

async function pairingCode() {
  await requestPairingCode();
  return '/tautan';
}

async function saveGroup(form) {
  const group = (await listGroups()).find((g) => g.id === form.jid);
  if (!group) return home('Gagal: grup tidak ditemukan');
  const state = updateState({ groupJid: group.id, groupName: group.subject });
  const next = state.testedFor === testKey(state) ? '' : ' Langkah berikutnya: kirim pesan percobaan.';
  return home(`Grup penerima disimpan: ${group.subject}.${next}`);
}

async function sendTest() {
  const { groupJid } = getState();
  if (!groupJid) throw new Error('Grup penerima belum dipilih');
  await botSend(groupJid, testText());
  addLog('uji', 'Pesan uji');
  updateState({ testedFor: testKey(getState()) });
  return home(`Pesan percobaan terkirim. Buka grup ${getState().groupName} di WhatsApp: bila pesannya masuk, bot sudah siap.`);
}

async function sendMorningNow() {
  await sendMorning({ force: true });
  return home('Info cuaca hari ini terkirim ke grup.');
}

async function saveSchedule(form) {
  if (form.jam === 'bawaan') {
    setMorningSchedule(null);
  } else {
    const minutes = parseScheduleTime(form.jam);
    if (minutes == null) {
      return home(`Gagal: jam tidak valid. Pilih antara ${minuteLabel(SCHEDULE_EARLIEST)} dan ${minuteLabel(SCHEDULE_LATEST)}.`);
    }
    setMorningSchedule(minutes);
  }
  addLog('jadwal', `Diubah ke sekitar pukul ${morningRange()}`);
  // Bila info hari ini belum terkirim, beri tahu kapan jam baru itu berlaku hari ini
  const state = getState();
  const now = nowWib();
  const ready = isConnected() && state.groupJid && state.morningSentOn !== now.date;
  const today = !ready ? ''
    : morningDue(now) ? ' Info cuaca hari ini belum terkirim, jadi dikirim dalam 1 menit.'
      : now.hour * 60 + now.minute < morningAt(now.date) ? ` Info cuaca hari ini dikirim pukul ${morningTime(now.date)}.` : '';
  return home(`Jam kirim disimpan: setiap hari sekitar pukul ${morningRange()} WIB.${today}`);
}

/** Info pagi otomatis nyala/mati. Saat mati, bot tidak mengirim apa pun sendiri; tetap menjawab pertanyaan. */
async function toggleMorning(form) {
  const on = form.aktif === '1';
  updateState({ morningEnabled: on });
  addLog('jadwal', on ? 'Info pagi dinyalakan' : 'Info pagi dimatikan');
  return home(on
    ? `Info cuaca pagi dinyalakan: dikirim setiap hari sekitar pukul ${morningRange()} WIB.`
    : `Info cuaca pagi dimatikan. Bot hanya menjawab pertanyaan "halo ${config.botName}" di grup.`);
}

/** Mode develop: kirim teks pilihan lewat bot utama. */
async function sendViaMainBot(form) {
  const kind = MANUAL_TEXTS[form.jenis] ? form.jenis : 'pagi';
  const to = (msg) => withFlash('/kirim', msg, { jenis: kind });
  if (!devBridge) return to('Gagal: hanya tersedia di mode develop (npm run dev)');
  try {
    await mainBot('/api/kirim', { text: await buildText(kind) });
    return to('Terkirim lewat bot utama. Cek grup di WhatsApp.');
  } catch (err) {
    return to(`Gagal: ${err.message}`);
  }
}

/** Alamat formulir → tindakan. autoOnly: hanya untuk bot otomatis (tidak ada artinya di WA_MODE=manual). */
export const ACTIONS = {
  '/daftar': { run: startLink, autoOnly: true },
  '/kode': { run: pairingCode, autoOnly: true },
  '/grup': { run: saveGroup, autoOnly: true },
  '/uji': { run: sendTest, autoOnly: true },
  '/kirim-pagi': { run: sendMorningNow, autoOnly: true },
  '/jam-pagi': { run: saveSchedule, autoOnly: true },
  '/info-pagi': { run: toggleMorning, autoOnly: true },
  '/kirim-lewat-bot': { run: sendViaMainBot },
};
