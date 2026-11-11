// Bagian bersama npm run kirim dan npm run kirim-env: alamat server, menjalankan perintah, dan menyalakan ulang bot.
// Server dipanggil lewat alias SSH di ~/.ssh/config. Bawaan: infocuacatani, folder ~/bot-cuaca
// (ganti dengan DEPLOY_HOST dan DEPLOY_DIR bila servernya lain).
import { spawnSync } from 'node:child_process';

export const host = process.env.DEPLOY_HOST || 'infocuacatani';
export const dir = process.env.DEPLOY_DIR || '~/bot-cuaca';

export function stop(text) {
  console.error(`\n❌ ${text}`);
  process.exit(1);
}

/** Menjalankan perintah; quiet = keluarannya diambil, bukan ditampilkan; input = isi yang dikirim ke perintah. */
export function run(cmd, args, { quiet = false, shell = false, input } = {}) {
  const stdin = input != null ? 'pipe' : quiet ? 'ignore' : 'inherit';
  const output = quiet ? 'pipe' : 'inherit';
  const result = spawnSync(cmd, args, { stdio: [stdin, output, output], input, encoding: 'utf8', shell });
  if (result.error) stop(`Perintah ${cmd} tidak bisa dijalankan: ${result.error.message}`);
  return { ok: result.status === 0, code: result.status, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() };
}

export const ssh = (command, options) => run('ssh', ['-o', 'ConnectTimeout=20', host, command], options);
export const step = (text) => console.log(`\n▶ ${text}`);

/**
 * Perintah di server (dari folder bot): nyalakan ulang bot, lalu tunggu sampai tersambung lagi ke WhatsApp,
 * paling lama 90 detik. Kode keluar: 0 tersambung, 3 bot mati, 4 menyala tapi belum tersambung.
 */
export const RESTART_AND_WAIT = `started=$(date +%s)
sudo systemctl restart bot-cuaca
for i in $(seq 1 18); do
  sleep 5
  if ! systemctl is-active --quiet bot-cuaca; then journalctl -u bot-cuaca -n 15 --no-pager -o cat; exit 3; fi
  if node -e 'const s = JSON.parse(require("fs").readFileSync("data/state.json", "utf8"));
    const last = (s.log || []).find((e) => e.kind === "sambungan" || e.kind === "nomor");
    process.exit(last && Date.parse(last.at) / 1000 >= Number(process.argv[1]) && /Tersambung/.test(last.detail) ? 0 : 1);' "$started"; then
    exit 0
  fi
done
exit 4`;

/** Pesan akhir untuk kode keluar RESTART_AND_WAIT. done: yang sudah selesai, misalnya 'Server memakai versi terbaru'. */
export function reportRestart(code, done) {
  if (code === 0) {
    console.log(`\n✅ Selesai. ${done} dan bot sudah tersambung ke WhatsApp.`);
  } else if (code === 3) {
    stop(`Bot mati setelah dinyalakan ulang. Lihat lognya di atas, atau: ssh ${host} "journalctl -u bot-cuaca -n 50"`);
  } else if (code === 4) {
    console.log(`\n⚠️ ${done} dan bot menyala, tetapi belum tersambung ke WhatsApp dalam 90 detik.\n` +
      '   Lihat halaman pengelola beberapa menit lagi. Bila tertulis WhatsApp memutus bot, ikuti petunjuk di sana.');
  } else {
    stop(`Perintah di server gagal (kode ${code}). Lihat pesan di atas.`);
  }
}
