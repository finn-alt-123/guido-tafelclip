/* ============================================================
   guido. tafelclip — server (Cloudflare Workers + Durable Object)
   Alle routes onder /api/… komen hier binnen.
   ============================================================ */
import crypto from 'node:crypto';
import { lees, wijzig, geheimen, sleutel, GEHEIMEN_LEEG, laad, doeActie, verspreid, noteerFout, haalEvents, onderhoud, STATUS_LEEG } from './kern.mjs';
import { teken, controleer, hashPin, pinKlopt, GEBRUIKERS_LEEG, naamSleutel, publiekeGebruiker, gebruikerUitToken } from './auth.mjs';
import { controleerSun } from './sun.mjs';
import { vapid, PUSH_LEEG, stuur } from './push.mjs';
import { publicView, adminView, magActie, uid } from '../public/js/core.js';

const VERSIE = '3.0';
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
});
const fout = (msg, status = 400, code = 'fout') => json({ fout: msg, code }, status);
const CHIPS_LEEG = () => ({ uids: {} });

async function body(req) {
  const t = await req.text();
  if (t.length > 2000000) { const e = new Error('Te groot.'); e.status = 413; throw e; }
  if (!t) return {};
  if ((req.headers.get('content-type') || '').includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(t));
  try { return JSON.parse(t); } catch { const e = new Error('Ongeldig verzoek.'); e.status = 400; throw e; }
}

/* ---------- wie is dit? ---------- */
async function wie(storage, req, g) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const p = controleer(auth.slice(7), g.sessieSleutel);
    if (p && p.s === 'p') {
      const { data } = await lees(storage, 'gebruikers', GEBRUIKERS_LEEG);
      const gebr = gebruikerUitToken(data, p);
      if (gebr) return { rol: gebr.rol, gebruiker: gebr };
    }
    return { rol: 'gast', ongeldig: true };
  }
  const s = controleer(req.headers.get('x-guido-sessie') || '', g.sessieSleutel);
  if (s && s.s === 'g') return { rol: 'gast', tafel: s.t };
  return { rol: 'gast' };
}
const isPersoneel = (w) => w.rol === 'personeel' || w.rol === 'eigenaar';

/** Een gast moet een geldige sessie van een echte chip-tik hebben als de beveiliging aan staat. */
function gastMag(state, w, tafel) {
  if (isPersoneel(w)) return true;
  if (!state.config.beveiliging.chips) return true;
  return w.tafel && w.tafel === String(tafel);
}

async function adminExtra(storage, env, w, state) {
  const [gebr, chips, status, pushData] = await Promise.all([
    lees(storage, 'gebruikers', GEBRUIKERS_LEEG), lees(storage, 'chips', CHIPS_LEEG), lees(storage, 'status', STATUS_LEEG), lees(storage, 'push', PUSH_LEEG)
  ]);
  const extra = {
    ik: { id: w.gebruiker.id, naam: w.gebruiker.naam, rol: w.gebruiker.rol },
    push: pushData.data.lijst.filter((p) => p.gebruiker === w.gebruiker.id).map((p) => ({ id: p.id, naam: p.naam, actief: p.actief !== false }))
  };
  if (w.rol === 'eigenaar') {
    const g = await geheimen(storage);
    extra.gebruikers = gebr.data.lijst.map(publiekeGebruiker);
    extra.chips = Object.entries(chips.data.uids).map(([u, c]) => ({ uid: u, ...c }));
    extra.status = status.data;
    extra.koppelingen = {
      sun: { sleutel: !!sleutel(g, 'sun.meta', 'SUN_SLEUTEL', env) },
      uit: { sleutel: !!sleutel(g, 'uit.apiKey', 'UIT_API_KEY', env) },
      pushToestellen: pushData.data.lijst.length
    };
  }
  return extra;
}

async function staatVoor(storage, env, w, state, tafel, alsBeheer) {
  if (alsBeheer && isPersoneel(w)) {
    const { adminPin, ...config } = state.config;
    return { ...adminView(state), config, ...(await adminExtra(storage, env, w, state)) };
  }
  return publicView(state, tafel);
}

/* ============================================================ */
export async function routeApi(storage, env, req) {
  const url = new URL(req.url);
  const pad = url.pathname.replace(/^\/api/, '');
  const achteraf = async (p) => { try { await p; } catch (e) { await noteerFout(storage, 'achteraf', e); } };

  try {
    const g = await geheimen(storage);

    /* ---------- toestand ---------- */
    if (pad === '/state' && req.method === 'GET') {
      if (url.searchParams.has('ping')) return json({ ok: true, versie: VERSIE });
      const w = await wie(storage, req, g);
      const { state } = await laad(storage);
      if (url.searchParams.has('admin')) {
        if (!isPersoneel(w)) return fout('Meld je opnieuw aan.', 401, 'pin');
        const rev = state.config.rev + '-' + state.live.rev;
        if (url.searchParams.get('since') === rev && !url.searchParams.has('vol')) return json({ same: true });
        return json({ state: await staatVoor(storage, env, w, state, null, true) });
      }
      const tafel = url.searchParams.get('tafel') || '';
      if (!gastMag(state, w, tafel)) return fout('Tik opnieuw op de clip op je tafel.', 401, 'sessie');
      const v = await staatVoor(storage, env, w, state, tafel);
      if (url.searchParams.get('since') === v.rev) return json({ same: true });
      return json({ state: v });
    }

    if (pad === '/action' && req.method === 'POST') {
      const a = await body(req);
      const w = await wie(storage, req, g);
      if (w.ongeldig) return fout('Meld je opnieuw aan.', 401, 'pin');
      if (!magActie(w.rol, a.type)) return fout(w.rol === 'gast' ? 'Meld je aan.' : 'Dit mag enkel de eigenaar.', w.rol === 'gast' ? 401 : 403, 'pin');
      if (a.type === 'config' && a.config && a.config.adminPin) delete a.config.adminPin;
      if (w.rol === 'gast') {
        const { state } = await laad(storage);
        if (!gastMag(state, w, a.tafel)) return fout('Tik opnieuw op de clip op je tafel.', 401, 'sessie');
      }
      if (isPersoneel(w)) a.door = w.gebruiker.naam; else delete a.door;
      const r = await doeActie(storage, a, w.rol);
      await achteraf(verspreid(storage, r.state, r.nieuw));
      const alsBeheer = url.searchParams.has('admin') && isPersoneel(w);
      return json({ result: r.result, state: await staatVoor(storage, env, w, r.state, alsBeheer ? null : a.tafel, alsBeheer) });
    }

    /* ---------- personeel: eerste keer, aanmelden ---------- */
    if (pad === '/setup' && req.method === 'GET') {
      const { data } = await lees(storage, 'gebruikers', GEBRUIKERS_LEEG);
      return json({ nodig: data.lijst.length === 0, codeIngesteld: !!env.GUIDO_SETUP_CODE });
    }
    if (pad === '/setup' && req.method === 'POST') {
      const b = await body(req);
      const code = env.GUIDO_SETUP_CODE;
      if (!code) return fout('Stel eerst GUIDO_SETUP_CODE in bij Cloudflare (zie LEESMIJ).', 400, 'setup');
      if (!b.code || b.code.length !== code.length || !crypto.timingSafeEqual(Buffer.from(b.code), Buffer.from(code))) return fout('De opstartcode klopt niet.', 403, 'setup');
      if (!/^(?=.*[a-zA-Z])(?=.*[0-9]).{8,72}$/.test(String(b.pin || ''))) return fout('Een wachtwoord heeft minstens 8 tekens, met zowel letters als cijfers.');
      const naam = String(b.naam || '').trim().slice(0, 40);
      if (!naam) return fout('Vul je naam in.');
      const { result } = await wijzig(storage, 'gebruikers', GEBRUIKERS_LEEG, (d) => {
        if (d.lijst.length) return { skip: true, result: null };
        const gb = { id: uid(), naam, rol: 'eigenaar', ...hashPin(b.pin), versie: 0, aan: true };
        d.lijst.push(gb); return { result: gb };
      });
      if (!result) return fout('Er is al een eigenaar. Meld je gewoon aan.', 409);
      return json({ token: teken({ s: 'p', u: result.id, v: 0, exp: Date.now() + 30 * 864e5 }, g.sessieSleutel), ik: publiekeGebruiker(result) });
    }
    if (pad === '/login' && req.method === 'POST') {
      const b = await body(req);
      const sl = naamSleutel(b.naam);
      const { result } = await wijzig(storage, 'gebruikers', GEBRUIKERS_LEEG, (d) => {
        const p = d.pogingen[sl] || { n: 0, tot: 0 };
        if (p.tot > Date.now()) return { skip: true, result: { geblokkeerd: Math.ceil((p.tot - Date.now()) / 60e3) } };
        const gb = d.lijst.find((x) => naamSleutel(x.naam) === sl && x.aan !== false);
        if (!gb || !pinKlopt(b.pin, gb)) {
          p.n += 1; if (p.n >= 5) { p.tot = Date.now() + 10 * 60e3; p.n = 0; }
          d.pogingen[sl] = p; return { result: { mis: true } };
        }
        delete d.pogingen[sl]; gb.laatst = Date.now();
        return { result: { gb } };
      });
      if (result.geblokkeerd) return fout(`Te veel foute pogingen. Probeer over ${result.geblokkeerd} min opnieuw.`, 429, 'blok');
      if (result.mis) return fout('Naam of pincode klopt niet.', 401, 'pin');
      const gb = result.gb;
      return json({ token: teken({ s: 'p', u: gb.id, v: gb.versie || 0, exp: Date.now() + 30 * 864e5 }, g.sessieSleutel), ik: publiekeGebruiker(gb) });
    }

    /* ---------- chip aangetikt ---------- */
    if (pad === '/sessie' && req.method === 'POST') {
      const b = await body(req);
      const { state } = await laad(storage);
      const w = await wie(storage, req, g);
      let tafel = String(b.t || '');
      if (b.e && b.c) {
        const meta = sleutel(g, 'sun.meta', 'SUN_SLEUTEL', env);
        if (!meta) return fout('De chipbeveiliging is nog niet ingesteld.', 400, 'sun');
        const tik = controleerSun({ e: b.e, c: b.c, metaSleutel: meta, bestandSleutel: sleutel(g, 'sun.bestand', 'SUN_SLEUTEL_BESTAND', env) || meta });
        if (!tik) return fout('Deze clip kon niet gecontroleerd worden. Tik opnieuw.', 401, 'sessie');
        const koppelen = state.live.koppelen && state.live.koppelen.tot > Date.now() ? state.live.koppelen : null;
        const { result } = await wijzig(storage, 'chips', CHIPS_LEEG, (d) => {
          const c = d.uids[tik.uid];
          if (c && tik.ctr <= c.ctr) return { skip: true, result: { herhaald: true } };
          if (!c && !koppelen && state.config.beveiliging.chips) return { skip: true, result: { onbekend: true } };
          const nieuweTafel = koppelen ? koppelen.tafel : (c ? c.tafel : tafel);
          d.uids[tik.uid] = { tafel: nieuweTafel, ctr: tik.ctr, laatst: Date.now(), sinds: (c && c.sinds) || Date.now() };
          return { result: { tafel: nieuweTafel, gekoppeld: !!koppelen } };
        });
        if (result.herhaald) return fout('Deze link werd al gebruikt. Tik opnieuw op de clip.', 401, 'sessie');
        if (result.onbekend) return fout('Deze clip is nog niet gekoppeld aan een tafel. Vraag het even aan de bar.', 401, 'sessie');
        tafel = result.tafel;
        if (result.gekoppeld) {
          await doeActie(storage, { type: 'koppel-stop' }, 'intern');
          await doeActie(storage, { type: 'systeem-melding', soort: 'info', tafel, tafelNaam: 'Chip gekoppeld', tekst: `Chip ${tik.uid} hoort nu bij ${(state.config.tafels.find((t) => t.id === tafel) || {}).naam || tafel}.` }, 'intern');
        }
      } else if (state.config.beveiliging.chips && !isPersoneel(w)) {
        return fout('Tik op de clip op je tafel.', 401, 'sessie');
      }
      if (!state.config.tafels.some((t) => t.id === tafel)) return fout('Deze tafel bestaat niet (meer).', 404, 'tafel');
      await doeActie(storage, { type: 'scan', tafel }, 'intern');
      // ober tikt de clip aan → oproep afvinken
      let afgevinkt = 0;
      if (isPersoneel(w)) {
        const r = await doeActie(storage, { type: 'aan-tafel', tafel, door: w.gebruiker.naam }, w.rol);
        afgevinkt = r.result.afgevinkt;
      }
      return json({ tafel, afgevinkt, token: teken({ s: 'g', t: tafel, exp: Date.now() + 3 * 3600e3 }, g.sessieSleutel) });
    }

    /* ---------- pushmeldingen ---------- */
    if (pad === '/push/sleutel' && req.method === 'GET') return json({ publicKey: (await vapid(storage)).publicKey });
    if (pad === '/push' && req.method === 'POST') {
      const w = await wie(storage, req, g);
      if (!isPersoneel(w)) return fout('Meld je opnieuw aan.', 401, 'pin');
      const b = await body(req);
      await wijzig(storage, 'push', PUSH_LEEG, (d) => {
        if (b.weg) { d.lijst = d.lijst.filter((p) => !(p.gebruiker === w.gebruiker.id && (p.id === b.weg || (p.sub && b.sub && p.sub.endpoint === b.sub.endpoint)))); return; }
        if (b.id && b.actief !== undefined && !b.sub) { const p = d.lijst.find((x) => x.id === b.id && x.gebruiker === w.gebruiker.id); if (p) p.actief = !!b.actief; return; }
        if (!b.sub || !b.sub.endpoint || !/^https:\/\//.test(b.sub.endpoint)) { const e = new Error('Ongeldig abonnement.'); e.status = 400; throw e; }
        d.lijst = d.lijst.filter((p) => p.sub.endpoint !== b.sub.endpoint);
        d.lijst.push({ id: uid(), gebruiker: w.gebruiker.id, naam: String(b.naam || 'Toestel').slice(0, 40) + ' · ' + w.gebruiker.naam, sub: b.sub, actief: true, sinds: Date.now() });
        d.lijst = d.lijst.slice(-60);
      });
      return json({ ok: true });
    }

    /* ---------- beheer: enkel de eigenaar ---------- */
    if (pad === '/beheer' && req.method === 'POST') {
      const w = await wie(storage, req, g);
      if (w.rol !== 'eigenaar') return fout('Dit mag enkel de eigenaar.', w.rol === 'personeel' ? 403 : 401, 'pin');
      const b = await body(req);
      /* Bevestiging: het eigen wachtwoord, of — als je het vergeten bent — de opstartcode (GUIDO_SETUP_CODE) die enkel de eigenaar in Cloudflare kent. */
      const bevestigd = (invoer) => {
        const s = String(invoer || '');
        if (pinKlopt(s, w.gebruiker)) return true;
        const code = env.GUIDO_SETUP_CODE;
        return !!code && s.length === code.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(code));
      };
      switch (b.type) {
        case 'gebruiker-plus': case 'gebruiker-wijzig': case 'gebruiker-weg': {
          await wijzig(storage, 'gebruikers', GEBRUIKERS_LEEG, (d) => {
            const err = (m) => { const e = new Error(m); e.status = 400; throw e; };
            if (b.type === 'gebruiker-plus') {
              const naam = String(b.naam || '').trim().slice(0, 40);
              if (!naam) err('Vul een naam in.');
              if (d.lijst.some((x) => naamSleutel(x.naam) === naamSleutel(naam))) err('Die naam bestaat al.');
              if (!bevestigd(b.huidig)) err('Je huidige wachtwoord (of de opstartcode) klopt niet.');
              if (!/^(?=.*[a-zA-Z])(?=.*[0-9]).{8,72}$/.test(String(b.pin || ''))) err('Een wachtwoord heeft minstens 8 tekens, met zowel letters als cijfers.');
              d.lijst.push({ id: uid(), naam, rol: b.rol === 'eigenaar' ? 'eigenaar' : 'personeel', ...hashPin(b.pin), versie: 0, aan: true });
              return;
            }
            const x = d.lijst.find((y) => y.id === b.id);
            if (!x) err('Deze persoon bestaat niet meer.');
            const eigenaars = d.lijst.filter((y) => y.rol === 'eigenaar' && y.aan !== false);
            const laatsteEigenaar = x.rol === 'eigenaar' && eigenaars.length === 1;
            if (b.type === 'gebruiker-weg') { if (laatsteEigenaar) err('Je kan de laatste eigenaar niet verwijderen.'); d.lijst = d.lijst.filter((y) => y.id !== b.id); return; }
            if (b.pin !== undefined) {
              if (!bevestigd(b.huidig)) err('Je huidige wachtwoord (of de opstartcode) klopt niet.');
              if (!/^(?=.*[a-zA-Z])(?=.*[0-9]).{8,72}$/.test(String(b.pin))) err('Een wachtwoord heeft minstens 8 tekens, met zowel letters als cijfers.');
              Object.assign(x, hashPin(b.pin)); x.versie = (x.versie || 0) + 1;
            }
            if (b.rol) { if (laatsteEigenaar && b.rol !== 'eigenaar') err('Er moet minstens één eigenaar blijven.'); x.rol = b.rol === 'eigenaar' ? 'eigenaar' : 'personeel'; x.versie = (x.versie || 0) + 1; }
            if (b.aan !== undefined) { if (laatsteEigenaar && !b.aan) err('Er moet minstens één eigenaar blijven.'); x.aan = !!b.aan; x.versie = (x.versie || 0) + 1; }
          });
          return json({ ok: true });
        }
        case 'geheim': {
          const toegelaten = { sun: ['meta', 'bestand'], uit: ['apiKey'] };
          if (!toegelaten[b.soort]) return fout('Onbekend soort sleutel.');
          const w2 = b.waarden || {};
          if (b.soort === 'sun') for (const k of ['meta', 'bestand']) if (w2[k] && !/^[0-9a-fA-F]{32}$/.test(w2[k])) return fout('Een chipsleutel heeft precies 32 hexadecimale tekens (0-9, A-F).');
          await wijzig(storage, 'geheimen', GEHEIMEN_LEEG, (x) => {
            x[b.soort] = x[b.soort] || {};
            for (const k of toegelaten[b.soort]) if (w2[k] !== undefined) { if (w2[k] === '') delete x[b.soort][k]; else x[b.soort][k] = String(w2[k]).trim(); }
          });
          return json({ ok: true });
        }
        case 'events-nu': return json({ data: await haalEvents(storage, env) });
        case 'onderhoud-nu': return json({ data: await onderhoud(storage, env) });
        case 'chip-weg': await wijzig(storage, 'chips', CHIPS_LEEG, (d) => { delete d.uids[String(b.uid)]; }); return json({ ok: true });
        case 'push-test': return json({ data: await stuur(storage, { titel: 'Test', tekst: 'Meldingen werken op dit toestel 👍', tag: 'test', url: '/beheer.html' }) });
        default: return fout('Onbekende opdracht.');
      }
    }

    if (pad === '/health' && req.method === 'GET') {
      const { data: s } = await lees(storage, 'status', STATUS_LEEG);
      const oud = s.onderhoud ? Date.now() - s.onderhoud : null;
      const ok = oud === null || oud < 3 * 3600e3;
      return json({ ok, versie: VERSIE, onderhoudMinutenGeleden: oud === null ? null : Math.round(oud / 60e3) }, ok ? 200 : 503);
    }

    return fout('Niet gevonden.', 404);
  } catch (e) {
    const status = e.status || (e.code ? 400 : 500);
    if (status >= 500) { await noteerFout(storage, pad, e); return fout('Er ging iets mis op de server. Probeer opnieuw.', status, 'server'); }
    return fout(e.message, status, e.code || 'fout');
  }
}
