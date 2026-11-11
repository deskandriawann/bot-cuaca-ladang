import './setup.js'; // harus paling awal: pengaturan bawaan dan folder data sementara
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayDetailMessage, morningMessage, notUnderstoodAgainMessage, rainSoonMessage, unknownMessage, updateMessage,
} from '../src/messages.js';
import { bmkg, tomorrow, slot } from './helpers.js';

test('ringkasan pagi memuat bagian penting', () => {
  const text = morningMessage(bmkg, tomorrow);
  for (const part of ['Selamat pagi', 'Pagi (06-12)', '☔', '⚡', '💨 Angin', 'Sumber: BMKG']) {
    assert.ok(text.includes(part), `tidak ada "${part}"\n${text}`);
  }
  assert.doesNotMatch(text, /JAM AMAN/);
});

test('hujan malam ikut dilaporkan: siram sore lalu hujan pukul 21.00', () => {
  const slots = [slot(6, 'Cerah'), slot(9, 'Cerah'), slot(12, 'Berawan'), slot(15, 'Berawan'), slot(18, 'Berawan'),
    { ...slot(21, 'Hujan Sedang'), rainChance: 80 }];
  const text = morningMessage({ place: 'Selopamioro', days: { '2026-11-14': slots } }, '2026-11-14');
  assert.match(text, /🌙 Malam \(18-24\): 🌧️ Hujan sedang/);
  assert.match(text, /POTENSI HUJAN[\s\S]*Hujan sedang\* sekitar pukul 21\.00 \(peluang 80%\)/);
  assert.doesNotMatch(text, /Hujan: tidak ada/);
  // Tanpa data tanggal berikutnya: tidak ada baris dini hari
  assert.doesNotMatch(text, /Dini hari/);

  // Malam kering tidak disebut, agar pesan tetap pendek
  const dry = morningMessage({ place: 'Selopamioro', days: { '2026-11-14': [...slots.slice(0, 5), slot(21, 'Berawan')] } }, '2026-11-14');
  assert.doesNotMatch(dry, /Malam|21\.00/);
  assert.match(dry, /☔ Hujan: tidak ada/);
});

test('hujan dini hari nanti dilaporkan dengan jamnya ("dini hari" agar tidak tertukar dengan pagi tadi); yang kering tidak', () => {
  const next = (hour, desc, rainChance) => ({ ...slot(hour, desc), date: '2026-11-15', rainChance });
  const bmkg = {
    place: 'Selopamioro',
    days: {
      '2026-11-14': [slot(0, 'Hujan Lebat'), slot(6, 'Cerah'), slot(12, 'Berawan'), slot(18, 'Berawan'), slot(21, 'Berawan')],
      '2026-11-15': [next(0, 'Berawan', 20), next(3, 'Hujan Sedang', 85), next(6, 'Cerah', 10)],
    },
  };
  const morning = morningMessage(bmkg, '2026-11-14');
  assert.match(morning, /🌌 Dini hari nanti \(00-06\): 🌧️ Hujan sedang/);
  assert.match(morning, /POTENSI HUJAN\*\n🌧️ \*Hujan sedang\* sekitar pukul 03\.00 dini hari \(peluang 85%\)/);
  // Hujan lebat pukul 00.00 tadi (sebelum ringkasan dikirim) tidak disebut; malam kering juga tidak
  assert.doesNotMatch(morning, /Hujan lebat|Malam/);

  // Rincian sampai pukul 18.00, lalu hanya jam malam dan dini hari yang hujan
  const detail = dayDetailMessage(bmkg, '2026-11-14', 0);
  assert.match(detail, /\*18\.00\* {2}.*\n\*03\.00 dini hari\* {2}🌧️ Hujan sedang/);
  assert.doesNotMatch(detail, /\*21\.00\*|00\.00 dini hari|06\.00 dini hari/);

  const update = updateMessage('Selopamioro', [{ ...next(3, 'Hujan Lebat', 90), lateNight: true }], ['2026-11-15 3 hujan_lebat'], '15.10');
  assert.match(update, /Hujan lebat sekitar pukul 03\.00 dini hari \(peluang 90%\)/);
});

test('salam ringkasan mengikuti jam kirim', () => {
  assert.match(morningMessage(bmkg, tomorrow), /^Selamat pagi, /m);
  assert.match(morningMessage(bmkg, tomorrow, 13), /^Selamat siang, /m);
  assert.match(morningMessage(bmkg, tomorrow, 17), /^Selamat sore, /m);
  assert.match(morningMessage(bmkg, tomorrow, 19), /^Selamat malam, /m);
});

test('pesan hanya berisi informasi, tanpa saran', () => {
  const day = (...descs) => ({ place: 'Selopamioro', days: { '2026-11-14': descs.map((d, i) => slot(6 + 3 * i, d)) } });
  const stormy = morningMessage(day('Hujan Petir', 'Hujan Sedang', 'Hujan Lebat', 'Hujan Sedang'), '2026-11-14');
  assert.match(stormy, /⚡ Petir sekitar pukul 06\.00/);
  const heavy = { ...slot(15, 'Hujan Lebat'), rainChance: 85 };
  const texts = [
    stormy,
    morningMessage(day('Cerah', 'Cerah', 'Berawan', 'Cerah'), '2026-11-14'),
    updateMessage('Selopamioro', [slot(12, 'Hujan Petir')], ['2026-11-14 12 petir'], '10.05'),
    rainSoonMessage('Selopamioro', heavy, 14, '14.10'),
  ];
  for (const text of texts) assert.doesNotMatch(text, /Saran|berteduh|jauhi pohon|menyemprot|jas hujan|tunda ke ladang/);
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

  const sure = morningMessage(day(85), '2026-11-14');
  assert.match(sure, /⚠️ \*POTENSI HUJAN\*\n🌧️ \*Hujan sedang\* sekitar pukul 15\.00 \(peluang 85%\)/);
  assert.match(sure, /☔ Hujan ringan sekitar pukul 12\.00 \(peluang 90%\)/);
});

test('pemberitahuan perubahan menyebut bahaya baru', () => {
  const text = updateMessage('Selopamioro', [slot(12, 'Hujan Lebat'), slot(15, 'Cerah')], ['2026-11-14 12 hujan_lebat'], '10.05');
  assert.match(text, /Hujan lebat sekitar pukul 12\.00/);
  assert.doesNotMatch(text, /JAM AMAN/);
});

test('pengingat hujan lebat: menjelang turun dan sudah masuk jamnya', () => {
  const heavy = { ...slot(15, 'Hujan Lebat'), rainChance: 85 };
  assert.match(rainSoonMessage('Selopamioro', heavy, 14, '14.10'), /HUJAN LEBAT SEBENTAR LAGI[\s\S]*mulai sekitar pukul 15\.00 \(peluang 85%\)/);
  assert.match(rainSoonMessage('Selopamioro', heavy, 15, '15.10'), /turun sejak sekitar pukul 15\.00/);
});

test('pertanyaan yang tidak dipahami diulang di jawaban, tanpa tautan dan tanda format', () => {
  const text = unknownMessage('2026-11-14', 'pesan pecel lele 1');
  assert.match(text, /“pesan pecel lele 1”/);
  assert.match(text, /Bot hanya bisa menjawab soal cuaca/);
  assert.match(text, /CARA BERTANYA/);

  const tricky = unknownMessage('2026-11-14', 'cek *promo* di https://contoh.id/x ya');
  assert.doesNotMatch(tricky, /https?:|\*promo\*/);
  assert.match(tricky, /“cek promo di ya”/);
  assert.match(unknownMessage('2026-11-14', 'a'.repeat(100)), /“a{57}\.\.\.”/);
  assert.match(notUnderstoodAgainMessage('2026-11-14', '07.10', 'pesan pecel lele 1'), /pesan pecel lele 1/);
});
