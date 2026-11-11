/* Draait elk uur op Netlify: events ophalen (1× per dag, vanaf 5 uur) en laten weten dat alles nog leeft. */
import { store, onderhoud, noteerFout } from '../lib/kern.mjs';

export default async () => {
  const st = store();
  try { await onderhoud(st); } catch (e) { await noteerFout(st, 'onderhoud', e); }
  return new Response('ok');
};

export const config = { schedule: '7 * * * *' };
