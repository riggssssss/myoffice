/**
 * Where the real sun is: NOAA's solar position equations (accurate to well under a degree,
 * plenty for light through a window), plus a guess at where the office is from the time zone.
 */

const RAD = Math.PI / 180;

export interface SunPosition {
  /** Degrees above the horizon (negative at night). */
  elevation: number;
  /** Compass bearing in degrees: 0 north, 90 east. */
  azimuth: number;
}

export function sunPosition(ms: number, lat: number, lon: number): SunPosition {
  const jd = ms / 86_400_000 + 2440587.5;
  const t = (jd - 2451545) / 36525;

  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));

  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime =
    4 *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD)) /
    RAD;

  const d = new Date(ms);
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const trueSolar = (((utcMinutes + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = (trueSolar / 4 < 0 ? trueSolar / 4 + 180 : trueSolar / 4 - 180) * RAD;

  const latR = lat * RAD;
  const cosZenith = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const azimuth =
    (Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(latR) - Math.tan(decl) * Math.cos(latR)) / RAD + 180 + 360) % 360;
  return { elevation: 90 - zenith / RAD, azimuth };
}

/**
 * Unit vector from the office towards the sun, in scene axes. The office's −z side faces
 * `north` degrees (0 = north), so +x is east when north is 0.
 */
export function sunVector(pos: SunPosition, north: number): { x: number; y: number; z: number } {
  const el = pos.elevation * RAD;
  const az = (pos.azimuth - north) * RAD;
  return { x: Math.cos(el) * Math.sin(az), y: Math.sin(el), z: -Math.cos(el) * Math.cos(az) };
}

/** Common time zones → a representative city. Anything else falls back on the UTC offset. */
const ZONES: Record<string, [number, number, string]> = {
  'Europe/Madrid': [40.42, -3.7, 'Madrid'],
  'Atlantic/Canary': [28.1, -15.42, 'Las Palmas'],
  'Africa/Ceuta': [35.89, -5.32, 'Ceuta'],
  'Europe/Lisbon': [38.72, -9.14, 'Lisboa'],
  'Europe/London': [51.51, -0.13, 'Londres'],
  'Europe/Dublin': [53.35, -6.26, 'Dublín'],
  'Europe/Paris': [48.86, 2.35, 'París'],
  'Europe/Berlin': [52.52, 13.4, 'Berlín'],
  'Europe/Rome': [41.9, 12.5, 'Roma'],
  'Europe/Amsterdam': [52.37, 4.9, 'Ámsterdam'],
  'Europe/Brussels': [50.85, 4.35, 'Bruselas'],
  'Europe/Zurich': [47.37, 8.54, 'Zúrich'],
  'Europe/Warsaw': [52.23, 21.01, 'Varsovia'],
  'Europe/Athens': [37.98, 23.73, 'Atenas'],
  'Europe/Istanbul': [41.01, 28.98, 'Estambul'],
  'Europe/Moscow': [55.76, 37.62, 'Moscú'],
  'America/New_York': [40.71, -74.01, 'Nueva York'],
  'America/Chicago': [41.88, -87.63, 'Chicago'],
  'America/Denver': [39.74, -104.99, 'Denver'],
  'America/Los_Angeles': [34.05, -118.24, 'Los Ángeles'],
  'America/Mexico_City': [19.43, -99.13, 'Ciudad de México'],
  'America/Bogota': [4.71, -74.07, 'Bogotá'],
  'America/Lima': [-12.05, -77.04, 'Lima'],
  'America/Caracas': [10.48, -66.9, 'Caracas'],
  'America/Santiago': [-33.45, -70.67, 'Santiago'],
  'America/Argentina/Buenos_Aires': [-34.6, -58.38, 'Buenos Aires'],
  'America/Montevideo': [-34.9, -56.16, 'Montevideo'],
  'America/Sao_Paulo': [-23.55, -46.63, 'São Paulo'],
  'America/Guatemala': [14.63, -90.51, 'Guatemala'],
  'America/Panama': [8.98, -79.52, 'Panamá'],
  'America/Santo_Domingo': [18.49, -69.93, 'Santo Domingo'],
  'America/Toronto': [43.65, -79.38, 'Toronto'],
  'Asia/Tokyo': [35.68, 139.69, 'Tokio'],
  'Asia/Shanghai': [31.23, 121.47, 'Shanghái'],
  'Asia/Kolkata': [28.61, 77.21, 'Nueva Delhi'],
  'Asia/Dubai': [25.2, 55.27, 'Dubái'],
  'Asia/Singapore': [1.35, 103.82, 'Singapur'],
  'Australia/Sydney': [-33.87, 151.21, 'Sídney'],
  'Africa/Cairo': [30.04, 31.24, 'El Cairo'],
  'Africa/Casablanca': [33.57, -7.59, 'Casablanca'],
  'Africa/Johannesburg': [-26.2, 28.05, 'Johannesburgo'],
};

export function guessLocation(): { lat: number; lon: number; place: string } {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const known = ZONES[zone];
  if (known) return { lat: known[0], lon: known[1], place: known[2] };
  // Each hour of offset is roughly 15° of longitude; latitude is a mid-northern guess.
  const offsetHours = -new Date().getTimezoneOffset() / 60;
  return { lat: 40, lon: offsetHours * 15, place: zone || 'Zona horaria' };
}
