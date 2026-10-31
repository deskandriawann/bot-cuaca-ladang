import { ADMIN_PASSWORD, OLD_SID } from './setup.js'; // harus paling awal: pengaturan bawaan dan folder data sementara
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseBmkg, parseOpenMeteo } from '../src/weather/sources.js';
import { safeWindows, alertKeys, hazardsOf, withRainChance } from '../src/weather/analysis.js';
import { morningMessage, updateMessage, rainSoonMessage } from '../src/messages.js';
import { parseCall } from '../src/commands.js';
import { answer } from '../src/bot.js';
import { normalizePhone, startAdmin } from '../src/admin.js';
import { getState } from '../src/store.js';
import { nowWib } from '../src/time.js';

const bmkg = parseBmkg(JSON.parse(fs.readFileSync(new URL('./fixtures/bmkg.json', import.meta.url))));
const om = parseOpenMeteo(JSON.parse(fs.readFileSync(new URL('./fixtures/openmeteo.json', import.meta.url))));
const dates = Object.keys(bmkg.days).sort();
const [today, tomorrow, dayAfter] = dates;
const offline = async () => { throw new Error('tidak dipakai dalam pengujian'); };
const sources = { getBmkg: async () => bmkg, getOm: async () => om, getEnsemble: offline };

const slot = (hour, desc, windKmh = 5) => ({
  date: '2026-11-14', hour, code: 0, desc, temp: 27, humidity: 80, windKmh, windFrom: 'SE', rainMm: 0,
});

test('BMKG dikelompokkan per tanggal WIB dan urut per jam', () => {
  assert.equal(bmkg.place, 'Selopamioro');
  assert.ok(dates.length >= 3);
  for (const slots of Object.values(bmkg.days)) {
    assert.deepEqual(slots.map((s) => s.hour), [...slots.map((s) => s.hour)].sort((a, b) => a - b));
  }
});

test('jam aman menggabungkan slot aman yang berurutan', () => {
  const slots = [slot(6, 'Cerah Berawan'), slot(9, 'Berawan'), slot(12, 'Hujan Lebat'), slot(15, 'Hujan Ringan')];
  assert.deepEqual(safeWindows(slots), [[6, 12], [15, 18]]);
  assert.deepEqual(safeWindows([slot(6, 'Hujan Petir'), slot(9, 'Hujan Sedang')]), []);
  assert.equal(safeWindows([slot(21, 'Cerah')]), null);
});

test('jam slot BMKG yang bergeser (05, 08, 11, 14, 17) tetap dihitung jam kerja', () => {
  const shifted = [
    slot(2, 'Hujan Lebat'), slot(5, 'Berawan'), slot(8, 'Cerah'), slot(11, 'Hujan Lebat'),
    slot(14, 'Berawan'), slot(17, 'Cerah'), slot(20, 'Hujan Petir'),
  ];
  assert.deepEqual(safeWindows(shifted), [[6, 11], [14, 18]]);
  assert.deepEqual(alertKeys(shifted), ['2026-11-14 11 hujan_lebat']);
});

test('bahaya dinilai dari keterangan BMKG, bukan kode angka', () => {
  // Di API BMKG, kode 61 berketerangan "Hujan Ringan": bukan bahaya
  assert.deepEqual(hazardsOf({ ...slot(9, 'Hujan Ringan'), code: 61 }), []);
  assert.deepEqual(hazardsOf({ ...slot(9, 'Hujan Sedang'), code: 63 }), ['hujan_sedang']);
});

test('angin kencang dihitung sebagai bahaya', () => {
  assert.deepEqual(hazardsOf(slot(9, 'Cerah', 45)), ['angin']);
  assert.deepEqual(alertKeys([slot(9, 'Hujan Petir'), slot(12, 'Hujan Sedang'), slot(21, 'Hujan Lebat')]), ['2026-11-14 9 petir']);
});

test('peluang hujan = rata-rata pusat cuaca: bagian anggota ensembel yang hujan minimal 1 mm dalam 3 jam', () => {
  const data = { place: 'Selopamioro', days: { '2026-11-14': [slot(14, 'Hujan Sedang')] } };
  const ensemble = {
    models: {
      // Jumlah 3 jam per anggota: 1,5 / 0,1 / 2 / 1,1 mm → 3 dari 4 hujan = 75%
      ecmwf_ifs025: { '2026-11-14': { 14: [0.5, 0, 2, 0.2], 15: [0.5, 0, 0, 0.3], 16: [0.5, 0.1, 0, 0.6] } },
      // Anggota kedua tidak lengkap (null) dan dilewati; anggota pertama 0,6 mm → 0%
      gfs_seamless: { '2026-11-14': { 14: [0.2, 0], 15: [0.2, 0], 16: [0.2, null] } },
      // Jam 16 tidak ada: pusat ini dilewati untuk slot ini
      gem_global: { '2026-11-14': { 14: [9], 15: [9] } },
    },
  };
  const [rated] = withRainChance(data, { ensemble }).days['2026-11-14'];
  assert.deepEqual(rated.rainModels, { ecmwf_ifs025: 75, gfs_seamless: 0 });
  assert.equal(rated.rainChance, 38);
});

test('ensembel gagal: peluang hujan Open-Meteo biasa sebagai cadangan, lalu BMKG saja', () => {
  const data = { place: 'Selopamioro', days: { '2026-11-14': [slot(12, 'Hujan Sedang'), slot(15, 'Berawan')] } };
  const om = { hours: { '2026-11-14': { 12: 40, 13: 75, 14: 60, 15: 10 } } };
  const [noon, afternoon] = withRainChance(data, { ensemble: null, om }).days['2026-11-14'];
  assert.equal(noon.rainChance, 75);
  assert.equal(afternoon.rainChance, 10);
  assert.equal(withRainChance(data, {}), data);
});

test('hujan sedang dan lebat baru jadi bahaya bila pasti; petir selalu', () => {
  assert.deepEqual(hazardsOf({ ...slot(12, 'Hujan Sedang'), rainChance: 50 }), []);
  assert.deepEqual(hazardsOf({ ...slot(12, 'Hujan Lebat'), rainChance: 85 }), ['hujan_lebat']);
  assert.deepEqual(hazardsOf({ ...slot(12, 'Hujan Petir'), rainChance: 30 }), ['petir']);
  // Tanpa data peluang (Open-Meteo gagal), keterangan BMKG saja yang dipakai
  assert.deepEqual(hazardsOf(slot(12, 'Hujan Lebat')), ['hujan_lebat']);
});

test('hujan belum pasti cukup info; hujan sedang atau lebat yang pasti diberi peringatan potensi hujan', () => {
  const day = (chance) => ({
    place: 'Selopamioro',
    days: {
      '2026-11-14': [
        slot(6, 'Cerah'), slot(9, 'Berawan'),
        { ...slot(12, 'Hujan Ringan'), rainChance: 90 }, { ...slot(15, 'Hujan Sedang'), rainChance: chance },
      ],
    },
  });
  const unsure = morningMessage(day(50), '2026-11-14');
  assert.doesNotMatch(unsure, /POTENSI HUJAN/);
  assert.match(unsure, /☔ Mungkin hujan sedang sekitar pukul 12\.00 dan 15\.00 \(peluang 50-90%\)/);
  assert.match(unsure, /✅ \*JAM AMAN KE LADANG\*/);

  const sure = morningMessage(day(85), '2026-11-14');
  assert.match(sure, /⚠️ \*POTENSI HUJAN\*\n🌧️ \*Hujan sedang\* sekitar pukul 15\.00 \(peluang 85%\)/);
  assert.match(sure, /☔ Hujan ringan sekitar pukul 12\.00 \(peluang 90%\)/);
  assert.match(sure, /selesai sebelum pukul 15\.00/);
});

test('hujan lebat pasti: diumumkan saat muncul, lalu diingatkan sekali menjelang turun', async () => {
  const { pendingAlerts } = await import('../src/bot.js');
  const heavy = { ...slot(15, 'Hujan Lebat'), rainChance: 85 };
  const announced = ['2026-11-14 15 hujan_lebat'];
  assert.deepEqual(pendingAlerts([{ ...heavy, rainChance: 40 }], [], 14), { fresh: [], soon: null });
  assert.deepEqual(pendingAlerts([heavy], [], 10), { fresh: announced, soon: null });
  assert.equal(pendingAlerts([heavy], announced, 14).soon, heavy);
  assert.equal(pendingAlerts([heavy], announced, 15).soon, heavy);
  assert.equal(pendingAlerts([heavy], [...announced, '2026-11-14 15 segera'], 15).soon, null);
  // Hujan sedang tidak dikirim ulang walau pasti
  assert.deepEqual(pendingAlerts([{ ...slot(15, 'Hujan Sedang'), rainChance: 90 }], [], 14), { fresh: [], soon: null });

  assert.match(rainSoonMessage('Selopamioro', heavy, 14, '14.10'), /HUJAN LEBAT SEBENTAR LAGI[\s\S]*mulai sekitar pukul 15\.00 \(peluang 85%\)/);
  assert.match(rainSoonMessage('Selopamioro', heavy, 15, '15.10'), /turun sejak sekitar pukul 15\.00/);
});

test('ringkasan pagi memuat bagian penting', () => {
  const text = morningMessage(bmkg, tomorrow);
  for (const part of ['Selamat pagi', 'JAM AMAN KE LADANG', 'Pagi (06-12)', '☔', '⚡', '💨 Angin', '💡 *Saran*', '💦', 'Sumber: BMKG']) {
    assert.ok(text.includes(part), `tidak ada "${part}"\n${text}`);
  }
});

test('pemberitahuan perubahan menyebut bahaya baru', () => {
  const text = updateMessage('Selopamioro', [slot(12, 'Hujan Lebat'), slot(15, 'Cerah')], ['2026-11-14 12 hujan_lebat'], '10.05');
  assert.match(text, /Hujan lebat sekitar pukul 12\.00/);
  assert.match(text, /JAM AMAN TERSISA\*\n\*15\.00-18\.00\*/);
});

test('panggilan dikenali hanya bila diawali sapaan dan nama bot', () => {
  const day = '2026-10-25'; // Minggu
  assert.equal(parseCall('cuaca besok gimana', 'tani', day), null);
  assert.equal(parseCall('halo tanidi cuaca', 'tani', day), null);
  assert.deepEqual(parseCall('Halo Tani, cuaca besok?', 'tani', day), { kind: 'day', offset: 1 });
  assert.deepEqual(parseCall('halo tani', 'tani', day), { kind: 'day', offset: 0 });
  assert.deepEqual(parseCall('halo tani cuaca lusa', 'tani', day), { kind: 'day', offset: 2 });
  assert.deepEqual(parseCall('halo tani cuaca sabtu', 'tani', day), { kind: 'day', offset: 6 });
  assert.deepEqual(parseCall('halo tani cuaca minggu', 'tani', day), { kind: 'day', offset: 0 });
  assert.deepEqual(parseCall('halo tani cuaca 10 hari', 'tani', day), { kind: 'outlook' });
  assert.deepEqual(parseCall('halo tani cuaca tanggal 1', 'tani', day), { kind: 'day', offset: 7 });
  assert.deepEqual(parseCall('halo tani cuaca tanggal 20', 'tani', day), { kind: 'past' });
  assert.deepEqual(parseCall('halo tani cuaca tanggal 15', 'tani', day), { kind: 'too_far' });
  assert.deepEqual(parseCall('halo tani menu', 'tani', day), { kind: 'help' });
});

test('pertanyaan bebas: hari dan tanggal dikenali sendiri, termasuk bahasa Jawa', () => {
  const day = '2026-10-25'; // Minggu
  const cases = {
    'halo tani 28': { kind: 'day', offset: 3 },
    'halo tani 1 november': { kind: 'day', offset: 7 },
    'halo tani tgl 1 nov': { kind: 'day', offset: 7 },
    'halo tani 1/11': { kind: 'day', offset: 7 },
    'halo tani 1-11-2026 hujan?': { kind: 'day', offset: 7 },
    'halo tani 3 hari lagi': { kind: 'day', offset: 3 },
    'halo tani 12 hari lagi': { kind: 'too_far' },
    'halo tani minggu depan': { kind: 'outlook' },
    'halo tani 3 hari ke depan': { kind: 'outlook' },
    "halo tani jum'at": { kind: 'day', offset: 5 },
    'halo tani setu': { kind: 'day', offset: 6 },
    'halo tani rebo': { kind: 'day', offset: 3 },
    'halo tani ahad depan': { kind: 'day', offset: 7 },
    'halo tani sesuk': { kind: 'day', offset: 1 },
    'halo tani besuk pagi': { kind: 'day', offset: 1 },
    'halo tani nanti sore hujan ga?': { kind: 'day', offset: 0 },
    'halo tani jam 3 hujan nggak': { kind: 'day', offset: 0 },
    'halo tani kemarin': { kind: 'past' },
    'halo tani makasih ya': { kind: 'thanks' },
    'halo tani apa kabar': { kind: 'unknown' },
    'Hallo tani lusa': { kind: 'day', offset: 2 },
    'hai tani besok': { kind: 'day', offset: 1 },
  };
  for (const [text, expected] of Object.entries(cases)) assert.deepEqual(parseCall(text, 'tani', day), expected, text);
  assert.equal(parseCall('halo tanih besok', 'tani', day), null);
});

test('jawaban membantu: contoh pertanyaan memakai hari dan tanggal yang akan datang', async () => {
  const help = await answer({ kind: 'help' }, '2026-10-25', sources);
  assert.match(help, /halo tani rabu\* → hari Rabu terdekat/);
  assert.match(help, /halo tani tanggal 29\* atau \*halo tani 29 oktober/);
  assert.match(await answer({ kind: 'unknown' }, '2026-10-25', sources), /belum paham[\s\S]*CARA BERTANYA/);
  assert.match(await answer({ kind: 'past' }, '2026-10-25', sources), /sudah lewat/);
  assert.match(await answer({ kind: 'day', offset: 0 }, today, sources), /💬 Cuaca besok\? Ketik \*halo tani besok\*/);
  assert.match(morningMessage(bmkg, tomorrow), /💬 .*\*halo tani /);
});

test('hari ke-1 sampai ke-3 dari BMKG, ke-4 dan seterusnya dari Open-Meteo', async () => {
  const detail = await answer({ kind: 'day', offset: 2 }, today, sources);
  assert.match(detail, /Sumber: BMKG/);
  assert.match(detail, /CUACA LUSA/);

  const short = await answer({ kind: 'day', offset: 5 }, today, sources);
  assert.match(short, /Sumber: Open-Meteo/);
  assert.match(short, /5 hari lagi/);

  const outlook = await answer({ kind: 'outlook' }, today, sources);
  assert.equal(outlook.split('\n').filter((l) => /^\S+ \w{3} \d+ \w{3}:/u.test(l)).length, 10);
  assert.ok(dayAfter);
});

test('BMKG gagal, jawaban beralih ke Open-Meteo', async () => {
  const text = await answer({ kind: 'day', offset: 1 }, today, {
    getBmkg: async () => { throw new Error('mati'); },
    getOm: async () => om,
    getEnsemble: offline,
  });
  assert.match(text, /Open-Meteo/);
});

test('nomor telepon dinormalkan ke format 62', () => {
  assert.equal(normalizePhone('0812-3456-7890'), '6281234567890');
  assert.equal(normalizePhone('+62 812 3456 7890'), '6281234567890');
  assert.equal(normalizePhone('81234567890'), '6281234567890');
  assert.equal(normalizePhone('123'), null);
});

test('waktu WIB = UTC+7', () => {
  assert.deepEqual(nowWib(new Date('2026-10-24T22:30:00Z')), { date: '2026-10-25', hour: 5, minute: 30, hhmm: '05.30' });
});

test('tahap nomor: tenang, pemanasan, lalu normal', async () => {
  const { linkPhase, dailyLimit } = await import('../src/bot.js');
  const linked = Date.parse('2026-11-01T00:00:00Z');
  const hour = 60 * 60 * 1000;
  assert.equal(linkPhase(null, linked).phase, 'normal');
  assert.equal(linkPhase(new Date(linked).toISOString(), linked + 1 * hour).phase, 'tenang');
  assert.equal(linkPhase(new Date(linked).toISOString(), linked + 25 * hour).phase, 'pemanasan');
  assert.equal(linkPhase(new Date(linked).toISOString(), linked + (24 + 7 * 24 + 1) * hour).phase, 'normal');
  assert.ok(dailyLimit('pemanasan') < dailyLimit('normal'));
});

test('menit kirim diacak per hari tapi tetap sama untuk hari yang sama', async () => {
  const { stableJitter } = await import('../src/bot.js');
  const minutes = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((d) => stableJitter(d, 15));
  assert.ok(minutes.every((m) => m >= 0 && m < 15));
  assert.ok(new Set(minutes).size > 1);
  assert.equal(stableJitter('2026-11-01', 15), minutes[0]);
});

test('bot menolak mengirim ke selain grup tujuan, tanpa menghitung pesan', async () => {
  const { botSend } = await import('../src/bot.js');
  await assert.rejects(botSend('120363000000000000@g.us', 'halo'), (err) => err.notSent === true);
});

test('pesan otomatis tanpa tautan (tautan = sinyal spam); kirim manual boleh', async () => {
  const morning = morningMessage(bmkg, tomorrow);
  const outlook = await answer({ kind: 'outlook' }, today, sources);
  const detail = await answer({ kind: 'day', offset: 1 }, today, sources);
  for (const text of [morning, outlook, detail]) assert.doesNotMatch(text, /https?:\/\//);
  assert.match(await answer({ kind: 'help' }, today, sources), /deskripsi grup/);
});

test('langkah menyambungkan bot berurutan sampai pesan uji', async () => {
  const { setupSteps } = await import('../src/admin.js');
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

test('sesi WhatsApp ditulis atomik dan tetap terbaca setelah program berhenti', async () => {
  const { useSafeAuthState } = await import('../src/auth-store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-cuaca-auth-'));
  const first = await useSafeAuthState(dir);
  first.state.creds.me = { id: '6280000000000:1@s.whatsapp.net' };
  await first.saveCreds();
  await first.state.keys.set({ 'pre-key': { 7: { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5, 6]) } } });
  await first.flush();
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')), 'tidak ada sisa berkas sementara');

  // Seperti program dinyalakan ulang: sesi yang sama dibaca lagi, tanpa menautkan ulang
  const again = await useSafeAuthState(dir);
  assert.equal(again.state.creds.me.id, '6280000000000:1@s.whatsapp.net');
  const keys = await again.state.keys.get('pre-key', ['7']);
  assert.deepEqual([...keys['7'].public], [1, 2, 3]);

  // Sisa berkas sementara dari penulisan yang terhenti dibuang, tidak dipakai
  fs.writeFileSync(path.join(dir, 'creds.json.123.9.tmp'), '{"setengah');
  await useSafeAuthState(dir);
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')));

  // creds.json yang rusak dilaporkan, tidak diam-diam diganti identitas baru
  fs.writeFileSync(path.join(dir, 'creds.json'), '{"noiseKey":');
  await assert.rejects(useSafeAuthState(dir), /rusak/);
});

test('hanya satu bot per folder data', async () => {
  const { acquireLock, releaseLock } = await import('../src/lock.js');
  const { config } = await import('../src/config.js');
  const file = path.join(config.dataDir, 'bot.lock');
  fs.mkdirSync(config.dataDir, { recursive: true });

  fs.writeFileSync(file, String(process.ppid)); // proses induk masih hidup: dianggap bot lain
  assert.throws(() => acquireLock(), /sudah berjalan/);

  fs.writeFileSync(file, '999999'); // proses tidak ada: kunci basi dari bot yang crash
  acquireLock();
  assert.equal(fs.readFileSync(file, 'utf8'), String(process.pid));
  releaseLock();
  assert.ok(!fs.existsSync(file));
});

test('saran: waktu menyemprot hanya saat tidak hujan, angin tenang, dan tidak disusul hujan', async () => {
  const { sprayWindow } = await import('../src/weather/analysis.js');
  assert.deepEqual(sprayWindow([slot(6, 'Cerah', 5), slot(9, 'Cerah', 20), slot(12, 'Hujan Ringan'), slot(15, 'Cerah')]), [6, 9]);
  assert.deepEqual(sprayWindow([slot(6, 'Cerah', 5), slot(9, 'Hujan Ringan'), slot(12, 'Cerah', 5), slot(15, 'Cerah', 5), slot(18, 'Cerah')]), [12, 18]);
  assert.equal(sprayWindow([slot(6, 'Hujan Sedang'), slot(9, 'Hujan Petir'), slot(12, 'Hujan Ringan'), slot(15, 'Hujan Ringan')]), null);
});

test('halaman pengelola: header keamanan, Origin, cookie Secure, pesan bertanda tangan, kunci masuk', async () => {
  const server = startAdmin();
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const form = (pathname, body, headers = {}) => fetch(base + pathname, {
    method: 'POST', redirect: 'manual', body: new URLSearchParams(body),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  });
  const login = (password, ip) => form('/masuk', { password }, { 'x-forwarded-for': ip });
  try {
    const first = await fetch(`${base}/`);
    assert.match(first.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(first.headers.get('x-frame-options'), 'DENY');
    assert.equal(first.headers.get('strict-transport-security'), null); // HTTP biasa

    // Sesi dari kata sandi lama gugur
    assert.match(await (await fetch(`${base}/`, { headers: { cookie: `sid=${OLD_SID}` } })).text(), /Kata sandi pengelola/);

    // Formulir dari situs lain ditolak, walau kata sandinya benar
    assert.equal((await form('/masuk', { password: ADMIN_PASSWORD }, { origin: 'https://jahat.example' })).status, 403);

    // Lewat reverse proxy HTTPS: cookie hanya dikirim lewat HTTPS
    const ok = await form('/masuk', { password: ADMIN_PASSWORD }, { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' });
    assert.equal(ok.status, 303);
    assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; .*Secure/);
    assert.ok(ok.headers.get('strict-transport-security'));
    const cookie = ok.headers.get('set-cookie').split(';')[0];

    // Pesan di alamat hanya tampil bila ditandatangani bot sendiri
    const fake = await (await fetch(`${base}/?pesan=Hubungi%20nomor%20ini`, { headers: { cookie } })).text();
    assert.match(fake, /Keluar/); // sudah masuk: halaman utama, bukan halaman masuk
    assert.doesNotMatch(fake, /Hubungi nomor ini/);
    const back = await form('/grup', { jid: 'tidak-ada@g.us' }, { cookie });
    const shown = await (await fetch(base + back.headers.get('location'), { headers: { cookie } })).text();
    assert.match(shown, /Gagal: grup tidak ditemukan/);

    // API mode develop: token benar tetap ditolak bila datang lewat reverse proxy
    const { config } = await import('../src/config.js');
    const token = fs.readFileSync(path.join(config.dataDir, 'api-token'), 'utf8');
    assert.equal((await fetch(`${base}/api/status`, { headers: { 'x-bot-token': token } })).status, 200);
    assert.equal((await fetch(`${base}/api/status`, { headers: { 'x-bot-token': token, 'x-forwarded-for': '203.0.113.9' } })).status, 403);

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

test('jam aman: ✅ sepanjang hari, ⚠️ sebagian, ⛔ tidak ada', () => {
  const day = (...descs) => ({ place: 'Selopamioro', days: { '2026-11-14': descs.map((d, i) => slot(6 + 3 * i, d)) } });
  assert.match(morningMessage(day('Cerah', 'Cerah', 'Berawan', 'Cerah'), '2026-11-14'), /✅ \*JAM AMAN KE LADANG\*\n\*06\.00-18\.00\*/);
  assert.match(morningMessage(day('Cerah', 'Cerah', 'Hujan Lebat', 'Cerah'), '2026-11-14'), /⚠️ \*JAM AMAN KE LADANG\*/);
  const none = morningMessage(day('Hujan Petir', 'Hujan Sedang', 'Hujan Lebat', 'Hujan Sedang'), '2026-11-14');
  assert.match(none, /⛔ \*JAM AMAN KE LADANG\*/);
  assert.match(none, /jauhi pohon tinggi/);
});
