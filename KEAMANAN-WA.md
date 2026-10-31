# Keamanan Bot WhatsApp

Selama bot memakai Baileys (tidak resmi), risiko blokir **tidak bisa nol**, hanya bisa diperkecil.
Dokumen ini mendaftar semua kemungkinan penyebab blokir dan gangguan yang sudah dipertimbangkan, siapa yang menanganinya, dan sisa risikonya.
Bila semua pengaman gagal, **Kirim manual** di halaman pengelola tetap berjalan tanpa risiko, karena pesannya dikirim manusia dari aplikasi WhatsApp resmi.

Keterangan kolom **Oleh**: *Kode* = sudah ditangani program, *Pengurus* = tugas pemegang ponsel bot, *Pengembang* = tugas yang memasang server.

## 1. Jalur WhatsApp yang dipertimbangkan

| Jalur | Risiko blokir | Biaya | Bisa ke grup 101 orang | Keputusan |
| --- | --- | --- | --- | --- |
| Kirim manual (`wa.me`, manusia menekan kirim) | Tidak ada | Gratis | Ya | Dipakai, selalu tersedia |
| Baileys (tidak resmi, otomatis) | Ada | Gratis | Ya | Dipakai, dengan semua pengaman di bawah |
| WhatsApp Cloud API (resmi dari Meta) | Tidak ada | Siaran harian berbayar per pesan per penerima (perkiraan ±Rp330 untuk kategori utilitas); balasan gratis sampai 1.000 per bulan per nomor | Tidak: fitur grupnya hanya untuk akun bisnis resmi, maksimal 8 peserta | Tidak dipakai |
| Saluran WhatsApp (Channel), diposting manual | Tidak ada | Gratis | Satu arah; anggota harus mengikuti saluran | Opsional |
| Otomasi aplikasi resmi di HP Android (Tasker, AutoInput) | Rendah, tetap melanggar ketentuan | Gratis | Ya | Tidak dipakai: rapuh, HP harus menyala terus |
| Gateway WhatsApp pihak ketiga | Umumnya sama dengan Baileys (memakai tautan QR) | Berbayar | Ya | Tidak dipakai |

Sumber harga Cloud API: [Pricing on the WhatsApp Business Platform](https://developers.facebook.com/docs/whatsapp/pricing) (kuota 1.000 pesan layanan gratis per nomor per bulan mulai 1 Oktober 2026). Tarif Indonesia per pesan adalah perkiraan; cek rate card resmi sebelum dipakai.

## 2. Semua kemungkinan dan penanganannya

### A. Nomor bot

| Kemungkinan | Penanganan | Oleh |
| --- | --- | --- |
| Nomor baru langsung ditautkan ke bot. Ini penyebab blokir pada uji coba 25 Oktober 2026: diblokir sekitar 1 menit setelah tertaut, sebelum ada pesan terkirim | Pakai nomor untuk chat biasa minimal 10 hari sebelum ditautkan. Halaman pengelola menolak menautkan bila daftar persiapan belum dicentang | Pengurus, Kode |
| Profil kosong, nomor tidak dikenal anggota | Isi nama, foto, dan profil bisnis (kategori, deskripsi "Info cuaca otomatis untuk Kelompok Tani Nawungan 2, data BMKG"). Minta pengurus dan anggota menyimpan nomornya | Pengurus |
| **Dilaporkan anggota sebagai spam.** Laporan pengguna adalah salah satu pemicu blokir terkuat | Admin grup mengumumkan bot sebelum memasukkannya; sosialisasi; profil jelas. Bot tidak pernah chat pribadi, tidak menambahkan orang, dan hanya bisa mengirim ke satu grup tujuan | Pengurus, Kode |
| Ada yang chat pribadi ke nomor bot | Nyalakan **pesan salam** ("Greeting message") di WhatsApp Business ("Nomor ini hanya mengirim info cuaca. Hubungi pengurus untuk pertanyaan."). Pesan ini dikirim oleh aplikasi resmi, bukan bot | Pengurus |
| Akun diambil alih atau didaftarkan di HP lain | Nyalakan verifikasi dua langkah (PIN) di WhatsApp Business | Pengurus |
| **Kartu SIM hangus** karena masa aktif habis, lalu nomornya dipakai orang lain | Catat tanggal masa aktif (dari SMS atau aplikasi operator) dan isi pulsa rutin sebelum habis | Pengurus |
| Ponsel bot hilang atau rusak | PIN mencegah pendaftaran ulang oleh orang lain. Urus kartu pengganti di gerai operator, daftarkan di HP lain, lalu tautkan ulang | Pengurus |

### B. Penautan

| Kemungkinan | Penanganan | Oleh |
| --- | --- | --- |
| Menautkan berulang kali, misalnya saat uji coba | Paling banyak `MAX_LINK_ATTEMPTS_PER_DAY` (3) kali sehari. Penautan berhenti sendiri bila waktunya habis; tidak ada penautan ulang otomatis | Kode |
| Kode tautan lebih sering ditolak (laporan komunitas) | QR menjadi cara utama; kode tautan hanya dibuat bila diminta | Kode |
| Server dinyalakan ulang atau internet putus | Sesi di `data/auth` dipakai lagi, seperti WhatsApp Web; tidak perlu menautkan ulang. Formulir penautan dilipat selama sesi masih berlaku agar tidak ditautkan ulang tanpa perlu | Kode |
| Sesi dikeluarkan WhatsApp (kode 401 atau 403) | Bot berhenti, menandai sesi itu, dan tidak mencoba login lagi dengan sesi mati saat menyala berikutnya. Pengurus menautkan ulang bila nomornya masih bisa dibuka di HP | Kode, Pengurus |
| WhatsApp meminta passkey atau verifikasi tambahan saat menautkan (dilaporkan sebagian pengguna Baileys) | Tidak bisa diatasi kode. Pakai Kirim manual | Sisa risiko |

### C. Pola pengiriman

| Kemungkinan | Penanganan | Oleh |
| --- | --- | --- |
| Langsung mengirim begitu tertaut | Masa tenang 24 jam (diam total), lalu pemanasan 7 hari: paling banyak 3 pesan per hari, tanpa pemberitahuan mendadak | Kode |
| Volume terlalu banyak | Batas 40 pesan keluar per hari, 3 pemberitahuan mendadak per hari, 30 jawaban per hari, jeda 30 detik antar-jawaban | Kode |
| Jam kirim persis sama setiap hari | Ringkasan pagi pada menit acak 05.00-05.14 (berbeda tiap hari, tanpa pola berurutan); pemeriksaan per jam juga pada menit acak | Kode |
| Membalas seketika tanpa membaca | Pesan ditandai dibaca dengan jeda 1-4 detik, lalu status mengetik 3-12 detik; antar-pesan minimal 15 detik | Kode |
| Aktif 24 jam | Panggilan hanya dijawab pukul 05.00-21.00. Status online hanya muncul saat mengirim | Kode |
| Teks yang sama dikirim berulang | Teks identik tidak dikirim dua kali dalam 30 menit | Kode |
| Ringkasan terkirim dua kali karena program crash saat mengirim | Ringkasan dicatat sebelum dikirim, jadi paling banyak sekali sehari. Bila gagal, halaman pengelola menyuruh kirim manual | Kode |
| Pesan ke chat pribadi, grup lain, atau menambahkan anggota | Tidak ada fitur itu. Semua pengiriman lewat satu pintu yang hanya mengizinkan grup tujuan | Kode |

### D. Isi pesan

| Kemungkinan | Penanganan | Oleh |
| --- | --- | --- |
| Tautan di pesan otomatis (umum dianggap sinyal spam) | Pesan otomatis tanpa tautan (`LINK_IN_AUTO_MESSAGES=false`). Tautan BMKG ditaruh di deskripsi grup dan di teks Kirim manual | Kode, Pengurus |
| Mention massal, pesan berantai, huruf kapital semua | Tidak ada di format pesan | Kode |

### E. Server dan jaringan

| Kemungkinan | Penanganan | Oleh |
| --- | --- | --- |
| IP server cloud lebih dicurigai (anggapan komunitas, tidak pernah dinyatakan WhatsApp) | Bila diblokir saat di cloud, jalankan dari koneksi rumah atau posko: laptop, mini PC, atau HP Android lama | Pengembang |
| Server jauh dari lokasi ponsel | Pilih region server terdekat (misalnya Singapura) | Pengembang |
| **Crash berulang** sehingga bot menyambung ulang terus | Pemutus: paling banyak `MAX_CONNECTS_PER_HOUR` (6) sambungan per jam, tercatat di berkas sehingga tetap berlaku walau program menyala ulang. systemd menunggu 60 detik sebelum menyalakan ulang dan berhenti setelah 5 kali gagal dalam 1 jam. Galat yang lolos hanya dicatat | Kode |
| Bot dijalankan dua kali dengan sesi yang sama | Di satu komputer: bot kedua menolak menyala (kunci `data/bot.lock`). Di dua komputer: terdeteksi ("sesi dibuka di tempat lain"), bot berhenti | Kode, Pengembang |
| **Program dihentikan (Ctrl+C) atau crash saat sedang menulis sesi**, sehingga berkas sesi terpotong dan bot harus ditautkan ulang padahal di HP perangkatnya masih tercantum | Berkas sesi ditulis atomik (berkas sementara lalu ganti nama). Ctrl+C dan `systemctl stop` menutup sambungan dengan rapi (bukan logout) dan menunggu penulisan selesai. `creds.json` yang rusak dilaporkan, tidak diam-diam diganti identitas baru | Kode |
| Pembaruan Baileys mengubah perilaku | Versi dikunci di `7.0.0-rc14`. Perbarui dengan sengaja, lalu uji di grup kecil | Kode, Pengembang |
| Baileys terlalu lama tidak diperbarui | Cek rilis Baileys tiap bulan; versi terpasang tampil di halaman pengelola | Pengembang |

### F. Ponsel bot

| Kemungkinan | Penanganan | Oleh |
| --- | --- | --- |
| Ponsel tidak aktif lebih dari 14 hari sehingga perangkat tertaut terputus | Buka WhatsApp Business minimal seminggu sekali dengan internet menyala | Pengurus |
| Perangkat tertaut tidak sengaja dikeluarkan dari menu Perangkat tertaut, atau WhatsApp Business didaftarkan ulang di HP, misalnya setelah pasang ulang aplikasi (biasanya ikut mengeluarkan semua perangkat tertaut) | Status "Perangkat bot dikeluarkan WhatsApp"; tautkan ulang (dihitung sebagai percobaan). Setiap putus dan sambung tercatat di halaman pengelola beserta kodenya | Pengurus |

### G. Halaman pengelola

| Kemungkinan | Penanganan | Oleh |
| --- | --- | --- |
| Kata sandi ditebak | Satu alamat dikunci 15 menit setelah 5 kali salah; semua percobaan dikunci 15 menit setelah 30 kali salah dari berbagai alamat (tercatat sebagai *keamanan*); peringatan bila kata sandi kurang dari 12 karakter | Kode |
| Kata sandi atau cookie disadap (HTTP tanpa enkripsi) | Halaman hanya mendengar `127.0.0.1`; dari luar lewat HTTPS (Caddy + DuckDNS, lihat README). Lewat HTTPS, cookie bertanda `Secure` | Pengembang |
| Pengurus lama masih bisa masuk setelah serah terima | Ganti `ADMIN_PASSWORD`: semua sesi masuk otomatis gugur | Pengembang |
| Tautan palsu yang memunculkan pesan di halaman pengelola, formulir dari situs lain, atau halaman dibingkai situs lain | Pesan di alamat ditandatangani bot; cookie `SameSite=Strict` dan pemeriksaan `Origin`; iframe dilarang | Kode |
| Penyusup masuk lalu mengirim spam | Tetap hanya bisa ke grup tujuan, hanya pesan cuaca (tidak bisa teks bebas), dengan batas harian dan gerbang penautan | Kode |
| Celah di pembaca pesan WhatsApp (siapa pun bisa mengirim pesan ke nomor bot) | Layanan systemd dibatasi: tanpa `sudo`, hanya bisa menulis di `data/`, berkas hanya terbaca pemilik. API mode develop mati di server | Kode |

### H. Bila tetap terjadi masalah

| Kemungkinan | Penanganan | Oleh |
| --- | --- | --- |
| Bot mati atau diblokir pada pagi hari | Patokan: bila pukul 05.30 belum ada ringkasan di grup, buka Kirim manual. Halaman itu menunjukkan bila bot gagal | Pengurus |
| Nomor diblokir | Jangan tautkan ulang nomor itu. Ajukan peninjauan dari aplikasi WhatsApp Business. Pakai nomor cadangan yang sudah dipakai chat biasa minimal 10 hari | Pengurus |
| Risiko tidak bisa diterima sama sekali | `WA_MODE=manual`: Baileys tidak dinyalakan, pengiriman hanya lewat Kirim manual | Pengembang |

## 3. Sisa risiko yang tidak bisa dihilangkan

- Baileys melanggar ketentuan WhatsApp, jadi WhatsApp bisa memblokir kapan saja tanpa pemberitahuan.
- Cara WhatsApp mendeteksi spam tidak diumumkan. Pengaman di atas berdasarkan pengalaman komunitas pengembang dan dugaan wajar, bukan jaminan.
- Perubahan protokol WhatsApp bisa membuat bot berhenti sampai Baileys diperbarui.

Karena itu Kirim manual selalu tersedia sebagai jalur cadangan.

## 4. Urutan pemakaian yang disarankan

| Waktu | Langkah | Mode |
| --- | --- | --- |
| Hari 0 | SIM baru di slot 2, daftar WhatsApp Business, isi profil, nyalakan PIN dan pesan salam, catat masa aktif SIM | `manual`, kirim manual tiap pagi |
| Hari 0 sampai 10 | Pakai nomor untuk chat biasa dengan pengurus dan beberapa anggota; minta mereka menyimpan nomornya | `manual` |
| Hari 10 | Tautkan lewat QR, pilih **grup uji** berisi 3-5 orang | `otomatis` |
| Hari 10 sampai 18 | Masa tenang 24 jam, lalu pemanasan 7 hari di grup uji | `otomatis` |
| Setelah itu | Admin mengumumkan bot di grup Kelompok Tani, memasukkan nomor bot, lalu grup tujuan dipindah ke grup Kelompok Tani | `otomatis`, kirim manual sebagai cadangan |

Pengaturan yang disebut di atas ada di [.env.example](.env.example).
