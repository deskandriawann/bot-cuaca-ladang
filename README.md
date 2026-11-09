# Bot WhatsApp Informasi Cuaca Ladang

Program pokok KKN-PPM UGM Unit YO 095, Padukuhan Nawungan, Kalurahan Selopamioro, Imogiri, Bantul.
Bot mengirim informasi cuaca ke grup WhatsApp Kelompok Tani Nawungan 2.

## Fitur

| Fitur | Waktu | Sumber |
| --- | --- | --- |
| Ringkasan pagi (informasi saja, tanpa saran): cuaca pagi/siang/sore, hujan, petir, angin, suhu. Bisa dimatikan dari halaman pengelola | Setiap hari pukul 05.00 WIB | BMKG |
| Pemberitahuan perubahan mendadak (hujan lebat pasti, petir, angin kencang baru) dan pengingat menjelang hujan lebat | Dicek tiap jam 06.00-18.00, paling banyak 3 kali sehari | BMKG, peluang hujan gabungan 5 model cuaca dunia |
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
- **Pengiriman:** satu pintu yang hanya mengizinkan grup tujuan; masa tenang 24 jam dan pemanasan 7 hari; batas pesan per jam (3 saat pemanasan, 20 setelahnya) dan 100 per hari; semua panggilan masuk antrean dan dijawab dengan membalas pesannya, pertanyaan yang sama dalam 30 menit cukup ditunjukkan ke jawaban sebelumnya; menit kirim acak; tandai dibaca, status mengetik, jeda; teks sama tidak dikirim dua kali; ringkasan paling banyak sekali sehari.
- **Isi:** pesan otomatis tanpa tautan; tautan BMKG ditaruh di deskripsi grup dan di teks Kirim manual.
- **Server:** pemutus sambung ulang (maks 6 per jam, tetap berlaku walau program crash), systemd tidak menyalakan ulang beruntun, versi Baileys dikunci, deteksi sesi ganda.
- **Cadangan:** Kirim manual selalu tersedia; `WA_MODE=manual` mematikan Baileys sepenuhnya.

## Struktur

```
src/
  index.js              titik masuk: kunci folder data, halaman pengelola, WhatsApp, penjadwal
  config.js             pengaturan dari .env
  log.js                log bersama (pino)
  lock.js               satu bot per folder data
  store.js              data/state.json dan catatan prakiraan
  time.js               waktu WIB dan format jam
  commands.js           pengurai "halo tani ..." (hari dan tanggal dari kalimat bebas)
  messages.js           teks pesan WhatsApp
  weather/
    sources.js          ambil data BMKG, Open-Meteo, dan ensembel 5 pusat cuaca
    analysis.js         hujan, petir, angin, peluang hujan, waktu menyemprot
  whatsapp/
    connection.js       sambungan WhatsApp (Baileys): penautan, sambung ulang, kirim, terima pesan grup
    auth-store.js       penyimpanan sesi WhatsApp di data/auth (tulis atomik)
  bot/
    send.js             satu-satunya jalan kirim pesan: tahap nomor baru, batas harian, tanpa teks ganda
    replies.js          jawaban "halo tani ..."
    morning.js          ringkasan pagi
    alerts.js           pemberitahuan perubahan mendadak dan pengingat hujan lebat
    schedule.js         jam kirim ringkasan (dari halaman pengelola atau .env) dan menit acaknya
    scheduler.js        penjadwal tiap 30 detik
  admin/                halaman pengelola
    server.js           server HTTP dan urutan pemeriksaan tiap permintaan
    security.js         kata sandi, sesi masuk, kunci salah sandi, asal permintaan, header keamanan (CSP)
    actions.js          tindakan formulir (tautkan nomor, pilih grup, pesan percobaan, jam kirim)
    dashboard.js        halaman utama
    pages.js            halaman masuk, kirim manual, kode QR, tautkan nomor, pilih grup
    layout.js           kerangka halaman, ikon, spanduk
    format.js           nomor, waktu, status, dan catatan kegiatan dalam bahasa sehari-hari
    assets.js           gambar/video dari assets/ dan berkas static/
    dev.js              mode develop: API kecil ke bot utama
    static/             admin.css dan admin.js (tanpa sisipan di halaman)
scripts/preview.js      contoh pesan tanpa WhatsApp
scripts/dev.js          mode develop (npm run dev): muat ulang otomatis, tanpa WhatsApp
scripts/kirim.js        mengirim perubahan ke server (npm run kirim)
test/                   pengujian per bagian; data contoh asli di test/fixtures, data uji bersama di test/helpers.js
deploy/                 layanan systemd (dibatasi: tanpa sudo, hanya menulis di data/)
.github/workflows/      cek otomatis di GitHub (npm run check)
eslint.config.js        aturan pemeriksaan kode
assets/               gambar halaman pengelola (.png/.jpg/.webp/.svg, video .mp4/.webm):
                        icon                            ikon tab, logo di atas, layar memuat
                        logo-unit, logo-ugm, logo-kkn   tiga logo di kaki halaman
                        hero-video, hero-video-2        video spanduk atas (layar lebar saja, bergantian)
                        hero-poster                     gambar spanduk di HP dan sebelum video siap
```

Aturan yang dijaga saat mengubah kode:

- **Arah ketergantungan satu arah:** `weather/`, `messages.js`, `commands.js`, `time.js` tidak tahu WhatsApp; `bot/` memakai `whatsapp/`; `admin/` memakai `bot/`. Bagian bawah tidak pernah mengimpor bagian atasnya.
- **Semua pesan keluar lewat `bot/send.js`** (`botSend`), agar batas harian, masa tenang, dan hanya-ke-grup-penerima tidak bisa terlewati.
- **Halaman pengelola tanpa sisipan:** semua teks dari luar lewat `esc()`, gaya dan skrip hanya di `admin/static/` (CSP melarang skrip, gaya, dan `onclick` sisipan; pengujian memeriksanya).
- **Pesan untuk pengurus dalam bahasa sehari-hari;** kode dan rincian teknis hanya ke log server.
- `npm run check` hijau sebelum push. `test/modules.test.js` memuat semua modul, jadi jalur impor yang salah setelah berkas dipindah langsung ketahuan.

## Menjalankan di komputer sendiri

Butuh Node.js 20.12 atau lebih baru (disarankan 22, lihat `.nvmrc`).

```bash
npm install
cp .env.example .env        # isi ADMIN_PASSWORD
npm test                    # pengujian (npm run test:watch: diulang tiap berkas disimpan)
npm run lint                # pemeriksaan kode (ESLint); npm run lint:fix merapikan yang bisa dirapikan otomatis
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

Jalankan keduanya bersamaan di dua terminal. Di mode develop, menu **Pilih pesan untuk diuji** → **Kirim ke grup lewat bot utama** mengirim pesan yang disusun kode terbaru lewat sambungan bot utama: nomor dan sesinya sama, tidak ada sambungan kedua, dan semua pengaman tetap berlaku (hanya ke grup penerima, batas harian, tanpa teks ganda). Pintu ini (`/api/status`, `/api/kirim`) hanya menerima permintaan dari komputer yang sama dengan token di `data/api-token` yang dibuat baru setiap bot utama menyala.

Jangan pakai `node --watch` untuk `npm start`: setiap muat ulang berarti sambung ulang ke WhatsApp, dan setelah 6 kali dalam satu jam bot ditahan oleh pemutus.

### GitHub

`.gitignore` menahan `.env` (kata sandi) dan `data/` (sesi WhatsApp): siapa pun yang memegang `data/` bisa memakai nomor bot. Sebelum commit pertama, pastikan keduanya tidak ikut dengan `git status`. Setiap push menjalankan `npm run check` di GitHub Actions ([.github/workflows/cek.yml](.github/workflows/cek.yml)); tanda centang hijau di GitHub berarti kode siap dipasang.

### Mengirim perubahan ke server

Setelah mengubah kode di laptop, cukup satu perintah dari folder proyek:

```bash
npm run kirim -- "pesan singkat perubahan"   # ada perubahan yang belum di-commit
npm run kirim                                # semua perubahan sudah di-commit
```

Urutannya: periksa kode (`npm run check`; bila gagal, berhenti dan server tidak diubah) → commit → push ke GitHub → server menjalankan `git pull`, memasang ulang paket bila `package-lock.json` berubah, menyalakan ulang bot, lalu menunggu sampai bot tersambung lagi ke WhatsApp. Bila server sudah memakai versi terbaru, atau yang berubah hanya dokumen, skrip, atau tes (di luar `src/`, `assets/`, `deploy/`, `package*.json`), bot tidak dinyalakan ulang.

Butuh alias SSH `infocuacatani` di `~/.ssh/config` laptop (server lain: isi `DEPLOY_HOST` dan `DEPLOY_DIR`). Setiap kirim berarti bot menyambung ulang ke WhatsApp, jadi kumpulkan perubahan lalu kirim sekaligus, bukan berkali-kali sejam. `.env` di server tidak ikut berubah; pengaturan di sana diubah dengan `ssh infocuacatani`, lalu `nano ~/bot-cuaca/.env`.

## Pemasangan di Oracle Cloud Always Free

Komunitas pengembang menganggap IP server cloud lebih dicurigai WhatsApp daripada koneksi rumah (tidak pernah dinyatakan resmi).
Bila nomor diblokir saat bot berjalan di cloud, pindahkan bot ke laptop, mini PC, atau HP Android lama di posko atau rumah pengurus.
Bila tetap memakai cloud, pilih region terdekat (misalnya Indonesia North (Batam) atau Singapura) saat mendaftar.

1. Buat instance Canonical Ubuntu 24.04 (shape Always Free), lalu masuk lewat SSH.
2. Pasang Node.js 22:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   ```
3. Ambil kode ke `/home/ubuntu/bot-cuaca` (repo privat meminta username GitHub dan personal access token sebagai kata sandi), lalu:
   ```bash
   git clone https://github.com/<akun>/<repo>.git ~/bot-cuaca
   cd ~/bot-cuaca && npm ci --omit=dev
   cp .env.example .env && nano .env   # isi ADMIN_PASSWORD; ADMIN_HOST tetap 127.0.0.1
   chmod 600 .env                      # hanya pemilik yang bisa membaca
   ```
   Memperbarui kode nanti: dari laptop `npm run kirim` (lihat [Mengirim perubahan ke server](#mengirim-perubahan-ke-server)), atau di server `git pull && npm ci --omit=dev && sudo systemctl restart bot-cuaca`. Setiap restart berarti sambung ulang ke WhatsApp, jadi perbarui sekaligus, bukan berkali-kali sehari.
4. Jalankan sebagai layanan:
   ```bash
   sudo cp deploy/bot-cuaca.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now bot-cuaca
   journalctl -u bot-cuaca -f          # melihat log
   ```
   Layanan menunggu 60 detik sebelum menyala ulang dan berhenti mencoba setelah 5 kali gagal dalam 1 jam, agar tidak menyambung ke WhatsApp berulang-ulang. Setelah memperbaiki penyebabnya: `sudo systemctl reset-failed bot-cuaca && sudo systemctl start bot-cuaca`.
   Layanan juga dibatasi: tanpa `sudo`, hanya bisa menulis di `data/`, dan berkas baru hanya terbaca pemiliknya. Bila ada celah di pembaca pesan WhatsApp, penyusup tidak bisa mengambil alih server.
5. HTTPS, agar kata sandi dan cookie masuk tidak terkirim tanpa enkripsi. Halaman pengelola hanya mendengar `127.0.0.1`; dari luar dibuka lewat Caddy.
   - Buat nama gratis di [duckdns.org](https://www.duckdns.org) (misalnya `botcuaca-nawungan.duckdns.org`) dan isi IP publik server.
   - Tambahkan aturan masuk TCP 80 dan 443 di Security List VCN (port 3000 tidak perlu dibuka), lalu di server:
     ```bash
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```
   - Pasang Caddy (dari repo resminya) dan arahkan ke bot. Sertifikat HTTPS diambil dan diperpanjang sendiri:
     ```bash
     sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
     curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
     curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
     sudo apt update && sudo apt install -y caddy
     printf 'botcuaca-nawungan.duckdns.org {\n\treverse_proxy 127.0.0.1:3000\n}\n' | sudo tee /etc/caddy/Caddyfile
     sudo systemctl reload caddy
     ```
   - Halaman pengelola: `https://botcuaca-nawungan.duckdns.org`. Bot mengenali HTTPS dari Caddy: cookie masuk hanya dikirim lewat HTTPS, dan kunci salah sandi memakai alamat asli pengunjung.
   - Sebelum nama DuckDNS siap, halaman bisa dibuka dari laptop lewat terowongan SSH: `ssh -L 3000:127.0.0.1:3000 ubuntu@<IP-SERVER>`, lalu buka `http://localhost:3000`.

Data penting ada di folder `data/` (sesi WhatsApp dan pengaturan grup). Jangan dibagikan. Saat pindah komputer, matikan bot di tempat lama dulu; sesi yang sama tidak boleh berjalan di dua tempat.

### Kata sandi halaman pengelola

Kata sandi hanya ada di `ADMIN_PASSWORD` dalam `.env` di server, tidak pernah ikut ke GitHub. Bot menolak menyala bila kosong atau kurang dari 8 karakter, dan memberi peringatan di log saat menyala bila kurang dari 12.

- Pakai huruf, angka, dan tanda `-`, misalnya beberapa kata acak: `jagung-embun-pacul-senja`. Tanda `#` memotong kata sandi tanpa peringatan (`abc#123` terbaca `abc`); bila perlu `#`, apit dengan tanda kutip.
- Mengganti: ubah `ADMIN_PASSWORD` dengan `nano ~/bot-cuaca/.env`, lalu `sudo systemctl restart bot-cuaca`. Semua browser yang sedang masuk otomatis keluar, jadi cukup ganti kata sandi saat serah terima pengurus.
- Salah 5 kali dari satu alamat: alamat itu dikunci 15 menit. Salah 30 kali dalam 15 menit dari berbagai alamat (tebakan beramai-ramai): semua percobaan masuk dikunci 15 menit dan tercatat di **Kegiatan bot terbaru** sebagai *Keamanan*.
- Pesan di alamat halaman (`?pesan=`) ditandatangani bot, jadi tautan dari luar tidak bisa memunculkan teks palsu di halaman pengelola. Formulir dari situs lain dan pembingkaian halaman (iframe) ditolak.

## Catatan teknis

- **Keterangan cuaca BMKG.** Hujan dan petir dinilai dari teks `weather_desc`, bukan kode angka. Di API publik BMKG, kode 61 berketerangan "Hujan Ringan" dan 63 "Hujan Sedang", berbeda dari tabel kode yang sering dikutip.
- **Jam kerja** = slot BMKG (masing-masing mewakili 3 jam) yang bersinggungan dengan 06.00-18.00. Jam slot BMKG sering bergeser (pernah 06/09/12/15, 05/08/11/14/17, dan 07/10/13/16), jadi tidak dipatok ke jam tertentu.
- **Peluang hujan** (BMKG sendiri tidak memberinya) = rata-rata 5 pusat cuaca dunia lewat Open-Meteo Ensemble API: ECMWF, ICON (Jerman), GFS (Amerika), UKMO (Inggris), GEM (Kanada), sekitar 160 versi hitungan model. Peluang tiap pusat = bagian anggota ensembelnya yang hujan minimal 1 mm dalam 3 jam slot; tiap pusat berbobot sama. Ambang 1 mm sengaja dipakai karena model global terlalu sering memprakirakan gerimis tipis di daerah tropis. Bila ensembel gagal, cadangannya peluang hujan Open-Meteo biasa, lalu BMKG saja. Lihat rinciannya per pusat: `npm run preview -- --sumber`.
- **Catatan prakiraan** di `data/prakiraan.json`: setiap ringkasan pagi menyimpan keterangan BMKG dan peluang tiap pusat untuk jam kerja hari itu. Belum dipakai menghitung; disiapkan untuk menilai sumber mana yang paling tepat di Selopamioro begitu ada data hujan yang benar-benar turun (BMKG tidak menyimpan prakiraan lamanya).
- **Hujan pasti** = BMKG memprakirakan hujan dan peluang hujan pada jam itu ≥ `RAIN_SURE_PERCENT` (bawaan 70%). Aturannya:
  - Hujan ringan, atau hujan yang belum pasti: cukup info satu baris, misalnya "☔ Mungkin hujan sedang sekitar pukul 14.00 (peluang 50%)".
  - Hujan sedang, lebat, atau hujan petir yang pasti: tambahan "⚠️ POTENSI HUJAN".
  - Hujan lebat atau hujan petir yang pasti: pesan susulan saat baru muncul di prakiraan, dan pengingat sekali saat jam hujannya mulai atau sejam sebelumnya.
  - Petir selalu dihitung bahaya, berapa pun peluangnya. Bila Open-Meteo gagal, hujan dinilai dari keterangan BMKG saja (seperti dulu).
- **Bahaya** (dipakai untuk pemberitahuan dan tanda ⚠️ di rincian per jam) = hujan sedang/lebat yang pasti, petir, atau angin ≥ `STRONG_WIND_KMH`.
- **Peringatan dini BMKG (nowcasting)** belum disertakan: feed peringatan dini menolak akses dari server (HTTP 403) saat diuji pada 25 Oktober 2026. Perubahan mendadak saat ini dideteksi dari pembaruan prakiraan per 3 jam.
- **Tautan rincian** `DETAIL_LINK` belum bisa diverifikasi otomatis (situs BMKG menolak akses dari skrip). Buka di peramban ponsel untuk memastikan, dan ganti di `.env` bila perlu.
- **Penanda sesi tertaut** memakai `creds.me`, bukan `creds.registered`: di Baileys 7, `registered` bisa tetap `false` walau nomor sudah tertaut.
- **Sesi tersimpan** di `data/auth` dan dipakai lagi setiap bot menyala, seperti WhatsApp Web. Penyimpanannya ([src/whatsapp/auth-store.js](src/whatsapp/auth-store.js)) memakai format berkas yang sama dengan `useMultiFileAuthState` bawaan Baileys, tetapi menulis secara atomik. Untuk menghentikan bot, tekan Ctrl+C **sekali** dan tunggu sampai berhenti sendiri; sambungan ditutup biasa (bukan logout) dan sesi selesai ditulis dulu. Menautkan ulang hanya perlu bila WhatsApp mengeluarkan perangkat bot (kode 401).
- **Satu bot per folder data.** Bot kedua dengan `DATA_DIR` yang sama menolak menyala (`data/bot.lock`).
- Bila server mati saat jadwal ringkasan pagi, ringkasan tetap dikirim begitu server menyala paling lambat 4 jam setelahnya (bawaan sebelum pukul 09.00).
- **Info pagi nyala/mati** di halaman pengelola (kotak *Info cuaca setiap pagi*). Saat mati, bot tidak mengirim apa pun sendiri (ringkasan pagi maupun peringatan cuaca) dan hanya menjawab "halo tani ..."; tombol *Kirim info cuaca sekarang* tetap bisa dipakai sekali-sekali.
- **Jam kirim ringkasan** diatur pengurus di halaman pengelola (kotak *Jam kirim info cuaca*, 03.00-21.00), berlaku langsung tanpa menyalakan ulang dan disimpan di `data/state.json`. `MORNING_HOUR` dan `MORNING_MINUTE` di `.env` hanya jam bawaannya. Salam pembuka mengikuti jam kirim (pagi, siang, sore, malam).
- Menguji jadwal kirim tepat pada menitnya, misalnya 17.50: isi `MORNING_JITTER_MIN=0` di `.env` dan nyalakan ulang bot, lalu atur jam 17.50 di halaman pengelola. Ringkasan hanya terkirim bila hari itu belum terkirim; kembalikan jam dan `MORNING_JITTER_MIN` setelah selesai.
