/* Gedeelde serverlogica voor de API en het onderhoud. */
import { lees, wijzig, geheimen, sleutel, GEHEIMEN_LEEG } from './db.mjs';
import { apply, defaultConfig, defaultLive, migreer, lokaal } from '../public/js/core.js';
import { stuur } from './push.mjs';
import { uitEvents, icsEvents } from './events.mjs';

export const STATUS_LEEG = () => ({ fouten: [], onderhoud: null, events: null, eventsFout: '' });

/* ---------- toestand ---------- */
export async function laad(storage) {
  const [c, l] = await Promise.all([storage.get('config'), storage.get('live')]);
  const now = Date.now();
  const state = migreer({ config: c != null ? c : defaultConfig(now), live: l != null ? l : defaultLive(now) });
  return { state };
}

/** Voert een actie uit met de juiste rol, bewaart veilig, en geeft nieuwe meldingen terug. */
export async function doeActie(storage, action, rol) {
  const { state } = await laad(storage);
  const out = apply(state, action, Date.now()); // gooit een Fout met code bij een probleem
  const ns = out.state;
  const taken = [];
  if (JSON.stringify(ns.config) !== JSON.stringify(state.config)) taken.push(storage.put('config', ns.config));
  if (JSON.stringify(ns.live) !== JSON.stringify(state.live)) taken.push(storage.put('live', ns.live));
  if (taken.length) await Promise.all(taken);
  const oud = new Set(state.live.meldingen.map((m) => m.id));
  return { state: ns, result: out.result, nieuw: ns.live.meldingen.filter((m) => !oud.has(m.id)), rol };
}

export async function noteerFout(storage, bron, fout) {
  try {
    await wijzig(storage, 'status', STATUS_LEEG, (s) => {
      s.fouten = [{ ts: Date.now(), bron, tekst: String(fout && fout.message ? fout.message : fout).slice(0, 300) }, ...s.fouten].slice(0, 30);
    });
  } catch { /* nooit de hoofdtaak laten mislukken */ }
}

/* ---------- meldingen doorsturen naar de toestellen van het personeel ---------- */
function omschrijf(m) {
  if (m.soort === 'ober') return { titel: m.tafelNaam + ' roept de ober', tekst: m.tekst || 'Graag even langskomen' };
  if (m.soort === 'afrekenen') return { titel: m.tafelNaam + ' wil afrekenen', tekst: m.tekst || 'Breng de rekening' };
  if (m.soort === 'verzoek') return { titel: m.tafelNaam + ': ' + m.label, tekst: m.tekst || 'Verzoekje' };
  return { titel: 'Let op: ' + (m.tafelNaam || 'systeem'), tekst: m.tekst };
}

export async function verspreid(storage, state, nieuw) {
  const lijst = (nieuw || []).filter((m) => m.soort !== 'info');
  if (!lijst.length) return;
  await Promise.all(lijst.map((m) => {
    const o = omschrijf(m);
    return stuur(storage, { titel: o.titel, tekst: o.tekst, tag: m.id, url: '/beheer.html#meldingen', soort: m.soort }).catch((e) => noteerFout(storage, 'push', e));
  }));
}

/* ---------- events ---------- */
export async function haalEvents(storage, env) {
  const { state } = await laad(storage);
  const g = await geheimen(storage);
  const br = state.config.buurt.bronnen;
  const dagen = Number(state.config.buurt.dagen) || 7;
  const alles = []; const fouten = [];
  const uitSleutel = sleutel(g, 'uit.apiKey', 'UIT_API_KEY', env);
  if (br.uit.aan) {
    if (!uitSleutel) fouten.push('UiTdatabank: nog geen sleutel ingevuld.');
    else { try { alles.push(...await uitEvents({ sleutel: uitSleutel, postcode: br.uit.postcode, soorten: br.uit.soorten, dagen, env })); } catch (e) { fouten.push(e.message); } }
  }
  for (const bron of br.ics || []) {
    if (!bron.url) continue;
    try { (await icsEvents({ url: bron.url, naam: bron.naam, dagen })).forEach((x) => alles.push({ ...x, auto: !!bron.auto })); }
    catch (e) { fouten.push(e.message); }
  }
  const r = await doeActie(storage, { type: 'voorstellen-bij', items: alles, auto: !!br.auto }, 'intern');
  await wijzig(storage, 'status', STATUS_LEEG, (s) => { s.events = Date.now(); s.eventsFout = fouten.join(' · '); s.eventsAantal = alles.length; });
  return { gevonden: alles.length, nieuw: r.result.nieuw, fouten };
}

/* ---------- onderhoud (elk uur): events ophalen, 1× per dag vanaf 5 uur ---------- */
export async function onderhoud(storage, env, { forceerEvents = false } = {}) {
  const verslag = [];
  const nu = Date.now();
  const { data: s } = await lees(storage, 'status', STATUS_LEEG);
  const { state } = await laad(storage);
  const br = state.config.buurt.bronnen;
  const heeftBronnen = br.uit.aan || (br.ics || []).some((b) => b.url);
  if (forceerEvents || (heeftBronnen && (!s.events || nu - s.events > 20 * 3600e3) && lokaal(nu).uur >= 5)) {
    try { const r = await haalEvents(storage, env); verslag.push(`events: ${r.gevonden} gevonden, ${r.nieuw} nieuw`); } catch (e) { await noteerFout(storage, 'events', e); }
  }
  await wijzig(storage, 'status', STATUS_LEEG, (x) => { x.onderhoud = Date.now(); });
  return verslag;
}

export { lees, wijzig, geheimen, sleutel, GEHEIMEN_LEEG };
