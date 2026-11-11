/* Gedeelde serverlogica voor de API en het onderhoud. */
import { lees, wijzig, store, geheimen, sleutel, GEHEIMEN_LEEG } from './db.mjs';
import { apply, defaultConfig, defaultLive, migreer, lokaal } from '../../js/core.js';
import { stuur } from './push.mjs';
import { uitEvents, icsEvents } from './events.mjs';

export const STATUS_LEEG = () => ({ fouten: [], onderhoud: null, events: null, eventsFout: '' });

/* ---------- toestand ---------- */
export async function laad(st) {
  const [c, l] = await Promise.all([st.getWithMetadata('config', { type: 'json' }), st.getWithMetadata('live', { type: 'json' })]);
  const now = Date.now();
  const state = migreer({ config: (c && c.data) || defaultConfig(now), live: (l && l.data) || defaultLive(now) });
  return { state, etags: { config: c ? c.etag : null, live: l ? l.etag : null } };
}

/** Voert een actie uit met de juiste rol, bewaart veilig, en geeft nieuwe meldingen terug. */
export async function doeActie(st, action, rol) {
  for (let poging = 0; poging < 8; poging++) {
    const { state, etags } = await laad(st);
    const out = apply(state, action, Date.now()); // gooit een Fout met code bij een probleem
    const ns = out.state;
    let ok = true;
    if (JSON.stringify(ns.config) !== JSON.stringify(state.config)) {
      const r = await st.setJSON('config', ns.config, etags.config ? { onlyIfMatch: etags.config } : { onlyIfNew: true });
      ok = !r || r.modified !== false;
    }
    if (ok && JSON.stringify(ns.live) !== JSON.stringify(state.live)) {
      const r = await st.setJSON('live', ns.live, etags.live ? { onlyIfMatch: etags.live } : { onlyIfNew: true });
      ok = !r || r.modified !== false;
    }
    if (!ok) { await new Promise((r) => setTimeout(r, 40 + Math.random() * 150)); continue; }
    const oud = new Set(state.live.meldingen.map((m) => m.id));
    return { state: ns, result: out.result, nieuw: ns.live.meldingen.filter((m) => !oud.has(m.id)), rol };
  }
  const e = new Error('Het is even druk. Probeer opnieuw.'); e.code = 'druk'; e.status = 409; throw e;
}

export async function noteerFout(st, bron, fout) {
  try {
    await wijzig(st, 'status', STATUS_LEEG, (s) => {
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

export async function verspreid(st, state, nieuw) {
  const lijst = (nieuw || []).filter((m) => m.soort !== 'info');
  if (!lijst.length) return;
  await Promise.all(lijst.map((m) => {
    const o = omschrijf(m);
    return stuur(st, { titel: o.titel, tekst: o.tekst, tag: m.id, url: '/beheer.html#meldingen', soort: m.soort }).catch((e) => noteerFout(st, 'push', e));
  }));
}

/* ---------- events ---------- */
export async function haalEvents(st) {
  const { state } = await laad(st);
  const g = await geheimen(st);
  const br = state.config.buurt.bronnen;
  const dagen = Number(state.config.buurt.dagen) || 7;
  const alles = []; const fouten = [];
  const uitSleutel = sleutel(g, 'uit.apiKey', 'UIT_API_KEY');
  if (br.uit.aan) {
    if (!uitSleutel) fouten.push('UiTdatabank: nog geen sleutel ingevuld.');
    else { try { alles.push(...await uitEvents({ sleutel: uitSleutel, postcode: br.uit.postcode, soorten: br.uit.soorten, dagen })); } catch (e) { fouten.push(e.message); } }
  }
  for (const bron of br.ics || []) {
    if (!bron.url) continue;
    try { (await icsEvents({ url: bron.url, naam: bron.naam, dagen })).forEach((x) => alles.push({ ...x, auto: !!bron.auto })); }
    catch (e) { fouten.push(e.message); }
  }
  const r = await doeActie(st, { type: 'voorstellen-bij', items: alles, auto: !!br.auto }, 'intern');
  await wijzig(st, 'status', STATUS_LEEG, (s) => { s.events = Date.now(); s.eventsFout = fouten.join(' · '); s.eventsAantal = alles.length; });
  return { gevonden: alles.length, nieuw: r.result.nieuw, fouten };
}

/* ---------- onderhoud (elk uur): events ophalen, 1× per dag vanaf 5 uur ---------- */
export async function onderhoud(st, { forceerEvents = false } = {}) {
  const verslag = [];
  const nu = Date.now();
  const { data: s } = await lees(st, 'status', STATUS_LEEG);
  const { state } = await laad(st);
  const br = state.config.buurt.bronnen;
  const heeftBronnen = br.uit.aan || (br.ics || []).some((b) => b.url);
  if (forceerEvents || (heeftBronnen && (!s.events || nu - s.events > 20 * 3600e3) && lokaal(nu).uur >= 5)) {
    try { const r = await haalEvents(st); verslag.push(`events: ${r.gevonden} gevonden, ${r.nieuw} nieuw`); } catch (e) { await noteerFout(st, 'events', e); }
  }
  await wijzig(st, 'status', STATUS_LEEG, (x) => { x.onderhoud = Date.now(); });
  return verslag;
}

export { store, lees, wijzig, geheimen, sleutel, GEHEIMEN_LEEG };
