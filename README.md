# Bot WhatsApp Informasi Cuaca Ladang

Program pokok KKN-PPM UGM Unit YO 095, Padukuhan Nawungan, Kalurahan Selopamioro, Imogiri, Bantul.
Bot mengirim informasi cuaca ke grup WhatsApp Kelompok Tani Nawungan 2.

## Fitur

| Fitur | Waktu | Sumber |
| --- | --- | --- |
| Ringkasan pagi: cuaca pagi/siang/sore, hujan, petir, angin, suhu, jam aman ke ladang | Setiap hari pukul 05.00 WIB | BMKG |
| Pemberitahuan perubahan mendadak (hujan lebat pasti, petir, angin kencang baru) dan pengingat menjelang hujan lebat | Dicek tiap jam 06.00-18.00, paling banyak 3 kali sehari | BMKG, peluang hujan Open-Meteo |
| Cek cuaca hari ke-1 sampai ke-3, rincian per 3 jam | Saat dipanggil | BMKG |
| Cek cuaca hari ke-4 sampai ke-10, gambaran singkat | Saat dipanggil | Open-Meteo |
| Halaman pengelola: daftarkan nomor, pilih grup, status, pesan uji | Kapan saja | - |

Cara memanggil di grup: awali dengan **halo tani** (pesan tanpa sapaan diabaikan), lalu tulis bebas. Hari yang ditanya dikenali sendiri dari kalimatnya:

```
halo tani                      hari ini (juga "halo tani nanti sore hujan ga?")
halo tani besok / lusa         juga bahasa Jawa: sesuk, besuk
halo tani sabtu                hari terdekat; Jawa: senen, rebo, kemis, jemuah, setu, ahad
halo tani tanggal 5            juga "halo tani 5", "halo tani 5 november", "halo tani 5/11"
halo tani 3 hari lagi
halo tani 10 hari              juga "seminggu", "minggu depan"
halo tani menu                 cara bertanya
```

Hari yang sudah lewat ("kemarin", tanggal minggu lalu) dijawab bahwa prakiraan hanya ke depan; pertanyaan yang tidak dikenali dijawab dengan cara bertanya. Ringkasan pagi dan setiap jawaban diakhiri satu contoh pertanyaan berikutnya, berganti tiap hari.

Kata `tani` diatur lewat `BOT_NAME` di `.env`.

## Dua mode pengiriman

| Mode | Cara kerja | Risiko blokir |
| --- | --- | --- |
| `WA_MODE=manual` | Bot tidak tersambung ke WhatsApp. Tiap pagi pengurus membuka **Kirim manual** di halaman pengelola, mengetuk **Buka WhatsApp dan pilih grup**, lalu mengirim (sekitar 4 ketukan). Tautannya memakai `https://wa.me/?text=` milik WhatsApp sendiri | Tidak ada, karena yang mengirim manusia dari aplikasi resmi |
| `WA_MODE=otomatis` (bawaan) | Bot mengirim sendiri lewat Baileys dengan pengaman di bawah | Ada; hanya dikurangi |

Di mode otomatis, **Kirim manual** tetap tersedia sebagai cadangan bila bot terputus atau nomornya diblokir. Halaman itu memberi tahu bila bot sudah mengirim ringkasan hari ini, agar tidak terkirim dua kali.

## Cara kerja nomor bot

Bot berjalan di server dan tertaut ke WhatsApp Business di SIM 2 ponsel pengurus sebagai perangkat tertaut (seperti WhatsApp Web).
Bila nomor diblokir, pengurus menyiapkan nomor baru, menautkannya lewat halaman pengelola, lalu memasukkannya ke grup.
Langkah lengkap untuk pengurus ada di [PANDUAN-PENGURUS.md](PANDUAN-PENGURUS.md).

## Mengurangi risiko blokir

Baileys bukan layanan resmi WhatsApp, jadi risiko blokir tidak bisa dihilangkan, hanya dikurangi.
Pada uji coba 25 Oktober 2026, nomor baru diblokir sekitar satu menit setelah ditautkan, sebelum bot mengirim satu pesan pun.
Artinya yang paling menentukan adalah riwayat nomor, bukan isi atau jumlah pesan.

Semua kemungkinan penyebab blokir dan gangguan, penanganannya, dan urutan pemakaian yang disarankan ada di **[KEAMANAN-WA.md](KEAMANAN-WA.md)**. Ringkasnya:

- **Nomor:** dipakai chat biasa minimal 10 hari sebelum ditautkan, profil lengkap, PIN dua langkah, disimpan anggota (dicentang di halaman pengelola sebelum menautkan), masa aktif SIM dipantau.
- **Penautan:** lewat QR, paling banyak 3 kali sehari, berhenti sendiri bila waktu habis, tidak pernah menautkan ulang otomatis.
- **Pengiriman:** satu pintu yang hanya mengizinkan grup tujuan; masa tenang 24 jam dan pemanasan 7 hari; batas harian; menit kirim acak; tandai dibaca, status mengetik, jeda; tidak menjawab malam hari; teks sama tidak dikirim dua kali; ringkasan paling banyak sekali sehari.
- **Isi:** pesan otomatis tanpa tautan; tautan BMKG ditaruh di deskripsi grup dan di teks Kirim manual.
- **Server:** pemutus sambung ulang (maks 6 per jam, tetap berlaku walau program crash), systemd tidak menyalakan ulang beruntun, versi Baileys dikunci, deteksi sesi ganda.
- **Cadangan:** Kirim manual selalu tersedia; `WA_MODE=manual` mematikan Baileys sepenuhnya.

## Struktur

```
src/
  index.js            titik masuk
  config.js           pengaturan dari .env
  wa.js               sambungan WhatsApp (Baileys), QR dan kode tautan, berhenti rapi
  auth-store.js       penyimpanan sesi WhatsApp di data/auth (tulis atomik)
  lock.js             satu bot per folder data
  bot.js              jadwal 05.00, pemeriksaan per jam, jawaban panggilan
  commands.js         pengurai "halo tani ..." (hari dan tanggal dari kalimat bebas)
  messages.js         teks pesan
  admin.js            halaman pengelola
  store.js            data/state.json
  time.js             waktu WIB
  weather/sources.js  ambil data BMKG dan Open-Meteo
  weather/analysis.js hujan, petir, angin, jam aman
scripts/preview.js    contoh pesan tanpa WhatsApp
scripts/dev.js        mode develop (npm run dev): muat ulang otomatis, tanpa WhatsApp
test/                 pengujian (data contoh asli di test/fixtures)
deploy/               layanan systemd
.github/workflows/    cek otomatis di GitHub (npm run check)
eslint.config.js      aturan pemeriksaan kode
assets/               gambar halaman pengelola (.png/.jpg/.webp/.svg, video .mp4/.webm):
                        icon                            ikon tab, logo di atas, layar memuat
                        logo-unit, logo-ugm, logo-kkn   tiga logo di kaki halaman
                        hero-video, hero-video-2        video spanduk atas (layar lebar saja, bergantian)
                        hero-poster                     gambar spanduk di HP dan sebelum video siap
```

## Menjalankan di komputer sendiri

Butuh Node.js 20 atau lebih baru.

```bash
npm install
cp .env.example .env        # isi ADMIN_PASSWORD
npm test                    # pengujian
npm run lint                # pemeriksaan kode (ESLint)
npm run check               # cek siap deploy: lint + pengujian + celah keamanan paket server
npm run preview             # contoh ringkasan pagi dengan data hari ini
npm run preview -- "halo tani cuaca 10 hari"
npm start                   # buka http://localhost:3000
```

### Develop

| Perintah | Tersambung ke WhatsApp | Memuat ulang otomatis | Dipakai untuk |
| --- | --- | --- | --- |
| `npm run dev` (http://localhost:3001) | Tidak, menitipkan ke bot utama | Ya, setiap file kode disimpan | Mengubah format pesan, halaman pengelola, logika cuaca. Aman dimuat ulang berkali-kali; memakai folder `data-dev/` sendiri |
| `npm start` (http://localhost:3000) | Ya | Tidak | Bot utama: memegang satu-satunya sambungan WhatsApp. Nyalakan ulang seperlunya saja |

Jalankan keduanya bersamaan di dua terminal. Di mode develop, menu **Pilih pesan untuk diuji** → **Kirim ke grup lewat bot utama** mengirim pesan yang disusun kode terbaru lewat sambungan bot utama: nomor dan sesinya sama, tidak ada sambungan kedua, dan semua pengaman tetap berlaku (hanya ke grup tujuan, batas harian, tanpa teks ganda). Pintu ini (`/api/status`, `/api/kirim`) hanya menerima permintaan dari komputer yang sama dengan token di `data/api-token` yang dibuat baru setiap bot utama menyala.

Jangan pakai `node --watch` untuk `npm start`: setiap muat ulang berarti sambung ulang ke WhatsApp, dan setelah 6 kali dalam satu jam bot ditahan oleh pemutus.

### GitHub

`.gitignore` menahan `.env` (kata sandi) dan `data/` (sesi WhatsApp): siapa pun yang memegang `data/` bisa memakai nomor bot. Sebelum commit pertama, pastikan keduanya tidak ikut dengan `git status`. Setiap push menjalankan `npm run check` di GitHub Actions ([.github/workflows/cek.yml](.github/workflows/cek.yml)); tanda centang hijau di GitHub berarti kode siap dipasang.

## Pemasangan di Oracle Cloud Always Free

Komunitas pengembang menganggap IP server cloud lebih dicurigai WhatsApp daripada koneksi rumah (tidak pernah dinyatakan resmi).
Bila nomor diblokir saat bot berjalan di cloud, pindahkan bot ke laptop, mini PC, atau HP Android lama di posko atau rumah pengurus.
Bila tetap memakai cloud, pilih region terdekat (misalnya Singapura) saat mendaftar.

1. Buat instance Ubuntu (shape Always Free), lalu masuk lewat SSH.
2. Pasang Node.js 22:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   ```
3. Ambil kode ke `/home/ubuntu/bot-cuaca` (repo privat meminta username GitHub dan personal access token sebagai kata sandi), lalu:
   ```bash
   git clone https://github.com/<akun>/<repo>.git ~/bot-cuaca
   cd ~/bot-cuaca && npm ci --omit=dev
   cp .env.example .env && nano .env   # isi ADMIN_PASSWORD
   ```
   Memperbarui kode nanti: `git pull && npm ci --omit=dev && sudo systemctl restart bot-cuaca`. Setiap restart berarti sambung ulang ke WhatsApp, jadi perbarui sekaligus, bukan berkali-kali sehari.
4. Jalankan sebagai layanan:
   ```bash
   sudo cp deploy/bot-cuaca.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now bot-cuaca
   journalctl -u bot-cuaca -f          # melihat log
   ```
   Layanan menunggu 60 detik sebelum menyala ulang dan berhenti mencoba setelah 5 kali gagal dalam 1 jam, agar tidak menyambung ke WhatsApp berulang-ulang. Setelah memperbaiki penyebabnya: `sudo systemctl reset-failed bot-cuaca && sudo systemctl start bot-cuaca`.
5. Buka port halaman pengelola: tambahkan aturan masuk TCP 3000 di Security List VCN, lalu di server:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
   sudo netfilter-persistent save
   ```
6. Disarankan: pasang HTTPS (misalnya Caddy dengan domain gratis) agar kata sandi tidak terkirim tanpa enkripsi, lalu isi `ADMIN_HOST=127.0.0.1` dan tutup port 3000 dari luar.

Data penting ada di folder `data/` (sesi WhatsApp dan pengaturan grup). Jangan dibagikan. Saat pindah komputer, matikan bot di tempat lama dulu; sesi yang sama tidak boleh berjalan di dua tempat.

## Catatan teknis

- **Keterangan cuaca BMKG.** Hujan dan petir dinilai dari teks `weather_desc`, bukan kode angka. Di API publik BMKG, kode 61 berketerangan "Hujan Ringan" dan 63 "Hujan Sedang", berbeda dari tabel kode yang sering dikutip.
- **Jam kerja** = slot BMKG (masing-masing mewakili 3 jam) yang bersinggungan dengan 06.00-18.00. Jam slot BMKG bisa bergeser (pernah 06/09/12/15, Oktober 2026 menjadi 05/08/11/14/17), jadi tidak dipatok ke jam tertentu.
- **Peluang hujan** (BMKG sendiri tidak memberinya) = rata-rata 5 pusat cuaca dunia lewat Open-Meteo Ensemble API: ECMWF, ICON (Jerman), GFS (Amerika), UKMO (Inggris), GEM (Kanada), sekitar 160 versi hitungan model. Peluang tiap pusat = bagian anggota ensembelnya yang hujan minimal 1 mm dalam 3 jam slot; tiap pusat berbobot sama. Ambang 1 mm sengaja dipakai karena model global terlalu sering memprakirakan gerimis tipis di daerah tropis. Bila ensembel gagal, cadangannya peluang hujan Open-Meteo biasa, lalu BMKG saja. Lihat rinciannya per pusat: `npm run preview -- --sumber`.
- **Catatan prakiraan** di `data/prakiraan.json`: setiap ringkasan pagi menyimpan keterangan BMKG dan peluang tiap pusat untuk jam kerja hari itu. Belum dipakai menghitung; disiapkan untuk menilai sumber mana yang paling tepat di Selopamioro begitu ada data hujan yang benar-benar turun (BMKG tidak menyimpan prakiraan lamanya).
- **Hujan pasti** = BMKG memprakirakan hujan dan peluang hujan pada jam itu ≥ `RAIN_SURE_PERCENT` (bawaan 70%). Aturannya:
  - Hujan ringan, atau hujan yang belum pasti: cukup info satu baris, misalnya "☔ Mungkin hujan sedang sekitar pukul 14.00 (peluang 50%)".
  - Hujan sedang, lebat, atau hujan petir yang pasti: tambahan "⚠️ POTENSI HUJAN" dan masuk perhitungan jam aman.
  - Hujan lebat atau hujan petir yang pasti: pesan susulan saat baru muncul di prakiraan, dan pengingat sekali saat jam hujannya mulai atau sejam sebelumnya.
  - Petir selalu dihitung bahaya, berapa pun peluangnya. Bila Open-Meteo gagal, hujan dinilai dari keterangan BMKG saja (seperti dulu).
- **Jam aman** = jam kerja tanpa hujan sedang/lebat yang pasti, petir, atau angin ≥ `STRONG_WIND_KMH`.
- **Peringatan dini BMKG (nowcasting)** belum disertakan: feed peringatan dini menolak akses dari server (HTTP 403) saat diuji pada 25 Oktober 2026. Perubahan mendadak saat ini dideteksi dari pembaruan prakiraan per 3 jam.
- **Tautan rincian** `DETAIL_LINK` belum bisa diverifikasi otomatis (situs BMKG menolak akses dari skrip). Buka di peramban ponsel untuk memastikan, dan ganti di `.env` bila perlu.
- **Penanda sesi tertaut** memakai `creds.me`, bukan `creds.registered`: di Baileys 7, `registered` bisa tetap `false` walau nomor sudah tertaut.
- **Sesi tersimpan** di `data/auth` dan dipakai lagi setiap bot menyala, seperti WhatsApp Web. Penyimpanannya ([src/auth-store.js](src/auth-store.js)) memakai format berkas yang sama dengan `useMultiFileAuthState` bawaan Baileys, tetapi menulis secara atomik. Untuk menghentikan bot, tekan Ctrl+C **sekali** dan tunggu sampai berhenti sendiri; sambungan ditutup biasa (bukan logout) dan sesi selesai ditulis dulu. Menautkan ulang hanya perlu bila WhatsApp mengeluarkan perangkat bot (kode 401).
- **Satu bot per folder data.** Bot kedua dengan `DATA_DIR` yang sama menolak menyala (`data/bot.lock`).
- Bila server mati saat pukul 05.00, ringkasan tetap dikirim begitu server menyala sebelum pukul 09.00.
