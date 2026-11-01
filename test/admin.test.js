import { ADMIN_PASSWORD, OLD_SID } from './setup.js'; // harus paling awal: pengaturan bawaan dan folder data sementara
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { addLog, getState } from '../src/store.js';
import { startAdmin } from '../src/admin/server.js';
import { normalizePhone } from '../src/admin/actions.js';
import { setupSteps } from '../src/admin/dashboard.js';

test('nomor telepon dinormalkan ke format 62', () => {
  assert.equal(normalizePhone('0812-3456-7890'), '6281234567890');
  assert.equal(normalizePhone('+62 812 3456 7890'), '6281234567890');
  assert.equal(normalizePhone('81234567890'), '6281234567890');
  assert.equal(normalizePhone('123'), null);
});

test('langkah menyambungkan bot berurutan sampai pesan percobaan', () => {
  const steps = (linked, grouped, quiet, tested) => setupSteps({ linked, grouped, quiet, tested });
  assert.equal(steps(false, false, false, false).current, 0);
  // Grup lama tanpa nomor tertaut tidak dihitung selesai
  assert.deepEqual(steps(false, true, false, true).done, [false, false, false, false]);
  assert.equal(steps(true, false, true, false).current, 1);
  assert.equal(steps(true, true, true, false).current, 2);
  assert.equal(steps(true, true, false, false).current, 3);
  assert.equal(steps(true, true, false, false).complete, false);
  assert.equal(steps(true, true, false, true).complete, true);
  assert.equal(steps(true, true, false, true).current, -1);
});

test('halaman pengelola: keamanan, pesan bertanda tangan, jam kirim, dan kunci masuk', async () => {
  const server = startAdmin();
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const form = (pathname, body, headers = {}) => fetch(base + pathname, {
    method: 'POST', redirect: 'manual', body: new URLSearchParams(body),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  });
  const login = (password, ip) => form('/masuk', { password }, { 'x-forwarded-for': ip });
  try {
    // Header keamanan: tanpa skrip/gaya sisipan, tidak boleh dibingkai, HTTPS hanya bila lewat proxy HTTPS
    const first = await fetch(`${base}/`);
    const csp = first.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.equal(first.headers.get('x-frame-options'), 'DENY');
    assert.equal(first.headers.get('strict-transport-security'), null);

    // Halaman tidak memakai skrip, gaya, atau penangan kejadian sisipan (dilarang CSP)
    const loginHtml = await first.text();
    assert.doesNotMatch(loginHtml, /<script>|<style|\sstyle="|\son[a-z]+="/);

    // Gaya dan skrip dilayani dari berkas; alamat bersidik boleh disimpan lama
    const cssUrl = /href="(\/static\/admin\.css\?v=\w+)"/.exec(loginHtml)[1];
    const css = await fetch(base + cssUrl);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.match(css.headers.get('cache-control'), /immutable/);
    // Upaya membaca berkas lain lewat '../' ditolak (%2F agar tidak dirapikan fetch sebelum sampai ke server)
    assert.equal((await fetch(`${base}/static/..%2F..%2Fconfig.js`)).status, 404);
    assert.equal((await fetch(`${base}/aset/..%2F..%2F.env`)).status, 404);

    // Sesi dari kata sandi lama gugur
    assert.match(await (await fetch(`${base}/`, { headers: { cookie: `sid=${OLD_SID}` } })).text(), /name="password"/);

    // Formulir dari situs lain ditolak, walau kata sandinya benar
    assert.equal((await form('/masuk', { password: ADMIN_PASSWORD }, { origin: 'https://jahat.example' })).status, 403);

    // Lewat reverse proxy HTTPS: cookie hanya dikirim lewat HTTPS
    const ok = await form('/masuk', { password: ADMIN_PASSWORD }, { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' });
    assert.equal(ok.status, 303);
    assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; .*Secure/);
    assert.ok(ok.headers.get('strict-transport-security'));
    const cookie = ok.headers.get('set-cookie').split(';')[0];

    // Pesan di alamat hanya tampil bila ditandatangani bot sendiri
    addLog('sambungan', 'Terputus sementara (kode 428), menyambung ulang sendiri');
    addLog('pembaruan', '2026-10-31 15 petir, 2026-10-31 15 segera');
    addLog('nomor', 'Tertaut sebagai 6285190966236');
    const fake = await (await fetch(`${base}/?pesan=Hubungi%20nomor%20ini`, { headers: { cookie } })).text();
    assert.match(fake, /Keluar/); // sudah masuk: halaman utama, bukan halaman masuk
    assert.doesNotMatch(fake, /Hubungi nomor ini/);
    assert.doesNotMatch(fake, /<script>|<style|\sstyle="|\son[a-z]+="/);

    // Catatan kegiatan dalam bahasa sehari-hari: tanpa kode teknis, nomor ditulis seperti biasa
    assert.match(fake, /Terputus sebentar, menyambung lagi sendiri/);
    assert.match(fake, /Hujan petir pukul 15\.00, pengingat hujan pukul 15\.00/);
    assert.match(fake, /Tertaut sebagai 0851-9096-6236/);
    assert.doesNotMatch(fake, /kode 428|Baileys/);
    const back = await form('/grup', { jid: 'tidak-ada@g.us' }, { cookie });
    const shown = await (await fetch(base + back.headers.get('location'), { headers: { cookie } })).text();
    assert.match(shown, /Gagal: grup tidak ditemukan/);

    // Jam kirim diatur dari halaman: dicek batasnya, langsung berlaku, bisa dikembalikan ke bawaan
    const saveTime = async (jam) => {
      const saved = await form('/jam-pagi', { jam }, { cookie });
      return (await fetch(base + saved.headers.get('location'), { headers: { cookie } })).text();
    };
    assert.match(await saveTime('23:30'), /Gagal: jam tidak valid/);
    assert.match(await saveTime('6:75'), /Gagal: jam tidak valid/);
    const after = await saveTime('06:30');
    assert.match(after, /Jam kirim disimpan: setiap hari sekitar pukul 06\.30-06\.44 WIB/);
    assert.match(after, /value="06:30"/);
    assert.match(after, /Kembali ke jam awal \(05\.00\)/);
    assert.deepEqual(getState().morningSchedule, { hour: 6, minute: 30 });
    await saveTime('bawaan');
    assert.equal(getState().morningSchedule, null);

    // Halaman kirim manual: tombol salin lewat atribut data, bukan onclick
    const manual = await (await fetch(`${base}/kirim?jenis=besok`, { headers: { cookie } })).text();
    assert.match(manual, /data-copy="teks"/);

    // API mode develop: token benar tetap ditolak bila datang lewat reverse proxy
    const token = fs.readFileSync(path.join(config.dataDir, 'api-token'), 'utf8');
    assert.equal((await fetch(`${base}/api/status`, { headers: { 'x-bot-token': token } })).status, 200);
    assert.equal((await fetch(`${base}/api/status`, { headers: { 'x-bot-token': token, 'x-forwarded-for': '203.0.113.9' } })).status, 403);

    // Keluar: cookie dihapus dan sesi tidak berlaku lagi
    const out = await form('/keluar', {}, { cookie });
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.match(await (await fetch(`${base}/`, { headers: { cookie } })).text(), /name="password"/);

    // 5 kali salah dari satu alamat: alamat itu dikunci, kata sandi benar pun ditolak
    await Promise.all(Array.from({ length: 5 }, () => login('salah', '198.51.100.7')));
    assert.equal((await login(ADMIN_PASSWORD, '198.51.100.7')).status, 429);
    assert.equal((await login(ADMIN_PASSWORD, '198.51.100.8')).status, 303);

    // 30 kali salah dari banyak alamat: semua dikunci dan dicatat
    await Promise.all(Array.from({ length: 30 }, (_, i) => login('salah', `192.0.2.${i + 1}`)));
    assert.equal((await login(ADMIN_PASSWORD, '192.0.2.200')).status, 429);
    assert.equal(getState().log[0].kind, 'keamanan');
  } finally {
    server.close();
  }
});
