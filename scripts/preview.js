// Menampilkan contoh pesan dengan data cuaca terbaru, tanpa WhatsApp.
// Pakai: npm run preview            (ringkasan pagi)
//        npm run preview -- "halo tani besok"
//        npm run preview -- --sumber (peluang hujan tiap pusat cuaca per slot BMKG, 3 hari)
import { config } from '../src/config.js';
import { parseCall } from '../src/commands.js';
import { answer } from '../src/bot/replies.js';
import { buildMorning, fetchWeather } from '../src/bot/morning.js';
import { ENSEMBLE_MODELS } from '../src/weather/sources.js';
import { isFieldSlot } from '../src/weather/analysis.js';
import { nowWib, shortDate, hourLabel } from '../src/time.js';

const today = nowWib().date;
const text = process.argv.slice(2).join(' ');

if (!text) {
  console.log((await buildMorning(today)).text);
} else if (text === '--sumber') {
  const weather = await fetchWeather();
  console.log(`Peluang hujan minimal 1 mm per 3 jam. Pasti bila rata-rata >= ${config.rainSurePercent}%.\n`);
  for (const [date, slots] of Object.entries(weather.days)) {
    for (const s of slots.filter(isFieldSlot)) {
      const models = Object.keys(ENSEMBLE_MODELS)
        .map((name) => `${name.split('_')[0].toUpperCase()} ${s.rainModels?.[name] ?? '-'}`.padEnd(10))
        .join(' ');
      console.log(`${shortDate(date)} ${hourLabel(s.hour)}  ${s.desc.padEnd(16)} rata-rata ${String(s.rainChance ?? '-').padStart(3)}%  | ${models}`);
    }
  }
} else {
  const call = parseCall(text, config.botName, today);
  if (!call) console.log(`(diabaikan: pesan tidak diawali "halo ${config.botName}")`);
  else console.log(await answer(call, today));
}
process.exit(0);
