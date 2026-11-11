/* ============================================================
   Opslag
   - "gedeeld": de Netlify-functie draait (deploy via GitHub) →
     alle toestellen zien hetzelfde, met logins en pushmeldingen.
   - "lokaal": geen functie (bv. Netlify Drop) → demo in deze browser.
   ============================================================ */
import { apply, defaultState, publicView, adminView, isAdminAction, migreer } from './core.js';

const KEY = 'guido-tafelclip-v1';
const TOKEN_KEY = 'guido-personeel-token';
const PIN_KEY = 'guido-tafelclip-pin';
const SESSIE_KEY = 'guido-sessie';

const veilig = (fn, terug) => { try { return fn(); } catch { return terug; } };

/* Personeel: blijft aangemeld op dit toestel (30 dagen). */
export const personeel = {
  token: () => veilig(() => localStorage.getItem(TOKEN_KEY) || '', ''),
  zet: (t) => veilig(() => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))),
  ik: () => veilig(() => JSON.parse(localStorage.getItem(TOKEN_KEY + '-ik') || 'null'), null),
  zetIk: (ik) => veilig(() => (ik ? localStorage.setItem(TOKEN_KEY + '-ik', JSON.stringify(ik)) : localStorage.removeItem(TOKEN_KEY + '-ik')))
};
/* Lokale modus: één pincode. */
export const savedPin = {
  get: () => veilig(() => sessionStorage.getItem(PIN_KEY) || '', ''),
  set: (p) => veilig(() => (p ? sessionStorage.setItem(PIN_KEY, p) : sessionStorage.removeItem(PIN_KEY)))
};
/* Gast: sessie na een echte tik op de clip. */
export const sessie = {
  get: (tafel) => veilig(() => { const s = JSON.parse(sessionStorage.getItem(SESSIE_KEY) || 'null'); return s && s.tafel === String(tafel) && s.exp > Date.now() ? s.token : ''; }, ''),
  zet: (tafel, token) => veilig(() => sessionStorage.setItem(SESSIE_KEY, JSON.stringify({ tafel: String(tafel), token, exp: Date.now() + 2.9 * 3600e3 })))
};

let gedeeldBelofte = null;
export function isGedeeld() {
  if (!gedeeldBelofte) gedeeldBelofte = (async () => {
    try {
      const r = await fetch('/api/state?ping=1', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return false;
      return (await r.json()).ok === true;
    } catch { return false; }
  })();
  return gedeeldBelofte;
}

function readLocal() {
  const raw = veilig(() => localStorage.getItem(KEY), null);
  if (raw) { const s = veilig(() => JSON.parse(raw), null); if (s && s.config && s.live) return migreer(s); }
  const s = defaultState(); writeLocal(s); return s;
}
function writeLocal(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); }
  catch { throw new Error('De browser kan niets bewaren (privévenster of opslag vol?).'); }
}

/** Rechtstreekse API-oproep (gedeelde modus). */
export async function api(pad, { method = 'GET', body, tafel } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const tk = personeel.token();
  if (tk) headers.authorization = 'Bearer ' + tk;
  else if (tafel) { const s = sessie.get(tafel); if (s) headers['x-guido-sessie'] = s; }
  let r;
  try { r = await fetch(pad, { method, headers, cache: 'no-store', body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch { const e = new Error('Geen verbinding. Kijk je wifi of 4G na.'); e.code = 'net'; throw e; }
  let j = null; try { j = await r.json(); } catch { /* */ }
  if (!r.ok) {
    const e = new Error((j && j.fout) || 'Er liep iets mis. Probeer opnieuw.');
    e.code = (j && j.code) || (r.status === 401 ? 'pin' : 'net'); e.status = r.status;
    throw e;
  }
  return j;
}

/**
 * @param {{ tafel?: string, admin?: boolean, tempo?: (view: any) => number }} opts
 */
export async function createStore(opts = {}) {
  const shared = await isGedeeld();
  const listeners = new Set();
  let view = null; let rev = ''; let pollTimer = null; let luistert = false;
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('guido-tafelclip') : null;
  const makeView = (s) => (opts.admin ? adminView(s) : publicView(s, opts.tafel));
  const setView = (v) => { if (!v) return; view = v; rev = v.rev; listeners.forEach((fn) => fn(view)); };
  const localRefresh = () => setView(makeView(readLocal()));

  async function remoteRefresh(vol) {
    const q = opts.admin ? 'admin=1' : 'tafel=' + encodeURIComponent(opts.tafel || '');
    const j = await api('/api/state?' + q + (rev && !vol ? '&since=' + encodeURIComponent(rev) : '') + (vol ? '&vol=1' : ''), { tafel: opts.tafel });
    if (j && j.state) setView(j.state);
    return j;
  }
  /* Verversen: vlug als er iets loopt, traag als het rustig is (spaart de server).
     opts.tempo(view) geeft het aantal milliseconden tot de volgende controle. */
  const tempo = () => Math.max(2000, Number(opts.tempo ? opts.tempo(view) : (opts.admin ? 4000 : 20000)) || 20000);
  function plan() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (document.visibilityState === 'visible') { try { await remoteRefresh(); } catch (e) { if (store.onFout) store.onFout(e); } }
      if (pollTimer) plan();
    }, tempo());
  }
  function startPolling() {
    plan();
    if (!luistert) {
      luistert = true;
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && pollTimer) { remoteRefresh().catch(() => {}); plan(); } });
      window.addEventListener('online', () => { if (pollTimer) remoteRefresh().catch(() => {}); });
    }
  }

  const store = {
    mode: shared ? 'gedeeld' : 'lokaal',
    onFout: null,
    get view() { return view; },
    subscribe(fn) { listeners.add(fn); if (view) fn(view); return () => listeners.delete(fn); },
    isAangemeld: () => (shared ? !!personeel.token() : readLocal().config.adminPin === savedPin.get() && !!savedPin.get()),

    async setupNodig() { return shared ? api('/api/setup') : { nodig: false }; },
    async setup(code, naam, pin) {
      const j = await api('/api/setup', { method: 'POST', body: { code, naam, pin } });
      personeel.zet(j.token); personeel.zetIk(j.ik); await store.start(); return j.ik;
    },
    async login(naam, pin) {
      if (shared) {
        const j = await api('/api/login', { method: 'POST', body: { naam, pin } });
        personeel.zet(j.token); personeel.zetIk(j.ik); rev = ''; await store.start(); return j.ik;
      }
      if (readLocal().config.adminPin !== pin) { const e = new Error('Verkeerde pincode.'); e.code = 'pin'; throw e; }
      savedPin.set(pin); await store.start();
      return { naam: 'Eigenaar', rol: 'eigenaar' };
    },
    logout() { personeel.zet(''); personeel.zetIk(null); savedPin.set(''); clearTimeout(pollTimer); pollTimer = null; view = null; rev = ''; },

    async start() {
      if (shared) {
        if (opts.admin && !personeel.token()) return;
        try { await remoteRefresh(true); }
        catch (e) { if (opts.admin && e.code === 'pin') { store.logout(); return; } throw e; }
        startPolling();
      } else {
        if (opts.admin && !store.isAangemeld()) return;
        localRefresh();
        if (!store._lokaal) {
          store._lokaal = true;
          window.addEventListener('storage', (e) => { if (e.key === KEY) localRefresh(); });
          if (bc) bc.onmessage = () => localRefresh();
        }
      }
    },

    async dispatch(action) {
      if (shared) {
        const j = await api('/api/action' + (opts.admin ? '?admin=1' : ''), { method: 'POST', body: action, tafel: action.tafel || opts.tafel });
        if (j.state) setView(j.state);
        if (pollTimer) plan();
        return j.result;
      }
      if (isAdminAction(action.type) && !store.isAangemeld()) { const e = new Error('Meld je opnieuw aan.'); e.code = 'pin'; throw e; }
      const { state, result } = apply(readLocal(), action, Date.now());
      writeLocal(state);
      if (bc) bc.postMessage('update');
      localRefresh();
      return result;
    },

    /** Opdrachten voor de eigenaar die enkel op de server bestaan (koppelingen, personeel…). */
    async beheer(type, data = {}) {
      if (!shared) { const e = new Error('Dit werkt enkel online in de gedeelde modus (zie LEESMIJ).'); e.code = 'lokaal'; throw e; }
      const j = await api('/api/beheer', { method: 'POST', body: { type, ...data } });
      await remoteRefresh(true).catch(() => {});
      return j.data !== undefined ? j.data : j;
    },

    refresh(vol) { return shared ? remoteRefresh(vol) : Promise.resolve(localRefresh()); }
  };
  return store;
}
