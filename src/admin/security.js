// Keamanan halaman pengelola: kata sandi dan sesi masuk, kunci salah sandi, asal permintaan, pesan bertanda tangan,
// dan header keamanan. Penjelasan untuk pengurus ada di KEAMANAN-WA.md bagian G.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../log.js';
import { addLog } from '../store.js';

// ── Kata sandi dan sesi masuk ────────────────────────────────────────────────────────────────────────────

// Lama agar pengurus tidak perlu masuk ulang tiap pagi. Disimpan di berkas agar tetap berlaku
// walau server dinyalakan ulang; yang disimpan hanya sidik SHA-256, bukan tokennya.
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
// Kata sandi lebih pendek dari ini tetap diterima (minimal 8), tetapi diberi peringatan di log saat menyala
const STRONG_PASSWORD_LENGTH = 12;
const sessionsFile = path.join(config.dataDir, 'login-sessions.json');
const hashSid = (sid) => crypto.createHash('sha256').update(sid).digest('hex');

// Sidik kata sandi (scrypt bergaram) disimpan bersama sesi: bila kata sandi di .env diganti, semua sesi lama gugur
const passwordPrint = (salt) => `${salt}:${crypto.scryptSync(config.adminPassword, Buffer.from(salt, 'hex'), 32).toString('hex')}`;
let currentPrint = null;
const sessions = loadSessions();

function loadSessions() {
  try {
    const saved = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    const salt = String(saved.password ?? '').split(':')[0];
    if (/^[a-f0-9]{32}$/.test(salt) && passwordPrint(salt) === saved.password) {
      currentPrint = saved.password;
      return new Map(Object.entries(saved.sessions ?? {}));
    }
  } catch {
    // belum ada atau rusak: semua masuk ulang
  }
  currentPrint = passwordPrint(crypto.randomBytes(16).toString('hex'));
  return new Map();
}

function saveSessions() {
  const now = Date.now();
  for (const [key, expiry] of sessions) if (expiry <= now) sessions.delete(key);
  fs.mkdirSync(path.dirname(sessionsFile), { recursive: true });
  const tmp = `${sessionsFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ password: currentPrint, sessions: Object.fromEntries(sessions) }));
  fs.renameSync(tmp, sessionsFile);
}

/** Bot menolak menyala tanpa kata sandi yang layak. */
export function checkAdminPassword() {
  if (!config.adminPassword || config.adminPassword.length < 8) {
    throw new Error('ADMIN_PASSWORD di .env wajib diisi, minimal 8 karakter');
  }
  if (config.adminPassword.length < STRONG_PASSWORD_LENGTH) {
    logger.warn(`ADMIN_PASSWORD terlalu pendek: sebaiknya minimal ${STRONG_PASSWORD_LENGTH} karakter`);
  }
}

export function passwordMatches(input) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Token sesi dari cookie bila masih berlaku, atau null. */
export function sessionOf(req) {
  const match = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie ?? '');
  const expiry = match && sessions.get(hashSid(match[1]));
  return expiry && expiry > Date.now() ? match[1] : null;
}

/** Sesi baru setelah kata sandi benar; mengembalikan header Set-Cookie. */
export function startSession(req) {
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(hashSid(sid), Date.now() + SESSION_MS);
  saveSessions();
  return `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${viaHttps(req) ? '; Secure' : ''}`;
}

/** Keluar; mengembalikan header Set-Cookie yang menghapus cookie. */
export function endSession(req, sid) {
  sessions.delete(hashSid(sid));
  saveSessions();
  return `sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${viaHttps(req) ? '; Secure' : ''}`;
}

// ── Kunci salah sandi ───────────────────────────────────────────────────────────────────────────────────

// Kunci masuk setelah beberapa kali salah: per alamat IP, dan untuk semua alamat sekaligus bila salahnya
// datang dari banyak alamat (tebakan beramai-ramai). Hitungan dibuang setelah 15 menit tanpa salah lagi.
const LOGIN_MAX_FAILS = 5;
const LOGIN_GLOBAL_MAX_FAILS = 30;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const failedLogins = new Map(); // ip → { count, at, until }
let recentFails = [];
let globalLockUntil = 0;

/** Waktu (ms) sampai kapan alamat ini tidak boleh mencoba masuk; 0 bila boleh. */
export function loginLockedUntil(ip) {
  return Math.max(globalLockUntil, failedLogins.get(ip)?.until ?? 0);
}

export function recordFailedLogin(ip, now = Date.now()) {
  for (const [key, f] of failedLogins) if (now - f.at > LOGIN_LOCK_MS && f.until < now) failedLogins.delete(key);
  const fail = failedLogins.get(ip);
  const count = (fail && !fail.until ? fail.count : 0) + 1;
  failedLogins.set(ip, { count, at: now, until: count >= LOGIN_MAX_FAILS ? now + LOGIN_LOCK_MS : 0 });
  if (count === LOGIN_MAX_FAILS) logger.warn(`Masuk dikunci 15 menit untuk ${ip}: ${count} kali kata sandi salah`);

  recentFails = [...recentFails.filter((t) => now - t < LOGIN_LOCK_MS), now];
  if (recentFails.length >= LOGIN_GLOBAL_MAX_FAILS) {
    globalLockUntil = now + LOGIN_LOCK_MS;
    recentFails = [];
    logger.warn(`Semua percobaan masuk dikunci 15 menit: ${LOGIN_GLOBAL_MAX_FAILS} kali kata sandi salah dari berbagai alamat`);
    addLog('keamanan', `Halaman pengelola dikunci 15 menit: ${LOGIN_GLOBAL_MAX_FAILS} kali kata sandi salah dari berbagai alamat`);
  }
}

export function clearFailedLogins(ip) {
  failedLogins.delete(ip);
}

// ── Asal permintaan ─────────────────────────────────────────────────────────────────────────────────────

// Permintaan dari komputer ini sendiri: mode develop, atau reverse proxy HTTPS (Caddy) di server yang sama
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const fromLoopback = (req) => LOOPBACK.has(req.socket.remoteAddress);

/** Alamat pengunjung. Di balik reverse proxy di server yang sama, alamat aslinya dikirim proxy di X-Forwarded-For. */
export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (!fromLoopback(req) || typeof forwarded !== 'string') return req.socket.remoteAddress ?? '?';
  return forwarded.split(',').at(-1).trim() || '?';
}

/** Dibuka lewat HTTPS: reverse proxy di server yang sama menandainya dengan X-Forwarded-Proto. */
const viaHttps = (req) => fromLoopback(req) && req.headers['x-forwarded-proto'] === 'https';

/** Kiriman formulir dari halaman ini sendiri. Browser lama tanpa header Origin dilindungi cookie SameSite=Strict. */
export function sameOrigin(req) {
  const { origin } = req.headers;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false; // 'null' dari iframe terkurung dan sejenisnya
  }
}

// ── Pesan bertanda tangan ───────────────────────────────────────────────────────────────────────────────

// Pesan di alamat halaman (?pesan=) ditandatangani, agar tautan dari luar tidak bisa memunculkan teks palsu
// di halaman pengelola (misalnya "kata sandi diganti, hubungi nomor ini"). Kuncinya baru setiap bot menyala.
const flashKey = crypto.randomBytes(32);
const flashSig = (msg) => crypto.createHmac('sha256', flashKey).update(msg).digest('base64url');

/** '/kirim', 'Terkirim', { jenis: 'besok' } → '/kirim?jenis=besok&pesan=Terkirim&tanda=…' */
export function withFlash(pathname, msg, params = {}) {
  return `${pathname}?${new URLSearchParams({ ...params, pesan: msg, tanda: flashSig(msg) })}`;
}

export function readFlash(url) {
  const msg = url.searchParams.get('pesan');
  const sig = Buffer.from(url.searchParams.get('tanda') ?? '');
  if (!msg) return null;
  const expected = Buffer.from(flashSig(msg));
  return sig.length === expected.length && crypto.timingSafeEqual(sig, expected) ? msg : null;
}

// ── Header keamanan ─────────────────────────────────────────────────────────────────────────────────────

// Tanpa skrip dan gaya sisipan: semuanya dari berkas di server sendiri (src/admin/static), huruf dari Google Fonts,
// gambar QR penautan berupa data:. Halaman tidak boleh dibingkai situs lain dan formulir hanya terkirim ke sini.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

export function setSecurityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (viaHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}
