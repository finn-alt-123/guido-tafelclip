/* Opslag in een Durable Object (Cloudflare). Eén instantie verwerkt altijd
   precies één verzoek tegelijk, dus lezen-wijzigen-schrijven is hier altijd
   veilig: er is geen apart "etag"-systeem meer nodig zoals bij Netlify Blobs. */
import crypto from 'node:crypto';

const kopie = (v) => (typeof v === 'function' ? v() : JSON.parse(JSON.stringify(v)));

export async function lees(storage, key, fallback) {
  const data = await storage.get(key);
  return { data: data != null ? data : kopie(fallback) };
}

/**
 * Leest, past aan via fn(data), en schrijft weg.
 * fn mag { skip: true, result } teruggeven om niets te bewaren.
 */
export async function wijzig(storage, key, fallback, fn) {
  const { data } = await lees(storage, key, fallback);
  const res = await fn(data);
  if (res && res.skip) return { data, result: res.result };
  await storage.put(key, data);
  return { data, result: res ? res.result : undefined };
}

/* ---------- geheimen (enkel op de server) ---------- */
export const GEHEIMEN_LEEG = () => ({ sessieSleutel: '', webhookSleutel: '', vapid: null, sun: {}, uit: {} });

export async function geheimen(storage) {
  const { data } = await lees(storage, 'geheimen', GEHEIMEN_LEEG);
  if (data.sessieSleutel && data.webhookSleutel) return data;
  const { data: nieuw } = await wijzig(storage, 'geheimen', GEHEIMEN_LEEG, (g) => {
    if (g.sessieSleutel && g.webhookSleutel) return { skip: true };
    g.sessieSleutel = g.sessieSleutel || crypto.randomBytes(32).toString('hex');
    g.webhookSleutel = g.webhookSleutel || crypto.randomBytes(18).toString('base64url');
  });
  return nieuw;
}

/* Omgevingsvariabelen (secrets bij Cloudflare) gaan voor op wat in beheer is ingevuld. */
export function sleutel(g, pad, envNaam, env) {
  if (envNaam && env && env[envNaam]) return env[envNaam];
  return pad.split('.').reduce((o, k) => (o ? o[k] : undefined), g) || '';
}
