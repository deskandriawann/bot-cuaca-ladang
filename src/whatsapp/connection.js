// Sambungan WhatsApp lewat Baileys. Bot tertaut ke WhatsApp Business di SIM 2 sebagai perangkat tertaut.
//
// Baileys bukan layanan resmi, jadi nomor bisa diblokir. Pengaman untuk menurunkan risikonya:
// - penautan hanya saat diminta pengurus, dibatasi per hari, dan berhenti bila waktunya habis
//   (tidak ada percobaan tautan ulang otomatis);
// - sesi disimpan, jadi server menyala ulang tanpa menautkan lagi;
// - sambung ulang dibatasi per jam (MAX_CONNECTS_PER_HOUR), termasuk saat program crash berulang;
// - tiap pesan didahului status mengetik dengan jeda acak, dan antar-pesan diberi jarak.
import fs from 'node:fs';
import path from 'node:path';
import makeWASocket, {
  DisconnectReason, fetchLatestBaileysVersion, Browsers, normalizeMessageContent, isJidGroup,
} from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { config, paths } from '../config.js';
import { useSafeAuthState } from './auth-store.js';
import { getState, updateState, addLog } from '../store.js';
import { nowWib } from '../time.js';

// Log terpisah untuk Baileys: sangat ramai, jadi bawaannya hanya peringatan
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'warn' });

const MIN_GAP_MS = 15_000;

/** Status yang ditampilkan di halaman pengelola. */
export const wa = {
  // belum_terdaftar | menghubungkan | menunggu_tautan | tersambung | terputus | ditahan | kedaluwarsa | keluar | ganda | berhenti
  status: 'belum_terdaftar',
  phone: null,
  pairingCode: null,
  qr: null,
  error: null,
};

let sock = null;
let currentAuth = null; // penyimpanan sesi yang sedang dipakai (untuk menunggu penulisan saat berhenti)
let generation = 0;
let linking = false;
let reconnectTimer = null;
let attempt = 0;
let messageHandler = async () => {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomBetween = (min, max) => min + Math.random() * (max - min);

export function onGroupMessage(handler) {
  messageHandler = handler;
}

export function isConnected() {
  return wa.status === 'tersambung' && sock !== null;
}

// Ditampilkan ke pengurus: bahasa sehari-hari; kode WhatsApp (401/403) hanya dicatat di log
const LOGGED_OUT_TEXT = 'WhatsApp memutus bot dari nomor ini. Bila WhatsApp Business di HP bot masih bisa dibuka, ' +
  'tautkan lagi nomor yang sama satu kali lewat Ganti nomor bot. Bila tidak bisa dibuka, kemungkinan nomornya diblokir.';
const FORBIDDEN_TEXT = 'WhatsApp menolak nomor bot, kemungkinan diblokir. Cek aplikasi WhatsApp Business di HP bot.';

/**
 * Sesi tersimpan yang masih bisa dipakai: creds.me terisi (creds.registered tidak selalu diisi Baileys)
 * dan belum pernah ditolak WhatsApp. Sesi seperti ini dipakai lagi setiap kali program menyala atau
 * internet putus, tanpa menautkan ulang, sama seperti WhatsApp Web.
 */
export function hasLinkedSession() {
  if (getState().sessionRevoked) return false;
  try {
    return Boolean(JSON.parse(fs.readFileSync(path.join(paths.auth, 'creds.json'), 'utf8')).me?.id);
  } catch {
    return false;
  }
}

/** Saat program dinyalakan: sambungkan hanya dengan sesi yang masih berlaku. */
export async function startExisting() {
  const { phone, sessionRevoked } = getState();
  wa.phone = phone;
  if (sessionRevoked) {
    // Sesi yang sudah dikeluarkan WhatsApp tidak dicoba lagi: login berulang dengan sesi mati terlihat mencurigakan
    Object.assign(wa, { status: 'keluar', error: sessionRevoked.code === 403 ? FORBIDDEN_TEXT : LOGGED_OUT_TEXT });
    return;
  }
  if (hasLinkedSession()) await connect();
}

export function linkAttemptsLeft() {
  const { linkAttempts } = getState();
  const used = linkAttempts?.date === nowWib().date ? linkAttempts.count : 0;
  return Math.max(0, config.maxLinkAttemptsPerDay - used);
}

/**
 * Mulai menautkan nomor baru: sesi lama dihapus, lalu QR ditampilkan.
 * Kode tautan hanya dibuat bila pengurus memintanya (requestPairingCode).
 * phone berupa angka dengan kode negara, misal 6281234567890.
 */
export async function startLinking(phone) {
  if (linkAttemptsLeft() === 0) {
    throw new Error(`Batas ${config.maxLinkAttemptsPerDay} percobaan penautan hari ini sudah habis. ` +
      'Coba lagi besok; penautan berulang memperbesar risiko blokir.');
  }
  const today = nowWib().date;
  const { linkAttempts, phone: previous } = getState();
  const used = linkAttempts?.date === today ? linkAttempts.count : 0;
  // Nomor lain belum tentu ada di grup tujuan lama, jadi grup dipilih ulang setelah tertaut
  const groupReset = phone !== previous ? { groupJid: null, groupName: null } : {};
  updateState({ phone, linkAttempts: { date: today, count: used + 1 }, ...groupReset });
  addLog('nomor', `Mulai menautkan ${phone}`);

  stopSocket();
  await currentAuth?.flush(); // jangan sampai penulisan sesi lama menyusul setelah folder dihapus
  currentAuth = null;
  fs.rmSync(paths.auth, { recursive: true, force: true });
  linking = true;
  Object.assign(wa, { status: 'menunggu_tautan', phone, pairingCode: null, qr: null, error: null });
  await connect();
}

/** Kode tautan 8 karakter, untuk menautkan dari HP bot sendiri (yang tidak bisa memindai QR-nya). */
export async function requestPairingCode() {
  if (!linking || !sock || !wa.qr) throw new Error('Tidak ada penautan yang sedang berjalan. Mulai dari halaman utama.');
  if (!wa.pairingCode) wa.pairingCode = await sock.requestPairingCode(wa.phone);
  return wa.pairingCode;
}

function stopSocket() {
  generation++;
  clearTimeout(reconnectTimer);
  if (sock) {
    sock.ev.removeAllListeners();
    sock.end(undefined);
    sock = null;
  }
}

/**
 * Berhenti dengan rapi saat program dimatikan: sambungan ditutup biasa (BUKAN keluar dari perangkat
 * tertaut, jadi sesi tetap berlaku) dan semua berkas sesi ditunggu sampai selesai ditulis.
 */
export async function shutdown() {
  generation++;
  clearTimeout(reconnectTimer);
  const s = sock;
  sock = null;
  wa.status = 'berhenti';
  s?.end(undefined);
  if (currentAuth) {
    await currentAuth.saveCreds().catch(() => {});
    await currentAuth.flush();
  }
}

function stopWith(status, error) {
  linking = false;
  sock = null;
  Object.assign(wa, { status, error, qr: null, pairingCode: null });
}

const CONNECT_WINDOW_MS = 60 * 60 * 1000;

/** Waktu sambung dalam 1 jam terakhir. Disimpan di berkas agar tetap terhitung walau program crash dan menyala ulang. */
function recentConnects(now = Date.now()) {
  return (getState().connects ?? []).filter((t) => now - t < CONNECT_WINDOW_MS);
}

async function connect() {
  const gen = ++generation;

  // Pemutus: sambung ulang beruntun (crash berulang, internet putus-nyambung) terlihat mencurigakan bagi WhatsApp
  const recent = recentConnects();
  if (!linking && recent.length >= config.maxConnectsPerHour) {
    const resumeAt = recent[0] + CONNECT_WINDOW_MS + 1_000;
    const until = nowWib(new Date(resumeAt)).hhmm;
    Object.assign(wa, {
      status: 'ditahan',
      error: `Bot beristirahat sampai pukul ${until} WIB karena terlalu sering menyambung. Setelah itu tersambung lagi sendiri, tidak perlu melakukan apa-apa.`,
    });
    addLog('sambungan', `Istirahat sampai pukul ${until} karena terlalu sering menyambung`);
    reconnectTimer = setTimeout(() => {
      if (gen === generation) connect().catch((err) => logger.error(err));
    }, resumeAt - Date.now());
    return;
  }
  updateState({ connects: [...recent, Date.now()] });

  let auth;
  try {
    auth = await useSafeAuthState(paths.auth);
  } catch (err) {
    stopWith('keluar', err.message);
    addLog('nomor', err.message);
    return;
  }
  currentAuth = auth;
  const { state, saveCreds } = auth;
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  if (gen !== generation) return;

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    qrTimeout: 60_000, // tiap QR berlaku 60 detik, cukup waktu untuk pengurus
  });
  if (!linking) wa.status = 'menghubungkan';

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (gen !== generation) return;

    if (qr) {
      if (!linking) {
        // WhatsApp meminta penautan baru: sesi lama tidak berlaku lagi. Jangan menautkan otomatis; tunggu pengurus.
        stopSocket();
        stopWith('keluar', LOGGED_OUT_TEXT);
        updateState({ sessionRevoked: { at: new Date().toISOString(), code: DisconnectReason.loggedOut } });
        addLog('nomor', 'WhatsApp meminta nomor ditautkan lagi');
        return;
      }
      wa.qr = await QRCode.toDataURL(qr);
    }

    if (connection === 'open') {
      const justLinked = linking;
      linking = false;
      attempt = 0;
      const phone = sock.user?.id?.split(':')[0].split('@')[0] ?? wa.phone;
      Object.assign(wa, { status: 'tersambung', phone, pairingCode: null, qr: null, error: null });
      if (justLinked) {
        updateState({ phone, linkedAt: new Date().toISOString(), sessionRevoked: null });
        addLog('nomor', `Tertaut sebagai ${phone}`);
      } else {
        addLog('sambungan', 'Tersambung kembali');
      }
      logger.info(`Tersambung sebagai ${phone}`);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      sock = null;

      if (code === DisconnectReason.restartRequired) {
        // Normal setelah penautan berhasil
        connect().catch((err) => logger.error(err));
        return;
      }
      if (code === DisconnectReason.loggedOut || code === DisconnectReason.forbidden) {
        // Sesi dicabut WhatsApp: tandai agar tidak dipakai login lagi saat program menyala berikutnya
        stopWith('keluar', code === DisconnectReason.forbidden ? FORBIDDEN_TEXT : LOGGED_OUT_TEXT);
        updateState({ sessionRevoked: { at: new Date().toISOString(), code } });
        logger.warn(`Dikeluarkan WhatsApp (kode ${code})`);
        addLog('nomor', code === DisconnectReason.forbidden ? 'Ditolak WhatsApp, kemungkinan diblokir' : 'Diputus WhatsApp, perlu ditautkan lagi');
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        stopWith('ganda', 'Bot sedang berjalan di komputer lain dengan nomor yang sama. Jalankan di satu tempat saja, lalu nyalakan ulang bot ini.');
        return;
      }
      if (linking) {
        stopWith('kedaluwarsa', 'Waktu memindai kode QR habis. Ulangi dari halaman utama bila perlu.');
        return;
      }
      // Sesi tertaut tapi sambungan putus (internet, server WhatsApp): sambung ulang perlahan dengan sesi yang sama
      wa.status = 'terputus';
      logger.info(`Terputus sementara (kode ${code ?? '?'})`);
      addLog('sambungan', 'Terputus sebentar, menyambung lagi sendiri');
      const delay = Math.min(5 * 60_000, 5_000 * 2 ** attempt++);
      reconnectTimer = setTimeout(() => {
        if (gen === generation) connect().catch((err) => logger.error(err));
      }, delay);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (gen !== generation || type !== 'notify') return;
    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      if (msg.key.fromMe || !isJidGroup(jid)) continue;
      const content = normalizeMessageContent(msg.message);
      const text = content?.conversation ?? content?.extendedTextMessage?.text ?? content?.imageMessage?.caption;
      if (!text) continue;
      messageHandler({ jid, text, msg }).catch((err) => logger.error(err, 'Gagal menangani pesan'));
    }
  });
}

let queue = Promise.resolve();
let lastSentAt = 0;

/** Mengirim teks lewat antrean: satu per satu, berjarak, dan didahului status mengetik. */
export function sendText(jid, text, quoted) {
  const job = queue.then(() => deliver(jid, text, quoted));
  queue = job.catch(() => {});
  return job;
}

/** Kesalahan sebelum pesan keluar (notSent): pengirim boleh mencoba lagi tanpa risiko pesan ganda. */
function notSentError(message) {
  const err = new Error(message);
  err.notSent = true;
  return err;
}

async function deliver(jid, text, quoted) {
  if (!isConnected()) throw notSentError('Bot belum tersambung ke WhatsApp');
  const wait = MIN_GAP_MS - (Date.now() - lastSentAt);
  if (wait > 0) await sleep(wait);
  if (!isConnected()) throw notSentError('Sambungan WhatsApp terputus sebelum pesan terkirim');

  const s = sock;
  await s.sendPresenceUpdate('available').catch(() => {});
  await sleep(randomBetween(1_000, 2_500));
  await s.sendPresenceUpdate('composing', jid).catch(() => {});
  await sleep(randomBetween(3_000, 7_000) + Math.min(text.length * 15, 5_000));
  await s.sendPresenceUpdate('paused', jid).catch(() => {});

  if (!isConnected() || sock !== s) throw notSentError('Sambungan WhatsApp terputus sebelum pesan terkirim');
  await s.sendMessage(jid, { text }, quoted ? { quoted } : undefined);
  lastSentAt = Date.now();
  setTimeout(() => s.sendPresenceUpdate('unavailable').catch(() => {}), randomBetween(5_000, 15_000));
}

/** Menandai pesan sudah dibaca sebelum dijawab, seperti orang membaca dulu baru membalas. */
export async function markRead(msg) {
  if (!isConnected() || !msg?.key) return;
  await sleep(randomBetween(1_000, 4_000));
  await sock?.readMessages([msg.key]).catch(() => {});
}

/** Grup yang diikuti nomor bot, untuk dipilih sebagai grup tujuan. */
export async function listGroups() {
  if (!isConnected()) return [];
  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups)
    .map((g) => ({ id: g.id, subject: g.subject, size: g.participants?.length ?? 0 }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
}
