// Mengirim perubahan kode ke server: periksa kode, simpan (commit), unggah ke GitHub, lalu server mengambilnya
// dan menyalakan ulang bot. Bot di laptop tidak ikut dijalankan.
// Pakai: npm run kirim                                (pesan perubahan ditanyakan bila ada yang belum di-commit)
//        npm run kirim -- "pesan singkat perubahan"   (pesan langsung ditulis; perhatikan spasi sesudah --)
// Server dipanggil lewat alias SSH di ~/.ssh/config. Bawaan: infocuacatani, folder ~/bot-cuaca
// (ganti dengan DEPLOY_HOST dan DEPLOY_DIR bila servernya lain).
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';

const host = process.env.DEPLOY_HOST || 'infocuacatani';
const dir = process.env.DEPLOY_DIR || '~/bot-cuaca';
let message = process.argv.slice(2).join(' ').trim();

function stop(text) {
  console.error(`\n❌ ${text}`);
  process.exit(1);
}

/** Menjalankan perintah; quiet = keluarannya diambil, bukan ditampilkan. */
function run(cmd, args, { quiet = false, shell = false } = {}) {
  const result = spawnSync(cmd, args, { stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', shell });
  if (result.error) stop(`Perintah ${cmd} tidak bisa dijalankan: ${result.error.message}`);
  return { ok: result.status === 0, code: result.status, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() };
}

const git = (...args) => run('git', args, { quiet: true });
const step = (text) => console.log(`\n▶ ${text}`);

// 1. Hanya dari cabang main, dan perubahan yang belum disimpan perlu pesan (ditanyakan bila belum ditulis)
const branch = git('rev-parse', '--abbrev-ref', 'HEAD').out;
if (branch !== 'main') stop(`Sedang di cabang "${branch}". Pindah dulu ke main: git checkout main`);
const changes = git('status', '--porcelain').out;
if (changes && !message) {
  console.log(`Ada perubahan yang belum disimpan:\n ${changes}`);
  if (process.stdin.isTTY) {
    const ask = readline.createInterface({ input: process.stdin, output: process.stdout });
    message = (await ask.question('\nTulis pesan singkat perubahannya, lalu tekan Enter: ')).trim();
    ask.close();
  }
  if (!message) stop('Pesan perubahan masih kosong. Ulangi, misalnya:\n   npm run kirim -- "Ganti kalimat jawaban terima kasih"');
}

// 2. Periksa kode lebih dulu: kode yang gagal pemeriksaan tidak sampai ke server
step('Memeriksa kode (lint, tes, keamanan paket)...');
const check = run('npm run check', [], { shell: true, quiet: true });
if (!check.ok) {
  // Hanya bagian yang gagal yang ditampilkan, bukan seluruh daftar tes
  const failed = `${check.out}\n${check.err}`.split('\n').filter((line) => !/^\s*(ok \d|#|---|\.\.\.|duration_ms)/.test(line));
  console.log(failed.slice(-40).join('\n'));
  stop('Pemeriksaan gagal. Perbaiki dulu; server tidak diubah.');
}
console.log('Semua pemeriksaan lolos.');

// 3. Simpan dan unggah ke GitHub (.env dan data/ tidak ikut, sudah dikecualikan di .gitignore)
if (changes) {
  step('Menyimpan perubahan...');
  if (!git('add', '-A').ok) stop('Gagal menyiapkan perubahan (git add).');
  const commit = git('commit', '-m', message);
  if (!commit.ok) stop(`Gagal menyimpan perubahan (git commit):\n${commit.out || commit.err}`);
  console.log(git('log', '--oneline', '-1').out);
}
step('Mengunggah ke GitHub...');
const push = git('push', 'origin', 'main');
if (!push.ok) {
  stop(`Gagal mengunggah ke GitHub:\n${push.err}\n\nBila GitHub punya perubahan yang belum ada di laptop, ambil dulu: git pull, lalu ulangi.`);
}

// 4. Server mengambil versi terbaru. Menyala ulang = menyambung ulang ke WhatsApp, jadi dilewati bila tidak ada yang baru
const local = git('rev-parse', 'HEAD').out;
step(`Menghubungi server (${host})...`);
const current = run('ssh', ['-o', 'ConnectTimeout=20', host, `git -C ${dir} rev-parse HEAD`], { quiet: true });
if (!current.ok) stop(`Server tidak bisa dihubungi lewat SSH:\n${current.err}\n\nCoba: ssh ${host}`);
if (current.out === local) {
  console.log('\n✅ Server sudah memakai versi terbaru. Bot tidak perlu dinyalakan ulang.');
  process.exit(0);
}

step('Server mengambil versi terbaru (bila kode bot berubah, bot dinyalakan ulang: sekitar 1 menit)...');
// Kode keluar: 0 tersambung ke WhatsApp, 3 bot mati, 4 menyala tapi belum tersambung,
// 5 hanya dokumen/skrip/tes yang berubah (bot tidak perlu menyambung ulang ke WhatsApp)
const remote = `set -e
cd ${dir}
before=$(git rev-parse HEAD)
git pull -q --ff-only
git log --oneline -1
if ! git diff --name-only "$before" HEAD | grep -qE '^(src/|assets/|deploy/|package(-lock)?\\.json$)'; then exit 5; fi
if ! git diff --quiet "$before" HEAD -- package.json package-lock.json; then
  echo "Memasang ulang paket..."
  npm ci --omit=dev --no-audit --no-fund --loglevel=error
fi
if ! git diff --quiet "$before" HEAD -- deploy/bot-cuaca.service; then
  sudo cp deploy/bot-cuaca.service /etc/systemd/system/ && sudo systemctl daemon-reload
fi
started=$(date +%s)
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
const deploy = run('ssh', ['-o', 'ConnectTimeout=20', host, remote]);
if (deploy.code === 0) {
  console.log('\n✅ Selesai. Server memakai versi terbaru dan bot sudah tersambung ke WhatsApp.');
} else if (deploy.code === 3) {
  stop(`Bot mati setelah dinyalakan ulang. Lihat lognya di atas, atau: ssh ${host} "journalctl -u bot-cuaca -n 50"`);
} else if (deploy.code === 5) {
  console.log('\n✅ Selesai. Yang berubah hanya dokumen atau skrip, jadi bot tidak perlu dinyalakan ulang.');
} else if (deploy.code === 4) {
  console.log('\n⚠️ Kode sudah terpasang dan bot menyala, tetapi belum tersambung ke WhatsApp dalam 90 detik.\n' +
    '   Lihat halaman pengelola beberapa menit lagi. Bila tertulis WhatsApp memutus bot, ikuti petunjuk di sana.');
} else {
  stop(`Server gagal mengambil versi terbaru (kode ${deploy.code}). Lihat pesan di atas.`);
}
