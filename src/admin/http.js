// Bantuan HTTP kecil untuk halaman pengelola: kirim HTML atau JSON, alihkan, dan baca isian (dengan batas ukuran).

export function send(res, status, html, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(html);
}

export function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function redirect(res, location, headers = {}) {
  res.writeHead(303, { Location: location, ...headers });
  res.end();
}

async function readBody(req, limit) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error('Isian terlalu panjang');
  }
  return body;
}

export async function readForm(req) {
  return Object.fromEntries(new URLSearchParams(await readBody(req, 10_000)));
}

export async function readJson(req) {
  return JSON.parse((await readBody(req, 20_000)) || '{}');
}
