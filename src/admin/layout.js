// Kerangka halaman pengelola: bilah atas, spanduk, kaki halaman, ikon, dan potongan tampilan yang dipakai bersama.
// Gaya dan perilaku ada di static/admin.css dan static/admin.js (tanpa sisipan, lihat kebijakan keamanan di security.js).
import { config } from '../config.js';
import { FOOTER_LOGOS, HERO_VIDEOS, assetUrl, staticUrl } from './assets.js';

const UNIT_LABEL = 'KKN-PPM UGM Unit YO 095';

/** Teks aman untuk HTML: semua yang berasal dari luar (nama grup, pesan anggota, data cuaca) wajib lewat sini. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const svg = (paths) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const ICONS = {
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
  clock: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  sliders: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  activity: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
};

/** Kotak pemberitahuan; kind: ok | warn | bad. Kosong bila tidak ada pesan. */
export function flash(message, kind = 'ok') {
  return message ? `<div class="note ${kind}">${esc(message)}</div>` : '';
}

/** Spanduk atas selebar layar. Video hanya diputar di layar lebar; HP cukup gambar diam agar hemat kuota. */
export function hero({ pill, title, lead, actions = '' }) {
  const videos = HERO_VIDEOS.map((name) => assetUrl(name)).filter(Boolean);
  const posterUrl = assetUrl('hero-poster');
  const poster = posterUrl ? ` poster="${esc(posterUrl)}"` : '';
  return `<section class="hero">
${videos.length || poster ? `<video class="hero-video" muted playsinline preload="none"${poster} data-videos="${esc(JSON.stringify(videos))}" aria-hidden="true"></video>` : ''}
<div class="wrap hero-body"><span class="pill">${esc(pill)}</span><h1>${esc(title)}</h1><p class="lead">${esc(lead)}</p>${actions}</div>
</section>`;
}

/**
 * Satu halaman utuh. hero: spanduk atas (lihat hero()). wide: dua kolom. nav: tombol Keluar (tidak di halaman masuk).
 * refresh: detik muat ulang sendiri (halaman QR); halaman itu tanpa layar memuat agar QR tidak tertutup.
 */
export function page(title, body, { refresh, hero: banner = '', wide = false, nav = true } = {}) {
  const icon = assetUrl('icon');
  const logo = icon ? `<img src="${esc(icon)}" alt="">` : `<span class="logo-fallback">${ICONS.cloud}</span>`;
  const footerLogos = FOOTER_LOGOS.map(([name, alt]) => [assetUrl(name), alt]).filter(([src]) => src)
    .map(([src, alt]) => `<img src="${esc(src)}" alt="${alt}">`).join('');
  return `<!doctype html><html lang="id"${refresh ? ' data-no-loader' : ''}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${esc(title)} · Bot Cuaca</title>
<link rel="icon" href="/aset/icon">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="${staticUrl('admin.css')}">
<script src="${staticUrl('admin.js')}"></script>
</head><body>
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
</body></html>`;
}

/** Kotak ringkasan berwarna. subHtml: keterangan yang sudah aman (dipakai untuk nomor yang tidak boleh terpotong baris). */
export function tiles(items) {
  return `<div class="tiles">${items.map(({ color, icon, label, value, sub, subHtml }) => `<div class="tile ${color}">
<div class="tile-head"><span>${esc(label)}</span><span class="tile-icon">${icon}</span></div>
<strong>${esc(value)}</strong><small>${subHtml ?? esc(sub)}</small></div>`).join('')}</div>`;
}

/** Halaman pesan singkat: ditolak, tidak ditemukan, galat. */
export function messagePage(title, heading, text) {
  return page(title, `<h1>${esc(heading)}</h1>${text ? `<p>${esc(text)}</p>` : ''}<a class="btn" href="/">Kembali</a>`);
}
