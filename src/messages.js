// Penyusunan teks pesan WhatsApp. *teks* = cetak tebal di WhatsApp.
//
// Pembaca utama berusia 50-60 tahun, jadi: yang terpenting (jam aman ke ladang) ditaruh paling atas,
// setiap baris diawali satu ikon agar mudah dipindai, kalimat pendek, dan jam ditulis "pukul 15.00".
import { config } from './config.js';
import {
  PERIODS, fieldSlots, safeWindows, sprayWindow, worstSlot, strongestWind, tempRange, hazardsOf, isSafe,
  hazardLabel, condition, isRain, isThunder, isSureRain, isRainWarning, windFromText, windFromDegrees, wmoText,
} from './weather/analysis.js';
import { HARI, BULAN, addDays, weekdayIndex, longDate, shortDate, hourLabel, pad } from './time.js';

const OM_NOTE = 'Prakiraan lebih dari 3 hari hanya gambaran umum, bukan dari BMKG. Cek lagi mendekati harinya.';
const THUNDER_ADVICE = '⚡ Saat ada petir, segera tinggalkan ladang dan jauhi pohon tinggi.';

const WEATHER_EMOJI = {
  petir: '⛈️',
  hujan_lebat: '🌧️',
  hujan_sedang: '🌧️',
  hujan_ringan: '🌦️',
  kabut: '🌫️',
  berawan_tebal: '☁️',
  berawan: '⛅',
  cerah_berawan: '🌤️',
  cerah: '☀️',
};
const HAZARD_EMOJI = { petir: '⛈️', hujan_lebat: '🌧️', hujan_sedang: '🌧️', angin: '💨' };
const PERIOD_EMOJI = { Pagi: '🌅', Siang: '🌞', Sore: '🌇' };

function slotEmoji(slot) {
  const cond = condition(slot);
  if (cond === 'cerah' && (slot.hour >= 18 || slot.hour < 6)) return '🌙';
  return WEATHER_EMOJI[cond];
}

// Kode cuaca WMO yang dipakai Open-Meteo
function wmoEmoji(code) {
  if (code === 0) return '☀️';
  if (code === 1 || code === 2) return '🌤️';
  if (code === 3) return '⛅';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 95) return '⛈️';
  if ([63, 65, 66, 67, 81, 82].includes(code)) return '🌧️';
  if (code >= 51) return '🌦️';
  return '⛅';
}

/** 'Cerah Berawan' → 'Cerah berawan' */
const sentence = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : text);

function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} dan ${items.at(-1)}`;
}

function rangeText([min, max], unit = '') {
  return min === max ? `${min}${unit}` : `${min}-${max}${unit}`;
}

const tempText = (range) => rangeText(range, '°C');
const timesText = (slots) => joinList(slots.map((s) => hourLabel(s.hour)));

/** ' (peluang 40-60%)' dari peluang hujan slot-slot, atau kosong bila tidak ada datanya. */
function chanceText(slots) {
  const chances = [slots].flat().map((s) => s.rainChance).filter((c) => c != null);
  return chances.length > 0 ? ` (peluang ${rangeText([Math.min(...chances), Math.max(...chances)], '%')})` : '';
}

function windText(slot) {
  const from = windFromText(slot.windFrom);
  return `${Math.round(slot.windKmh)} km/jam${from ? ` dari ${from}` : ''}`;
}

function windowsText(windows) {
  return joinList(windows.map(([a, b]) => `${hourLabel(a)}-${hourLabel(b)}`));
}

/** 0 → 'hari ini', 1 → 'besok', 2 → 'lusa', 5 → '5 hari lagi' */
function whenText(offset) {
  return ['hari ini', 'besok', 'lusa'][offset] ?? `${offset} hari lagi`;
}

/** Baris tautan rincian, hanya bila LINK_IN_AUTO_MESSAGES=true (tautan di pesan otomatis = sinyal spam). */
function linkLines() {
  return config.linkInAutoMessages && config.detailLink ? [`🔗 Rincian: ${config.detailLink}`] : [];
}

/** Baris-baris diikuti satu baris kosong, atau tidak sama sekali bila kosong. */
const block = (lines) => (lines.length > 0 ? [...lines, ''] : []);

/** Asal angka peluang hujan (BMKG tidak memberinya), atau null bila tidak ada. */
function chanceSource(slots) {
  const models = Math.max(0, ...slots.map((s) => Object.keys(s.rainModels ?? {}).length));
  if (models > 0) return `peluang hujan gabungan ${models} model cuaca dunia`;
  return slots.some((s) => s.rainChance != null) ? 'peluang hujan dari Open-Meteo' : null;
}

/** tip: satu baris contoh pertanyaan berikutnya, agar anggota terbiasa bertanya ke bot. */
function footer(source, slots, tip) {
  const lines = [];
  if (source === 'openmeteo') lines.push(`ℹ️ ${OM_NOTE}`);
  const chance = chanceSource(slots);
  lines.push(source === 'bmkg' ? `📡 Sumber: BMKG${chance ? `, ${chance}` : ''}` : '📡 Sumber: Open-Meteo');
  lines.push(tip, ...linkLines());
  return lines;
}

/** Contoh hari dan tanggal yang benar-benar akan datang, agar contoh pertanyaan terasa nyata. */
function examples(today) {
  const date = addDays(today, 4);
  const dayName = HARI[weekdayIndex(addDays(today, 3))];
  return {
    dayName,
    weekday: dayName.toLowerCase(),
    day: Number(date.slice(8)),
    month: BULAN[Number(date.slice(5, 7)) - 1].toLowerCase(),
  };
}

/** Contoh pertanyaan di ringkasan pagi, berganti tiap hari (teks pagi juga jadi tidak sama persis tiap hari). */
function morningTip(date) {
  const n = config.botName;
  const { dayName, weekday, day } = examples(date);
  const tips = [
    `💬 Mau tahu cuaca besok? Ketik *halo ${n} besok*`,
    `💬 Mau tahu cuaca hari ${dayName}? Ketik *halo ${n} ${weekday}*`,
    `💬 Mau tahu cuaca tanggal ${day}? Ketik *halo ${n} tanggal ${day}*`,
    `💬 Lusa mau ke ladang? Ketik *halo ${n} lusa*`,
    `💬 Mau lihat 10 hari ke depan? Ketik *halo ${n} 10 hari*`,
    `💬 Cara bertanya lainnya: ketik *halo ${n} menu*`,
  ];
  return tips[Math.round(Date.parse(date) / 86_400_000) % tips.length];
}

/** Saran pertanyaan berikutnya setelah menjawab cuaca satu hari. */
function nextTip(dayIndex) {
  const n = config.botName;
  if (dayIndex === 0) return `💬 Cuaca besok? Ketik *halo ${n} besok*`;
  if (dayIndex === 1) return `💬 Cuaca lusa? Ketik *halo ${n} lusa*`;
  return `💬 Cuaca 10 hari ke depan? Ketik *halo ${n} 10 hari*`;
}

/** Judul jam aman: ✅ aman sepanjang jam kerja, ⚠️ sebagian, ⛔ tidak ada. Kosong bila tidak ada slot jam kerja. */
function safeHeadline(slots, label = 'JAM AMAN KE LADANG') {
  const windows = safeWindows(slots);
  if (!windows) return [];
  if (windows.length === 0) return [`⛔ *${label}*`, '*Tidak ada, sebaiknya tunda ke ladang*'];
  const full = fieldSlots(slots).every(isSafe);
  return [`${full ? '✅' : '⚠️'} *${label}*`, `*${windowsText(windows)}*`];
}

/**
 * Peringatan tambahan untuk hujan sedang, lebat, atau hujan petir yang pasti.
 * Hujan ringan dan hujan yang belum pasti tidak masuk sini, cukup jadi info di conditionLines.
 */
function rainWarningLines(slots) {
  const field = fieldSlots(slots);
  const sure = (field.length > 0 ? field : slots).filter(isRainWarning);
  if (sure.length === 0) return [];
  return ['⚠️ *POTENSI HUJAN*', ...sure.map((s) => `${slotEmoji(s)} *${sentence(s.desc)}* sekitar pukul ${hourLabel(s.hour)}${chanceText(s)}`)];
}

/** Hujan, petir, dan angin untuk satu hari data BMKG. */
function conditionLines(slots) {
  const field = fieldSlots(slots);
  const scope = field.length > 0 ? field : slots;
  const rainy = scope.filter(isRain);
  // Hujan yang sudah masuk "potensi hujan" tidak diulang; sisanya hanya info, "mungkin" bila belum pasti
  const info = rainy.filter((s) => !isRainWarning(s));
  const thunder = scope.filter(isThunder);
  const wind = strongestWind(scope);
  let rain = rainy.length > 0 ? null : '☔ Hujan: tidak ada';
  if (info.length > 0) {
    const worst = worstSlot(info);
    const desc = isSureRain(worst) ? sentence(worst.desc) : `Mungkin ${worst.desc.toLowerCase()}`;
    rain = `☔ ${desc} sekitar pukul ${timesText(info)}${chanceText(info)}`;
  }
  return [
    ...(rain ? [rain] : []),
    thunder.length > 0 ? `⚡ Petir sekitar pukul ${timesText(thunder)}` : '⚡ Petir: tidak ada',
    `💨 Angin hingga ${windText(wind)}${wind.windKmh >= config.strongWindKmh ? ' ⚠️ kencang' : ''}`,
  ];
}

/** Saran praktis dari data: kapan selesai di ladang, keselamatan saat petir, dan waktu menyemprot. */
function adviceLines(slots) {
  const field = fieldSlots(slots);
  if (field.length === 0) return [];
  const lines = [];
  // Selaras dengan jam aman: hanya petir, dan hujan sedang atau lebat yang pasti, membuat pekerjaan perlu selesai lebih awal
  const heavy = field.filter((s) => isThunder(s) || isRainWarning(s));
  const light = field.filter((s) => isRain(s) && !heavy.includes(s));
  if (field.some(isThunder)) lines.push(THUNDER_ADVICE);
  if (heavy.length > 0) {
    lines.push(heavy[0].hour > field[0].hour
      ? `🕐 Usahakan pekerjaan di ladang selesai sebelum pukul ${hourLabel(heavy[0].hour)}.`
      : '🧥 Hujan cukup deras, sebaiknya tunda ke ladang.');
  } else if (light.length > 0) {
    lines.push(`🧥 Bawa jas hujan, ada kemungkinan hujan sekitar pukul ${timesText(light)}.`);
  }
  if (field.some((s) => s.windKmh >= config.strongWindKmh)) {
    lines.push('💨 Angin kencang: hati-hati di tempat terbuka dan amankan peralatan.');
  }
  if (lines.length === 0) lines.push('👍 Cuaca mendukung untuk bekerja di ladang.');
  const spray = sprayWindow(slots);
  lines.push(spray
    ? `💦 Waktu menyemprot yang baik: ${hourLabel(spray[0])}-${hourLabel(spray[1])}.`
    : '💦 Kurang cocok untuk menyemprot (hujan atau angin).');
  return ['💡 *Saran*', ...lines];
}

export function morningMessage(bmkg, date) {
  const slots = bmkg.days[date];
  if (!slots?.length) return unavailableMessage();
  const periods = [];
  for (const period of PERIODS) {
    const inPeriod = slots.filter((s) => s.hour >= period.from && s.hour < period.to);
    if (inPeriod.length === 0) continue;
    const worst = worstSlot(inPeriod);
    periods.push(`${PERIOD_EMOJI[period.name]} ${period.name} (${pad(period.from)}-${pad(period.to)}): ` +
      `${slotEmoji(worst)} ${sentence(worst.desc)}, ${tempText(tempRange(inPeriod))}`);
  }
  return [
    '🌾 *INFO CUACA HARI INI*',
    `Selamat pagi, Bapak/Ibu ${config.groupLabel} 🙏`,
    '',
    `📍 ${bmkg.place}`,
    `📅 ${longDate(date)}`,
    '',
    ...block(safeHeadline(slots)),
    ...block(rainWarningLines(slots)),
    ...block(periods),
    ...block(conditionLines(slots)),
    ...block(adviceLines(slots)),
    ...footer('bmkg', slots, morningTip(date)),
  ].join('\n');
}

export function dayDetailMessage(bmkg, date, dayIndex) {
  const slots = bmkg.days[date];
  if (!slots?.length) return unavailableMessage();
  // Rincian per 3 jam untuk siang hari saja; malam hanya bila tidak ada yang tersisa (ditanya larut malam)
  const daytime = slots.filter((s) => s.hour >= 6 && s.hour <= 18);
  const shown = daytime.length > 0 ? daytime : slots;
  const hours = shown.map((s) => `*${hourLabel(s.hour)}*  ${slotEmoji(s)} ${sentence(s.desc)}, ${s.temp}°C${hazardsOf(s).length > 0 ? ' ⚠️' : ''}`);
  const humidity = shown.map((s) => s.humidity);
  return [
    `🌾 *CUACA ${whenText(dayIndex).toUpperCase()}*`,
    `📍 ${bmkg.place}`,
    `📅 ${longDate(date)}`,
    '',
    ...block(safeHeadline(slots)),
    ...block(rainWarningLines(slots)),
    ...block(hours),
    ...conditionLines(slots),
    `💧 Kelembapan ${rangeText([Math.min(...humidity), Math.max(...humidity)], '%')}`,
    '',
    ...block(adviceLines(slots)),
    ...footer('bmkg', slots, nextTip(dayIndex)),
  ].join('\n');
}

export function dayShortMessage(om, date, dayIndex) {
  const d = om.days[date];
  if (!d) return unavailableMessage();
  return [
    '🗓️ *GAMBARAN CUACA*',
    `📅 ${longDate(date)} (${whenText(dayIndex)})`,
    '',
    `${wmoEmoji(d.code)} ${wmoText(d.code)}`,
    `🌡️ Suhu ${tempText([Math.round(d.tempMin), Math.round(d.tempMax)])}`,
    `☔ Peluang hujan ${d.rainChance}%`,
    `💨 Angin hingga ${Math.round(d.windMaxKmh)} km/jam dari ${windFromDegrees(d.windDirDeg)}`,
    '',
    ...footer('openmeteo', [], nextTip(dayIndex)),
  ].join('\n');
}

/** Ringkasan 10 hari: hari ke-1 sampai ke-3 dari BMKG, sisanya gambaran umum dari Open-Meteo. */
export function outlookMessage(bmkg, om, dates) {
  const lines = ['🗓️ *CUACA 10 HARI KE DEPAN*', `📍 ${bmkg?.place ?? config.placeName}`, ''];
  if (bmkg) {
    lines.push('*Dari BMKG:*');
    for (const date of dates.slice(0, 3)) {
      const slots = bmkg.days[date];
      if (!slots?.length) continue;
      const field = fieldSlots(slots);
      const scope = field.length > 0 ? field : slots;
      const worst = worstSlot(scope);
      const windows = safeWindows(slots);
      let safe = '';
      if (windows?.length) safe = `, aman pukul ${joinList(windows.map(([a, b]) => `${pad(a)}-${pad(b)}`))}`;
      else if (windows) safe = ', tidak aman ke ladang';
      lines.push(`${slotEmoji(worst)} ${shortDate(date)}: ${sentence(worst.desc)}, ${tempText(tempRange(scope))}${safe}`);
    }
    lines.push('');
  }
  if (om) {
    lines.push('*Gambaran umum:*');
    for (const date of dates.slice(bmkg ? 3 : 0)) {
      const d = om.days[date];
      if (!d) continue;
      lines.push(`${wmoEmoji(d.code)} ${shortDate(date)}: ${wmoText(d.code)}, ` +
        `${tempText([Math.round(d.tempMin), Math.round(d.tempMax)])}, hujan ${d.rainChance}%`);
    }
    lines.push('');
  }
  const { weekday } = examples(dates[0]);
  lines.push(
    `ℹ️ ${OM_NOTE}`,
    '📡 Sumber: BMKG dan Open-Meteo',
    `💬 Rincian satu hari? Ketik misalnya *halo ${config.botName} ${weekday}*`,
    ...linkLines(),
  );
  return lines.join('\n');
}

/**
 * Pemberitahuan perubahan mendadak.
 * remaining: slot BMKG hari ini yang belum lewat; newKeys: ['YYYY-MM-DD 15 petir', ...]
 */
export function updateMessage(place, remaining, newKeys, nowHhmm) {
  const items = newKeys.map((key) => {
    const [, hour, type] = key.split(' ');
    const slot = remaining.find((s) => s.hour === Number(hour));
    return `${HAZARD_EMOJI[type]} ${hazardLabel(type)} sekitar pukul ${hourLabel(Number(hour))}${slot && type !== 'angin' ? chanceText(slot) : ''}`;
  });
  return [
    '⚠️ *PERINGATAN CUACA*',
    `📍 ${place}`,
    `🕐 Pukul ${nowHhmm} WIB`,
    '',
    'BMKG memperbarui prakiraan hari ini:',
    ...block(items),
    ...block(safeHeadline(remaining, 'JAM AMAN TERSISA')),
    ...block(newKeys.some((key) => key.endsWith(' petir')) ? [THUNDER_ADVICE] : []),
    '📡 Sumber: BMKG',
  ].join('\n');
}

/**
 * Pengingat hujan lebat atau hujan petir yang pasti: menjelang turun, atau sudah masuk jamnya.
 * Bot tidak punya data hujan yang benar-benar turun, jadi tetap ditulis "diperkirakan".
 */
export function rainSoonMessage(place, slot, nowHour, nowHhmm) {
  const kind = isThunder(slot) ? 'PETIR' : 'LEBAT';
  const started = slot.hour <= nowHour;
  return [
    `${slotEmoji(slot)} *${started ? `PERINGATAN HUJAN ${kind}` : `HUJAN ${kind} SEBENTAR LAGI`}*`,
    `📍 ${place}`,
    `🕐 Pukul ${nowHhmm} WIB`,
    '',
    `${sentence(slot.desc)} diperkirakan ${started ? 'turun sejak' : 'mulai'} sekitar pukul ${hourLabel(slot.hour)}${chanceText(slot)}.`,
    started ? '🏠 Bila masih di ladang, segera berteduh.' : '🏠 Segera selesaikan pekerjaan di ladang dan cari tempat berteduh.',
    ...(isThunder(slot) ? [THUNDER_ADVICE] : []),
    '',
    '📡 Sumber: BMKG',
  ].join('\n');
}

/** today: tanggal hari ini, untuk contoh hari dan tanggal yang benar-benar akan datang. */
export function helpMessage(today) {
  const n = config.botName;
  const { dayName, weekday, day, month } = examples(today);
  return [
    '🤖 *CARA BERTANYA KE BOT CUACA*',
    `Awali dengan *halo ${n}*, lalu sebut harinya. Bot mengenali sendiri hari yang ditanya:`,
    '',
    `☀️ *halo ${n}* → cuaca hari ini`,
    `📅 *halo ${n} besok* atau *halo ${n} lusa*`,
    `📅 *halo ${n} ${weekday}* → hari ${dayName} terdekat`,
    `📅 *halo ${n} tanggal ${day}* atau *halo ${n} ${day} ${month}*`,
    `📅 *halo ${n} 3 hari lagi*`,
    `🗓️ *halo ${n} 10 hari* → ringkasan 10 hari ke depan`,
    '',
    `🗣️ Boleh juga bahasa Jawa, misalnya *halo ${n} sesuk* atau *halo ${n} setu*.`,
    'ℹ️ Hari 1-3 dari BMKG, hari 4-10 gambaran umum dari Open-Meteo.',
    ...(config.linkInAutoMessages ? linkLines() : ['🔗 Rincian lengkap: tautan BMKG di deskripsi grup.']),
  ].join('\n');
}

export function tooFarMessage(today) {
  return [
    `🙏 Maaf, prakiraan hanya tersedia sampai 10 hari ke depan (sampai ${longDate(addDays(today, 9))}).`,
    '',
    `💬 Lihat 10 hari ke depan: ketik *halo ${config.botName} 10 hari*`,
  ].join('\n');
}

export function pastMessage() {
  const n = config.botName;
  return [
    '🙏 Maaf, bot hanya punya prakiraan dari hari ini sampai 10 hari ke depan, bukan untuk hari yang sudah lewat.',
    '',
    `💬 Cuaca hari ini: ketik *halo ${n}*`,
    `💬 Cuaca besok: ketik *halo ${n} besok*`,
  ].join('\n');
}

export function unknownMessage(today) {
  return `🤔 Maaf, bot belum paham pertanyaannya.\n\n${helpMessage(today)}`;
}

export function thanksMessage() {
  return '🙏 Sama-sama, Bapak/Ibu. Semoga lancar di ladang 🌾';
}

export function unavailableMessage() {
  const where = config.linkInAutoMessages && config.detailLink ? config.detailLink : 'aplikasi Info BMKG';
  return `🙏 Maaf, data cuaca belum tersedia saat ini.\nSilakan coba lagi nanti atau cek langsung di ${where}.`;
}
