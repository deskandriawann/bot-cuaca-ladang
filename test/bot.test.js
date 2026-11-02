import './setup.js'; // harus paling awal: pengaturan bawaan dan folder data sementara
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { morningMessage } from '../src/messages.js';
import { updateState } from '../src/store.js';
import { nowWib } from '../src/time.js';
import { answer } from '../src/bot/replies.js';
import { botSend, limitReason, linkPhase, sendLimits } from '../src/bot/send.js';
import { pendingAlerts } from '../src/bot/alerts.js';
import { morningAt, morningDue, parseScheduleTime, stableJitter } from '../src/bot/schedule.js';
import { bmkg, om, today, tomorrow, dayAfter, offline, sources, slot } from './helpers.js';

test('waktu WIB = UTC+7', () => {
  assert.deepEqual(nowWib(new Date('2026-10-24T22:30:00Z')), { date: '2026-10-25', hour: 5, minute: 30, hhmm: '05.30' });
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

test('pesan otomatis tanpa tautan (tautan = sinyal spam); kirim manual boleh', async () => {
  const morning = morningMessage(bmkg, tomorrow);
  const outlook = await answer({ kind: 'outlook' }, today, sources);
  const detail = await answer({ kind: 'day', offset: 1 }, today, sources);
  for (const text of [morning, outlook, detail]) assert.doesNotMatch(text, /https?:\/\//);
  assert.match(await answer({ kind: 'help' }, today, sources), /deskripsi grup/);
});

test('tahap nomor: tenang, pemanasan, lalu normal', () => {
  const linked = Date.parse('2026-11-01T00:00:00Z');
  const hour = 60 * 60 * 1000;
  assert.equal(linkPhase(null, linked).phase, 'normal');
  assert.equal(linkPhase(new Date(linked).toISOString(), linked + 1 * hour).phase, 'tenang');
  assert.equal(linkPhase(new Date(linked).toISOString(), linked + 25 * hour).phase, 'pemanasan');
  assert.equal(linkPhase(new Date(linked).toISOString(), linked + (24 + 7 * 24 + 1) * hour).phase, 'normal');
  assert.ok(sendLimits('pemanasan').perHour < sendLimits('normal').perHour);
});

test('batas kirim per jam (lebih ketat saat pemanasan) dan per hari', () => {
  const now = Date.parse('2026-11-02T05:00:00Z'); // 12.00 WIB
  const minutesAgo = (m) => now - m * 60_000;
  const today = { date: '2026-11-02', count: 3 };

  // Pemanasan: 3 pesan dalam 1 jam terakhir → tunggu sampai pesan tertua lewat 1 jam (12.50 WIB)
  const busy = { sent: today, recentSends: [minutesAgo(10), minutesAgo(5), minutesAgo(1)] };
  assert.match(limitReason(busy, 'pemanasan', now), /3 pesan dalam 1 jam terakhir\. Bisa mengirim lagi pukul 12\.50 WIB/);
  // Pesan yang sudah lewat 1 jam tidak dihitung: pagi yang ramai tidak membuat bot diam sampai besok
  assert.equal(limitReason({ sent: today, recentSends: [minutesAgo(400), minutesAgo(300), minutesAgo(61)] }, 'pemanasan', now), null);
  // Setelah pemanasan batas per jam lebih longgar
  assert.equal(limitReason(busy, 'normal', now), null);
  // Batas harian tetap berlaku
  assert.match(limitReason({ sent: { date: '2026-11-02', count: 40 }, recentSends: [] }, 'normal', now), /sudah mengirim 40 pesan/);
});

test('bot menolak mengirim ke selain grup penerima, tanpa menghitung pesan', async () => {
  await assert.rejects(botSend('120363000000000000@g.us', 'halo'), (err) => err.notSent === true);
});

test('hujan lebat pasti: diumumkan saat muncul, lalu diingatkan sekali menjelang turun', () => {
  const heavy = { ...slot(15, 'Hujan Lebat'), rainChance: 85 };
  const announced = ['2026-11-14 15 hujan_lebat'];
  assert.deepEqual(pendingAlerts([{ ...heavy, rainChance: 40 }], [], 14), { fresh: [], soon: null });
  assert.deepEqual(pendingAlerts([heavy], [], 10), { fresh: announced, soon: null });
  assert.equal(pendingAlerts([heavy], announced, 14).soon, heavy);
  assert.equal(pendingAlerts([heavy], announced, 15).soon, heavy);
  assert.equal(pendingAlerts([heavy], [...announced, '2026-11-14 15 segera'], 15).soon, null);
  // Hujan sedang tidak dikirim ulang walau pasti
  assert.deepEqual(pendingAlerts([{ ...slot(15, 'Hujan Sedang'), rainChance: 90 }], [], 14), { fresh: [], soon: null });
});

test('menit kirim diacak per hari tapi tetap sama untuk hari yang sama', () => {
  const minutes = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((d) => stableJitter(d, 15));
  assert.ok(minutes.every((m) => m >= 0 && m < 15));
  assert.ok(new Set(minutes).size > 1);
  assert.equal(stableJitter('2026-11-01', 15), minutes[0]);
});

test('jadwal ringkasan pagi: sejak menit acaknya sampai 4 jam setelah jadwal, bisa diatur sampai menitnya', () => {
  const date = '2026-11-14';
  const at = (minutes) => ({ date, hour: Math.floor(minutes / 60), minute: minutes % 60 });

  // Bawaan: 05.00 ditambah menit acak 0-14, terlambat menyala masih dikirim sampai sebelum 09.00
  const due = morningAt(date);
  assert.ok(due >= 5 * 60 && due < 5 * 60 + 15);
  assert.equal(morningDue(at(due - 1)), false);
  assert.equal(morningDue(at(due)), true);
  assert.equal(morningDue(at(8 * 60 + 59)), true);
  assert.equal(morningDue(at(9 * 60)), false);

  // Uji jadwal sore: MORNING_HOUR=17, MORNING_MINUTE=50, MORNING_JITTER_MIN=0
  const saved = { ...config };
  Object.assign(config, { morningHour: 17, morningMinute: 50, morningJitterMin: 0 });
  try {
    assert.equal(morningDue(at(17 * 60 + 49)), false);
    assert.equal(morningDue(at(17 * 60 + 50)), true);
    assert.equal(morningDue(at(21 * 60 + 49)), true);
    assert.equal(morningDue(at(21 * 60 + 50)), false);

    // Jam dari halaman pengelola mengalahkan .env
    updateState({ morningSchedule: { hour: 6, minute: 30 } });
    assert.equal(morningDue(at(6 * 60 + 29)), false);
    assert.equal(morningDue(at(6 * 60 + 30)), true);
    assert.equal(morningDue(at(17 * 60 + 50)), false);
  } finally {
    Object.assign(config, saved);
    updateState({ morningSchedule: null });
  }
});

test('jam kirim dari pengurus: hanya jam yang wajar dan di dalam batas', () => {
  assert.equal(parseScheduleTime('06:30'), 6 * 60 + 30);
  assert.equal(parseScheduleTime('6.30'), 6 * 60 + 30);
  assert.equal(parseScheduleTime('21:00'), 21 * 60);
  for (const bad of ['23:30', '02:59', '6:75', 'jam 6', '', undefined]) assert.equal(parseScheduleTime(bad), null, String(bad));
});
