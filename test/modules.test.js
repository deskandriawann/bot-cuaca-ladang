import './setup.js'; // harus paling awal: pengaturan bawaan dan folder data sementara
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Semua modul bisa dimuat: menangkap jalur impor yang salah setelah berkas dipindah, tanpa menyalakan bot.
// index.js dilewati (menyalakan bot), begitu juga skrip browser di static/.
const src = new URL('../src/', import.meta.url);
const modules = fs.readdirSync(src, { recursive: true })
  .map((file) => file.replaceAll('\\', '/'))
  .filter((file) => file.endsWith('.js') && file !== 'index.js' && !file.includes('static/'));

test('semua modul di src/ bisa dimuat', async () => {
  assert.ok(modules.length > 15, `hanya ${modules.length} modul ditemukan`);
  for (const file of modules) {
    await assert.doesNotReject(import(new URL(file, src).href), file);
  }
});
