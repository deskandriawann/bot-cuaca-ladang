// Data uji bersama: prakiraan BMKG dan Open-Meteo asli (test/fixtures), sumber data tanpa internet, dan slot buatan.
import fs from 'node:fs';
import { parseBmkg, parseOpenMeteo } from '../src/weather/sources.js';

export const bmkg = parseBmkg(JSON.parse(fs.readFileSync(new URL('./fixtures/bmkg.json', import.meta.url))));
export const om = parseOpenMeteo(JSON.parse(fs.readFileSync(new URL('./fixtures/openmeteo.json', import.meta.url))));
export const dates = Object.keys(bmkg.days).sort();
export const [today, tomorrow, dayAfter] = dates;

export const offline = async () => { throw new Error('tidak dipakai dalam pengujian'); };
export const sources = { getBmkg: async () => bmkg, getOm: async () => om, getEnsemble: offline };

/** Satu slot BMKG buatan pada 14 November 2026. */
export const slot = (hour, desc, windKmh = 5) => ({
  date: '2026-11-14', hour, code: 0, desc, temp: 27, humidity: 80, windKmh, windFrom: 'SE', rainMm: 0,
});
