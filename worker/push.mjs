/* ============================================================
   Web Push zonder de npm-package "web-push" (die draait niet op
   Cloudflare Workers). Dit bestand doet hetzelfde met de
   ingebouwde Web Crypto API: VAPID-ondertekening (RFC 8292) en
   aes128gcm-versleuteling van het bericht (RFC 8291 / RFC 8188).
   ============================================================ */
import { wijzig, lees, GEHEIMEN_LEEG } from './db.mjs';

/* ---------- kleine hulpjes ---------- */
const b64u = (buf) => {
  let s = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64uDecode = (s) => {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const concat = (...parts) => {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const txt = (s) => new TextEncoder().encode(s);

/* ---------- VAPID-sleutelpaar aanmaken/bewaren ---------- */
export async function vapid(storage) {
  const { data } = await lees(storage, 'geheimen', GEHEIMEN_LEEG);
  if (data.vapid && data.vapid.publicKey) return data.vapid;
  const { data: g } = await wijzig(storage, 'geheimen', GEHEIMEN_LEEG, async (x) => {
    if (x.vapid && x.vapid.publicKey) return { skip: true };
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const raw = await crypto.subtle.exportKey('raw', pair.publicKey);      // 65 bytes, ongecomprimeerd EC-punt
    const jwkPriv = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const jwkPub = await crypto.subtle.exportKey('jwk', pair.publicKey);
    x.vapid = { publicKey: b64u(raw), privateJwk: jwkPriv, publicJwk: jwkPub };
  });
  return g.vapid;
}

async function privateSignKey(vapidData) {
  return crypto.subtle.importKey('jwk', vapidData.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/* ---------- VAPID Authorization-header (RFC 8292), JWT met ES256 ---------- */
async function vapidHeader(endpoint, vapidData) {
  const aud = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:tafelclip@cafeguido.be' };
  const signingInput = b64u(txt(JSON.stringify(header))) + '.' + b64u(txt(JSON.stringify(payload)));
  const key = await privateSignKey(vapidData);
  // Web Crypto geeft de ECDSA-handtekening al in het platte "r||s"-formaat (IEEE P1363) terug — precies wat een JWT nodig heeft.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, txt(signingInput));
  const jwt = signingInput + '.' + b64u(sig);
  return `vapid t=${jwt}, k=${vapidData.publicKey}`;
}

/* ---------- aes128gcm-versleuteling van het bericht (RFC 8291) ---------- */
async function hkdf(ikmKey, salt, info, lengteBytes) {
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, ikmKey, lengteBytes * 8);
  return new Uint8Array(bits);
}

async function versleutel(payloadObj, sub) {
  const plaintext = txt(JSON.stringify(payloadObj));
  const p256dh = b64uDecode(sub.keys.p256dh);   // publieke sleutel van het toestel (65 bytes)
  const authSecret = b64uDecode(sub.keys.auth);  // 16 bytes

  // 1) eigen eenmalig ECDH-sleutelpaar voor dit bericht
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  // 2) gedeeld geheim met het toestel
  const uaPublicKey = await crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, ephemeral.privateKey, 256));

  // 3) sleutelmateriaal afleiden (RFC 8291 §3.3/3.4)
  const keyInfo = concat(txt('WebPush: info\0'), p256dh, asPublicRaw);
  const ikmKey0 = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveBits']);
  const ikm = await hkdf(ikmKey0, authSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const cekBytes = await hkdf(ikmKey, salt, txt('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikmKey, salt, txt('Content-Encoding: nonce\0'), 12);

  const cek = await crypto.subtle.importKey('raw', cekBytes, 'AES-GCM', false, ['encrypt']);
  const metPadding = concat(plaintext, new Uint8Array([2])); // 0x02 = laatste (en enige) record, geen opvulling
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cek, metPadding);

  // 4) aes128gcm-record opbouwen (RFC 8188): salt(16) | recordsize(4) | idlen(1) | keyid | ciphertext+tag
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096, false);
  const header = concat(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return concat(header, new Uint8Array(cipherBuf));
}

/** Stuurt een melding naar alle toestellen die "in dienst" staan. Ongeldige abonnementen worden opgeruimd. */
export async function stuur(storage, bericht, filter = () => true) {
  const v = await vapid(storage);
  const { data } = await lees(storage, 'push', PUSH_LEEG);
  const doel = data.lijst.filter((s) => s.actief !== false && filter(s));
  const dood = [];
  await Promise.all(doel.map(async (s) => {
    try {
      const body = await versleutel(bericht, s.sub);
      const auth = await vapidHeader(s.sub.endpoint, v);
      const topic = bericht.tag ? String(bericht.tag).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) : undefined;
      const r = await fetch(s.sub.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'content-encoding': 'aes128gcm',
          authorization: auth,
          ttl: '300',
          urgency: 'high',
          ...(topic ? { topic } : {})
        },
        body
      });
      if (r.status === 404 || r.status === 410) dood.push(s.sub.endpoint);
    } catch { /* tijdelijke fout (netwerk, …): toestel niet meteen verwijderen */ }
  }));
  if (dood.length) await wijzig(storage, 'push', PUSH_LEEG, (x) => { x.lijst = x.lijst.filter((s) => !dood.includes(s.sub.endpoint)); });
  return { verstuurd: doel.length - dood.length };
}

export const PUSH_LEEG = () => ({ lijst: [] });
