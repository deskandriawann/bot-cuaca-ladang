// Penyusunan teks pesan WhatsApp. *teks* = cetak tebal di WhatsApp.
//
// Pembaca utama berusia 50-60 tahun, jadi: yang terpenting (peringatan hujan) ditaruh paling atas,
// setiap baris diawali satu ikon agar mudah dipindai, kalimat pendek, dan jam ditulis "pukul 15.00".
import { config } from './config.js';
import {
  PERIODS, fieldSlots, lateNightSlots, reportSlots, worstSlot, strongestWind, tempRange, hazardsOf,
  hazardLabel, condition, isRain, isThunder, isSureRain, isRainWarning, windFromText, windFromDegrees, wmoText,
} from './weather/analysis.js';
import { HARI, BULAN, addDays, weekdayIndex, longDate, shortDate, hourLabel, pad } from './time.js';

const OM_NOTE = 'Prakiraan lebih dari 3 hari hanya gambaran umum, bukan dari BMKG. Cek lagi mendekati harinya.';

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
/** '15.00', atau '03.00 dini hari' untuk dini hari sesudah tanggal yang dilaporkan (bukan dini hari tadi). */
const timeLabel = (slot) => `${hourLabel(slot.hour)}${slot.lateNight ? ' dini hari' : ''}`;
const timesText = (slots) => joinList(slots.map(timeLabel));

/** ' (peluang 40-60%)' dari peluang hujan slot-slot, atau kosong bila tidak ada datanya. */
function chanceText(slots) {
  const chances = [slots].flat().map((s) => s.rainChance).filter((c) => c != null);
  return chances.length > 0 ? ` (peluang ${rangeText([Math.min(...chances), Math.max(...chances)], '%')})` : '';
}

function windText(slot) {
  const from = windFromText(slot.windFrom);
  return `${Math.round(slot.windKmh)} km/jam${from ? ` dari ${from}` : ''}`;
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

const lastVariant = new Map(); // jenis kalimat → urutan pilihan terakhir

/** Satu kalimat acak, tidak sama dengan pilihan sebelumnya untuk jenis yang sama, agar jawaban bot tidak monoton. */
function vary(kind, options) {
  const fresh = options.filter((_, i) => options.length === 1 || i !== lastVariant.get(kind));
  const choice = fresh[Math.floor(Math.random() * fresh.length)];
  lastVariant.set(kind, options.indexOf(choice));
  return choice;
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

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

/**
 * Peringatan tambahan untuk hujan sedang, lebat, atau hujan petir yang pasti.
 * Hujan ringan dan hujan yang belum pasti tidak masuk sini, cukup jadi info di conditionLines.
 */
function rainWarningLines(scope) {
  const sure = scope.filter(isRainWarning);
  if (sure.length === 0) return [];
  return ['⚠️ *POTENSI HUJAN*', ...sure.map((s) => `${slotEmoji(s)} *${sentence(s.desc)}* sekitar pukul ${timeLabel(s)}${chanceText(s)}`)];
}

/**
 * Yang dilaporkan untuk satu tanggal: jam kerja, ditambah malam dan dini hari nanti hanya bila hujan (reportSlots).
 * Bila jam kerja sudah lewat (ditanya malam hari), semua slot tanggal itu ditambah hujan dini hari nanti.
 */
function scopeOf(bmkg, date) {
  if (fieldSlots(bmkg.days[date]).length > 0) return reportSlots(bmkg.days, date);
  return [...bmkg.days[date], ...lateNightSlots(bmkg.days, date).filter(isRain)];
}

/** Hujan, petir, dan angin untuk waktu yang dilaporkan (lihat scopeOf). */
function conditionLines(scope) {
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

/** Salam sesuai jam: ringkasan biasanya pagi, tetapi jam kirimnya bisa diubah pengurus. */
export function greeting(hour) {
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

/** hour: jam saat dikirim, untuk salam (bawaan pagi). */
export function morningMessage(bmkg, date, hour = 5) {
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
  // Malam dan dini hari nanti (tanggal berikutnya, bukan dini hari tadi) hanya disebut bila hujan, agar pesan tetap pendek
  const night = [
    ['🌙 Malam (18-24)', slots.filter((s) => s.hour >= 18)],
    ['🌌 Dini hari nanti (00-06)', lateNightSlots(bmkg.days, date)],
  ];
  for (const [label, part] of night) {
    if (!part.some(isRain)) continue;
    const worst = worstSlot(part);
    periods.push(`${label}: ${slotEmoji(worst)} ${sentence(worst.desc)}, ${tempText(tempRange(part))}`);
  }
  const scope = scopeOf(bmkg, date);
  return [
    '🌾 *INFO CUACA HARI INI*',
    `${greeting(hour)}, Bapak/Ibu ${config.groupLabel} 🙏`,
    '',
    `📍 ${bmkg.place}`,
    `📅 ${longDate(date)}`,
    '',
    ...block(rainWarningLines(scope)),
    ...block(periods),
    ...block(conditionLines(scope)),
    ...footer('bmkg', slots, morningTip(date)),
  ].join('\n');
}

export function dayDetailMessage(bmkg, date, dayIndex) {
  const slots = bmkg.days[date];
  if (!slots?.length) return unavailableMessage();
  // Rincian per 3 jam sampai pukul 18.00, lalu malam dan dini hari nanti hanya jam yang hujan.
  // Ditanya malam hari (jam kerja sudah lewat): sisa jam hari itu.
  const scope = scopeOf(bmkg, date);
  const daytime = slots.filter((s) => s.hour >= 6 && s.hour <= 18);
  const shown = daytime.length > 0 ? [...daytime, ...scope.filter((s) => s.lateNight || s.hour > 18)] : scope;
  const hours = shown.map((s) => `*${timeLabel(s)}*  ${slotEmoji(s)} ${sentence(s.desc)}, ${s.temp}°C${hazardsOf(s).length > 0 ? ' ⚠️' : ''}`);
  const humidity = shown.map((s) => s.humidity);
  return [
    `🌾 *CUACA ${whenText(dayIndex).toUpperCase()}*`,
    `📍 ${bmkg.place}`,
    `📅 ${longDate(date)}`,
    '',
    ...block(rainWarningLines(scope)),
    ...block(hours),
    ...conditionLines(scope),
    `💧 Kelembapan ${rangeText([Math.min(...humidity), Math.max(...humidity)], '%')}`,
    '',
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
      lines.push(`${slotEmoji(worst)} ${shortDate(date)}: ${sentence(worst.desc)}, ${tempText(tempRange(scope))}`);
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
 * remaining: slot yang dilaporkan dan belum lewat (termasuk dini hari nanti); newKeys: ['YYYY-MM-DD 15 petir', ...]
 */
export function updateMessage(place, remaining, newKeys, nowHhmm) {
  const items = newKeys.map((key) => {
    const [date, hour, type] = key.split(' ');
    const slot = remaining.find((s) => s.date === date && s.hour === Number(hour));
    return `${HAZARD_EMOJI[type]} ${hazardLabel(type)} sekitar pukul ${slot ? timeLabel(slot) : hourLabel(Number(hour))}` +
      `${slot && type !== 'angin' ? chanceText(slot) : ''}`;
  });
  return [
    '⚠️ *PERINGATAN CUACA*',
    `📍 ${place}`,
    `🕐 Pukul ${nowHhmm} WIB`,
    '',
    'BMKG memperbarui prakiraan hari ini:',
    ...block(items),
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
    `🏷️ Bisa juga tanpa *halo ${n}*: tag nomor bot (ketik @ lalu pilih bot), lalu tulis pertanyaannya.`,
    'ℹ️ Hari 1-3 dari BMKG, hari 4-10 gambaran umum dari Open-Meteo.',
    ...(config.linkInAutoMessages ? linkLines() : ['🔗 Rincian lengkap: tautan BMKG di deskripsi grup.']),
  ].join('\n');
}

export function tooFarMessage(today) {
  const last = longDate(addDays(today, 9));
  return [
    vary('terlalu-jauh', [
      `🙏 Maaf, prakiraan hanya tersedia sampai 10 hari ke depan (sampai ${last}).`,
      `🙏 Hari itu masih terlalu jauh. Prakiraan baru tersedia sampai ${last}.`,
      `🙏 Mohon maaf, bot hanya bisa melihat sampai 10 hari ke depan, yaitu sampai ${last}.`,
    ]),
    '',
    `💬 Lihat 10 hari ke depan: ketik *halo ${config.botName} 10 hari*`,
  ].join('\n');
}

export function pastMessage() {
  const n = config.botName;
  return [
    vary('sudah-lewat', [
      '🙏 Maaf, bot hanya punya prakiraan dari hari ini sampai 10 hari ke depan, bukan untuk hari yang sudah lewat.',
      '🙏 Untuk hari yang sudah lewat, bot tidak punya datanya. Yang tersedia hari ini sampai 10 hari ke depan.',
      '🙏 Mohon maaf, hari yang sudah lewat tidak ada prakiraannya. Bot hanya melihat hari ini sampai 10 hari ke depan.',
    ]),
    '',
    `💬 Cuaca hari ini: ketik *halo ${n}*`,
    `💬 Cuaca besok: ketik *halo ${n} besok*`,
  ].join('\n');
}

/**
 * Pertanyaan anggota untuk diulang di jawaban: tanpa tautan (tautan di pesan bot = sinyal spam) dan tanda format
 * WhatsApp, paling banyak 60 huruf.
 */
function questionText(question) {
  const clean = String(question ?? '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...clean];
  return chars.length > 60 ? `${chars.slice(0, 57).join('').trimEnd()}...` : clean;
}

/** question: kalimat yang tidak dikenali, diulang agar penanya tahu pertanyaan mana yang belum bisa dijawab. */
export function unknownMessage(today, question) {
  const q = questionText(question);
  const opening = q
    ? vary('belum-paham', [
      `🤔 Maaf, bot belum bisa memahami dan menjawab pertanyaan mengenai “${q}”.`,
      `🙏 Maaf, bot belum mengerti maksud “${q}”.`,
      `🤔 Pertanyaan “${q}” belum bisa dijawab bot.`,
    ])
    : vary('belum-paham', [
      '🤔 Maaf, bot belum paham pertanyaannya.',
      '🙏 Maaf, bot belum mengerti maksudnya.',
      '🤔 Pertanyaannya belum dikenali bot.',
    ]);
  return `${opening}\nBot hanya bisa menjawab soal cuaca.\n\n${helpMessage(today)}`;
}

/** Pertanyaan tidak dikenali, padahal cara bertanya baru saja dikirim (pukul hhmm): cukup contoh singkat. */
export function notUnderstoodAgainMessage(today, hhmm, question) {
  const n = config.botName;
  const { weekday, day } = examples(today);
  const q = questionText(question);
  const about = q ? ` “${q}”` : '';
  return vary('belum-paham-lagi', [
    `🤔 Maaf, bot belum paham pertanyaan${about || 'nya'}. Sebut saja harinya, misalnya *halo ${n} besok* atau *halo ${n} ${weekday}*.`,
    `🙏 Bot belum paham maksud${about || 'nya'}, Bapak/Ibu. Cara bertanya sudah dikirim di atas pukul ${hhmm} WIB.`,
    `🤔 Belum paham pertanyaan${about || 'nya'}. Coba misalnya *halo ${n} lusa* atau *halo ${n} tanggal ${day}*.`,
    `🙏 Maaf, bot belum mengerti${about}. Contoh yang bisa dijawab: *halo ${n} besok* atau *halo ${n} 10 hari*.`,
  ]);
}

/** Cara bertanya diminta lagi, padahal baru saja dikirim (pukul hhmm). */
export function helpAgainMessage(today, hhmm) {
  const n = config.botName;
  const { weekday } = examples(today);
  return vary('menu-lagi', [
    `👆 Cara bertanya ke bot sudah dikirim di atas pukul ${hhmm} WIB ya, Bapak/Ibu.`,
    `🙏 Cara bertanya ada di pesan bot pukul ${hhmm} WIB di atas. Singkatnya: *halo ${n} besok*, *halo ${n} lusa*, atau *halo ${n} 10 hari*.`,
    `📌 Cara bertanya baru saja dikirim pukul ${hhmm} WIB. Contoh singkat: *halo ${n} ${weekday}*.`,
  ]);
}

/** Pokok pertanyaan cuaca satu hari, untuk jawaban "sudah dijawab": 'cuaca besok (Rabu, 4 November)'. */
export function daySubject(date, dayIndex) {
  return `cuaca ${whenText(dayIndex)} (${longDate(date).replace(/ \d{4}$/, '')})`;
}

export const OUTLOOK_SUBJECT = 'cuaca 10 hari ke depan';

/**
 * Pertanyaan yang sama baru saja dijawab (pukul hhmm): tunjuk jawaban sebelumnya,
 * agar grup tidak dibanjiri pesan panjang yang isinya sama.
 */
export function alreadyAnsweredMessage(subject, hhmm) {
  const Subject = capitalize(subject);
  return vary('sudah-dijawab', [
    `👆 ${Subject} sudah dijawab di atas pukul ${hhmm} WIB ya, Bapak/Ibu.`,
    `🙏 Pertanyaan yang sama baru saja dijawab pukul ${hhmm} WIB: ${subject}. Silakan gulir ke atas.`,
    `📌 Jawaban ${subject} ada di pesan bot pukul ${hhmm} WIB di atas. Datanya masih sama 🙏`,
    `🙂 ${Subject} sudah dijawab tadi pukul ${hhmm} WIB, ada di atas ya.`,
    `👆 Sudah dijawab pukul ${hhmm} WIB, Bapak/Ibu. Silakan lihat pesan bot di atas untuk ${subject}.`,
  ]);
}

export function thanksMessage() {
  return vary('terima-kasih', [
    '🙏 Sama-sama, Bapak/Ibu. Semoga lancar di ladang 🌾',
    '🙏 Sama-sama. Semoga panennya berhasil 🌾',
    '😊 Sama-sama, Bapak/Ibu. Tanya cuaca lagi kapan saja ya 🌱',
    '🙏 Terima kasih kembali. Semoga lancar kegiatannya hari ini 🌾',
    `🌾 Sama-sama. Kapan pun perlu, ketik saja *halo ${config.botName}* 🙏`,
  ]);
}

export function unavailableMessage() {
  const where = config.linkInAutoMessages && config.detailLink ? config.detailLink : 'aplikasi Info BMKG';
  return `🙏 Maaf, data cuaca belum tersedia saat ini.\nSilakan coba lagi nanti atau cek langsung di ${where}.`;
}
