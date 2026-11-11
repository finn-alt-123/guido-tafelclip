/* ============================================================
   NTAG 424 DNA — "Secure Unique NFC" (SUN) controleren.
   De chip voegt bij elke tik een versleutelde code (e) en een
   handtekening (c) aan de link toe. Zo kan niemand een link
   namaken of een oude link opnieuw gebruiken.
   Volgens NXP AN12196 (PICCData versleuteld, SDMMAC over lege invoer).
   ============================================================ */
import crypto from 'node:crypto';

function aesEcb(key, blok) {
  const c = crypto.createCipheriv('aes-128-ecb', key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(blok), c.final()]);
}
function schuif(b) {
  const out = Buffer.alloc(16); let carry = 0;
  for (let i = 15; i >= 0; i--) { out[i] = ((b[i] << 1) | carry) & 0xff; carry = (b[i] >> 7) & 1; }
  return out;
}
export function cmac(key, msg) {
  const L = aesEcb(key, Buffer.alloc(16));
  const K1 = schuif(L); if (L[0] & 0x80) K1[15] ^= 0x87;
  const K2 = schuif(K1); if (K1[0] & 0x80) K2[15] ^= 0x87;
  const n = Math.max(1, Math.ceil(msg.length / 16));
  const volledig = msg.length > 0 && msg.length % 16 === 0;
  const laatste = Buffer.alloc(16);
  msg.subarray((n - 1) * 16).copy(laatste);
  if (volledig) for (let i = 0; i < 16; i++) laatste[i] ^= K1[i];
  else { laatste[msg.length - (n - 1) * 16] = 0x80; for (let i = 0; i < 16; i++) laatste[i] ^= K2[i]; }
  let X = Buffer.alloc(16);
  for (let b = 0; b < n - 1; b++) {
    for (let i = 0; i < 16; i++) X[i] ^= msg[b * 16 + i];
    X = aesEcb(key, X);
  }
  for (let i = 0; i < 16; i++) X[i] ^= laatste[i];
  return aesEcb(key, X);
}

const hexSleutel = (h) => {
  const b = Buffer.from(String(h || '').replace(/\s/g, ''), 'hex');
  if (b.length !== 16) throw new Error('Een chipsleutel heeft 32 hexadecimale tekens.');
  return b;
};

/** Geeft { uid, ctr } terug als de tik echt is, anders null. */
export function controleerSun({ e, c, metaSleutel, bestandSleutel }) {
  try {
    const kMeta = hexSleutel(metaSleutel);
    const kFile = hexSleutel(bestandSleutel || metaSleutel);
    const enc = Buffer.from(String(e || ''), 'hex');
    const gegeven = Buffer.from(String(c || ''), 'hex');
    if (enc.length !== 16 || gegeven.length !== 8) return null;
    const d = crypto.createDecipheriv('aes-128-cbc', kMeta, Buffer.alloc(16));
    d.setAutoPadding(false);
    const p = Buffer.concat([d.update(enc), d.final()]);
    const tag = p[0];
    if (!(tag & 0x80) || !(tag & 0x40) || (tag & 0x0f) !== 7) return null;
    const uid = p.subarray(1, 8);
    const ctrBytes = p.subarray(8, 11);
    const ctr = ctrBytes[0] | (ctrBytes[1] << 8) | (ctrBytes[2] << 16);
    const sv2 = Buffer.concat([Buffer.from([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]), uid, ctrBytes]);
    const sessie = cmac(kFile, sv2);
    const vol = cmac(sessie, Buffer.alloc(0));
    const mac = Buffer.from([1, 3, 5, 7, 9, 11, 13, 15].map((i) => vol[i]));
    if (!crypto.timingSafeEqual(mac, gegeven)) return null;
    return { uid: uid.toString('hex').toUpperCase(), ctr };
  } catch { return null; }
}
