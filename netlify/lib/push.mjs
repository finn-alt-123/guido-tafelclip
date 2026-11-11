/* Pushmeldingen naar de iPad aan de kassa en de iPhones van de obers (Web Push). */
import webpush from 'web-push';
import { wijzig, lees, GEHEIMEN_LEEG } from './db.mjs';

export async function vapid(st) {
  const { data } = await lees(st, 'geheimen', GEHEIMEN_LEEG);
  if (data.vapid && data.vapid.publicKey) return data.vapid;
  const { data: g } = await wijzig(st, 'geheimen', GEHEIMEN_LEEG, (x) => {
    if (x.vapid && x.vapid.publicKey) return { skip: true };
    x.vapid = webpush.generateVAPIDKeys();
  });
  return g.vapid;
}

export const PUSH_LEEG = () => ({ lijst: [] });

/** Stuurt een melding naar alle toestellen die "in dienst" staan. Ongeldige abonnementen worden opgeruimd. */
export async function stuur(st, bericht, filter = () => true) {
  const v = await vapid(st);
  webpush.setVapidDetails('mailto:tafelclip@cafeguido.be', v.publicKey, v.privateKey);
  const { data } = await lees(st, 'push', PUSH_LEEG);
  const doel = data.lijst.filter((s) => s.actief !== false && filter(s));
  const dood = [];
  await Promise.all(doel.map(async (s) => {
    try { await webpush.sendNotification(s.sub, JSON.stringify(bericht), { TTL: 300, urgency: 'high', topic: bericht.tag ? String(bericht.tag).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) : undefined }); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dood.push(s.sub.endpoint); }
  }));
  if (dood.length) await wijzig(st, 'push', PUSH_LEEG, (x) => { x.lijst = x.lijst.filter((s) => !dood.includes(s.sub.endpoint)); });
  return { verstuurd: doel.length - dood.length };
}
