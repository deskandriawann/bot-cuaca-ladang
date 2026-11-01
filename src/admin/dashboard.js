// Halaman utama pengelola: kotak ringkasan, langkah menyiapkan bot, info cuaca pagi, jam kirim, dan kegiatan terbaru.
import { config } from '../config.js';
import { addDays, minuteLabel, nowWib } from '../time.js';
import { getState } from '../store.js';
import { greeting } from '../messages.js';
import { wa, isConnected, hasLinkedSession } from '../whatsapp/connection.js';
import { linkPhase, dailyLimit } from '../bot/send.js';
import { SCHEDULE_EARLIEST, SCHEDULE_LATEST, defaultMorningBase, morningBase, morningRange } from '../bot/schedule.js';
import { esc, ICONS, flash, hero, page, tiles } from './layout.js';
import { STATUS_COLOR, logEntry, morningTime, nextMorningText, phoneText, statusOf, wibText } from './format.js';
import { devCard } from './dev.js';

const manualMode = config.waMode === 'manual';

/**
 * Langkah menyambungkan bot, berurutan: tautkan nomor, pilih grup, masa tenang lewat, pesan uji terkirim.
 * current: langkah pertama yang belum selesai (-1 bila semua selesai).
 */
export function setupSteps({ linked, grouped, quiet, tested }) {
  const done = [linked, linked && grouped, linked && !quiet, linked && grouped && !quiet && tested];
  return { done, current: done.indexOf(false), complete: done.every(Boolean) };
}

// Pesan uji berlaku untuk satu penautan dan satu grup: nomor ditautkan ulang atau grup diganti, uji lagi
export const testKey = (state) => `${state.linkedAt}|${state.groupJid}`;

/** Pesan perkenalan yang dikirim sebagai pesan percobaan. */
export function testText() {
  return [
    `✅ *Bot info cuaca ${config.placeName} sudah aktif di grup ini.*`,
    '',
    `🌾 Setiap pagi pukul ${minuteLabel(morningBase())} WIB, bot mengirim info cuaca dan jam aman ke ladang.`,
    `❓ Untuk bertanya, ketik: *halo ${config.botName} besok* (cara lain: *halo ${config.botName} menu*)`,
  ].join('\n');
}

/** Kotak "Info cuaca pagi". info: { morning: status hari ini, phase, group }. */
function morningTile({ morning, phase, group }) {
  const [value, sub, color] = morning === 'terkirim' ? ['Terkirim ✓', 'Sudah masuk grup hari ini', 'green']
    : morning === 'gagal' ? ['Belum terkirim', 'Kirim lewat tombol di bawah', 'red']
      : morning === 'mengirim' ? ['Sedang dikirim', 'Tunggu sebentar', 'amber']
        : !group || phase === 'tenang' ? ['Belum aktif', 'Selesaikan langkah di bawah', 'amber']
          : ['Terjadwal', `Dikirim ${nextMorningText()}`, 'amber'];
  return { color, icon: ICONS.sun, label: 'Info cuaca pagi', value, sub };
}

/** Panduan menyambungkan bot langkah demi langkah, sampai pesan percobaan terkirim. */
function setupCard({ done, current }, state, until, today) {
  const steps = [
    {
      title: 'Tautkan nomor bot',
      body: done[0]
        ? `<p>Nomor <strong>${esc(phoneText(wa.phone ?? state.phone))}</strong> sudah tertaut ke bot.</p>
<a class="btn outline" href="/ganti-nomor">${ICONS.phone}Ganti nomor bot</a>`
        : wa.status === 'menunggu_tautan'
          ? `<p>Sedang menunggu. Buka kode QR, lalu pindai dengan HP bot.</p>
<a class="btn" href="/tautan">Lanjutkan: tampilkan kode QR</a>`
          : `<p>Hubungkan nomor WhatsApp Business (SIM 2) ke bot. Siapkan HP bot, dan satu laptop atau HP lain untuk menampilkan kode QR.</p>
<a class="btn" href="/ganti-nomor">${ICONS.phone}Tautkan nomor bot</a>`,
    },
    {
      title: 'Masukkan bot ke grup, lalu pilih grupnya',
      body: done[1]
        ? `<p>Grup penerima: <strong>${esc(state.groupName)}</strong>.</p>
<a class="btn outline" href="/grup">${ICONS.users}Ganti grup</a>`
        : `<p>Minta admin grup memasukkan nomor bot ke grup ${esc(config.groupLabel)}. Sebaiknya coba dulu di grup kecil berisi 3-5 orang. Setelah itu, pilih grupnya di sini.</p>
${!done[0] ? '<p class="muted">Bisa dilakukan setelah langkah 1 selesai.</p>'
    : isConnected() ? `<a class="btn" href="/grup">${ICONS.users}Pilih grup</a>` : '<p class="warn">Tunggu sampai status bot <strong>Aktif</strong>, lalu muat ulang halaman ini.</p>'}`,
    },
    {
      title: 'Tunggu 24 jam dulu',
      body: done[2]
        ? '<p>Sudah lewat 24 jam.</p>'
        : done[0]
          ? `<p>Nomor yang baru tertaut sebaiknya diam dulu supaya tidak dicurigai WhatsApp. Bot boleh mulai mengirim pada <strong>${esc(wibText(until))}</strong>.</p>
<p class="muted">Tidak perlu melakukan apa-apa, cukup tunggu. Grup boleh dipilih sekarang.</p>`
          : '<p class="muted">Dimulai sendiri setelah nomor tertaut. Selama 24 jam bot belum mengirim apa pun.</p>',
    },
    {
      title: 'Kirim pesan percobaan',
      body: current === 3
        ? `<p><strong>Gunanya:</strong> memastikan bot benar-benar bisa mengirim ke grup. Bot mengirim satu pesan perkenalan ini ke grup <strong>${esc(state.groupName)}</strong>:</p>
<pre>${esc(testText())}</pre>
<p>Setelah menekan tombol, buka grup di WhatsApp dan lihat apakah pesannya masuk.</p>
<form method="post" action="/uji"><button type="submit">${ICONS.send}Kirim pesan percobaan</button></form>`
        : '<p class="muted">Bisa dilakukan setelah langkah 1 sampai 3 selesai, untuk memastikan bot benar-benar bisa mengirim ke grup.</p>',
    },
  ];
  const kind = (i) => (done[i] ? 'done' : i === current ? 'now' : 'later');
  return `<section class="card"><h2>${ICONS.list}Menyiapkan bot</h2>
<p class="muted">Ikuti dari atas ke bawah. Langkah yang sudah selesai diberi centang hijau.</p>
<ol class="steps">${steps.map((s, i) => `<li class="step ${kind(i)}"><span class="step-num">${done[i] ? ICONS.check : i + 1}</span>
<div><h3>${s.title}</h3>${s.body}</div></li>`).join('')}
<li class="step finish"><span class="step-num">${ICONS.flag}</span><div><h3>Selesai! Bot berjalan sendiri</h3>
<p>Setiap pagi sekitar pukul ${morningTime(today)} WIB bot mengirim info cuaca ke grup. Bapak/Ibu tidak perlu menekan apa-apa.</p></div></li>
</ol></section>`;
}

/** Jam kirim info cuaca pagi, diatur pengurus. Berlaku langsung, tanpa menyalakan ulang bot. */
function scheduleCard(state) {
  const fromEnv = defaultMorningBase();
  const asInput = (minutes) => minuteLabel(minutes).replace('.', ':');
  const reset = state.morningSchedule && morningBase() !== fromEnv
    ? `<form method="post" action="/jam-pagi"><input type="hidden" name="jam" value="bawaan">
<button class="alt" type="submit">Kembali ke jam awal (${minuteLabel(fromEnv)})</button></form>`
    : '';
  return `<section class="card"><h2>${ICONS.clock}Jam kirim info cuaca</h2>
<p>Setiap hari sekitar pukul <strong>${morningRange()} WIB</strong>.</p>
<form method="post" action="/jam-pagi">
<label for="jam">Pilih jam baru</label>
<div class="actions"><input id="jam" type="time" name="jam" value="${asInput(morningBase())}"
 min="${asInput(SCHEDULE_EARLIEST)}" max="${asInput(SCHEDULE_LATEST)}" required>
<button type="submit">${ICONS.check}Simpan jam</button></div>
</form>
${reset}
<p class="muted">Saran: pukul 05.00-06.00, sebelum berangkat ke ladang. Supaya terasa alami, jam kirimnya bergeser beberapa menit setiap hari. Bila info hari ini sudah terkirim, jam baru berlaku mulai besok.</p></section>`;
}

/** Setelah semua langkah selesai: info cuaca pagi, jam kirim, dan tombol ganti nomor atau grup. */
function readyCards(state, today) {
  const status = state.morningSentOn === today ? state.morningStatus : null;
  const morning = status === 'terkirim'
    ? `<p class="ok"><strong>${ICONS.check} Info cuaca hari ini sudah masuk ke grup.</strong></p>
<p class="muted">Besok bot mengirim lagi sekitar pukul ${morningTime(addDays(today, 1))} WIB.</p>`
    : status === 'mengirim'
      ? '<p class="warn"><strong>Info cuaca hari ini sedang dikirim.</strong> Tunggu sebentar, lalu muat ulang halaman ini.</p>'
      : `${status === 'gagal' ? '<p class="bad"><strong>Info cuaca hari ini belum berhasil terkirim.</strong></p>'
        : `<p>Bot akan mengirim sendiri <strong>${nextMorningText()}</strong>.</p>`}
<p>Belum masuk ke grup sampai pukul ${minuteLabel(morningBase() + 30)}? Tekan tombol ini, bot langsung mengirim. Tidak perlu ditekan setiap hari.</p>
<form method="post" action="/kirim-pagi"><button type="submit">${ICONS.send}Kirim info cuaca sekarang</button></form>
<p class="muted">Masih belum bisa? Kirim sendiri lewat tombol <strong>Buka teks cuaca hari ini</strong> di bagian atas.</p>`;
  const healthy = isConnected()
    ? `<div class="note ok">${ICONS.check} Semua berjalan lancar. Bot mengirim info cuaca ke grup <strong>${esc(state.groupName)}</strong> setiap pagi, tanpa perlu ditekan.</div>`
    : '';
  return `${healthy}
<section class="card"><h2>${ICONS.sun}Info cuaca pagi ini</h2>${morning}</section>
${scheduleCard(state)}
<section class="card"><h2>${ICONS.sliders}Pengaturan bot</h2>
<div class="setting"><span class="setting-icon">${ICONS.phone}</span>
<div><h3>Nomor bot: ${esc(phoneText(wa.phone ?? state.phone))}</h3><p class="muted">Ganti bila nomor bot diblokir atau kartunya diganti.</p></div>
<a class="btn outline" href="/ganti-nomor">Ganti nomor bot</a></div>
<div class="setting"><span class="setting-icon">${ICONS.users}</span>
<div><h3>Grup penerima: ${esc(state.groupName)}</h3><p class="muted">Ganti bila info cuaca harus dikirim ke grup lain.</p></div>
<a class="btn outline" href="/grup">Ganti grup</a></div>
</section>`;
}

function activityCard(log) {
  const rows = log.slice(0, 8).map((entry) => {
    const { icon, label, detail, when } = logEntry(entry);
    return `<div class="log"><span class="log-icon" aria-hidden="true">${icon}</span>
<div class="log-text"><strong>${esc(label)}</strong><span>${esc(detail)}</span></div><time>${esc(when)}</time></div>`;
  }).join('');
  return `<section class="card"><h2>${ICONS.activity}Kegiatan bot terbaru</h2>${rows || '<p class="muted">Belum ada kegiatan.</p>'}</section>`;
}

/** message: pesan dari tindakan sebelumnya. main: status bot utama (hanya di mode develop), atau null. */
export function dashboard(message, main = null) {
  const state = getState();
  const { phase, until } = linkPhase();
  const today = nowWib().date;

  // Kotak ringkasan: bot di proses ini, bot utama (mode develop), atau tidak ada bot (mode manual)
  const live = !manualMode
    ? {
      status: wa.status, phone: wa.phone ?? state.phone, sent: state.sent?.date === today ? state.sent.count : 0,
      limit: dailyLimit(phase), group: state.groupName, morning: state.morningSentOn === today ? state.morningStatus : null, phase,
    }
    : main?.ok ? {
      status: main.status, phone: main.phone, sent: main.sentToday, limit: main.limit, group: main.groupName,
      morning: main.morningStatus, phase: main.phase,
    } : null;
  const liveStatus = live && statusOf(live.status);
  const stats = tiles([
    {
      color: live ? STATUS_COLOR[liveStatus.kind] : 'amber', icon: ICONS.signal, label: 'Status bot',
      value: live ? liveStatus.short : main ? 'Belum berjalan' : 'Kirim manual',
      sub: live ? 'Tautkan nomor di langkah 1' : main ? 'Bot utama belum menyala' : 'Bot tidak mengirim sendiri',
      subHtml: live?.phone ? `Nomor <span class="nowrap">${esc(phoneText(live.phone))}</span>` : undefined,
    },
    {
      color: 'blue', icon: ICONS.message, label: 'Pesan hari ini',
      value: live ? String(live.sent) : '–',
      sub: !live ? 'Dikirim lewat WhatsApp sendiri'
        : live.phase === 'pemanasan' ? `Nomor baru: batas sementara ${live.limit} per hari` : `Batas aman ${live.limit} pesan per hari`,
    },
    {
      color: 'violet', icon: ICONS.users, label: 'Grup penerima',
      value: live ? live.group ?? 'Belum dipilih' : config.groupLabel,
      sub: live ? (live.group ? 'Menerima info cuaca' : 'Pilih grup di langkah 2') : 'Dikirim manual',
    },
    live ? morningTile(live) : {
      color: 'amber', icon: ICONS.sun, label: 'Info cuaca pagi', value: 'Kirim manual', sub: 'Lewat tombol di bagian atas',
    },
  ]);

  // Hanya pemberitahuan yang perlu ditindaklanjuti; kata sandi pendek cukup diingatkan di log server saat menyala
  let content;
  let notes = '';
  if (manualMode) {
    content = main ? devCard(main) : `<section class="card"><h2>${ICONS.send}Kirim manual</h2><p>Bot sedang tidak mengirim sendiri. Kirim info cuaca setiap pagi lewat tombol <strong>Buka teks cuaca hari ini</strong> di bagian atas.</p></section>`;
  } else {
    const setup = setupSteps({
      linked: hasLinkedSession(), grouped: Boolean(state.groupJid), quiet: phase === 'tenang', tested: state.testedFor === testKey(state),
    });
    content = setup.complete ? readyCards(state, today) : setupCard(setup, state, until, today) + scheduleCard(state);
    const status = statusOf(wa.status);
    const statusNote = !wa.error && status.kind !== 'ok' && setup.done[0] ? flash(status.text, 'warn') : '';
    notes = wa.error ? flash(wa.error, 'bad') : statusNote;
  }

  return page('Beranda', `${flash(message, /^Gagal/.test(message ?? '') ? 'bad' : 'ok')}
${notes}
${stats}
<div class="cols"><div>
${content}
</div><div>
${activityCard(state.log)}
</div></div>`, {
    wide: true,
    hero: hero({
      pill: `${greeting(nowWib().hour)}, Bapak/Ibu Pengurus 👋`,
      title: 'Bot Cuaca Ladang',
      lead: `Pantau dan atur info cuaca harian untuk ${config.groupLabel}, ${config.placeName}, dari satu halaman.`,
      actions: '<div class="actions"><a class="btn" href="/kirim">Buka teks cuaca hari ini</a><a class="btn alt" href="/kirim?jenis=besok">Cuaca besok</a></div>',
    }),
  });
}
