// Pengambilan data dari BMKG (hari ke-1 sampai ke-3) dan Open-Meteo (hari ke-4 sampai ke-10).
import { config } from '../config.js';

const CACHE_MS = 15 * 60 * 1000;
const cache = new Map();

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'bot-cuaca-ladang (KKN-PPM UGM)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Gagal mengambil ${new URL(url).host}: HTTP ${res.status}`);
  return res.json();
}

async function cached(key, maxAgeMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Prakiraan BMKG per 3 jam, dikelompokkan per tanggal WIB.
 * Hasil: { place, days: { 'YYYY-MM-DD': [slot, ...] } }
 * slot: { date, hour, code, desc, temp, humidity, windKmh, windFrom, rainMm }
 */
export function fetchBmkg({ maxAgeMs = CACHE_MS } = {}) {
  return cached('bmkg', maxAgeMs, async () => {
    const json = await getJson(`https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${config.adm4}`);
    return parseBmkg(json);
  });
}

export function parseBmkg(json) {
  const entry = json?.data?.[0];
  if (!entry?.cuaca) throw new Error('Format data BMKG tidak dikenali');
  const days = {};
  for (const item of entry.cuaca.flat()) {
    const [date, time] = String(item.local_datetime).split(' ');
    const slot = {
      date,
      hour: Number(time.slice(0, 2)),
      code: Number(item.weather),
      desc: item.weather_desc,
      temp: item.t,
      humidity: item.hu,
      windKmh: item.ws,
      windFrom: item.wd,
      rainMm: item.tp,
    };
    (days[date] ??= []).push(slot);
  }
  for (const slots of Object.values(days)) slots.sort((a, b) => a.hour - b.hour);
  return { place: json.lokasi?.desa ?? config.placeName, days };
}

// Pusat cuaca dunia yang ensembelnya (puluhan versi hitungan model) dipakai untuk peluang hujan.
// Model BOM (Australia) tidak disertakan: datanya kosong untuk lokasi ini saat diuji 30 Oktober 2026.
export const ENSEMBLE_MODELS = {
  ecmwf_ifs025: 'ECMWF (Eropa)',
  icon_seamless: 'ICON (Jerman)',
  gfs_seamless: 'GFS (Amerika)',
  ukmo_global_ensemble_20km: 'UKMO (Inggris)',
  gem_global: 'GEM (Kanada)',
};

/**
 * Curah hujan per jam semua anggota ensembel tiap pusat cuaca, untuk 4 hari (menutup hari ke-3 BMKG).
 * Tiap pusat diminta terpisah: bila satu gagal atau berganti nama, yang lain tetap dipakai.
 * Hasil: { models: { ecmwf_ifs025: { 'YYYY-MM-DD': { 14: [mm anggota ke-0, ke-1, ...] } }, ... } }
 */
export function fetchEnsemble({ maxAgeMs = 60 * 60 * 1000 } = {}) {
  return cached('ensemble', maxAgeMs, async () => {
    const results = await Promise.allSettled(Object.keys(ENSEMBLE_MODELS).map(async (model) => {
      const params = new URLSearchParams({
        latitude: config.latitude,
        longitude: config.longitude,
        hourly: 'precipitation',
        models: model,
        timezone: config.timezone,
        forecast_days: 4,
      });
      return [model, parseEnsemble(await getJson(`https://ensemble-api.open-meteo.com/v1/ensemble?${params}`))];
    }));
    const models = Object.fromEntries(results.filter((r) => r.status === 'fulfilled').map((r) => r.value));
    if (Object.keys(models).length === 0) throw new Error('Semua model ensembel gagal diambil');
    return { models };
  });
}

/** { 'YYYY-MM-DD': { jam: [mm per anggota] } }; urutan anggota sama di setiap jam, null bila tidak ada data. */
function parseEnsemble(json) {
  const h = json?.hourly;
  if (!h?.time) throw new Error('Format data ensembel tidak dikenali');
  const members = Object.keys(h).filter((key) => /^precipitation(_member\d+)?$/.test(key));
  const hours = {};
  h.time.forEach((time, i) => {
    const values = members.map((key) => h[key][i]);
    if (values.every((v) => v == null)) return;
    const [date, clock] = time.split('T');
    (hours[date] ??= {})[Number(clock.slice(0, 2))] = values;
  });
  return hours;
}

/**
 * Prakiraan harian Open-Meteo 10 hari, ditambah peluang hujan per jam (cadangan bila ensembel gagal).
 * Hasil: { days: { 'YYYY-MM-DD': { date, code, tempMin, tempMax, rainChance, rainMm, windMaxKmh, windDirDeg } },
 *          hours: { 'YYYY-MM-DD': { 15: persen, ... } } }
 */
export function fetchOpenMeteo({ maxAgeMs = 60 * 60 * 1000 } = {}) {
  return cached('openmeteo', maxAgeMs, async () => {
    const params = new URLSearchParams({
      latitude: config.latitude,
      longitude: config.longitude,
      daily: [
        'weather_code', 'temperature_2m_max', 'temperature_2m_min',
        'precipitation_probability_max', 'precipitation_sum',
        'wind_speed_10m_max', 'wind_direction_10m_dominant',
      ].join(','),
      hourly: 'precipitation_probability',
      timezone: config.timezone,
      forecast_days: 10,
    });
    return parseOpenMeteo(await getJson(`https://api.open-meteo.com/v1/forecast?${params}`));
  });
}

export function parseOpenMeteo(json) {
  const d = json?.daily;
  if (!d?.time) throw new Error('Format data Open-Meteo tidak dikenali');
  const days = {};
  d.time.forEach((date, i) => {
    days[date] = {
      date,
      code: d.weather_code[i],
      tempMin: d.temperature_2m_min[i],
      tempMax: d.temperature_2m_max[i],
      rainChance: d.precipitation_probability_max[i],
      rainMm: d.precipitation_sum[i],
      windMaxKmh: d.wind_speed_10m_max[i],
      windDirDeg: d.wind_direction_10m_dominant[i],
    };
  });
  const hours = {};
  const h = json.hourly;
  h?.time?.forEach((time, i) => {
    const chance = h.precipitation_probability?.[i];
    if (chance == null) return;
    const [date, clock] = time.split('T');
    (hours[date] ??= {})[Number(clock.slice(0, 2))] = chance;
  });
  return { days, hours };
}
