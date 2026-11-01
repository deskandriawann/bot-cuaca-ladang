// Berkas yang dilayani halaman pengelola:
// - assets/ (gambar dan video milik unit, boleh diganti tanpa menyalakan ulang): icon, tiga logo kaki halaman,
//   video spanduk (hero-video, hero-video-2, diputar bergantian) dan hero-poster. Boleh .png/.jpg/.jpeg/.webp/.svg/.ico/.mp4/.webm.
// - src/admin/static/ (bagian kode): admin.css dan admin.js. Alamatnya diberi sidik isi (?v=...) agar boleh
//   disimpan lama di browser, dan berganti sendiri setiap berkasnya diubah.
// Hanya nama dalam daftar yang dilayani, jadi tidak ada jalan membaca berkas lain di server.
import crypto from 'node:crypto';
import fs from 'node:fs';

const ASSET_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  mp4: 'video/mp4', webm: 'video/webm',
};
export const FOOTER_LOGOS = [['logo-unit', 'Logo unit KKN'], ['logo-ugm', 'Logo Universitas Gadjah Mada'], ['logo-kkn', 'Logo KKN-PPM UGM']];
export const HERO_VIDEOS = ['hero-video', 'hero-video-2'];
const ASSET_NAMES = new Set(['icon', 'hero-poster', ...HERO_VIDEOS, ...FOOTER_LOGOS.map(([name]) => name)]);

const STATIC_TYPES = { 'admin.css': 'text/css; charset=utf-8', 'admin.js': 'text/javascript; charset=utf-8' };

export function findAsset(name) {
  if (!ASSET_NAMES.has(name)) return null;
  for (const [ext, type] of Object.entries(ASSET_TYPES)) {
    const file = new URL(`../../assets/${name}.${ext}`, import.meta.url);
    if (fs.existsSync(file)) return { file, type };
  }
  return null;
}

// Dibaca setiap diminta (berkasnya kecil) agar perubahan saat develop langsung terlihat
function staticFile(name) {
  const body = fs.readFileSync(new URL(`./static/${name}`, import.meta.url));
  return { body, version: crypto.createHash('sha256').update(body).digest('hex').slice(0, 12) };
}

/** '/static/admin.css?v=3f2a…' */
export function staticUrl(name) {
  return `/static/${name}?v=${staticFile(name).version}`;
}

export function serveStatic(req, res, url) {
  const name = url.pathname.slice('/static/'.length);
  if (!STATIC_TYPES[name]) return false;
  const { body, version } = staticFile(name);
  res.writeHead(200, {
    'Content-Type': STATIC_TYPES[name],
    // Alamat bersidik boleh disimpan setahun; tanpa sidik selalu diperiksa ulang
    'Cache-Control': url.searchParams.get('v') === version ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Length': body.length,
  });
  res.end(body);
  return true;
}

/** Gambar dan video dari assets/, dengan Range (video) dan Last-Modified. false bila nama tidak dikenal. */
export function serveAsset(req, res, name) {
  const asset = findAsset(name);
  if (!asset) return false;
  const { size, mtime } = fs.statSync(asset.file);
  const modified = mtime.toUTCString();
  const headers = {
    'Content-Type': asset.type,
    'Cache-Control': 'no-cache',
    'Last-Modified': modified,
    'Accept-Ranges': 'bytes',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", // berkas SVG tidak boleh menjalankan skrip
  };
  if (req.headers['if-modified-since'] === modified && !req.headers.range) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  const stream = (opts) => fs.createReadStream(asset.file, opts).on('error', () => res.destroy()).pipe(res);
  // Video diminta sepotong-sepotong (Range); Safari tidak mau memutar video tanpa ini
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return true;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    stream({ start, end });
    return true;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  stream();
  return true;
}
