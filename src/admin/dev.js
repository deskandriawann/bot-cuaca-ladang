// Mode develop (npm run dev): halaman pengelola kedua tanpa sambungan WhatsApp sendiri. Pesan uji dititipkan ke
// bot utama (npm start) di komputer yang sama lewat API kecil, jadi memakai nomor dan sesi yang sama.
// Di server (NODE_ENV=production) API ini mati sama sekali.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { nowWib } from '../time.js';
import { getState, addLog } from '../store.js';
import { wa } from '../whatsapp/connection.js';
import { botSend, sendLimits } from '../bot/send.js';
import { readJson, sendJson } from './http.js';
import { fromLoopback } from './security.js';
import { esc } from './layout.js';
import { phoneText, statusOf } from './format.js';

const manualMode = config.waMode === 'manual';

/** Halaman ini halaman develop yang menitipkan kiriman ke bot utama. */
export const devBridge = manualMode && Boolean(config.mainBotUrl);

// ── Sisi bot utama: API hanya dari 127.0.0.1, dengan token baru setiap bot utama menyala ──────────────────

const apiEnabled = !manualMode && process.env.NODE_ENV !== 'production';
let apiToken = null;

/** Dipanggil saat halaman pengelola menyala: buat token baru, atau hapus token lama bila API mati. */
export function initDevApi() {
  const tokenFile = path.join(config.dataDir, 'api-token');
  if (apiEnabled) {
    apiToken = crypto.randomBytes(24).toString('hex');
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(tokenFile, apiToken);
  } else if (!manualMode) {
    fs.rmSync(tokenFile, { force: true });
  }
}

function apiTokenMatches(token) {
  if (!apiToken || typeof token !== 'string') return false;
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(apiToken).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function apiRoute(req, res, url) {
  if (!apiEnabled) return sendJson(res, 404, { error: 'Tidak ditemukan' });
  // Lewat reverse proxy berarti datang dari luar, walau tampak dari 127.0.0.1
  if (!fromLoopback(req) || req.headers['x-forwarded-for'] !== undefined || !apiTokenMatches(req.headers['x-bot-token'])) {
    return sendJson(res, 403, { error: 'Ditolak' });
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const state = getState();
    const today = nowWib().date;
    return sendJson(res, 200, {
      status: wa.status,
      statusText: statusOf(wa.status).text,
      phone: wa.phone ?? state.phone,
      error: wa.error,
      groupName: state.groupName,
      sentToday: state.sent?.date === today ? state.sent.count : 0,
      ...sendLimits(),
      morningStatus: state.morningSentOn === today ? state.morningStatus : null,
      morningEnabled: state.morningEnabled !== false,
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/kirim') {
    const { text } = await readJson(req).catch(() => ({}));
    if (typeof text !== 'string' || !text.trim()) return sendJson(res, 400, { error: 'Teks kosong' });
    const { groupJid } = getState();
    if (!groupJid) return sendJson(res, 409, { error: 'Grup penerima bot utama belum dipilih' });
    try {
      // Lewat pintu yang sama dengan pesan otomatis: hanya ke grup penerima, batas harian, tanpa teks ganda
      await botSend(groupJid, text);
      addLog('develop', 'Kiriman uji dari mode develop');
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, err.notSent ? 409 : 502, { error: err.message });
    }
  }
  return sendJson(res, 404, { error: 'Tidak ditemukan' });
}

// ── Sisi halaman develop: meminta ke bot utama ───────────────────────────────────────────────────────────

const MAIN_BOT_DOWN = 'Bot utama belum berjalan. Jalankan npm start di terminal lain.';

/** Permintaan ke bot utama: hanya dari komputer yang sama, dengan token yang dibuat bot utama saat menyala. */
export async function mainBot(pathname, body) {
  let token;
  try {
    token = fs.readFileSync(config.mainBotTokenFile, 'utf8').trim();
  } catch {
    throw new Error(MAIN_BOT_DOWN);
  }
  let res;
  try {
    res = await fetch(`${config.mainBotUrl}${pathname}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-bot-token': token, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(90_000), // kirim memakai jeda mengetik dan jarak antar-pesan
    });
  } catch {
    throw new Error(MAIN_BOT_DOWN);
  }
  if (!res.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Bot utama masih memakai kode lama. Nyalakan ulang bot utama sekali.');
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Bot utama menjawab HTTP ${res.status}`);
  return json;
}

export async function mainBotStatus() {
  try {
    return { ok: true, ...(await mainBot('/api/status')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function devCard(main) {
  const intro = '<p class="muted">Halaman ini memuat ulang sendiri setiap kode disimpan dan tidak membuka sambungan WhatsApp sendiri. ' +
    'Pesan uji dititipkan ke bot utama, jadi memakai nomor dan sesi yang sama tanpa menautkan ulang.</p>';
  if (!main.ok) return `<section class="card"><h2>Mode develop</h2>${intro}<p class="bad">${esc(main.error)}</p></section>`;
  return `<section class="card"><h2>Mode develop</h2>${intro}
<p>Bot utama: <strong class="${main.status === 'tersambung' ? 'ok' : 'warn'}">${esc(main.statusText)}</strong><br>
Nomor: <strong>${esc(phoneText(main.phone) ?? '-')}</strong><br>
Grup penerima: <strong>${esc(main.groupName ?? 'belum dipilih')}</strong><br>
Pesan hari ini: ${esc(main.sentToday)} dari batas ${esc(main.perDay)} (maks ${esc(main.perHour)} per jam)</p>
${main.groupName ? '' : '<p class="warn">Pilih grup penerima dulu di halaman bot utama.</p>'}
<a class="btn" href="/kirim">Pilih pesan untuk diuji</a></section>`;
}
