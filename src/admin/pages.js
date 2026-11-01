// Halaman pengelola selain halaman utama: masuk, kirim manual, kode QR penautan, tautkan nomor, dan pilih grup.
import { config } from '../config.js';
import { nowWib } from '../time.js';
import { getState } from '../store.js';
import { wa, isConnected, hasLinkedSession, linkAttemptsLeft, listGroups } from '../whatsapp/connection.js';
import { linkPhase } from '../bot/send.js';
import { buildMorning } from '../bot/morning.js';
import { answer } from '../bot/replies.js';
import { esc, ICONS, flash, hero, page } from './layout.js';
import { nextMorningText, phoneText, statusOf } from './format.js';
import { dashboard } from './dashboard.js';
import { devBridge } from './dev.js';

const manualMode = config.waMode === 'manual';

export function loginPage(error) {
  return page('Masuk', `${flash(error, 'bad')}
<form class="card" method="post" action="/masuk">
<h2>Selamat datang 👋</h2>
<p class="muted">Halaman ini khusus pengurus. Masukkan kata sandi untuk melanjutkan.</p>
<label for="pw">Kata sandi</label>
<input id="pw" type="password" name="password" autocomplete="current-password" required autofocus>
<label class="check"><input type="checkbox" data-show-password="pw"> Tampilkan kata sandi</label>
<button type="submit">Masuk</button>
<p class="muted">Lupa kata sandi? Tanyakan ke pengelola teknis bot.</p></form>`, {
    nav: false,
    hero: hero({ pill: 'Halaman pengurus', title: 'Bot Cuaca Ladang', lead: `Info cuaca harian untuk ${config.groupLabel}, ${config.placeName}.` }),
  });
}

export const MANUAL_TEXTS = {
  pagi: 'Ringkasan hari ini',
  besok: 'Cuaca besok',
  lusa: 'Cuaca lusa',
  '10hari': '10 hari ke depan',
  ...(devBridge ? { menu: 'Menu bantuan' } : {}),
};

/** Teks pesan untuk satu jenis, tanpa tautan (dipakai kirim manual dan kiriman uji lewat bot utama). */
export async function buildText(kind) {
  const today = nowWib().date;
  if (kind === 'pagi') return (await buildMorning(today)).text;
  if (kind === 'menu') return answer({ kind: 'help' }, today);
  return answer(kind === '10hari' ? { kind: 'outlook' } : { kind: 'day', offset: kind === 'besok' ? 1 : 2 }, today);
}

/** Catatan di atas teks ringkasan hari ini: perlu dikirim manual atau tidak. */
function morningNote() {
  const state = getState();
  const status = state.morningSentOn === nowWib().date ? state.morningStatus : null;
  if (status === 'terkirim') return flash('Bot sudah mengirim info cuaca hari ini ke grup. Tidak perlu dikirim lagi.', 'ok');
  if (status === 'gagal') return flash('Bot belum berhasil mengirim info cuaca hari ini. Kirim sendiri lewat tombol di bawah.', 'bad');
  if (status === 'mengirim') return flash('Bot sedang mengirim info cuaca. Tunggu sebentar, lalu muat ulang halaman ini.', 'warn');
  if (isConnected() && state.groupJid && linkPhase().phase !== 'tenang') {
    return flash(`Bot akan mengirim sendiri ${nextMorningText()}. Kirim manual hanya bila bot tidak mengirim.`, 'warn');
  }
  return flash('Bot sedang tidak mengirim sendiri. Kirim info cuaca lewat tombol di bawah.', 'warn');
}

/** Halaman kirim manual: teks siap kirim + tombol wa.me (aplikasi WhatsApp resmi, dikirim oleh manusia). */
export async function manualPage(kind, message) {
  if (!MANUAL_TEXTS[kind]) kind = 'pagi';
  let text;
  try {
    text = await buildText(kind);
  } catch (err) {
    text = `Data cuaca gagal diambil: ${err.message}`;
  }
  // Yang mengirim manusia lewat aplikasi resmi, jadi tautan rincian aman disertakan
  if (config.detailLink && !text.includes(config.detailLink)) text += `\n🔗 Rincian: ${config.detailLink}`;

  const tabs = Object.entries(MANUAL_TEXTS)
    .map(([key, label]) => `<a class="btn${key === kind ? '' : ' alt'}" href="/kirim?jenis=${key}">${esc(label)}</a>`)
    .join(' ');
  return page('Kirim manual', `<h1>Kirim cuaca lewat WhatsApp</h1>
${flash(message, /^Gagal/.test(message ?? '') ? 'bad' : 'ok')}
${!manualMode && kind === 'pagi' ? morningNote() : ''}
<div class="tabs">${tabs}</div>
<section class="card">
<pre id="teks">${esc(text)}</pre>
<div class="actions">
<a class="btn" href="https://wa.me/?text=${encodeURIComponent(text)}">Buka WhatsApp dan pilih grup</a>
<button class="alt" type="button" data-copy="teks" data-copied="tersalin">Salin teks</button> <span id="tersalin" class="ok"></span>
</div>
${devBridge ? `<form method="post" action="/kirim-lewat-bot"><input type="hidden" name="jenis" value="${esc(kind)}">
<button type="submit">Kirim ke grup lewat bot utama</button></form>
<p class="muted">Dikirim oleh bot utama dengan nomor dan sesi yang sama, tanpa tautan rincian (seperti pesan otomatis). Jawaban butuh 10-30 detik.</p>` : ''}
</section>
<ol class="muted">
<li>Ketuk <strong>Buka WhatsApp dan pilih grup</strong>. Bila HP punya dua WhatsApp, pilih yang biasa dipakai di grup.</li>
<li>Pilih grup ${esc(config.groupLabel)}, lalu ketuk kirim.</li>
</ol>
<a class="btn alt" href="/">Kembali</a>`);
}

/** Kode QR penautan; memuat ulang sendiri sampai tersambung, berhenti, atau waktunya habis. */
export function pairingPage() {
  if (wa.status === 'tersambung') {
    return page('Berhasil', `<h1>Nomor berhasil ditautkan</h1>
<section class="card"><p class="ok"><strong>${ICONS.check} Bot tersambung sebagai ${esc(phoneText(wa.phone))}.</strong></p>
<p><strong>Langkah berikutnya:</strong> minta admin grup memasukkan nomor ini ke grup ${esc(config.groupLabel)} (dan mengeluarkan nomor bot lama bila ada). Setelah itu pilih grupnya.</p>
<div class="actions"><a class="btn" href="/grup">${ICONS.users}Lanjut: pilih grup penerima</a><a class="btn alt" href="/">Ke halaman utama</a></div></section>`);
  }
  if (wa.status !== 'menunggu_tautan') {
    return page('Penautan berhenti', `<h1>Penautan berhenti</h1>
${flash(wa.error ?? statusOf(wa.status).text, 'bad')}
<p class="muted">Sisa percobaan hari ini: ${linkAttemptsLeft()}.</p>
<a class="btn" href="/">Kembali</a>`);
  }
  const code = wa.pairingCode ? `${wa.pairingCode.slice(0, 4)}-${wa.pairingCode.slice(4)}` : null;
  return page('Tautkan nomor', `<h1>Tautkan nomor ${esc(phoneText(wa.phone))}</h1>
<section class="card"><h2>Pindai QR (disarankan)</h2>
${wa.qr ? `<img class="qr" src="${esc(wa.qr)}" alt="Kode QR penautan">` : '<p class="warn">Menyiapkan QR…</p>'}
<ol>
<li>Buka halaman ini di laptop atau HP lain.</li>
<li>Di HP bot, buka <strong>WhatsApp Business</strong>, ketuk titik tiga, lalu <strong>Perangkat tertaut</strong>.</li>
<li>Ketuk <strong>Tautkan perangkat</strong>, lalu pindai QR di atas.</li>
</ol></section>
<section class="card"><h2>Hanya punya HP bot?</h2>
${code
    ? `<div class="code">${esc(code)}</div>
<p>Di WhatsApp Business: <strong>Perangkat tertaut</strong>, <strong>Tautkan perangkat</strong>, lalu <strong>Tautkan dengan nomor telepon saja</strong>, dan masukkan kode ini.</p>`
    : `<p class="muted">Pakai kode tautan bila tidak ada perangkat lain untuk menampilkan QR.</p>
<form method="post" action="/kode"><button class="alt" type="submit"${wa.qr ? '' : ' disabled'}>Minta kode tautan</button></form>`}
</section>
<p class="muted">Halaman ini memuat ulang sendiri tiap 5 detik. Penautan berhenti sendiri bila tidak diselesaikan dalam beberapa menit.</p>
<a class="btn alt" href="/">Kembali</a>`, { refresh: 5 });
}

/** Halaman tautkan atau ganti nomor bot: persiapan wajib, lalu QR. */
export function linkPage(message) {
  const state = getState();
  // Sesi tersimpan tetap dipakai setelah server menyala ulang; menautkan ulang tanpa perlu justru mencurigakan
  const sessionSaved = hasLinkedSession();
  const title = sessionSaved ? 'Ganti nomor bot' : 'Tautkan nomor bot';
  const current = esc(phoneText(wa.phone ?? state.phone) ?? '');
  const left = linkAttemptsLeft();
  return page(title, `<h1>${title}</h1>
${flash(message, 'bad')}
${sessionSaved ? `<div class="note warn">Nomor ${current} masih tertaut dan berjalan. Lanjutkan hanya bila nomor itu diblokir atau memang mau diganti. Bila nomornya berbeda, grup penerima perlu dipilih lagi.</div>` : ''}
<section class="card"><h2>Yang perlu disiapkan</h2>
<ol>
<li>HP bot dengan <strong>WhatsApp Business</strong> di SIM 2.</li>
<li>Laptop atau HP lain untuk membuka halaman ini dan menampilkan kode QR.</li>
</ol>
<p class="muted">Sisa percobaan hari ini: <strong>${left}</strong> kali. Bila gagal, jangan diulang-ulang; coba lagi besok. Penautan berulang memperbesar risiko blokir.</p></section>
${left ? `<form class="card" method="post" action="/daftar">
<label for="phone">Nomor WhatsApp Business (SIM 2)</label>
<input id="phone" type="tel" name="phone" placeholder="0812xxxxxxxx" inputmode="tel" required>
<p class="check-title"><strong>Centang bila sudah:</strong></p>
<label class="check"><input type="checkbox" name="cek_profil" value="1" required> Nama dan foto profil WhatsApp Business sudah diisi</label>
<label class="check"><input type="checkbox" name="cek_pin" value="1" required> Verifikasi dua langkah (PIN) sudah dinyalakan</label>
<label class="check"><input type="checkbox" name="cek_kontak" value="1" required> Nomor sudah disimpan pengurus dan beberapa anggota, dan sudah pernah berbalas chat</label>
<label class="check"><input type="checkbox" name="cek_qr" value="1" required> Halaman ini dibuka di laptop atau HP lain untuk memindai QR</label>
${sessionSaved ? `<label class="check warn"><input type="checkbox" name="confirm" value="1" required> Saya mengerti nomor ${current} akan dilepas dari bot.</label>` : ''}
<div class="actions"><button type="submit">${ICONS.phone}Mulai menautkan</button><a class="btn alt" href="/">Batal</a></div></form>`
    : '<div class="note bad">Batas percobaan hari ini sudah habis. Coba lagi besok.</div><a class="btn alt" href="/">Kembali</a>'}`);
}

/** Pilih grup penerima dari grup yang sudah dimasuki nomor bot. */
export async function groupPage() {
  if (!isConnected()) return dashboard('Bot belum tersambung. Daftarkan nomor terlebih dahulu.');
  const groups = await listGroups();
  const state = getState();
  const rows = groups.map((g) => `<label class="pick"><input type="radio" name="jid" value="${esc(g.id)}" ${g.id === state.groupJid ? 'checked' : ''} required>
<span>${esc(g.subject)} <span class="muted">(${g.size} anggota)</span></span></label>`).join('');
  return page('Pilih grup', `<h1>Pilih grup penerima</h1>
<section class="card"><ol>
<li>Pastikan admin grup sudah memasukkan nomor bot <strong>${esc(phoneText(wa.phone ?? state.phone))}</strong> ke grup.</li>
<li>Pilih grupnya di bawah, lalu tekan <strong>Simpan grup ini</strong>.</li>
</ol>
<p class="muted">Grup belum muncul? Tekan <strong>Muat ulang daftar</strong> setelah nomor bot dimasukkan ke grup.</p></section>
<form class="card" method="post" action="/grup">
${rows || '<p class="warn">Nomor bot belum masuk ke grup mana pun. Minta admin grup menambahkan nomor bot, lalu muat ulang daftar.</p>'}
${rows ? `<button type="submit">${ICONS.check}Simpan grup ini</button>` : ''}
</form><div class="actions"><a class="btn alt" href="/grup">Muat ulang daftar</a><a class="btn alt" href="/">Kembali</a></div>`);
}
