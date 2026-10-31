// Penyimpanan sesi WhatsApp (perangkat tertaut) di folder data/auth, pengganti useMultiFileAuthState
// bawaan Baileys dengan nama dan format berkas yang sama, sehingga sesi lama tetap terbaca. Bedanya:
// - setiap berkas ditulis atomik (tulis ke berkas sementara, lalu ganti nama), jadi program yang
//   dihentikan atau crash saat menulis tidak meninggalkan berkas terpotong;
// - creds.json yang rusak dilaporkan sebagai galat, tidak diam-diam diganti identitas baru
//   (identitas baru berarti harus menautkan ulang, padahal di HP perangkatnya masih tercantum).
import fs from 'node:fs/promises';
import path from 'node:path';
import { initAuthCreds, BufferJSON, proto } from 'baileys';

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

export async function useSafeAuthState(folder) {
  await fs.mkdir(folder, { recursive: true });
  // Sisa berkas sementara dari penulisan yang terhenti tidak pernah menjadi berkas sesi
  for (const name of await fs.readdir(folder)) {
    if (name.endsWith('.tmp')) await fs.rm(path.join(folder, name), { force: true });
  }

  // Antrean per berkas: operasi pada berkas yang sama dijalankan berurutan
  const pending = new Map();
  const queue = (name, op) => {
    const run = (pending.get(name) ?? Promise.resolve()).then(op, op);
    const settled = run.catch(() => {});
    pending.set(name, settled);
    settled.then(() => {
      if (pending.get(name) === settled) pending.delete(name);
    });
    return run;
  };

  const fileOf = (name) => path.join(folder, name.replace(/\//g, '__').replace(/:/g, '-'));
  let tmpCounter = 0;

  const write = (name, value) => queue(name, async () => {
    const target = fileOf(name);
    const tmp = `${target}.${process.pid}.${++tmpCounter}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, BufferJSON.replacer));
    await renameWithRetry(tmp, target);
  });

  const remove = (name) => queue(name, () => fs.rm(fileOf(name), { force: true }));

  const read = (name) => queue(name, async () => {
    let text;
    try {
      text = await fs.readFile(fileOf(name), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    return JSON.parse(text, BufferJSON.reviver);
  });

  let creds;
  try {
    creds = await read('creds.json');
  } catch (err) {
    throw new Error(`Berkas sesi creds.json rusak (${err.message}). Sesi tidak bisa dipakai; tautkan ulang.`);
  }
  creds ??= initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            // Kunci yang tidak terbaca diperlakukan seperti tidak ada, sama dengan perilaku bawaan Baileys
            let value = await read(`${type}-${id}.json`).catch(() => null);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const name = `${category}-${id}.json`;
              tasks.push(value ? write(name, value) : remove(name));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write('creds.json', creds),
    /** Menunggu semua penulisan yang sedang berjalan selesai (dipakai saat program berhenti). */
    flush: async () => {
      while (pending.size > 0) await Promise.all([...pending.values()]);
    },
  };
}

async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      // Di Windows, antivirus atau pengindeks berkas kadang mengunci berkas sesaat
      if (!RETRY_CODES.has(err.code) || attempt >= 5) {
        await fs.rm(from, { force: true });
        throw err;
      }
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}
