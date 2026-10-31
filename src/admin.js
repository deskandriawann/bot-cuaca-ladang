// Halaman pengelola untuk pengurus: kirim manual lewat WhatsApp resmi, status bot, tautkan nomor, pilih grup.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import pino from 'pino';
import { config } from './config.js';
import {
  wa, startLinking, requestPairingCode, linkAttemptsLeft, listGroups, isConnected, hasLinkedSession,
} from './wa.js';
import { getState, updateState, addLog } from './store.js';
import {
  sendMorning, botSend, linkPhase, dailyLimit, buildMorning, answer, stableJitter,
} from './bot.js';
import { nowWib, pad } from './time.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Lama agar pengurus tidak perlu masuk ulang tiap pagi. Disimpan di berkas agar tetap berlaku
// walau server dinyalakan ulang; yang disimpan hanya sidik SHA-256, bukan tokennya.
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const manualMode = config.waMode === 'manual';
const sessionsFile = path.join(config.dataDir, 'login-sessions.json');
const hashSid = (sid) => crypto.createHash('sha256').update(sid).digest('hex');
const sessions = loadSessions();

function loadSessions() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(sessionsFile, 'utf8'))));
  } catch {
    return new Map();
  }
}

function saveSessions() {
  const now = Date.now();
  for (const [key, expiry] of sessions) if (expiry <= now) sessions.delete(key);
  fs.mkdirSync(path.dirname(sessionsFile), { recursive: true });
  const tmp = `${sessionsFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(sessions)));
  fs.renameSync(tmp, sessionsFile);
}

// [teks lengkap, jenis, teks pendek untuk kotak ringkasan]
const STATUS_TEXT = {
  belum_terdaftar: ['Belum ada nomor terdaftar', 'warn', 'Belum terdaftar'],
  menghubungkan: ['Menghubungkan…', 'warn', 'Menghubungkan'],
  menunggu_tautan: ['Menunggu penautan di WhatsApp Business', 'warn', 'Menunggu tautan'],
  tersambung: ['Tersambung', 'ok', 'Tersambung'],
  terputus: ['Terputus sebentar, menyambung ulang sendiri (tidak perlu menautkan ulang)', 'warn', 'Terputus sebentar'],
  kedaluwarsa: ['Waktu penautan habis', 'warn', 'Tautan habis'],
  keluar: ['Perangkat bot dikeluarkan WhatsApp, perlu ditautkan ulang', 'bad', 'Perlu ditautkan'],
  ganda: ['Sesi dibuka di tempat lain', 'bad', 'Sesi ganda'],
  ditahan: ['Ditahan sementara karena terlalu sering menyambung (tidak perlu menautkan ulang)', 'warn', 'Ditahan sementara'],
};

const UNIT_LABEL = 'KKN-PPM UGM Unit YO 095';

// Berkas di folder assets/: icon (ikon tab, logo di atas, layar memuat), tiga logo di kaki halaman,
// dan video latar spanduk atas (hero-video, hero-video-2, diputar bergantian; hero-poster untuk HP).
// Boleh .png/.jpg/.jpeg/.webp/.svg/.ico/.mp4/.webm. Dibaca setiap diminta, jadi bisa diganti tanpa menyalakan ulang.
const ASSET_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  mp4: 'video/mp4', webm: 'video/webm',
};
const FOOTER_LOGOS = [['logo-unit', 'Logo unit KKN'], ['logo-ugm', 'Logo Universitas Gadjah Mada'], ['logo-kkn', 'Logo KKN-PPM UGM']];
const HERO_VIDEOS = ['hero-video', 'hero-video-2'];
const ASSET_NAMES = new Set(['icon', 'hero-poster', ...HERO_VIDEOS, ...FOOTER_LOGOS.map(([name]) => name)]);

function findAsset(name) {
  for (const [ext, type] of Object.entries(ASSET_TYPES)) {
    const file = new URL(`../assets/${name}.${ext}`, import.meta.url);
    if (fs.existsSync(file)) return { file, type };
  }
  return null;
}

const svg = (paths) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  signal: svg('<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/>'),
  message: svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'),
  phone: svg('<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>'),
  send: svg('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  flag: svg('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  cloud: svg('<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>'),
};

const BAILEYS_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../node_modules/baileys/package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '?';
  }
})();

/**
 * Langkah menyambungkan bot, berurutan: tautkan nomor, pilih grup, masa tenang lewat, pesan uji terkirim.
 * current: langkah pertama yang belum selesai (-1 bila semua selesai).
 */
export function setupSteps({ linked, grouped, quiet, tested }) {
  const done = [linked, linked && grouped, linked && !quiet, linked && grouped && !quiet && tested];
  return { done, current: done.indexOf(false), complete: done.every(Boolean) };
}

// Pesan uji berlaku untuk satu penautan dan satu grup: nomor ditautkan ulang atau grup diganti, uji lagi
const testKey = (state) => `${state.linkedAt}|${state.groupJid}`;

const morningTime = (date) => `${pad(config.morningHour)}.${pad(stableJitter(date, config.morningJitterMin))}`;

// Kunci login setelah beberapa kali salah, per alamat IP
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const failedLogins = new Map();

function wibText(date) {
  const t = nowWib(date);
  return `${t.date.slice(8)}/${t.date.slice(5, 7)} pukul ${t.hhmm} WIB`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 0812-3456-7890 / +62 812 3456 7890 → 6281234567890 */
export function normalizePhone(input) {
  let digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  return /^62\d{8,13}$/.test(digits) ? digits : null;
}

/** Spanduk atas selebar layar. Video hanya diputar di layar lebar; HP cukup gambar diam agar hemat kuota. */
function hero({ pill, title, lead, actions = '' }) {
  const videos = HERO_VIDEOS.filter((name) => findAsset(name)).map((name) => `/aset/${name}`);
  const poster = findAsset('hero-poster') ? ' poster="/aset/hero-poster"' : '';
  return `<section class="hero">
${videos.length || poster ? `<video class="hero-video" muted playsinline preload="none"${poster} data-videos="${esc(JSON.stringify(videos))}" aria-hidden="true"></video>` : ''}
<div class="wrap hero-body"><span class="pill">${esc(pill)}</span><h1>${esc(title)}</h1><p class="lead">${esc(lead)}</p>${actions}</div>
</section>`;
}

/** hero: spanduk atas (lihat hero()). wide: halaman lebar dua kolom. nav: tombol Keluar (tidak di halaman masuk). */
function page(title, body, { refresh, hero: banner = '', wide = false, nav = true } = {}) {
  const logo = findAsset('icon') ? '<img src="/aset/icon" alt="">' : `<span class="logo-fallback">${ICONS.cloud}</span>`;
  const footerLogos = FOOTER_LOGOS.filter(([name]) => findAsset(name))
    .map(([name, alt]) => `<img src="/aset/${name}" alt="${alt}">`).join('');
  // Halaman yang memuat ulang sendiri (QR penautan) tidak memakai layar memuat agar QR tidak tertutup
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : '<script>document.documentElement.classList.add(\'loading\')</script>'}
<title>${esc(title)} · Bot Cuaca</title>
<link rel="icon" href="/aset/icon">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap">
<style>
:root{color-scheme:light;--bg:#f8fafc;--card:#fff;--ink:#0f172a;--muted:#475569;--line:#e2e8f0;--accent:#0284c7;--accent-2:#0ea5e9;--ok:#15803d;--warn:#b45309;--bad:#b91c1c}
*{box-sizing:border-box}html{background:var(--bg)}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--ink);font:17px/1.6 Outfit,system-ui,sans-serif}
.wrap{width:100%;max-width:1040px;margin:0 auto;padding:0 16px}main.wrap{flex:1;padding-top:24px;padding-bottom:32px}main.narrow{max-width:672px}
h1{font-size:1.6rem;font-weight:700;letter-spacing:-.01em;line-height:1.2;margin:8px 0 16px}h2{font-size:1.1rem;font-weight:600;margin:0 0 8px}
.hero{position:relative;overflow:hidden;color:#fff;background:linear-gradient(135deg,#047857,#0284c7)}
.hero-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.hero::after{content:"";position:absolute;inset:0;background:rgba(15,23,42,.42)}
.hero-body{position:relative;z-index:1;padding-top:52px;padding-bottom:52px;text-align:center}
.hero h1{margin:14px 0 8px;font-size:clamp(1.9rem,5vw,3.2rem);color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.25)}
.lead{max-width:680px;margin:0 auto;color:rgba(255,255,255,.92);font-size:clamp(1rem,2vw,1.2rem)}
.pill{display:inline-block;padding:5px 14px;border-radius:999px;background:rgba(255,255,255,.2);color:#fff;font-size:.85rem;font-weight:500;backdrop-filter:blur(4px)}
.hero .actions{justify-content:center;margin-top:24px}.hero .btn.alt{background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.55)}
.hero .btn.alt:hover{background:rgba(255,255,255,.22)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:16px;box-shadow:0 1px 2px rgba(15,23,42,.04),0 4px 16px rgba(15,23,42,.04)}
label{display:block;font-weight:600;margin-bottom:4px}
input[type=text],input[type=password],input[type=tel],input[type=date]{width:100%;padding:12px;font:inherit;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink)}
input:focus{outline:none;border-color:var(--accent-2);box-shadow:0 0 0 3px rgba(14,165,233,.2)}
input[type=checkbox],input[type=radio]{width:18px;height:18px;margin:0 6px 0 0;vertical-align:-3px;accent-color:var(--accent)}
button,.btn{display:inline-flex;align-items:center;gap:8px;min-height:48px;margin-top:12px;padding:11px 20px;font-family:inherit;font-size:1.02rem;font-weight:600;line-height:1.3;border:1px solid transparent;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;text-decoration:none;cursor:pointer;box-shadow:0 2px 6px rgba(2,132,199,.25)}
.btn.alt,button.alt{background:#fff;color:var(--ink);border-color:#cbd5e1;box-shadow:none}.btn.alt:hover,button.alt:hover{background:var(--bg);border-color:#94a3b8}
.btn.outline{background:#fff;color:#0369a1;border:2px solid #38bdf8;box-shadow:none}.btn.outline:hover{background:#f0f9ff}
button:disabled{opacity:.5;cursor:not-allowed}:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.actions,.tabs{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}.actions form{margin:0}.actions button,.actions .btn,.tabs .btn{margin:0}.tabs{margin:0 0 16px}
.muted{color:var(--muted);font-size:.95rem}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.card h2 svg,.note svg,p svg{vertical-align:-4px}.card > p:last-child{margin-bottom:0}
.check{display:flex;align-items:flex-start;gap:10px;padding:8px 0;font-weight:500}.check input{flex:none;margin:4px 0 0}
.steps{list-style:none;margin:8px 0 0;padding:0}
.step{display:flex;gap:16px;padding:18px 0;border-bottom:1px solid var(--line)}.step:last-child{border:0;padding-bottom:0}.step > div{flex:1;min-width:0}
.step h3{margin:6px 0 6px;font-size:1.12rem}.step p{margin:0 0 8px}.step pre{margin:4px 0 12px}.step form{margin:0}
.step-num{flex:none;display:grid;place-items:center;width:42px;height:42px;border-radius:50%;font-weight:700;font-size:1.15rem;background:#e2e8f0;color:#64748b}
.step.done .step-num{background:#16a34a;color:#fff}.step.done h3{color:var(--ok)}
.step.now .step-num{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;box-shadow:0 0 0 5px #e0f2fe}
.step.now{margin:0 -12px;padding:18px 12px;border-radius:14px;background:#f0f9ff;border-bottom-color:transparent}
.step.later h3{color:#64748b}.step.finish .step-num{background:#fef3c7;color:#b45309}
.setting{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;padding:16px 0;border-bottom:1px solid var(--line)}.setting:last-child{border:0;padding-bottom:0}
.setting > div{flex:1 1 200px;min-width:0}.setting h3{margin:0;font-size:1.05rem;overflow-wrap:anywhere}.setting p{margin:2px 0 0}.setting .btn{margin:0}
.setting-icon{flex:none;display:grid;place-items:center;width:46px;height:46px;border-radius:12px;background:#e0f2fe;color:#0369a1}
.pick{display:flex;align-items:center;gap:12px;padding:14px;margin-bottom:8px;border:1px solid var(--line);border-radius:12px;font-weight:500;cursor:pointer}
.pick:has(input:checked){border-color:var(--accent);background:#f0f9ff}.pick input{flex:none;margin:0}
.note{padding:12px 16px;border:1px solid;border-radius:12px;margin-bottom:16px;font-weight:500}
.note.ok{background:#f0fdf4;border-color:#bbf7d0;color:#166534}.note.warn{background:#fffbeb;border-color:#fde68a;color:#92400e}.note.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b}
.code{font:700 2rem/1.2 ui-monospace,monospace;letter-spacing:.2em;text-align:center;padding:12px;border:2px dashed var(--accent);border-radius:10px;margin:8px 0}
ol{padding-left:20px}li{margin-bottom:4px}pre{white-space:pre-wrap;font-size:.92rem;background:#f1f5f9;padding:14px;border-radius:10px;margin:0}
.row{display:flex;gap:12px;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--line)}.row:last-child{border:0}.row .muted{flex:none}
details summary{cursor:pointer;font-weight:600;margin:8px 0}
img.qr{display:block;margin:8px auto;max-width:240px;width:100%;background:#fff;padding:8px;border-radius:10px}
.topbar{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid var(--line)}
.topbar .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:68px}.topbar form{margin:0}
.topbar button{margin:0;padding:8px 14px;font-size:.95rem}
.brand{display:flex;align-items:center;gap:12px;min-width:0;color:inherit;text-decoration:none}
.brand img,.brand .logo-fallback{flex:none;width:44px;height:44px;object-fit:contain;border-radius:8px}
.brand-text{min-width:0}.brand-text strong{display:block;font-size:clamp(.95rem,3.6vw,1.1rem);font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand-text small{display:block;color:var(--muted);font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.logo-fallback{display:grid;place-items:center;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff}
.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:20px}
.tile{min-width:0;padding:16px;border-radius:16px;color:#fff;box-shadow:0 8px 20px rgba(15,23,42,.10)}
.tile-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:500;font-size:.95rem}
.tile-icon{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.2)}
.tile strong{display:block;margin:10px 0 2px;font-size:1.45rem;font-weight:700;line-height:1.2;overflow-wrap:anywhere}.tile small{font-size:.85rem;opacity:.92}
.tile.sky{background:linear-gradient(135deg,#0369a1,#0284c7)}.tile.blue{background:linear-gradient(135deg,#1e3a8a,#1d4ed8)}
.tile.green{background:linear-gradient(135deg,#047857,#15803d)}.tile.amber{background:linear-gradient(135deg,#b45309,#d97706)}
.cols{display:grid;gap:0 20px}
@media (min-width:860px){.tiles{grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.cols{grid-template-columns:3fr 2fr;align-items:start}.hero-body{padding-top:96px;padding-bottom:96px}}
.footer{background:#fff;border-top:1px solid var(--line);padding:24px 0;text-align:center}
.logos{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:28px;margin-bottom:12px}
.logos img{height:60px;width:auto;max-width:140px;object-fit:contain;border-radius:8px}.footer p{margin:0;color:var(--muted);font-size:.875rem}
#loading{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;background:#fff;opacity:0;visibility:hidden;transition:opacity .3s,visibility .3s}
.loading #loading{opacity:1;visibility:visible;transition:none}
#loading p{display:flex;align-items:baseline;margin:0;font-size:1.75rem;font-weight:700;letter-spacing:-.01em}
.dots{display:inline-flex;gap:7px;margin-left:10px}.dots i{width:10px;height:10px;border-radius:50%;background:var(--accent);animation:beat 1.2s ease-in-out infinite}
.dots i:nth-child(2){animation-delay:.2s}.dots i:nth-child(3){animation-delay:.4s}
@keyframes beat{0%,80%,100%{transform:scale(.55);opacity:.35}40%{transform:scale(1.15);opacity:1}}
.ring{display:grid;place-items:center;width:min(200px,52vw);aspect-ratio:1;border-radius:50%;background:linear-gradient(160deg,#e3f0f9,#c3d8e8);box-shadow:0 20px 40px rgba(15,23,42,.08);animation:breathe 1.6s ease-in-out infinite}
.disc{display:grid;place-items:center;width:78%;aspect-ratio:1;border-radius:50%;background:#fff;box-shadow:0 10px 24px rgba(30,64,95,.14)}
.disc img{max-width:66%;max-height:66%;object-fit:contain}.disc .logo-fallback{width:46%;aspect-ratio:1;border-radius:50%}.disc svg{width:50%;height:50%}
@keyframes breathe{50%{transform:scale(1.04)}}@media (prefers-reduced-motion:reduce){.ring{animation:none}}
</style></head><body>
<div id="loading" role="status"><div class="ring"><div class="disc">${logo}</div></div><p>Memuat<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></p></div>
<header class="topbar"><div class="wrap">
<a class="brand" href="/">${logo}<span class="brand-text"><strong>${esc(config.groupLabel)}</strong><small>Bot Cuaca · ${UNIT_LABEL}</small></span></a>
${nav ? `<form method="post" action="/keluar"><button class="alt" type="submit">${ICONS.logout}Keluar</button></form>` : ''}
</div></header>
${banner}
<main class="wrap${wide ? '' : ' narrow'}">${body}</main>
<footer class="footer"><div class="wrap">
${footerLogos ? `<div class="logos">${footerLogos}</div>` : ''}
<p>${UNIT_LABEL} · ${esc(config.placeName)}</p>
</div></footer>
<script>
// Layar memuat: tampil sampai halaman siap, dan lagi saat pindah halaman atau menekan tombol
(function () {
  var root = document.documentElement;
  var done = function () { root.classList.remove('loading'); };
  var cap = setTimeout(done, 4000);
  addEventListener('load', function () { clearTimeout(cap); done(); });
  if (document.readyState === 'complete') done();
  addEventListener('pageshow', function (e) { if (e.persisted) done(); });
  document.addEventListener('submit', function (e) { if (!e.defaultPrevented) root.classList.add('loading'); });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target || a.origin !== location.origin || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (a.hash && a.pathname === location.pathname && a.search === location.search) return;
    root.classList.add('loading');
  });
})();
// Video spanduk: hanya di layar lebar, tidak saat hemat data atau gerak dikurangi; beberapa video diputar bergantian
(function () {
  var video = document.querySelector('.hero-video');
  var list = video ? JSON.parse(video.dataset.videos) : [];
  if (!list.length || (navigator.connection && navigator.connection.saveData)) return;
  if (!matchMedia('(min-width: 860px)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var i = 0;
  video.muted = true;
  video.loop = list.length === 1;
  video.addEventListener('ended', function () { i = (i + 1) % list.length; video.src = list[i]; video.play().catch(function () {}); });
  video.src = list[0];
  video.play().catch(function () {});
})();
</script></body></html>`;
}

function tiles(items) {
  return `<div class="tiles">${items.map(({ color, icon, label, value, sub }) => `<div class="tile ${color}">
<div class="tile-head"><span>${esc(label)}</span><span class="tile-icon">${icon}</span></div>
<strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`).join('')}</div>`;
}

function send(res, status, html, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(html);
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, { Location: location, ...headers });
  res.end();
}

async function readForm(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new Error('Isian terlalu panjang');
  }
  return Object.fromEntries(new URLSearchParams(body));
}

function sessionOf(req) {
  const match = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie ?? '');
  const expiry = match && sessions.get(hashSid(match[1]));
  return expiry && expiry > Date.now() ? match[1] : null;
}

function passwordMatches(input) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

function flash(message, kind = 'ok') {
  return message ? `<div class="note ${kind}">${esc(message)}</div>` : '';
}

function loginPage(error) {
  return page('Masuk', `${flash(error, 'bad')}
<form class="card" method="post" action="/masuk">
<h2>Masuk</h2>
<label for="pw">Kata sandi pengelola</label>
<input id="pw" type="password" name="password" autocomplete="current-password" required autofocus>
<button type="submit">Masuk</button></form>`, {
    nav: false,
    hero: hero({ pill: 'Halaman pengelola', title: 'Bot Cuaca Ladang', lead: `Info cuaca harian untuk ${config.groupLabel}, ${config.placeName}.` }),
  });
}

/** Kotak "Ringkasan pagi". info: { morning: status hari ini, phase, group }. */
function morningTile({ morning, phase, group }, today) {
  const [value, sub] = morning === 'terkirim' ? ['Terkirim', 'Sudah masuk grup hari ini']
    : morning === 'gagal' ? ['Gagal', 'Kirim ulang lewat tombol di bawah']
      : morning === 'mengirim' ? ['Sedang dikirim', 'Tunggu sebentar']
        : !group || phase === 'tenang' ? ['Belum aktif', 'Selesaikan langkah di bawah']
          : ['Belum dikirim', `Jadwal pukul ${morningTime(today)} WIB`];
  return { color: 'amber', icon: ICONS.sun, label: 'Ringkasan pagi', value, sub };
}

/** Panduan menyambungkan bot langkah demi langkah, sampai pesan uji terkirim. */
function setupCard({ done, current }, state, until, today) {
  const steps = [
    {
      title: 'Tautkan nomor bot',
      body: done[0]
        ? `<p>Nomor <strong>${esc(wa.phone ?? state.phone)}</strong> sudah tertaut ke bot.</p>
<a class="btn outline" href="/ganti-nomor">${ICONS.phone}Ganti nomor bot</a>`
        : wa.status === 'menunggu_tautan'
          ? `<p>Penautan sedang berjalan. Buka halaman kode QR, lalu pindai dengan HP bot.</p>
<a class="btn" href="/tautan">Lanjutkan: tampilkan kode QR</a>`
          : `<p>Hubungkan nomor WhatsApp Business (SIM 2) ke bot. Siapkan HP bot dan satu laptop atau HP lain untuk menampilkan kode QR.</p>
<a class="btn" href="/ganti-nomor">${ICONS.phone}Tautkan nomor bot</a>`,
    },
    {
      title: 'Masukkan bot ke grup, lalu pilih grupnya',
      body: done[1]
        ? `<p>Grup tujuan: <strong>${esc(state.groupName)}</strong>.</p>
<a class="btn outline" href="/grup">${ICONS.users}Ganti grup tujuan</a>`
        : `<p>Minta admin grup memasukkan nomor bot ke grup ${esc(config.groupLabel)}. Sebaiknya coba dulu di grup kecil berisi 3-5 orang. Setelah nomor bot ada di grup, pilih grupnya di sini.</p>
${!done[0] ? '<p class="muted">Bisa dilakukan setelah langkah 1 selesai.</p>'
    : isConnected() ? `<a class="btn" href="/grup">${ICONS.users}Pilih grup tujuan</a>` : '<p class="warn">Tunggu sampai status bot <strong>Tersambung</strong>, lalu muat ulang halaman ini.</p>'}`,
    },
    {
      title: 'Tunggu masa tenang 24 jam',
      body: done[2]
        ? '<p>Masa tenang sudah selesai.</p>'
        : done[0]
          ? `<p>Nomor yang baru tertaut harus diam dulu agar tidak dicurigai WhatsApp. Bot boleh mulai mengirim pada <strong>${esc(wibText(until))}</strong>.</p>
<p class="muted">Tidak perlu melakukan apa-apa, cukup tunggu. Grup tujuan boleh dipilih sekarang.</p>`
          : '<p class="muted">Dimulai sendiri setelah nomor tertaut. Selama 24 jam bot tidak mengirim apa pun.</p>',
    },
    {
      title: 'Kirim pesan uji',
      body: current === 3
        ? `<p><strong>Gunanya:</strong> memastikan bot benar-benar bisa mengirim ke grup. Bot mengirim satu pesan perkenalan ini ke grup <strong>${esc(state.groupName)}</strong>:</p>
<pre>${esc(testText())}</pre>
<p>Setelah menekan tombol, buka grup di WhatsApp dan lihat apakah pesannya masuk.</p>
<form method="post" action="/uji"><button type="submit">${ICONS.send}Kirim pesan uji</button></form>`
        : '<p class="muted">Bisa dilakukan setelah langkah 1 sampai 3 selesai. Gunanya memastikan bot benar-benar bisa mengirim ke grup.</p>',
    },
  ];
  const kind = (i) => (done[i] ? 'done' : i === current ? 'now' : 'later');
  return `<section class="card"><h2>Langkah menyambungkan bot</h2>
<p class="muted">Ikuti dari atas ke bawah. Langkah yang sudah selesai diberi tanda centang hijau.</p>
<ol class="steps">${steps.map((s, i) => `<li class="step ${kind(i)}"><span class="step-num">${done[i] ? ICONS.check : i + 1}</span>
<div><h3>${s.title}</h3>${s.body}</div></li>`).join('')}
<li class="step finish"><span class="step-num">${ICONS.flag}</span><div><h3>Selesai: bot berjalan sendiri</h3>
<p>Setiap pagi sekitar pukul ${morningTime(today)} WIB bot mengirim ringkasan cuaca ke grup. Anda tidak perlu menekan apa-apa.</p></div></li>
</ol></section>`;
}

/** Setelah semua langkah selesai: kirim ringkasan bila perlu, dan tombol ganti nomor atau grup. */
function readyCards(state, today) {
  const status = state.morningSentOn === today ? state.morningStatus : null;
  const morning = status === 'terkirim'
    ? `<p class="ok"><strong>${ICONS.check} Ringkasan hari ini sudah terkirim ke grup.</strong></p>
<p class="muted">Tombol kirim muncul lagi besok bila ringkasan pagi belum masuk.</p>`
    : status === 'mengirim'
      ? '<p class="warn"><strong>Ringkasan hari ini sedang dikirim.</strong> Tunggu sebentar, lalu muat ulang halaman ini.</p>'
      : `${status === 'gagal' ? '<p class="bad"><strong>Ringkasan hari ini gagal terkirim.</strong></p>'
        : `<p>Bot mengirim sendiri setiap pagi sekitar pukul <strong>${morningTime(today)} WIB</strong>.</p>`}
<p><strong>Gunanya tombol ini:</strong> bila sampai pukul ${pad(config.morningHour)}.30 ringkasan belum masuk ke grup, tekan tombol di bawah. Bot langsung mengirim ringkasan cuaca hari ini. Tidak perlu ditekan setiap hari.</p>
<form method="post" action="/kirim-pagi"><button type="submit">${ICONS.send}Kirim ringkasan hari ini sekarang</button></form>
<p class="muted">Bila tetap gagal, kirim sendiri lewat tombol <strong>Buka teks cuaca hari ini</strong> di bagian atas.</p>`;
  return `<div class="note ok">${ICONS.check} Bot sudah siap. Setiap pagi bot mengirim ringkasan cuaca ke grup <strong>${esc(state.groupName)}</strong>.</div>
<section class="card"><h2>Ringkasan cuaca pagi</h2>${morning}</section>
<section class="card"><h2>Pengaturan bot</h2>
<div class="setting"><span class="setting-icon">${ICONS.phone}</span>
<div><h3>Nomor bot: ${esc(wa.phone ?? state.phone)}</h3><p class="muted">Ganti bila nomor bot diblokir atau kartunya diganti.</p></div>
<a class="btn outline" href="/ganti-nomor">Ganti nomor bot</a></div>
<div class="setting"><span class="setting-icon">${ICONS.users}</span>
<div><h3>Grup tujuan: ${esc(state.groupName)}</h3><p class="muted">Ganti bila ringkasan harus dikirim ke grup lain.</p></div>
<a class="btn outline" href="/grup">Ganti grup tujuan</a></div>
</section>`;
}

/** main: status bot utama (hanya di mode develop), atau null. */
function dashboard(message, main = null) {
  const state = getState();
  const { phase, until } = linkPhase();
  const today = nowWib().date;
  const sentToday = state.sent?.date === today ? state.sent.count : 0;
  const log = state.log.slice(0, 10).map((e) => {
    const t = nowWib(new Date(e.at));
    return `<div class="row"><span class="muted">${t.date.slice(5)} ${t.hhmm}</span><span>${esc(e.kind)}: ${esc(e.detail)}</span></div>`;
  }).join('') || '<p class="muted">Belum ada pesan terkirim.</p>';

  // Kotak ringkasan: bot di proses ini, bot utama (mode develop), atau tidak ada bot (mode manual)
  const short = (status) => STATUS_TEXT[status]?.[2] ?? status;
  const live = !manualMode
    ? {
      status: short(wa.status), phone: wa.phone ?? state.phone, sent: sentToday, limit: dailyLimit(phase), group: state.groupName,
      morning: state.morningSentOn === today ? state.morningStatus : null, phase,
    }
    : main?.ok ? {
      status: short(main.status), phone: main.phone, sent: main.sentToday, limit: main.limit, group: main.groupName,
      morning: main.morningStatus, phase: main.phase,
    } : null;
  const stats = tiles([
    {
      color: 'sky', icon: ICONS.signal, label: 'Status bot',
      value: live ? live.status : main ? 'Belum berjalan' : 'Mode manual',
      sub: live ? (live.phone ? `Nomor ${live.phone}` : 'Tautkan nomor di langkah 1') : main ? 'Bot utama (npm start)' : 'Bot otomatis dimatikan',
    },
    {
      color: 'blue', icon: ICONS.message, label: 'Pesan hari ini',
      value: live ? String(live.sent) : '–',
      sub: live ? `dari batas ${live.limit}` : 'Kirim lewat WhatsApp sendiri',
    },
    {
      color: 'green', icon: ICONS.users, label: 'Grup tujuan',
      value: live ? live.group ?? 'Belum dipilih' : config.groupLabel,
      sub: live ? (live.group ? 'Penerima ringkasan pagi' : 'Pilih grup di langkah 2') : 'Dikirim manual',
    },
    live ? morningTile(live, today) : {
      color: 'amber', icon: ICONS.sun, label: 'Ringkasan pagi', value: 'Kirim manual', sub: 'Setiap pagi lewat tombol di atas',
    },
  ]);

  let content = '';
  let notes = '';
  if (manualMode) {
    content = main ? devCard(main) : '<section class="card"><h2>Mode manual</h2><p class="muted">Bot otomatis dimatikan (WA_MODE=manual). Kirim ringkasan setiap pagi lewat tombol di atas.</p></section>';
  } else {
    const setup = setupSteps({
      linked: hasLinkedSession(), grouped: Boolean(state.groupJid), quiet: phase === 'tenang', tested: state.testedFor === testKey(state),
    });
    content = setup.complete ? readyCards(state, today) : setupCard(setup, state, until, today);
    notes = (wa.error ? flash(wa.error, 'bad') : '') + (phase === 'pemanasan'
      ? flash(`Masa pemanasan nomor baru sampai ${wibText(until)}: bot hanya mengirim ringkasan pagi dan sedikit jawaban, paling banyak ${dailyLimit('pemanasan')} pesan per hari.`, 'warn')
      : '');
  }

  return page('Pengelola', `${flash(message, /^Gagal/.test(message ?? '') ? 'bad' : 'ok')}
${notes}
${stats}
<div class="cols"><div>
${content}
</div><div>
<section class="card"><h2>Pesan terakhir</h2>${log}
<p class="muted">Versi Baileys ${esc(BAILEYS_VERSION)}</p></section>
</div></div>`, {
    wide: true,
    hero: hero({
      pill: 'Sistem Informasi Cuaca',
      title: 'Bot Cuaca Ladang',
      lead: `Info cuaca harian untuk ${config.groupLabel}, ${config.placeName}. Teks cuaca siap dikirim manual lewat WhatsApp kapan saja, tanpa risiko blokir.`,
      actions: '<div class="actions"><a class="btn" href="/kirim">Buka teks cuaca hari ini</a><a class="btn alt" href="/kirim?jenis=besok">Cuaca besok</a></div>',
    }),
  });
}

// Mode develop (npm run dev): halaman ini tidak tersambung ke WhatsApp, pesan uji dititipkan ke bot utama
const devBridge = manualMode && Boolean(config.mainBotUrl);

const MANUAL_TEXTS = {
  pagi: 'Ringkasan hari ini',
  besok: 'Cuaca besok',
  lusa: 'Cuaca lusa',
  '10hari': '10 hari ke depan',
  ...(devBridge ? { menu: 'Menu bantuan' } : {}),
};

const MAIN_BOT_DOWN = 'Bot utama belum berjalan. Jalankan npm start di terminal lain.';

/** Permintaan ke bot utama: hanya dari komputer yang sama, dengan token yang dibuat bot utama saat menyala. */
async function mainBot(pathname, body) {
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

async function mainBotStatus() {
  try {
    return { ok: true, ...(await mainBot('/api/status')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function devCard(main) {
  const intro = '<p class="muted">Halaman ini memuat ulang sendiri setiap kode disimpan dan tidak membuka sambungan WhatsApp sendiri. ' +
    'Pesan uji dititipkan ke bot utama, jadi memakai nomor dan sesi yang sama tanpa menautkan ulang.</p>';
  if (!main.ok) return `<section class="card"><h2>Mode develop</h2>${intro}<p class="bad">${esc(main.error)}</p></section>`;
  return `<section class="card"><h2>Mode develop</h2>${intro}
<p>Bot utama: <strong class="${main.status === 'tersambung' ? 'ok' : 'warn'}">${esc(main.statusText)}</strong><br>
Nomor: <strong>${esc(main.phone ?? '-')}</strong><br>
Grup tujuan: <strong>${esc(main.groupName ?? 'belum dipilih')}</strong><br>
Pesan hari ini: ${main.sentToday} dari batas ${main.limit}</p>
${main.groupName ? '' : '<p class="warn">Pilih grup tujuan dulu di halaman bot utama.</p>'}
<a class="btn" href="/kirim">Pilih pesan untuk diuji</a></section>`;
}

/** Teks pesan untuk satu jenis, tanpa tautan (dipakai kirim manual dan kiriman uji lewat bot utama). */
async function buildText(kind) {
  const today = nowWib().date;
  if (kind === 'pagi') return (await buildMorning(today)).text;
  if (kind === 'menu') return answer({ kind: 'help' }, today);
  return answer(kind === '10hari' ? { kind: 'outlook' } : { kind: 'day', offset: kind === 'besok' ? 1 : 2 }, today);
}

/** Halaman kirim manual: teks siap kirim + tombol wa.me (aplikasi WhatsApp resmi, dikirim oleh manusia). */
async function manualPage(kind, message) {
  if (!MANUAL_TEXTS[kind]) kind = 'pagi';
  const today = nowWib().date;
  let text;
  try {
    text = await buildText(kind);
  } catch (err) {
    text = `Data cuaca gagal diambil: ${err.message}`;
  }

  // Yang mengirim manusia lewat aplikasi resmi, jadi tautan rincian aman disertakan
  if (config.detailLink && !text.includes(config.detailLink)) text += `\n🔗 Rincian: ${config.detailLink}`;

  const state = getState();
  let note = '';
  if (!manualMode && kind === 'pagi') {
    const status = state.morningSentOn === today ? state.morningStatus : null;
    if (status === 'terkirim') {
      note = flash('Bot otomatis sudah mengirim ringkasan hari ini. Tidak perlu dikirim lagi.', 'ok');
    } else if (status === 'gagal') {
      note = flash('Bot otomatis gagal mengirim ringkasan hari ini. Kirim lewat tombol di bawah.', 'bad');
    } else if (status === 'mengirim') {
      note = flash('Bot otomatis sedang mengirim ringkasan. Tunggu sebentar, lalu muat ulang halaman ini.', 'warn');
    } else if (isConnected() && state.groupJid && linkPhase().phase !== 'tenang') {
      note = flash(`Bot otomatis akan mengirim sekitar pukul ${morningTime(today)}. Kirim manual hanya bila bot tidak mengirim.`, 'warn');
    } else {
      note = flash('Bot otomatis sedang tidak mengirim. Kirim ringkasan lewat tombol di bawah.', 'warn');
    }
  }

  const tabs = Object.entries(MANUAL_TEXTS)
    .map(([key, label]) => `<a class="btn${key === kind ? '' : ' alt'}" href="/kirim?jenis=${key}">${esc(label)}</a>`)
    .join(' ');
  return page('Kirim manual', `<h1>Kirim cuaca lewat WhatsApp</h1>
${flash(message, /^Gagal/.test(message ?? '') ? 'bad' : 'ok')}
${note}
<div class="tabs">${tabs}</div>
<section class="card">
<pre id="teks">${esc(text)}</pre>
<div class="actions">
<a class="btn" href="https://wa.me/?text=${encodeURIComponent(text)}">Buka WhatsApp dan pilih grup</a>
<button class="alt" type="button" onclick="salin()">Salin teks</button> <span id="tersalin" class="ok"></span>
</div>
${devBridge ? `<form method="post" action="/kirim-lewat-bot"><input type="hidden" name="jenis" value="${esc(kind)}">
<button type="submit">Kirim ke grup lewat bot utama</button></form>
<p class="muted">Dikirim oleh bot utama dengan nomor dan sesi yang sama, tanpa tautan rincian (seperti pesan otomatis). Jawaban butuh 10-30 detik.</p>` : ''}
</section>
<ol class="muted">
<li>Ketuk <strong>Buka WhatsApp dan pilih grup</strong>. Bila HP punya dua WhatsApp, pilih yang biasa dipakai di grup.</li>
<li>Pilih grup ${esc(config.groupLabel)}, lalu ketuk kirim.</li>
</ol>
<a class="btn alt" href="/">Kembali</a>
<script>
function salin() {
  var teks = document.getElementById('teks');
  var tanda = function () { document.getElementById('tersalin').textContent = 'Tersalin'; };
  if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(teks.textContent).then(tanda); return; }
  var range = document.createRange(); range.selectNodeContents(teks);
  var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  if (document.execCommand('copy')) tanda();
  sel.removeAllRanges();
}
</script>`);
}

function pairingPage() {
  if (wa.status === 'tersambung') {
    return page('Berhasil', `<h1>Nomor berhasil ditautkan</h1>
<section class="card"><p class="ok"><strong>${ICONS.check} Bot tersambung sebagai ${esc(wa.phone)}.</strong></p>
<p><strong>Langkah berikutnya:</strong> minta admin grup memasukkan nomor ini ke grup ${esc(config.groupLabel)} (dan mengeluarkan nomor bot lama bila ada). Setelah itu pilih grupnya.</p>
<div class="actions"><a class="btn" href="/grup">${ICONS.users}Lanjut: pilih grup tujuan</a><a class="btn alt" href="/">Ke halaman utama</a></div></section>`);
  }
  if (wa.status !== 'menunggu_tautan') {
    return page('Penautan berhenti', `<h1>Penautan berhenti</h1>
${flash(wa.error ?? STATUS_TEXT[wa.status]?.[0] ?? wa.status, 'bad')}
<p class="muted">Sisa percobaan hari ini: ${linkAttemptsLeft()}.</p>
<a class="btn" href="/">Kembali</a>`);
  }
  const code = wa.pairingCode ? `${wa.pairingCode.slice(0, 4)}-${wa.pairingCode.slice(4)}` : null;
  return page('Tautkan nomor', `<h1>Tautkan nomor ${esc(wa.phone)}</h1>
<section class="card"><h2>Pindai QR (disarankan)</h2>
${wa.qr ? `<img class="qr" src="${wa.qr}" alt="Kode QR penautan">` : '<p class="warn">Menyiapkan QR…</p>'}
<ol>
<li>Buka halaman ini di laptop atau HP lain.</li>
<li>Di HP bot, buka <strong>WhatsApp Business</strong>, ketuk titik tiga, lalu <strong>Perangkat tertaut</strong>.</li>
<li>Ketuk <strong>Tautkan perangkat</strong>, lalu pindai QR di atas.</li>
</ol></section>
<section class="card"><h2>Hanya punya HP bot?</h2>
${code
    ? `<div class="code">${esc(code)}</div>
<p>Di WhatsApp Business: <strong>Perangkat tertaut</strong>, <strong>Tautkan perangkat</strong>, lalu <strong>Tautkan dengan nomor telepon saja</strong>, dan masukkan kode ini.</p>`
    : `<p class="muted">Pakai kode tautan bila tidak ada perangkat lain untuk menampilkan QR.</p>
<form method="post" action="/kode"><button class="alt" type="submit"${wa.qr ? '' : ' disabled'}>Minta kode tautan</button></form>`}
</section>
<p class="muted">Halaman ini memuat ulang sendiri tiap 5 detik. Penautan berhenti sendiri bila tidak diselesaikan dalam beberapa menit.</p>
<a class="btn alt" href="/">Kembali</a>`, { refresh: 5 });
}

/** Halaman tautkan atau ganti nomor bot: persiapan wajib, lalu QR. */
function linkPage(message) {
  const state = getState();
  // Sesi tersimpan tetap dipakai setelah server menyala ulang; menautkan ulang tanpa perlu justru mencurigakan
  const sessionSaved = hasLinkedSession();
  const title = sessionSaved ? 'Ganti nomor bot' : 'Tautkan nomor bot';
  const left = linkAttemptsLeft();
  return page(title, `<h1>${title}</h1>
${flash(message, 'bad')}
${sessionSaved ? `<div class="note warn">Nomor ${esc(wa.phone ?? state.phone ?? '')} masih tertaut dan berjalan. Lanjutkan hanya bila nomor itu diblokir atau memang mau diganti. Bila nomornya berbeda, grup tujuan perlu dipilih lagi.</div>` : ''}
<section class="card"><h2>Yang perlu disiapkan</h2>
<ol>
<li>HP bot dengan <strong>WhatsApp Business</strong> di SIM 2.</li>
<li>Laptop atau HP lain untuk membuka halaman ini dan menampilkan kode QR.</li>
</ol>
<p class="muted">Sisa percobaan hari ini: <strong>${left}</strong> kali. Bila gagal, jangan diulang-ulang; coba lagi besok. Penautan berulang memperbesar risiko blokir.</p></section>
${left ? `<form class="card" method="post" action="/daftar">
<label for="phone">Nomor WhatsApp Business (SIM 2)</label>
<input id="phone" type="tel" name="phone" placeholder="0812xxxxxxxx" inputmode="tel" required>
<p style="margin:16px 0 4px"><strong>Centang bila sudah:</strong></p>
<label class="check"><input type="checkbox" name="cek_profil" value="1" required> Nama dan foto profil WhatsApp Business sudah diisi</label>
<label class="check"><input type="checkbox" name="cek_pin" value="1" required> Verifikasi dua langkah (PIN) sudah dinyalakan</label>
<label class="check"><input type="checkbox" name="cek_kontak" value="1" required> Nomor sudah disimpan pengurus dan beberapa anggota, dan sudah pernah berbalas chat</label>
<label class="check"><input type="checkbox" name="cek_qr" value="1" required> Halaman ini dibuka di laptop atau HP lain untuk memindai QR</label>
${sessionSaved ? `<label class="check warn"><input type="checkbox" name="confirm" value="1" required> Saya mengerti nomor ${esc(wa.phone ?? state.phone ?? '')} akan dilepas dari bot.</label>` : ''}
<div class="actions"><button type="submit">${ICONS.phone}Mulai menautkan</button><a class="btn alt" href="/">Batal</a></div></form>`
    : '<div class="note bad">Batas percobaan hari ini sudah habis. Coba lagi besok.</div><a class="btn alt" href="/">Kembali</a>'}`);
}

async function groupPage() {
  if (!isConnected()) return dashboard('Bot belum tersambung. Daftarkan nomor terlebih dahulu.');
  const groups = await listGroups();
  const state = getState();
  const rows = groups.map((g) => `<label class="pick"><input type="radio" name="jid" value="${esc(g.id)}" ${g.id === state.groupJid ? 'checked' : ''} required>
<span>${esc(g.subject)} <span class="muted">(${g.size} anggota)</span></span></label>`).join('');
  return page('Pilih grup', `<h1>Pilih grup tujuan</h1>
<section class="card"><ol>
<li>Pastikan admin grup sudah memasukkan nomor bot <strong>${esc(wa.phone ?? state.phone)}</strong> ke grup.</li>
<li>Pilih grupnya di bawah, lalu tekan <strong>Simpan grup ini</strong>.</li>
</ol>
<p class="muted">Grup belum muncul? Tekan <strong>Muat ulang daftar</strong> setelah nomor bot dimasukkan ke grup.</p></section>
<form class="card" method="post" action="/grup">
${rows || '<p class="warn">Nomor bot belum masuk ke grup mana pun. Minta admin grup menambahkan nomor bot, lalu muat ulang daftar.</p>'}
${rows ? `<button type="submit">${ICONS.check}Simpan grup ini</button>` : ''}
</form><div class="actions"><a class="btn alt" href="/grup">Muat ulang daftar</a><a class="btn alt" href="/">Kembali</a></div>`);
}

function testText() {
  return [
    `✅ *Bot info cuaca ${config.placeName} sudah aktif di grup ini.*`,
    '',
    `🌾 Setiap pagi pukul ${pad(config.morningHour)}.00 WIB, bot mengirim info cuaca dan jam aman ke ladang.`,
    `❓ Untuk bertanya, ketik: *halo ${config.botName} besok* (cara lain: *halo ${config.botName} menu*)`,
  ].join('\n');
}

async function testMessage() {
  const { groupJid } = getState();
  if (!groupJid) throw new Error('Grup tujuan belum dipilih');
  await botSend(groupJid, testText());
  addLog('uji', 'Pesan uji');
  updateState({ testedFor: testKey(getState()) });
}

// API untuk mode develop di komputer yang sama: hanya dari 127.0.0.1, dengan token yang dibuat setiap bot menyala
let apiToken = null;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function apiTokenMatches(token) {
  if (!apiToken || typeof token !== 'string') return false;
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(apiToken).digest();
  return crypto.timingSafeEqual(a, b);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20_000) throw new Error('Isian terlalu panjang');
  }
  return JSON.parse(body || '{}');
}

async function apiRoute(req, res, url) {
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (!LOOPBACK.has(req.socket.remoteAddress) || !apiTokenMatches(req.headers['x-bot-token'])) return json(403, { error: 'Ditolak' });
  if (manualMode) return json(503, { error: 'Bot utama dalam mode manual, tidak tersambung ke WhatsApp' });

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const state = getState();
    const { phase } = linkPhase();
    const today = nowWib().date;
    return json(200, {
      status: wa.status,
      statusText: STATUS_TEXT[wa.status]?.[0] ?? wa.status,
      phone: wa.phone ?? state.phone,
      error: wa.error,
      groupName: state.groupName,
      sentToday: state.sent?.date === today ? state.sent.count : 0,
      limit: dailyLimit(phase),
      morningStatus: state.morningSentOn === today ? state.morningStatus : null,
      phase,
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/kirim') {
    const { text } = await readJson(req).catch(() => ({}));
    if (typeof text !== 'string' || !text.trim()) return json(400, { error: 'Teks kosong' });
    const { groupJid } = getState();
    if (!groupJid) return json(409, { error: 'Grup tujuan bot utama belum dipilih' });
    try {
      // Lewat pintu yang sama dengan pesan otomatis: hanya ke grup tujuan, batas harian, tanpa teks ganda
      await botSend(groupJid, text);
      addLog('develop', 'Kiriman uji dari mode develop');
      return json(200, { ok: true });
    } catch (err) {
      return json(err.notSent ? 409 : 502, { error: err.message });
    }
  }
  return json(404, { error: 'Tidak ditemukan' });
}

function sendAsset(req, res, asset) {
  const { size, mtime } = fs.statSync(asset.file);
  const modified = mtime.toUTCString();
  const headers = {
    'Content-Type': asset.type,
    'Cache-Control': 'no-cache',
    'Last-Modified': modified,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", // berkas SVG tidak boleh menjalankan skrip
  };
  if (req.headers['if-modified-since'] === modified && !req.headers.range) {
    res.writeHead(304, headers);
    return res.end();
  }
  const stream = (opts) => fs.createReadStream(asset.file, opts).on('error', () => res.destroy()).pipe(res);
  // Video diminta sepotong-sepotong (Range); Safari tidak mau memutar video tanpa ini
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return stream({ start, end });
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  return stream();
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;
  if (url.pathname.startsWith('/api/')) return apiRoute(req, res, url);
  // Sebelum pemeriksaan masuk agar logo juga tampil di halaman masuk
  if (method === 'GET' && (url.pathname === '/favicon.ico' || url.pathname.startsWith('/aset/'))) {
    const name = url.pathname === '/favicon.ico' ? 'icon' : url.pathname.slice('/aset/'.length);
    const asset = ASSET_NAMES.has(name) && findAsset(name);
    if (!asset) {
      res.writeHead(404);
      return res.end();
    }
    return sendAsset(req, res, asset);
  }
  const authed = sessionOf(req);

  if (url.pathname === '/masuk' && method === 'POST') {
    const form = await readForm(req);
    const ip = req.socket.remoteAddress ?? '?';
    const fail = failedLogins.get(ip);
    if (fail?.until > Date.now()) {
      return send(res, 429, loginPage(`Terlalu banyak percobaan. Coba lagi setelah pukul ${nowWib(new Date(fail.until)).hhmm} WIB.`));
    }
    if (!passwordMatches(form.password ?? '')) {
      const count = (fail && !fail.until ? fail.count : 0) + 1;
      failedLogins.set(ip, { count, until: count >= LOGIN_MAX_FAILS ? Date.now() + LOGIN_LOCK_MS : 0 });
      await new Promise((r) => setTimeout(r, 1000));
      return send(res, 401, loginPage('Kata sandi salah'));
    }
    failedLogins.delete(ip);
    const sid = crypto.randomBytes(32).toString('hex');
    sessions.set(hashSid(sid), Date.now() + SESSION_MS);
    saveSessions();
    return redirect(res, '/', { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` });
  }
  if (!authed) return send(res, 200, loginPage());

  if (manualMode && ['/tautan', '/ganti-nomor', '/grup', '/daftar', '/kode', '/uji', '/kirim-pagi'].includes(url.pathname)) {
    return redirect(res, `/?pesan=${encodeURIComponent('Bot otomatis dimatikan (WA_MODE=manual). Pakai kirim manual.')}`);
  }
  if (method === 'GET' && url.pathname === '/') {
    return send(res, 200, dashboard(url.searchParams.get('pesan'), devBridge ? await mainBotStatus() : null));
  }
  if (method === 'GET' && url.pathname === '/tautan') return send(res, 200, pairingPage());
  if (method === 'GET' && url.pathname === '/ganti-nomor') return send(res, 200, linkPage(url.searchParams.get('pesan')));
  if (method === 'GET' && url.pathname === '/grup') return send(res, 200, await groupPage());

  if (method === 'GET' && url.pathname === '/kirim') {
    return send(res, 200, await manualPage(url.searchParams.get('jenis'), url.searchParams.get('pesan')));
  }

  if (method === 'POST') {
    const form = await readForm(req);
    const back = (msg) => redirect(res, `/?pesan=${encodeURIComponent(msg)}`);
    try {
      switch (url.pathname) {
        case '/daftar': {
          const retry = (msg) => redirect(res, `/ganti-nomor?pesan=${encodeURIComponent(msg)}`);
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
          return redirect(res, '/tautan');
        }
        case '/kirim-lewat-bot': {
          const kind = MANUAL_TEXTS[form.jenis] ? form.jenis : 'pagi';
          const to = (msg) => redirect(res, `/kirim?jenis=${encodeURIComponent(kind)}&pesan=${encodeURIComponent(msg)}`);
          if (!devBridge) return to('Gagal: hanya tersedia di mode develop (npm run dev)');
          try {
            await mainBot('/api/kirim', { text: await buildText(kind) });
            return to('Terkirim lewat bot utama. Cek grup di WhatsApp.');
          } catch (err) {
            return to(`Gagal: ${err.message}`);
          }
        }
        case '/kode':
          await requestPairingCode();
          return redirect(res, '/tautan');
        case '/grup': {
          const group = (await listGroups()).find((g) => g.id === form.jid);
          if (!group) return back('Gagal: grup tidak ditemukan');
          const state = updateState({ groupJid: group.id, groupName: group.subject });
          const { phase, until } = linkPhase();
          const next = state.testedFor === testKey(state) ? ''
            : phase === 'tenang' ? ` Langkah berikutnya: tunggu masa tenang sampai ${wibText(until)}, lalu kirim pesan uji.`
              : ' Langkah berikutnya: kirim pesan uji.';
          return back(`Grup tujuan disimpan: ${group.subject}.${next}`);
        }
        case '/uji':
          await testMessage();
          return back(`Pesan uji terkirim. Buka grup ${getState().groupName} di WhatsApp: bila pesannya masuk, bot sudah siap.`);
        case '/kirim-pagi':
          await sendMorning({ force: true });
          return back('Ringkasan cuaca hari ini terkirim ke grup.');
        case '/keluar':
          sessions.delete(hashSid(authed));
          saveSessions();
          return redirect(res, '/', { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
        default:
          break;
      }
    } catch (err) {
      return back(`Gagal: ${err.message}`);
    }
  }
  send(res, 404, page('Tidak ditemukan', '<h1>Halaman tidak ditemukan</h1><a class="btn" href="/">Kembali</a>'));
}

export function startAdmin() {
  if (!config.adminPassword || config.adminPassword.length < 8) {
    throw new Error('ADMIN_PASSWORD di .env wajib diisi, minimal 8 karakter');
  }
  if (!manualMode) {
    // Token baru setiap bot utama menyala, dibaca mode develop dari berkas ini
    apiToken = crypto.randomBytes(24).toString('hex');
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(path.join(config.dataDir, 'api-token'), apiToken);
  }
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      logger.error(err, 'Halaman pengelola');
      if (!res.headersSent) send(res, 500, page('Galat', `<h1>Terjadi galat</h1><p>${esc(err.message)}</p>`));
    });
  });
  server.listen(config.adminPort, config.adminHost, () => {
    logger.info(`Halaman pengelola: http://${config.adminHost === '0.0.0.0' ? 'localhost' : config.adminHost}:${config.adminPort}`);
  });
  return server;
}
