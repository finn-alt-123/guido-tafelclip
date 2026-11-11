/* Opslag in Netlify Blobs met veilige gelijktijdige schrijfacties (etag). */
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

export const store = () => getStore({ name: 'guido-tafelclip', consistency: 'strong' });

const kopie = (v) => (typeof v === 'function' ? v() : JSON.parse(JSON.stringify(v)));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

export async function lees(st, key, fallback) {
  const r = await st.getWithMetadata(key, { type: 'json' });
  return { data: r && r.data != null ? r.data : kopie(fallback), etag: r ? r.etag : null };
}

/**
 * Lees–wijzig–schrijf met herhaling bij gelijktijdige wijzigingen.
 * fn(data) past data aan (of geeft { skip: true } terug om niets te bewaren).
 */
export async function wijzig(st, key, fallback, fn) {
  for (let poging = 0; poging < 8; poging++) {
    const { data, etag } = await lees(st, key, fallback);
    const res = await fn(data);
    if (res && res.skip) return { data, result: res.result };
    const out = await st.setJSON(key, data, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (!out || out.modified !== false) return { data, result: res ? res.result : undefined };
    await wacht(30 + Math.random() * 120);
  }
  const e = new Error('Het is even druk. Probeer opnieuw.'); e.code = 'druk'; e.status = 409; throw e;
}

/* ---------- geheimen (enkel op de server) ---------- */
export const GEHEIMEN_LEEG = () => ({ sessieSleutel: '', webhookSleutel: '', vapid: null, sun: {}, uit: {} });

export async function geheimen(st) {
  const { data } = await lees(st, 'geheimen', GEHEIMEN_LEEG);
  if (data.sessieSleutel && data.webhookSleutel) return data;
  const { data: nieuw } = await wijzig(st, 'geheimen', GEHEIMEN_LEEG, (g) => {
    if (g.sessieSleutel && g.webhookSleutel) return { skip: true };
    g.sessieSleutel = g.sessieSleutel || crypto.randomBytes(32).toString('hex');
    g.webhookSleutel = g.webhookSleutel || crypto.randomBytes(18).toString('base64url');
  });
  return nieuw;
}

/* Omgevingsvariabelen gaan voor op wat in beheer is ingevuld. */
export function sleutel(g, pad, env) {
  if (env && process.env[env]) return process.env[env];
  return pad.split('.').reduce((o, k) => (o ? o[k] : undefined), g) || '';
}
