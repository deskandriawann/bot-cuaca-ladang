// Halaman pengelola untuk pengurus: status bot, menyiapkan bot, jam kirim, dan kirim manual lewat WhatsApp resmi.
// Urutan pemeriksaan tiap permintaan: header keamanan → API develop → berkas → asal formulir → masuk → halaman/tindakan.
import http from 'node:http';
import { config } from '../config.js';
import { logger } from '../log.js';
import { nowWib } from '../time.js';
import { send, redirect, readForm } from './http.js';
import { serveAsset, serveStatic } from './assets.js';
import {
  checkAdminPassword, setSecurityHeaders, sameOrigin, clientIp, passwordMatches, sessionOf, startSession, endSession,
  loginLockedUntil, recordFailedLogin, clearFailedLogins, readFlash, withFlash,
} from './security.js';
import { messagePage } from './layout.js';
import { dashboard } from './dashboard.js';
import { loginPage, manualPage, pairingPage, linkPage, groupPage } from './pages.js';
import { ACTIONS } from './actions.js';
import { apiRoute, devBridge, initDevApi, mainBotStatus } from './dev.js';

const manualMode = config.waMode === 'manual';
// Halaman yang hanya berarti bila bot tersambung ke WhatsApp sendiri
const AUTO_ONLY_PAGES = new Set(['/tautan', '/ganti-nomor', '/grup']);

const PAGES = {
  '/': async (url, flashMsg) => dashboard(flashMsg, devBridge ? await mainBotStatus() : null),
  '/tautan': () => pairingPage(),
  '/ganti-nomor': (url, flashMsg) => linkPage(flashMsg),
  '/grup': () => groupPage(),
  '/kirim': (url, flashMsg) => manualPage(url.searchParams.get('jenis'), flashMsg),
};

async function login(req, res) {
  const form = await readForm(req);
  const ip = clientIp(req);
  const now = Date.now();
  const lockedUntil = loginLockedUntil(ip);
  if (lockedUntil > now) {
    return send(res, 429, loginPage(`Sudah terlalu sering salah, jadi halaman ini dikunci sebentar demi keamanan. Silakan coba lagi setelah pukul ${nowWib(new Date(lockedUntil)).hhmm} WIB.`));
  }
  if (!passwordMatches(form.password ?? '')) {
    recordFailedLogin(ip, now);
    await new Promise((r) => setTimeout(r, 1000)); // memperlambat tebakan beruntun
    return send(res, 401, loginPage('Kata sandi belum tepat. Periksa & isi dengan benar.'));
  }
  clearFailedLogins(ip);
  return redirect(res, '/', { 'Set-Cookie': startSession(req) });
}

async function route(req, res) {
  setSecurityHeaders(req, res);
  const url = new URL(req.url, 'http://localhost');
  const { method } = req;
  const path = url.pathname;

  if (path.startsWith('/api/')) return apiRoute(req, res, url);
  // Berkas dilayani sebelum pemeriksaan masuk, agar logo dan gaya juga tampil di halaman masuk
  if (method === 'GET' && (path === '/favicon.ico' || path.startsWith('/aset/'))) {
    if (serveAsset(req, res, path === '/favicon.ico' ? 'icon' : path.slice('/aset/'.length), url)) return;
    return send(res, 404, '');
  }
  if (method === 'GET' && path.startsWith('/static/')) {
    if (serveStatic(req, res, url)) return;
    return send(res, 404, '');
  }
  if (method === 'POST' && !sameOrigin(req)) {
    return send(res, 403, messagePage('Ditolak', 'Permintaan ditolak', 'Kirim formulir langsung dari halaman pengelola.'));
  }
  if (method === 'POST' && path === '/masuk') return login(req, res);

  const sid = sessionOf(req);
  if (!sid) return send(res, 200, loginPage());
  if (method === 'POST' && path === '/keluar') return redirect(res, '/', { 'Set-Cookie': endSession(req, sid) });

  const action = method === 'POST' ? ACTIONS[path] : null;
  if (manualMode && (AUTO_ONLY_PAGES.has(path) || action?.autoOnly)) {
    return redirect(res, withFlash('/', 'Bot sedang tidak mengirim sendiri. Kirim lewat tombol Buka teks cuaca hari ini.'));
  }
  if (method === 'GET' && PAGES[path]) return send(res, 200, await PAGES[path](url, readFlash(url)));
  if (action) {
    const form = await readForm(req);
    try {
      return redirect(res, await action.run(form));
    } catch (err) {
      return redirect(res, withFlash('/', `Gagal: ${err.message}`));
    }
  }
  send(res, 404, messagePage('Tidak ditemukan', 'Halaman tidak ditemukan'));
}

export function startAdmin() {
  checkAdminPassword();
  initDevApi();
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      // Rincian galat hanya di log, tidak ditampilkan ke pengunjung
      logger.error(err, 'Halaman pengelola');
      if (!res.headersSent) send(res, 500, messagePage('Galat', 'Terjadi galat', 'Coba lagi sebentar lagi. Bila terus terjadi, periksa log bot.'));
    });
  });
  server.listen(config.adminPort, config.adminHost, () => {
    logger.info(`Halaman pengelola: http://${config.adminHost === '0.0.0.0' ? 'localhost' : config.adminHost}:${config.adminPort}`);
  });
  return server;
}
