import './setup.js'; // harus paling awal: pengaturan bawaan dan folder data sementara
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertKeys, fieldSlots, hazardsOf, withRainChance } from '../src/weather/analysis.js';
import { bmkg, dates, slot } from './helpers.js';

test('BMKG dikelompokkan per tanggal WIB dan urut per jam', () => {
  assert.equal(bmkg.place, 'Selopamioro');
  assert.ok(dates.length >= 3);
  for (const slots of Object.values(bmkg.days)) {
    assert.deepEqual(slots.map((s) => s.hour), [...slots.map((s) => s.hour)].sort((a, b) => a - b));
  }
});

test('jam slot BMKG yang bergeser (05, 08, 11, 14, 17) tetap dihitung jam kerja', () => {
  const shifted = [
    slot(2, 'Hujan Lebat'), slot(5, 'Berawan'), slot(8, 'Cerah'), slot(11, 'Hujan Lebat'),
    slot(14, 'Berawan'), slot(17, 'Cerah'), slot(20, 'Hujan Petir'),
  ];
  assert.deepEqual(fieldSlots(shifted).map((s) => s.hour), [5, 8, 11, 14, 17]);
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
