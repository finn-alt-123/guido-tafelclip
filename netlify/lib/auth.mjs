/* Ondertekende tokens, pincodes en logins per medewerker. */
import crypto from 'node:crypto';

const b64 = (b) => Buffer.from(b).toString('base64url');

export function teken(payload, sleutel) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', sleutel).update(body).digest('base64url');
  return body + '.' + mac;
}

export function controleer(token, sleutel) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const juist = crypto.createHmac('sha256', sleutel).update(body).digest('base64url');
  const a = Buffer.from(mac || ''); const b = Buffer.from(juist);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return { salt, hash };
}
export function pinKlopt(pin, gebruiker) {
  if (!gebruiker || !gebruiker.salt) return false;
  const h = crypto.scryptSync(String(pin), gebruiker.salt, 32);
  const juist = Buffer.from(gebruiker.hash, 'hex');
  return h.length === juist.length && crypto.timingSafeEqual(h, juist);
}

export const GEBRUIKERS_LEEG = () => ({ lijst: [], pogingen: {} });
export const naamSleutel = (n) => String(n || '').trim().toLowerCase();

/** Gebruiker zonder geheime velden, voor het beheerscherm. */
export const publiekeGebruiker = (g) => ({ id: g.id, naam: g.naam, rol: g.rol, aan: g.aan !== false, laatst: g.laatst || null });

export function gebruikerUitToken(gebruikers, payload) {
  if (!payload || !payload.u) return null;
  const g = gebruikers.lijst.find((x) => x.id === payload.u);
  if (!g || g.aan === false || (g.versie || 0) !== (payload.v || 0)) return null;
  return g;
}
