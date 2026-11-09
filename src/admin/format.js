// Cara menampilkan data bot ke pengurus dalam bahasa sehari-hari: nomor, waktu, status, dan catatan kegiatan.
// Tanpa istilah atau kode teknis; kode WhatsApp dan rincian galat hanya masuk log server.
import { BULAN, addDays, minuteLabel, nowWib, pad } from '../time.js';
import { morningAt, morningDue } from '../bot/schedule.js';

/** '6285190966236' → '0851-9096-6236', seperti nomor ditulis sehari-hari */
export function phoneText(phone) {
  if (!phone) return phone;
  const local = String(phone).replace(/^62/, '0');
  return local.replace(/(\d{4})(?=\d)/g, '$1-');
}

/** Waktu catatan kegiatan: 'Hari ini 16.51', 'Kemarin 05.08', atau '28 Okt 05.08' */
export function whenText(iso) {
  const t = nowWib(new Date(iso));
  const today = nowWib().date;
  const day = t.date === today ? 'Hari ini' : t.date === addDays(today, -1) ? 'Kemarin'
    : `${Number(t.date.slice(8))} ${BULAN[Number(t.date.slice(5, 7)) - 1].slice(0, 3)}`;
  return `${day} ${t.hhmm}`;
}

/** Jam kirim info cuaca pada tanggal itu, dengan menit acaknya: '05.08' */
export const morningTime = (date) => minuteLabel(morningAt(date));

/** Kapan info cuaca pagi yang belum terkirim dikirim: 'hari ini pukul 05.08 WIB', 'sebentar lagi', atau 'besok pukul 05.11 WIB'. */
export function nextMorningText() {
  const now = nowWib();
  const minute = now.hour * 60 + now.minute;
  if (minute < morningAt(now.date)) return `hari ini pukul ${morningTime(now.date)} WIB`;
  if (morningDue(now)) return 'sebentar lagi';
  return `besok pukul ${morningTime(addDays(now.date, 1))} WIB`;
}

// [teks lengkap, jenis (warna kotak status), teks pendek untuk kotak ringkasan]
const STATUS_TEXT = {
  belum_terdaftar: ['Nomor bot belum ditautkan', 'warn', 'Belum ada nomor'],
  menghubungkan: ['Sedang menyambung ke WhatsApp', 'warn', 'Menyambung…'],
  menunggu_tautan: ['Menunggu kode QR dipindai dari HP bot', 'warn', 'Menunggu QR'],
  tersambung: ['Aktif dan tersambung ke WhatsApp', 'ok', 'Aktif'],
  terputus: ['Internet terputus sebentar. Bot menyambung lagi sendiri, tidak perlu melakukan apa-apa.', 'warn', 'Menyambung lagi'],
  kedaluwarsa: ['Waktu memindai kode QR habis', 'warn', 'Waktu habis'],
  keluar: ['WhatsApp memutus bot. Nomor bot perlu ditautkan lagi.', 'bad', 'Perlu ditautkan'],
  ganda: ['Bot sedang berjalan di komputer lain', 'bad', 'Dobel'],
  ditahan: ['Bot beristirahat sebentar karena terlalu sering menyambung. Nanti tersambung lagi sendiri.', 'warn', 'Istirahat sebentar'],
};
export const STATUS_COLOR = { ok: 'green', warn: 'amber', bad: 'red' };

/** Status sambungan → { text, kind, short }. */
export function statusOf(status) {
  const [text, kind, short] = STATUS_TEXT[status] ?? [status, 'warn', status];
  return { text, kind, short };
}

// Catatan kegiatan bot di halaman utama: ikon, judul yang mudah dipahami, dan keterangan tanpa kode teknis
const LOG_KINDS = {
  pagi: ['☀️', 'Info cuaca pagi'],
  jawaban: ['💬', 'Menjawab pertanyaan'],
  tak_dijawab: ['🔇', 'Pertanyaan tidak dijawab'],
  antrean: ['⏳', 'Pertanyaan menunggu giliran'],
  pembaruan: ['⚠️', 'Peringatan cuaca'],
  uji: ['✅', 'Pesan percobaan'],
  nomor: ['📱', 'Nomor bot'],
  sambungan: ['📶', 'Sambungan WhatsApp'],
  keamanan: ['🔒', 'Keamanan'],
  jadwal: ['⏰', 'Jam kirim'],
  develop: ['🛠️', 'Uji coba pengembang'],
};
const HAZARD_NAMES = { petir: 'hujan petir', hujan_lebat: 'hujan lebat', hujan_sedang: 'hujan sedang', angin: 'angin kencang', segera: 'pengingat hujan' };

// Catatan lama (sebelum bahasanya disederhanakan) tetap tampil dengan kalimat baru
const OLD_LOG_TEXT = [
  [/^Ringkasan \d{4}-\d{2}-\d{2}$/, 'Terkirim ke grup'],
  [/^Gagal, kirim manual: /, 'Belum terkirim, kirim manual: '],
  [/^Tersambung memakai sesi tersimpan.*$/, 'Tersambung kembali'],
  [/^Terputus sementara.*$/, 'Terputus sebentar, menyambung lagi sendiri'],
  [/^Sesi tidak berlaku lagi.*$/, 'WhatsApp meminta nomor ditautkan lagi'],
  [/^Dikeluarkan WhatsApp.*$/, 'Diputus WhatsApp, perlu ditautkan lagi'],
  [/^Ditahan sampai (\S+) \(terlalu sering menyambung\)$/, 'Istirahat sampai pukul $1 karena terlalu sering menyambung'],
  [/^Jam kirim ringkasan pukul /, 'Diubah ke sekitar pukul '],
];

function logDetail({ kind, detail }) {
  const text = String(detail ?? '');
  if (kind === 'jawaban') return `“${text}”`;
  if (kind === 'pembaruan') {
    // '2026-10-31 15 petir, 2026-10-31 15 segera' → 'Hujan petir pukul 15.00, pengingat hujan pukul 15.00'
    const items = text.split(', ').map((key) => {
      const [, hour, type] = key.split(' ');
      return `${HAZARD_NAMES[type] ?? type} pukul ${pad(Number(hour))}.00`;
    }).join(', ');
    return items.charAt(0).toUpperCase() + items.slice(1);
  }
  return OLD_LOG_TEXT.reduce((t, [pattern, plain]) => t.replace(pattern, plain), text)
    .replace(/ ?\(kode [^)]*\)/g, '')
    .replace(/\b62(\d{8,13})\b/g, (m) => phoneText(m));
}

/** Satu catatan kegiatan → { icon, label, detail, when } untuk ditampilkan. */
export function logEntry(entry) {
  const [icon, label] = LOG_KINDS[entry.kind] ?? ['•', entry.kind];
  return { icon, label, detail: logDetail(entry), when: whenText(entry.at) };
}
