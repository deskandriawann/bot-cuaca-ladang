import './setup.js'; // harus paling awal: pengaturan bawaan dan folder data sementara
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { acquireLock, releaseLock } from '../src/lock.js';
import { useSafeAuthState } from '../src/whatsapp/auth-store.js';

test('sesi WhatsApp ditulis atomik dan tetap terbaca setelah program berhenti', async () => {
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

test('hanya satu bot per folder data', () => {
  const file = path.join(config.dataDir, 'bot.lock');
  fs.mkdirSync(config.dataDir, { recursive: true });

  fs.writeFileSync(file, String(process.ppid)); // proses induk masih hidup: dianggap bot lain
  assert.throws(() => acquireLock(), /sudah berjalan/);

  fs.writeFileSync(file, '999999'); // proses tidak ada: kunci basi dari bot yang crash
  acquireLock();
  assert.equal(fs.readFileSync(file, 'utf8'), String(process.pid));
  releaseLock();
  assert.ok(!fs.existsSync(file));

  // PID hidup tapi kunci tidak diperbarui lagi: nomor PID bot lama sudah dipakai program lain (terjadi di Windows)
  fs.writeFileSync(file, String(process.ppid));
  const old = new Date(Date.now() - 5 * 60_000);
  fs.utimesSync(file, old, old);
  acquireLock();
  assert.equal(fs.readFileSync(file, 'utf8'), String(process.pid));
  releaseLock();
});
