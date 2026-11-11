import './setup.js'; // harus paling awal: pengaturan bawaan dan folder data sementara
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCall } from '../src/commands.js';

const day = '2026-10-25'; // Minggu

test('panggilan dikenali hanya bila diawali sapaan dan nama bot', () => {
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
  // Nomor bot di-tag lebih dulu
  assert.deepEqual(parseCall('@6281234567890 halo tani besok', 'tani', day), { kind: 'day', offset: 1 });
  assert.equal(parseCall('@6281234567890 besok hujan?', 'tani', day), null);
});

test('pertanyaan bebas: hari dan tanggal dikenali sendiri, termasuk bahasa Jawa', () => {
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
    'halo tani apa kabar': { kind: 'unknown', question: 'apa kabar' },
    'Hallo tani lusa': { kind: 'day', offset: 2 },
    'hai tani besok': { kind: 'day', offset: 1 },
  };
  for (const [text, expected] of Object.entries(cases)) assert.deepEqual(parseCall(text, 'tani', day), expected, text);
  assert.equal(parseCall('halo tanih besok', 'tani', day), null);
});

test('salah ketik ringan tetap dikenali; menyapa orang lain dan kata sehari-hari tidak', () => {
  const cases = {
    'hlo tani besok': { kind: 'day', offset: 1 },
    'Haloo tanii lusa': { kind: 'day', offset: 2 },
    'halo tnai besk': { kind: 'day', offset: 1 },
    'halo tani bsok hujan ga': { kind: 'day', offset: 1 },
    'halo tani lsa': { kind: 'day', offset: 2 },
    'halo tani kamsi': { kind: 'day', offset: 4 },
    'halo tani sbtu': { kind: 'day', offset: 6 },
    'halo tani ujan ga': { kind: 'day', offset: 0 },
    'halo tani makasi': { kind: 'thanks' },
    'halo tani tgl 1 nopember': { kind: 'day', offset: 7 },
  };
  for (const [text, expected] of Object.entries(cases)) assert.deepEqual(parseCall(text, 'tani', day), expected, text);
  // Menyapa orang bernama mirip, bukan bot
  for (const text of ['halo tari besok', 'halo dani besok', 'halo tina lusa']) assert.equal(parseCall(text, 'tani', day), null, text);
  // Kata sehari-hari tidak dibetulkan menjadi nama hari atau cuaca
  assert.equal(parseCall('halo tani kami mau tanya harga pupuk', 'tani', day).kind, 'unknown');
  assert.equal(parseCall('halo tani harga cabai merah dan terong', 'tani', day).kind, 'unknown');
  assert.deepEqual(parseCall('halo tani hujan abu', 'tani', day), { kind: 'day', offset: 0 });
});

test('nomor bot di-tag: tanpa "halo tani" tetap dijawab; tanpa tag tidak', () => {
  const tagged = (text) => parseCall(text, 'tani', day, { mentioned: true });
  assert.deepEqual(tagged('@6281234567890 besok hujan ga?'), { kind: 'day', offset: 1 });
  assert.deepEqual(tagged('lusa gimana @90207751786598'), { kind: 'day', offset: 2 });
  assert.deepEqual(tagged('@6281234567890 halo, sabtu?'), { kind: 'day', offset: 6 });
  assert.deepEqual(tagged('@6281234567890 halo tani besok'), { kind: 'day', offset: 1 });
  assert.deepEqual(tagged('@6281234567890'), { kind: 'day', offset: 0 });
  assert.deepEqual(tagged('@6281234567890 pesan pecel lele 1'), { kind: 'unknown', question: 'pesan pecel lele 1' });
  // Orang lain yang di-tag, bukan bot
  assert.equal(parseCall('@6281234567890 besok hujan ga?', 'tani', day), null);
});
