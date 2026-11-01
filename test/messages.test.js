import './setup.js'; // harus paling awal: pengaturan bawaan dan folder data sementara
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morningMessage, updateMessage, rainSoonMessage } from '../src/messages.js';
import { bmkg, tomorrow, slot } from './helpers.js';

test('ringkasan pagi memuat bagian penting', () => {
  const text = morningMessage(bmkg, tomorrow);
  for (const part of ['Selamat pagi', 'JAM AMAN KE LADANG', 'Pagi (06-12)', '☔', '⚡', '💨 Angin', '💡 *Saran*', '💦', 'Sumber: BMKG']) {
    assert.ok(text.includes(part), `tidak ada "${part}"\n${text}`);
  }
});

test('salam ringkasan mengikuti jam kirim', () => {
  assert.match(morningMessage(bmkg, tomorrow), /^Selamat pagi, /m);
  assert.match(morningMessage(bmkg, tomorrow, 13), /^Selamat siang, /m);
  assert.match(morningMessage(bmkg, tomorrow, 17), /^Selamat sore, /m);
  assert.match(morningMessage(bmkg, tomorrow, 19), /^Selamat malam, /m);
});

test('jam aman: ✅ sepanjang hari, ⚠️ sebagian, ⛔ tidak ada', () => {
  const day = (...descs) => ({ place: 'Selopamioro', days: { '2026-11-14': descs.map((d, i) => slot(6 + 3 * i, d)) } });
  assert.match(morningMessage(day('Cerah', 'Cerah', 'Berawan', 'Cerah'), '2026-11-14'), /✅ \*JAM AMAN KE LADANG\*\n\*06\.00-18\.00\*/);
  assert.match(morningMessage(day('Cerah', 'Cerah', 'Hujan Lebat', 'Cerah'), '2026-11-14'), /⚠️ \*JAM AMAN KE LADANG\*/);
  const none = morningMessage(day('Hujan Petir', 'Hujan Sedang', 'Hujan Lebat', 'Hujan Sedang'), '2026-11-14');
  assert.match(none, /⛔ \*JAM AMAN KE LADANG\*/);
  assert.match(none, /jauhi pohon tinggi/);
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

test('pemberitahuan perubahan menyebut bahaya baru', () => {
  const text = updateMessage('Selopamioro', [slot(12, 'Hujan Lebat'), slot(15, 'Cerah')], ['2026-11-14 12 hujan_lebat'], '10.05');
  assert.match(text, /Hujan lebat sekitar pukul 12\.00/);
  assert.match(text, /JAM AMAN TERSISA\*\n\*15\.00-18\.00\*/);
});

test('pengingat hujan lebat: menjelang turun dan sudah masuk jamnya', () => {
  const heavy = { ...slot(15, 'Hujan Lebat'), rainChance: 85 };
  assert.match(rainSoonMessage('Selopamioro', heavy, 14, '14.10'), /HUJAN LEBAT SEBENTAR LAGI[\s\S]*mulai sekitar pukul 15\.00 \(peluang 85%\)/);
  assert.match(rainSoonMessage('Selopamioro', heavy, 15, '15.10'), /turun sejak sekitar pukul 15\.00/);
});
