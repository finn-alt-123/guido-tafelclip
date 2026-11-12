/* ============================================================
   Personeel en beheer — meldingen, cijfers en alles wat de klant ziet.
   ============================================================ */
import { createStore, savedPin, personeel, api } from './store.js';
import { ago, wachtLabel, dateLabel, uid, isoDate, werkdag, isOpenMelding, isOpen } from './core.js';
import { I } from './icons.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const sameConfig = (a, b) => {
  const strip = (c) => { const { rev, adminPin, ...rest } = c; return JSON.stringify(rest); };
  return strip(a) === strip(b);
};

const TABS = [
  { id: 'meldingen', naam: 'Meldingen', ico: I.bel, rol: 'personeel', groep: 'Vandaag' },
  { id: 'cijfers', naam: 'Cijfers', ico: I.grafiek, rol: 'eigenaar', groep: 'Vandaag' },
  { id: 'klantscherm', naam: 'Knoppen & uren', ico: I.scherm, rol: 'eigenaar', groep: 'Wat de klant ziet' },
  { id: 'thema', naam: 'Thema', ico: I.palet, rol: 'eigenaar', groep: 'Wat de klant ziet' },
  { id: 'mededelingen', naam: 'Mededelingen', ico: I.megafoon, rol: 'eigenaar', groep: 'Wat de klant ziet' },
  { id: 'buurt', naam: 'In de buurt', ico: I.kaart, rol: 'eigenaar', groep: 'Wat de klant ziet' },
  { id: 'personeel', naam: 'Personeel', ico: I.hand, rol: 'eigenaar', gedeeld: true, groep: 'Opzet' },
  { id: 'instellingen', naam: 'Instellingen', ico: I.tandwiel, rol: 'eigenaar', groep: 'Opzet' }
];

let store = null;
let V = null;            // { config, live }
let draft = null;        // bewerkbare kopie van de instellingen
let editVersie = 0;
let bewaardVersie = 0;
let saveTimer = null;
let ingelogd = false;
const bekend = new Set();
const flits = new Set();

const ui = {
  tab: TABS.some((t) => t.id === location.hash.slice(1).split('&')[0]) ? location.hash.slice(1).split('&')[0] : 'meldingen',
  setup: null,
  uitvoer: {},
  bezig: '',
  tafel: '1',
  voorbeeld: '1',
  geluid: true,
  loginFout: ''
};
try { ui.geluid = localStorage.getItem('guido-geluid') !== 'uit'; } catch { /* */ }

/* ---------------- hulpjes ---------------- */
let toastTimer;
function toast(msg, isFout) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('fout', !!isFout);
  toastEl.classList.add('zichtbaar');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('zichtbaar'), 2800);
}

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((o, k) => o[k], obj);
  parent[last] = value;
}

const schakel = (path, label) => `<label class="schakel"><input type="checkbox" data-bind="${path}" ${getPath(draft, path) ? 'checked' : ''}><span class="baan"></span>${label ? `<span class="sr">${esc(label)}</span>` : ''}</label>`;
const tekstVeld = (path, label, opts = {}) => `<div class="veldrij"><label for="f-${path}">${esc(label)}</label>
  <input type="${opts.type || 'text'}" id="f-${path}" data-bind="${path}" ${opts.num ? 'data-num="1"' : ''} value="${esc(getPath(draft, path))}" ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''} ${opts.extra || ''}>
  ${opts.hulp ? `<span class="hulp">${opts.hulp}</span>` : ''}</div>`;
const tekstVak = (path, label, opts = {}) => `<div class="veldrij"><label for="f-${path}">${esc(label)}</label>
  <textarea id="f-${path}" data-bind="${path}" rows="${opts.rows || 3}" ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}>${esc(getPath(draft, path))}</textarea>
  ${opts.hulp ? `<span class="hulp">${opts.hulp}</span>` : ''}</div>`;
const knop = (a, ico, label, extra = '') => `<button type="button" class="ikoon-knop ${a === 'weg' ? 'weg' : ''}" data-a="${a}" ${extra} aria-label="${esc(label)}" title="${esc(label)}">${ico}</button>`;

const tafelUrl = (id) => location.origin + location.pathname.replace(/beheer\.html$/, '') + '?t=' + encodeURIComponent(id);
const openMeldingen = () => (V ? V.live.meldingen.filter((m) => m.status === 'nieuw') : []);
const duur = (s) => (s == null ? '–' : s < 60 ? Math.round(s) + ' s' : Math.floor(s / 60) + ' min ' + String(Math.round(s % 60)).padStart(2, '0') + ' s');
const gemiddeld = (d) => (d && d.reactieN ? d.reactieS / d.reactieN : null);

/* ---------------- geluid ---------------- */
let audio = null;
document.addEventListener('pointerdown', () => { if (!audio && 'AudioContext' in window) audio = new AudioContext(); }, { once: true });
function ping() {
  if (!ui.geluid || !audio) return;
  const t = audio.currentTime;
  [[880, 0], [1175, 0.14]].forEach(([f, d]) => {
    const o = audio.createOscillator(); const g = audio.createGain();
    o.frequency.value = f; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25);
    o.connect(g).connect(audio.destination); o.start(t + d); o.stop(t + d + 0.3);
  });
}

/* ============================================================
   SCHERMEN
   ============================================================ */
function loginHtml() {
  const gedeeld = store && store.mode === 'gedeeld';
  const fout = ui.loginFout ? `<div class="melding-fout" role="alert">${esc(ui.loginFout)}</div>` : '';
  const pinVeld = (id, label) => `<label class="lbl" for="${id}">${label}</label><input class="veld" id="${id}" type="password" maxlength="72" minlength="8" required autocomplete="off">`;
  if (ui.setup && ui.setup.nodig) {
    return `<div class="a-login"><form id="setup" autocomplete="off">
      <img class="logo-login" src="img/logo.png" alt="guido.">
      <h2 style="margin:4px 0 0">Eerste keer opstarten</h2>
      <p style="margin:0" class="muted small">Maak het account van de eigenaar. Daarna voeg je het personeel toe.</p>
      ${ui.setup.codeIngesteld ? '' : '<div class="melding-fout">Stel eerst <strong>GUIDO_SETUP_CODE</strong> in bij Netlify (LEESMIJ, stap 2).</div>'}
      <label class="lbl" for="s-code">Opstartcode</label><input class="veld" id="s-code" type="password" required autocomplete="off">
      <label class="lbl" for="s-naam">Je naam</label><input class="veld" id="s-naam" type="text" required maxlength="40" autocomplete="off">
      ${pinVeld('s-pin', 'Kies een wachtwoord (minstens 8 tekens, met letters en cijfers)')}
      ${fout}
      <button class="btn btn-groen btn-vol" type="submit">Account maken</button>
    </form></div>`;
  }
  return `<div class="a-login"><form id="login" autocomplete="off">
    <img class="logo-login" src="img/logo.png" alt="guido.">
    <p style="margin:0;text-align:center" class="muted">guido. team · meldingen en beheer</p>
    ${gedeeld ? `<label class="lbl" for="naam">Naam</label><input class="veld" id="naam" type="text" required maxlength="40" autocomplete="username" autocapitalize="words" value="${esc((personeel.ik() || {}).naam || '')}">` : ''}
    ${pinVeld('pin', 'Wachtwoord')}
    ${fout}
    <button class="btn btn-groen btn-vol" type="submit">Aanmelden</button>
    <p class="tiny muted" style="margin:0;text-align:center">${gedeeld ? 'Nog geen account? Vraag het aan de eigenaar.' : 'Demo zonder server: het wachtwoord is <strong>1234</strong>.'}</p>
  </form></div>`;
}

function navHtml() {
  const n = openMeldingen().length;
  let groep = '';
  const kopje = (t) => { if (rol() !== 'eigenaar' || t.groep === groep) return ''; groep = t.groep; return `<div class="groep">${t.groep}</div>`; };
  const items = zichtbareTabs().map((t) => `${kopje(t)}<button type="button" data-a="tab" data-v="${t.id}" ${ui.tab === t.id ? 'aria-current="page"' : ''}>${t.ico}<span>${t.naam}</span>${t.id === 'meldingen' && n ? `<span class="tel">${n}</span>` : ''}</button>`).join('');
  const mob = zichtbareTabs().map((t) => `<button type="button" data-a="tab" data-v="${t.id}" ${ui.tab === t.id ? 'aria-current="page"' : ''}>${t.naam}${t.id === 'meldingen' && n ? `<span class="tel">${n}</span>` : ''}</button>`).join('');
  return {
    zij: `<nav class="a-nav" aria-label="Beheer">
      <img class="logo-nav" src="img/logo.png" alt="guido."><div class="ondertitel">${V && V.ik ? 'Aangemeld als ' + esc(V.ik.naam) : 'Tafelclips'}</div>
      ${items}
      <div class="onder">
        <span class="modus ${store.mode}">${store.mode === 'gedeeld' ? 'Online · alle toestellen' : 'Lokale demo'}</span>
        <a href="./?t=${esc(ui.voorbeeld)}" target="_blank" rel="noopener">Klantscherm openen</a>
        <button type="button" class="btn-tekst" style="padding:0;min-height:0;text-align:left;font-size:13px" data-a="uitloggen">Afmelden</button>
      </div>
    </nav>`,
    mobiel: `<nav class="mobiel-nav" aria-label="Beheer">${mob}</nav>`
  };
}

function voorbeeldHtml() {
  const opts = draft.tafels.map((t) => `<option value="${esc(t.id)}" ${t.id === ui.voorbeeld ? 'selected' : ''}>${esc(t.naam)}</option>`).join('');
  return `<aside class="a-voorbeeld" aria-label="Voorbeeld klantscherm">
    <div class="v-kop"><strong>Zo ziet de klant het</strong><label class="sr" for="v-tafel">Tafel</label><select id="v-tafel" data-a="voorbeeld">${opts}</select></div>
    <div class="telefoon"><iframe id="voorbeeld" title="Voorbeeld klantscherm" src="./?t=${encodeURIComponent(ui.voorbeeld)}&voorbeeld=1"></iframe></div>
    <p class="tiny">Live: wijzigingen verschijnen hier na een paar tellen. Je kan erin klikken zoals een klant.</p>
  </aside>`;
}

function kop(titel, tekst, rechts = '') {
  return `<div class="a-kop"><div><h1>${esc(titel)}</h1>${tekst ? `<p>${tekst}</p>` : ''}</div><div class="knoppen-rij" style="align-items:center">${rechts}<span class="bewaard" id="bewaard" aria-live="polite"></span></div></div>`;
}

/* ---------------- meldingen ---------------- */
function meldingHtml(m) {
  let ico, wat;
  if (m.soort === 'ober') { ico = I.hand; wat = 'Ober roepen' + (m.tekst ? ` · <em>${esc(m.tekst)}</em>` : ''); }
  else if (m.soort === 'afrekenen') { ico = I.bon; wat = 'Wil afrekenen' + (m.tekst ? ` · <em>${esc(m.tekst)}</em>` : ''); }
  else if (m.soort === 'verzoek') { ico = `<span aria-hidden="true">${esc(m.emoji)}</span>`; wat = esc(m.label) + (m.tekst ? `: <strong>“${esc(m.tekst)}”</strong>` : ''); }
  else if (m.soort === 'fout') { ico = '!'; wat = esc(m.tekst); }
  else { ico = I.nfc; wat = esc(m.tekst); }
  const oproep = m.soort === 'ober' || m.soort === 'afrekenen';
  let knoppen = '';
  if (m.status === 'nieuw' && oproep) knoppen = `<button class="btn btn-geel btn-klein" data-a="status" data-id="${m.id}" data-v="onderweg">Ik kom eraan</button><button class="btn btn-licht btn-klein" data-a="status" data-id="${m.id}" data-v="klaar">Klaar</button>`;
  else if (m.status === 'onderweg') knoppen = `<button class="btn btn-groen btn-klein" data-a="status" data-id="${m.id}" data-v="klaar">Klaar</button>`;
  else if (m.status === 'nieuw') knoppen = `<button class="btn btn-geel btn-klein" data-a="status" data-id="${m.id}" data-v="klaar">${m.soort === 'verzoek' ? 'Gedaan' : 'Gezien'}</button>`;
  let tijd; let laat = false;
  if (isOpenMelding(m)) {
    tijd = wachtLabel(m.ts) + (m.status === 'onderweg' ? ' · ' + (m.door ? esc(m.door) + ' is onderweg' : 'onderweg') : '');
    laat = m.status === 'nieuw' && Date.now() - m.ts > 2 * 60e3;
  } else {
    tijd = ago(m.ts) + (m.status === 'geannuleerd' ? ' · geannuleerd door de klant' : m.aanTafel ? ' · ' + esc(m.door || 'iemand') + ' was aan tafel' : m.door ? ' · afgehandeld door ' + esc(m.door) : m.soort === 'info' ? '' : ' · afgehandeld');
  }
  return `<article class="mld ${m.soort} st-${m.status} ${flits.has(m.id) ? 'nieuw-flits' : ''}">
    <div class="m-ico">${ico}</div>
    <div class="m-tekst"><div class="m-tafel">${esc(m.tafelNaam || 'Tafel ' + m.tafel)}</div><div class="m-wat">${wat}</div><div class="m-tijd ${laat ? 'laat' : ''}">${tijd}</div></div>
    ${knoppen ? `<div class="m-knoppen">${knoppen}</div>` : ''}
  </article>`;
}

function meldingenTab() {
  const alle = V.live.meldingen;
  const open = alle.filter(isOpenMelding).sort((a, b) => a.ts - b.ts);
  const rest = alle.filter((m) => !isOpenMelding(m)).slice(0, 20);
  const d = (V.live.stats || {})[werkdag()] || {};
  const rechts = `<span class="open-pil ${isOpen(V.config) ? '' : 'dicht'}">${isOpen(V.config) ? 'Open: klanten kunnen roepen' : 'Gesloten: klanten kunnen niet roepen'}</span>
    <button class="btn btn-licht btn-klein" data-a="geluid" aria-pressed="${ui.geluid}">${ui.geluid ? I.geluid : I.stil} ${ui.geluid ? 'Geluid aan' : 'Geluid uit'}</button>
    ${rest.length ? `<button class="btn btn-licht btn-klein" data-a="opruimen">Afgehandelde wissen</button>` : ''}`;
  return kop('Meldingen', 'Wie het langst wacht, staat bovenaan.', rechts) + toestelBlok() + `
    ${open.length ? `<div class="meldingen">${open.map(meldingHtml).join('')}</div>` : `<div class="leeg"><span class="hand">Alles rustig.</span>Nieuwe oproepen verschijnen hier meteen${ui.geluid ? ', met een belletje' : ''}.</div>`}
    <div class="tellers" style="margin-top:16px">
      <div class="teller"><b>${d.ober || 0}</b><span>keer ober geroepen</span></div>
      <div class="teller"><b>${d.afrekenen || 0}</b><span>keer afrekenen</span></div>
      <div class="teller"><b>${d.verzoek || 0}</b><span>verzoekjes</span></div>
      <div class="teller"><b>${duur(gemiddeld(d))}</b><span>gemiddelde reactietijd</span></div>
    </div>
    ${rest.length ? `<h3 class="groep">Afgehandeld</h3><div class="meldingen">${rest.map(meldingHtml).join('')}</div>` : ''}`;
}

/* ---------------- cijfers ---------------- */
function dagenTerug(n) {
  const uit = [];
  for (let i = n - 1; i >= 0; i--) uit.push(werkdag(Date.now() - i * 864e5));
  return uit;
}
function cijfersTab() {
  const stats = V.live.stats || {};
  const dagen = dagenTerug(30);
  const som = (lijst, veld) => lijst.reduce((x, k) => x + ((stats[k] || {})[veld] || 0), 0);
  const week = dagen.slice(-7);
  const totaal = (k) => { const x = stats[k] || {}; return (x.ober || 0) + (x.afrekenen || 0) + (x.verzoek || 0); };
  const max = Math.max(1, ...dagen.map(totaal));
  const balken = dagen.map((k) => `<div class="b ${totaal(k) ? '' : 'nul'}" style="height:${Math.round(totaal(k) / max * 100)}%" title="${dateLabel(k, '')}: ${totaal(k)}"></div>`).join('');
  const wk = { reactieS: som(week, 'reactieS'), reactieN: som(week, 'reactieN') };
  const rijen = dagen.slice().reverse().filter((k) => stats[k]).map((k) => { const x = stats[k];
    return `<tr><td>${esc(dateLabel(k, ''))}</td><td>${x.ober || 0}</td><td>${x.afrekenen || 0}</td><td>${x.verzoek || 0}</td><td>${x.geannuleerd || 0}</td><td>${duur(gemiddeld(x))}</td></tr>`; }).join('');
  return kop('Cijfers', 'Hoe vaak de clips gebruikt worden en hoe vlug er gereageerd wordt. Een avond telt tot 5 uur ’s ochtends.', rijen ? '<button class="btn btn-licht btn-klein" data-a="csv">Download als tabel (CSV)</button>' : '') + `
    <div class="tellers">
      <div class="teller"><b>${som(week, 'ober')}</b><span>keer ober geroepen · 7 dagen</span></div>
      <div class="teller"><b>${som(week, 'afrekenen')}</b><span>keer afrekenen · 7 dagen</span></div>
      <div class="teller"><b>${som(week, 'verzoek')}</b><span>verzoekjes · 7 dagen</span></div>
      <div class="teller"><b>${duur(gemiddeld(wk))}</b><span>gemiddelde reactietijd · 7 dagen</span></div>
    </div>
    <section class="blok"><h2>Gebruik per dag</h2><p class="uitleg">Oproepen, afrekenen en verzoekjes samen, laatste 30 dagen.</p>
      <div class="balken" role="img" aria-label="Gebruik per dag, laatste 30 dagen">${balken}</div>
      <div class="balken-as"><span>${esc(dateLabel(dagen[0], ''))}</span><span>vandaag</span></div></section>
    ${rijen ? `<section class="blok"><div class="tabel-wrap"><table class="tabel"><thead><tr><th>Dag</th><th>Ober</th><th>Afrekenen</th><th>Verzoekjes</th><th>Geannuleerd</th><th>Reactietijd</th></tr></thead><tbody>${rijen}</tbody></table></div>
      <p class="small muted" style="margin:12px 0 0">Reactietijd = van de tik van de klant tot iemand “Ik kom eraan” of “Klaar” tikt.</p></section>` : '<div class="leeg"><span class="hand">Nog geen cijfers.</span>Ze verschijnen zodra de eerste klant een clip gebruikt.</div>'}
    ${scansBlok()}`;
}

function scansBlok() {
  const scans = V.live.tafelScans || {};
  const namen = Object.fromEntries(draft.tafels.map((t) => [t.id, t.naam]));
  const rijen = Object.keys(scans).sort((a, b) => scans[b] - scans[a]).slice(0, 10)
    .map((id) => `<tr><td>${esc(namen[id] || id)}</td><td>${scans[id]}</td></tr>`).join('');
  return `<section class="blok"><h2>Meest gescande tafels</h2><p class="uitleg">Hoe vaak de clip van elke tafel aangetikt is, sinds het begin.</p>
    ${rijen ? `<div class="tabel-wrap"><table class="tabel"><thead><tr><th>Tafel</th><th>Keer gescand</th></tr></thead><tbody>${rijen}</tbody></table></div>`
      : '<div class="leeg"><span class="hand">Nog geen scans.</span>Ze verschijnen zodra een klant of personeelslid een clip aantikt.</div>'}
  </section>`;
}

/* ---------------- tafels (sectie binnen Instellingen) ---------------- */
function tafelsBlok() {
  if (!draft.tafels.some((t) => t.id === ui.tafel)) ui.tafel = draft.tafels[0] ? draft.tafels[0].id : '';
  const idx = draft.tafels.findIndex((t) => t.id === ui.tafel);
  const lijst = draft.tafels.map((t) => {
    const oproep = V.live.meldingen.some((m) => m.tafel === t.id && isOpenMelding(m));
    const chip = (V.chips || []).some((c) => c.tafel === t.id);
    return `<button type="button" class="t" data-a="kies-tafel" data-v="${esc(t.id)}" aria-current="${t.id === ui.tafel}">${oproep ? '<span class="t-stip" title="Open melding"></span>' : ''}<span class="t-naam">${esc(t.naam)}</span><span class="t-bedrag">${chip ? 'beveiligd' : ''}</span></button>`;
  }).join('');

  let detail = '<div class="leeg">Nog geen tafels. Voeg er een toe.</div>';
  if (idx >= 0) {
    const t = draft.tafels[idx];
    const url = tafelUrl(t.id);
    const nfc = 'NDEFReader' in window;
    detail = `
      <section class="blok">
        <div class="grid2">
          ${tekstVeld(`tafels.${idx}.naam`, 'Naam die de klant en het personeel zien', { hulp: 'Bv. “Tafel 4”, “Terras 2” of “Aan het raam”.' })}
          <div class="veldrij"><span class="lbl">Code op de clip</span><input type="text" value="${esc(t.id)}" readonly aria-label="Code op de clip"><span class="hulp">Vast, zodat een geschreven clip blijft werken.</span></div>
        </div>
      </section>
      <section class="blok">
        <h2>NFC-clip</h2>
        <p class="uitleg">Schrijf deze link op de chip in de klem. ${nfc ? 'Je gsm kan dat rechtstreeks.' : 'Gebruik bv. de gratis app <strong>NFC Tools</strong> (iPhone en Android): Schrijven → Record toevoegen → URL.'}</p>
        <div class="link-veld"><label class="sr" for="nfc-url">Link voor de chip</label><input type="text" id="nfc-url" value="${esc(url)}" readonly>
          <button class="btn btn-licht btn-klein" data-a="kopieer" data-v="${esc(url)}">${I.kopie} Kopieer</button></div>
        <div class="knoppen-rij" style="margin-top:10px">
          <a class="btn btn-licht btn-klein" href="${esc(url)}&voorbeeld=1" target="_blank" rel="noopener">${I.extern} Open klantscherm</a>
          ${nfc ? `<button class="btn btn-geel btn-klein" data-a="schrijf-nfc" data-v="${esc(url)}">${I.nfc} Schrijf naar chip</button>` : ''}
        </div>
        ${chipBlok(t)}
      </section>
      <section class="blok"><div class="blok-kop"><div><h2>Tafel verwijderen</h2><p>De clip met deze code werkt dan niet meer.</p></div><button class="btn btn-gevaar btn-klein" data-a="tafel-weg">Verwijderen</button></div></section>`;
  }
  return `<h3 class="groep" style="margin-top:0">Tafels &amp; clips</h3><p class="uitleg" style="margin:-4px 0 14px">Elke tafel heeft een eigen clip. Kies een tafel om de link voor de chip te zien.</p>
    <div class="tafel-grid" style="margin-bottom:16px">
      <div><div class="tafel-lijst">${lijst}</div><button class="btn btn-licht btn-klein btn-vol" style="margin-top:10px" data-a="tafel-plus">${I.plus} Tafel toevoegen</button></div>
      <div>${detail}</div>
    </div>`;
}

/* ---------------- klantscherm ---------------- */
function tags(path, opts = {}) {
  const lijst = getPath(draft, path);
  return `<div class="taglijst">${lijst.map((v, i) => `<span class="tag">${esc(opts.fmt ? opts.fmt(v) : v)}<button type="button" data-a="tag-weg" data-path="${path}" data-i="${i}" aria-label="${esc(v)} verwijderen">×</button></span>`).join('')}
    <span class="tag-nieuw"><label class="sr" for="tag-${path}">${esc(opts.label || 'Toevoegen')}</label><input type="${opts.num ? 'number' : 'text'}" id="tag-${path}" placeholder="${esc(opts.placeholder || 'Toevoegen…')}" data-tag="${path}" ${opts.num ? 'min="0" max="50"' : 'maxlength="40"'}><button type="button" class="btn btn-licht btn-klein" data-a="tag-plus" data-path="${path}">Voeg toe</button></span></div>`;
}

function moduleBlok(path, titel, uitleg, lijf) {
  const aan = getPath(draft, path + '.aan');
  return `<section class="blok ${aan ? '' : 'uit'}">
    <div class="blok-kop"><div><h2>${titel}</h2><p>${uitleg}</p></div>${schakel(path + '.aan', titel + ' aan of uit')}</div>
    ${aan ? '' : '<p class="uit-melding">Staat uit: klanten zien dit niet.</p>'}
    <div class="blok-lijf">${lijf}</div>
  </section>`;
}

const VOLGORDE_LABELS = { acties: 'Oproepknop & acties', wifi: 'Wifi', mededelingen: 'Mededelingen', buurt: 'In de buurt', sociaal: 'Google Reviews & sociale knoppen' };
function volgordeBlok() {
  const lijst = draft.volgorde;
  const items = lijst.map((k, i) => `<div class="lijst-item" style="padding:10px 14px">
    <div class="li-kop" style="margin:0"><span class="titel">${esc(VOLGORDE_LABELS[k] || k)}</span>
      ${knop('op', I.omhoog, 'Hoger', `data-path="volgorde" data-i="${i}" ${i === 0 ? 'disabled' : ''}`)}${knop('neer', I.omlaag, 'Lager', `data-path="volgorde" data-i="${i}" ${i === lijst.length - 1 ? 'disabled' : ''}`)}</div>
  </div>`).join('');
  return `<section class="blok"><h2>Volgorde op het klantscherm</h2><p class="uitleg">In welke volgorde de klant deze onderdelen ziet, onder de banner. Zet bijvoorbeeld de Google Reviews-knop bovenaan als die voor jou het belangrijkst is.</p>
    <div class="lijst">${items}</div></section>`;
}

function klantschermTab() {
  const c = draft;
  const logo = c.cafe.logo ? `<img src="${esc(c.cafe.logo)}" alt="Logo">` : (c.cafe.naam || 'guido.') === 'guido.' ? '<img src="img/logo.png" alt="guido.">' : `<span class="woordmerk">${esc((c.cafe.naam || '').replace(/\.$/, ''))}<b>.</b></span>`;
  const algemeen = `<section class="blok"><h2>Bovenaan het scherm</h2><p class="uitleg">Hou de welkomtekst kort: de knoppen moeten meteen zichtbaar zijn.</p>
    <div class="li-velden">
      ${tekstVeld('cafe.naam', 'Naam van het café')}
      ${tekstVak('cafe.welkom', 'Welkomtekst (één of twee zinnen)', { rows: 2 })}
      ${tekstVak('cafe.welkomEn', 'Engelse vertaling (optioneel)', { rows: 2, hulp: 'Leeg laten = Engelstalige klanten zien ook de Nederlandse tekst.' })}
      <div class="veldrij"><span class="lbl">Logo</span>
        <div class="logo-voorbeeld"><div class="vak">${logo}</div>
          <div class="knoppen">
            <label class="btn btn-licht btn-klein" style="cursor:pointer">Logo kiezen<input type="file" accept="image/png,image/jpeg,image/webp" data-a="logo" class="sr"></label>
            ${c.cafe.logo ? '<button class="btn btn-tekst btn-klein" data-a="logo-weg">Logo verwijderen</button>' : ''}
          </div></div>
        <span class="hulp">Gebruik een witte of lichte versie, het komt op de groene balk.</span></div>
    </div></section>`;

  const sociaal = `<section class="blok"><h2>Knoppen onderaan het scherm</h2><p class="uitleg">Nette knoppen naast elkaar onderaan het klantscherm. Enkel ingevuld = enkel zichtbaar.</p>
    <div class="grid3">
      ${tekstVeld('cafe.googleReviewUrl', 'Link naar Google Reviews', { type: 'url', placeholder: 'https://g.page/r/…' })}
      ${tekstVeld('cafe.instagramUrl', 'Link naar Instagram', { type: 'url', placeholder: 'https://instagram.com/cafeguido' })}
      ${tekstVeld('cafe.facebookUrl', 'Link naar Facebook', { type: 'url', placeholder: 'https://facebook.com/cafeguido' })}
    </div></section>`;

  const DAGNAMEN = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
  const urenRijen = [1, 2, 3, 4, 5, 6, 0].map((i) => { const d = c.uren.dagen[i];
    return `<div class="uren-rij ${d.dicht ? 'dicht' : ''}"><strong>${DAGNAMEN[i]}</strong>
      <input type="time" data-bind="uren.dagen.${i}.van" value="${esc(d.van)}" aria-label="${DAGNAMEN[i]} open vanaf" ${d.dicht ? 'disabled' : ''}>
      <input type="time" data-bind="uren.dagen.${i}.tot" value="${esc(d.tot)}" aria-label="${DAGNAMEN[i]} open tot" ${d.dicht ? 'disabled' : ''}>
      <label class="vink"><input type="checkbox" data-bind="uren.dagen.${i}.dicht" ${d.dicht ? 'checked' : ''}> Gesloten</label></div>`; }).join('');
  const uren = moduleBlok('uren', 'Openingsuren', 'Buiten deze uren kan niemand roepen of iets vragen. Mededelingen en tips blijven zichtbaar. Uit = altijd open.', `
    <div>${urenRijen}</div>
    <p class="small muted" style="margin:0">Sluit je na middernacht? Vul gewoon het sluitingsuur in, bv. 16:00 tot 02:00.</p>
    ${tekstVeld('uren.tekst', 'Wat de klant ziet als je gesloten bent')}`);

  const ober = moduleBlok('ober', 'Ober roepen', 'De grote gele knop. Eén tik en de oproep staat bij Meldingen.', `
    <div class="veldrij"><span class="lbl">Na het roepen kan de klant aantikken waarvoor het is (optioneel)</span>${tags('ober.redenen', { placeholder: 'Bv. Iets bestellen' })}<span class="hulp">Hou het bij twee of drie keuzes. Geen keuzes = geen vraag.</span></div>
    <div style="max-width:320px">${tekstVeld('ober.wachttijd', 'Minimum tijd tussen twee oproepen (minuten)', { type: 'number', num: true, extra: 'min="0" max="30"', hulp: 'Tegen per ongeluk of te vaak roepen.' })}</div>`);

  const afrekenen = moduleBlok('afrekenen', 'Afrekenen', 'De klant vraagt de rekening. Betalen gebeurt aan tafel, zoals altijd: jij ziet wie betaald heeft.', `
    <div>
      <div class="schakel-rij"><div><strong>Vraag: met de kaart of contant?</strong><span>Zo weet je of je de betaalterminal moet meenemen.</span></div>${schakel('afrekenen.wijze', 'Kaart of contant vragen')}</div>
    </div>`);

  const vz = c.verzoekjes.items.map((it, i) => `<div class="lijst-item ${it.aan ? '' : 'uitgeschakeld'}">
    <div class="li-kop"><span class="titel">${esc(it.emoji)} ${esc(it.label || 'Nieuw verzoekje')}</span>
      ${schakel(`verzoekjes.items.${i}.aan`, 'Tonen')}
      ${knop('op', I.omhoog, 'Hoger', `data-path="verzoekjes.items" data-i="${i}" ${i === 0 ? 'disabled' : ''}`)}${knop('neer', I.omlaag, 'Lager', `data-path="verzoekjes.items" data-i="${i}" ${i === c.verzoekjes.items.length - 1 ? 'disabled' : ''}`)}${knop('weg', I.weg, 'Verwijderen', `data-path="verzoekjes.items" data-i="${i}"`)}</div>
    <div class="li-velden">
      <div style="display:grid;grid-template-columns:80px 1fr;gap:12px">${tekstVeld(`verzoekjes.items.${i}.emoji`, 'Icoon', { extra: 'class="emoji-veld" maxlength="4"' })}${tekstVeld(`verzoekjes.items.${i}.label`, 'Knoptekst', { placeholder: 'Bv. Liedje aanvragen' })}</div>
      ${tekstVeld(`verzoekjes.items.${i}.labelEn`, 'Knoptekst in het Engels (optioneel)', { placeholder: 'Bv. Request a song' })}
      <div class="schakel-rij" style="border:0;padding:0"><div><strong>Klant typt er iets bij</strong><span>Bv. welk liedje of welk berichtje.</span></div>${schakel(`verzoekjes.items.${i}.tekst`, 'Klant typt er iets bij')}</div>
      ${it.tekst ? tekstVeld(`verzoekjes.items.${i}.hint`, 'Voorbeeldtekst in het vak', { placeholder: 'Bv. Artiest – titel' }) : ''}
      ${it.tekst ? tekstVeld(`verzoekjes.items.${i}.hintEn`, 'Voorbeeldtekst in het Engels (optioneel)', { placeholder: 'Bv. Artist – title' }) : ''}
    </div></div>`).join('');
  const verzoekjes = moduleBlok('verzoekjes', 'Verzoekjes', 'Kleine vragen aan de bar: een liedje, een kaarsje, een lief woordje.', `
    <div class="lijst">${vz}</div>
    <button class="btn btn-licht btn-klein" data-a="lijst-plus" data-path="verzoekjes.items">${I.plus} Verzoekje toevoegen</button>`);

  const wifi = moduleBlok('wifi', 'Wifi', 'Toont de naam en het wachtwoord van de gastenwifi, met een knop om te kopiëren.', `
    <div class="grid2">${tekstVeld('wifi.naam', 'Naam van het netwerk')}${tekstVeld('wifi.wachtwoord', 'Wachtwoord', { hulp: 'Iedereen die een clip aantikt, kan dit lezen. Gebruik enkel de gastenwifi.' })}</div>`);

  return kop('Knoppen & uren', 'Kies wat klanten kunnen doen als ze de clip aantikken. Alles wordt meteen bewaard.') + volgordeBlok() + algemeen + sociaal + uren + ober + afrekenen + verzoekjes + wifi;
}

/* ---------------- thema ---------------- */
function themaTab() {
  const t = draft.theme;
  const kleurVeld = (path, label) => `<div class="veldrij"><label for="f-${path}">${esc(label)}</label><input type="color" id="f-${path}" data-bind="${path}" value="${esc(getPath(draft, path))}" style="min-height:42px;padding:4px;max-width:120px"></div>`;
  return kop('Thema', 'Kleuren, lettertype en logogrootte op het klantscherm. Niets verandert vanzelf.') + `
    <section class="blok"><h2>Kleuren</h2>
      <div class="grid2">
        ${kleurVeld('theme.kleurPrimair', 'Hoofdkleur (balk, knoppen)')}
        ${kleurVeld('theme.kleurAccent', 'Accentkleur (oproepknop, tafelpil)')}
      </div>
      <div class="knoppen-rij" style="margin-top:12px"><button class="btn btn-licht btn-klein" type="button" data-a="thema-reset">Terug naar standaardkleuren</button></div>
    </section>
    <section class="blok"><h2>Lettertype</h2>
      ${selectVeld('theme.lettertype', 'Lettertype op het klantscherm', [['inter', 'Inter (standaard)'], ['gochi', 'Gochi Hand (speels)'], ['systeem', 'Systeemlettertype']])}
    </section>
    <section class="blok"><h2>Groene banner bovenaan</h2>
      ${selectVeld('theme.banner', 'Grootte van de banner', [['normaal', 'Normaal'], ['compact', 'Compact (kleiner logo en tekst)'], ['minimaal', 'Minimaal (zonder welkomsttekst)']])}
    </section>
    <section class="blok"><h2>Logo</h2>
      <div style="max-width:220px">${tekstVeld('theme.logoGrootte', 'Logogrootte (%)', { type: 'number', num: true, extra: 'min="50" max="200" step="5"', hulp: `${esc(String(t.logoGrootte))}% van de standaardgrootte.` })}</div>
    </section>`;
}

/* ---------------- mededelingen ---------------- */
function statusTag(it) {
  if (!it.aan) return '<span class="status-tag">Verborgen</span>';
  if (it.datum && it.datum < isoDate()) return '<span class="status-tag">Voorbij</span>';
  return '<span class="status-tag live">Zichtbaar</span>';
}

function mededelingenTab() {
  const items = draft.mededelingen.items.map((m, i) => {
    const p = `mededelingen.items.${i}`;
    const event = m.soort === 'event';
    return `<div class="lijst-item ${m.aan ? '' : 'uitgeschakeld'}">
      <div class="li-kop"><span class="titel">${esc(m.titel || 'Nieuwe mededeling')}</span>${statusTag(m)}${schakel(p + '.aan', 'Tonen')}
        ${knop('op', I.omhoog, 'Hoger', `data-path="mededelingen.items" data-i="${i}" ${i === 0 ? 'disabled' : ''}`)}${knop('neer', I.omlaag, 'Lager', `data-path="mededelingen.items" data-i="${i}" ${i === draft.mededelingen.items.length - 1 ? 'disabled' : ''}`)}${knop('weg', I.weg, 'Verwijderen', `data-path="mededelingen.items" data-i="${i}"`)}</div>
      <div class="li-velden">
        <div class="grid2">
          <div class="veldrij"><label for="f-${p}.soort">Soort</label><select id="f-${p}.soort" data-bind="${p}.soort"><option value="event" ${event ? 'selected' : ''}>Event (met datum)</option><option value="actie" ${!event ? 'selected' : ''}>Actie of korting</option></select></div>
          ${tekstVeld(p + '.titel', 'Titel', { placeholder: event ? 'Bv. Karaoke-avond' : 'Bv. 5% korting' })}
        </div>
        ${tekstVeld(p + '.titelEn', 'Titel in het Engels (optioneel)', { placeholder: event ? 'Bv. Karaoke night' : 'Bv. 5% off' })}
        ${tekstVak(p + '.tekst', 'Korte uitleg', { rows: 2 })}
        ${tekstVak(p + '.tekstEn', 'Korte uitleg in het Engels (optioneel)', { rows: 2 })}
        <div class="grid2">
          ${tekstVeld(p + '.datum', event ? 'Datum' : 'Loopt tot (optioneel)', { type: 'date', hulp: 'Na deze dag verdwijnt het vanzelf.' })}
          ${event ? tekstVeld(p + '.tijd', 'Uur', { type: 'time' }) : ''}
        </div>
        <div class="veldrij"><span class="lbl">Afbeelding of gif (optioneel)</span>
          <div class="logo-voorbeeld"><div class="vak">${m.afbeelding ? `<img src="${esc(m.afbeelding)}" alt="">` : '<span class="muted small">Geen</span>'}</div>
            <div class="knoppen">
              <label class="btn btn-licht btn-klein" style="cursor:pointer">Afbeelding kiezen<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-a="mededeling-afbeelding" data-i="${i}" class="sr"></label>
              ${m.afbeelding ? `<button class="btn btn-tekst btn-klein" data-a="mededeling-afbeelding-weg" data-i="${i}">Verwijderen</button>` : ''}
            </div></div>
          <span class="hulp">Komt als klein, aantikbaar beeld op de kaart in plaats van het woordje “Actie”.</span></div>
      </div></div>`;
  }).join('');
  return kop('Mededelingen', 'Events en acties van het café zelf, bv. een karaoke-avond of korting bij een Instagram-post.') +
    `<section class="blok"><div class="blok-kop"><div><h2>Mededelingen tonen</h2><p>Als sectie “Bij ${esc(draft.cafe.naam)}” onder de knoppen.</p></div>${schakel('mededelingen.aan', 'Mededelingen tonen')}</div></section>
    <div class="lijst">${items}</div>
    <button class="btn btn-licht btn-klein" style="margin-top:12px" data-a="lijst-plus" data-path="mededelingen.items">${I.plus} Mededeling toevoegen</button>`;
}

/* ---------------- in de buurt ---------------- */
function buurtTab() {
  const items = draft.buurt.items.map((b, i) => {
    const p = `buurt.items.${i}`;
    return `<div class="lijst-item ${b.aan ? '' : 'uitgeschakeld'}">
      <div class="li-kop"><span class="titel">${esc(b.titel || 'Nieuwe tip')}</span>${statusTag(b)}${schakel(p + '.aan', 'Tonen')}${knop('weg', I.weg, 'Verwijderen', `data-path="buurt.items" data-i="${i}"`)}</div>
      <div class="li-velden">
        <div class="grid2">${tekstVeld(p + '.titel', 'Wat?', { placeholder: 'Bv. DJ Bramadonna' })}${tekstVeld(p + '.plaats', 'Waar?', { placeholder: 'Bv. BarBroos' })}</div>
        <div class="grid2">${tekstVeld(p + '.datum', 'Datum', { type: 'date' })}${tekstVeld(p + '.tijd', 'Uur', { type: 'time' })}</div>
        ${tekstVak(p + '.tekst', 'Korte uitleg (optioneel)', { rows: 2 })}
        ${tekstVeld(p + '.link', 'Link voor meer info (optioneel)', { type: 'url', placeholder: 'https://…' })}
      </div></div>`;
  }).join('');
  return kop('In de buurt', 'Tips uit de buurt, bv. een DJ in een bevriende bar. Ze verschijnen enkel als het binnenkort is.') +
    `<section class="blok"><div class="blok-kop"><div><h2>“In de buurt” tonen</h2><p>Alleen tips van vandaag tot ${esc(draft.buurt.dagen)} dagen vooruit.</p></div>${schakel('buurt.aan', 'In de buurt tonen')}</div>
      <div style="max-width:260px;margin-top:14px">${tekstVeld('buurt.dagen', 'Hoeveel dagen vooruit tonen?', { type: 'number', num: true, extra: 'min="0" max="60"' })}</div></section>
    ${voorstellenBlok()}${bronnenBlok()}
    <h3 class="groep">Tips op het klantscherm</h3>
    <div class="lijst">${items}</div>
    <button class="btn btn-licht btn-klein" style="margin-top:12px" data-a="lijst-plus" data-path="buurt.items">${I.plus} Tip toevoegen</button>`;
}

/* ---------------- instellingen ---------------- */
function instellingenTab() {
  const online = store.mode === 'gedeeld';
  const k = V.koppelingen || {}; const s = V.status || {};
  const fouten = (s.fouten || []).slice(0, 6).map((f) => `<li><span class="muted">${ago(f.ts)} · ${esc(f.bron)}:</span> ${esc(f.tekst)}</li>`).join('');
  const modus = online
    ? '<strong>Online.</strong> Alle toestellen zien dezelfde gegevens.'
    : '<strong>Lokale demo.</strong> Alles wordt bewaard in deze browser. Een andere gsm ziet je wijzigingen niet. Zet de site via GitHub op Netlify om met echte clips te werken (zie LEESMIJ).';

  const statusBlok = !online ? `<section class="blok"><h2>Opslag</h2><p class="uitleg" style="margin:0">${modus}</p></section>` : `<section class="blok"><h2>Status</h2>
    <p class="uitleg" style="margin-bottom:8px">${modus}</p>
    <div class="knoppen-rij">${badge((k.pushToestellen || 0) > 0, (k.pushToestellen || 0) + ' toestel(len) met meldingen', 'Nog geen toestel met meldingen', 'fout')} ${badge(s.onderhoud && Date.now() - s.onderhoud < 3 * 3600e3, 'Server in orde', s.onderhoud ? 'Server: laatste controle ' + ago(s.onderhoud) : 'Server: eerste controle volgt binnen het uur')}</div>
    ${fouten ? `<h3 class="groep">Laatste problemen</h3><ul class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">${fouten}</ul>` : '<p class="small muted">Geen problemen gemeld.</p>'}
    <div class="knoppen-rij" style="margin-top:12px">${knopBezig('push-test', 'Testmelding naar alle toestellen')}</div>
    ${uitvoer('status')}
  </section>`;

  const sunBlok = !online ? '' : `<section class="blok"><h2>Beveiligde chips (NTAG 424 DNA)</h2>
    <p class="uitleg">Zonder beveiliging kan wie de link van een tafel kent, van thuis uit de ober roepen. Met deze chips maakt elke tik een unieke link; een kopie of een oude link werkt niet.</p>
    <div class="knoppen-rij" style="margin-bottom:12px">${badge(k.sun && k.sun.sleutel, 'Chipsleutel ✓', 'Geen chipsleutel')} ${badge(draft.beveiliging.chips, 'Verplicht voor klanten', 'Nog niet verplicht')}</div>
    <div class="grid2">${geheimVeld('sun.meta', 'SDM-leessleutel (32 hex-tekens)', k.sun && k.sun.sleutel)}${geheimVeld('sun.bestand', 'SDM-MAC-sleutel (leeg = dezelfde)', false)}</div>
    <div class="knoppen-rij" style="margin-top:10px">${knopBezig('geheim-sun', 'Sleutels bewaren', 'data-soort="sun"')}</div>
    <p class="small muted">Link op de chip: <code>${esc(location.origin)}/?t=1&amp;e={PICCData}&amp;c={CMAC}</code>. Koppel elke chip daarna bij Tafels &amp; clips.</p>
    <div class="schakel-rij"><div><strong>Klanten moeten de clip echt aantikken</strong><span>Zet pas aan als alle tafels een gekoppelde chip hebben. Personeel blijft altijd binnen.</span></div>${schakel('beveiliging.chips', 'Verplicht')}</div>
  </section>`;

  const uitBlok = !online ? '' : `<section class="blok"><h2>Events zoeken (UiTdatabank)</h2>
    <p class="uitleg">Optioneel. Sleutel van publiq (platform.publiq.be). Welke events je zoekt, stel je in bij In de buurt.</p>
    ${geheimVeld('uit.apiKey', 'API-sleutel', k.uit && k.uit.sleutel)}
    <div class="knoppen-rij" style="margin-top:10px">${knopBezig('geheim-uit', 'Sleutel bewaren', 'data-soort="uit"')}</div>
  </section>`;

  return kop('Instellingen') + tafelsBlok() + statusBlok + sunBlok + uitBlok + `
    ${!online ? `<section class="blok"><h2>Wachtwoord beheren</h2><p class="uitleg">Minstens 8 tekens, met letters en cijfers.</p>
      <form id="pin-form" class="knoppen-rij" autocomplete="off">
        <label class="sr" for="huidige-pin">Huidig wachtwoord</label><input type="password" id="huidige-pin" minlength="8" maxlength="72" style="max-width:200px" placeholder="Huidig wachtwoord">
        <label class="sr" for="nieuwe-pin">Nieuw wachtwoord</label><input type="password" id="nieuwe-pin" minlength="8" maxlength="72" style="max-width:200px" placeholder="Nieuw wachtwoord">
        <button class="btn btn-groen btn-klein" type="submit">Wijzigen</button>
      </form></section>` : ''}
    <section class="blok"><h2>Reservekopie</h2><p class="uitleg">Download je instellingen of zet ze over naar een ander café of toestel.</p>
      <div class="knoppen-rij">
        <button class="btn btn-licht btn-klein" data-a="export">Download instellingen</button>
        <label class="btn btn-licht btn-klein" style="cursor:pointer">Instellingen inladen<input type="file" accept="application/json,.json" data-a="import" class="sr"></label>
      </div></section>
    <section class="blok"><div class="blok-kop"><div><h2>Alles terugzetten</h2><p>Zet alle instellingen, meldingen en cijfers terug zoals bij de start. Logins blijven.</p></div><button class="btn btn-gevaar btn-klein" data-a="reset">Terugzetten</button></div></section>`;
}

/* ============================================================
   ROLLEN, KOPPELINGEN, PERSONEEL, BETALINGEN, CHIPS, PUSH
   ============================================================ */
function rol() { return store && store.mode === 'gedeeld' ? (V && V.ik ? V.ik.rol : 'personeel') : 'eigenaar'; }
function zichtbareTabs() { return TABS.filter((t) => (t.rol !== 'eigenaar' || rol() === 'eigenaar') && (!t.gedeeld || (store && store.mode === 'gedeeld'))); }
const lokaalBlok = () => `<section class="blok"><h2>Enkel online</h2><p class="uitleg" style="margin:0">Dit werkt pas als de site via GitHub op Netlify staat (alle toestellen samen). Zie LEESMIJ, stap 2.</p></section>`;
const badge = (ok, ja, nee, soort) => `<span class="badge ${ok ? 'ok' : (soort || 'let')}">${esc(ok ? ja : nee)}</span>`;
const uitvoer = (k) => (ui.uitvoer[k] ? `<pre class="uitvoer" style="margin-top:10px">${esc(ui.uitvoer[k])}</pre>` : '');
const geheimVeld = (pad, label, ingesteld, hulp = '', placeholder = '') => `<div class="veldrij"><label for="g-${pad}">${esc(label)}</label>
  <input type="password" id="g-${pad}" data-geheim="${pad}" autocomplete="off" placeholder="${esc(ingesteld ? 'Ingesteld ✓ (leeg laten = behouden)' : placeholder)}">${hulp ? `<span class="hulp">${hulp}</span>` : ''}</div>`;
const knopBezig = (a, label, extra = '', soort = 'btn-licht') => `<button class="btn ${soort} btn-klein" data-a="${a}" ${extra} ${ui.bezig === a ? 'disabled' : ''}>${ui.bezig === a ? 'Even geduld…' : label}</button>`;
const selectVeld = (pad, label, opties, hulp = '') => `<div class="veldrij"><label for="f-${pad}">${esc(label)}</label><select id="f-${pad}" data-bind="${pad}">${opties.map(([v, t]) => `<option value="${esc(v)}" ${String(getPath(draft, pad)) === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>${hulp ? `<span class="hulp">${hulp}</span>` : ''}</div>`;

/* ---------- dit toestel: pushmeldingen ---------- */
const pushAan = () => { try { return localStorage.getItem('guido-push') === 'aan'; } catch { return false; } };
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function toestelNaam() { if (/iPhone/.test(navigator.userAgent)) return 'iPhone'; if (isIos()) return 'iPad'; if (/Android/.test(navigator.userAgent)) return 'Android'; return 'Computer'; }

function toestelBlok() {
  if (store.mode !== 'gedeeld') return '';
  const mijn = V.push || [];
  let uitleg;
  if (isIos() && !isStandalone()) uitleg = 'Op iPhone of iPad: tik op <strong>Deel → Zet op beginscherm</strong>, open <strong>guido.</strong> vanaf je beginscherm en tik dan hier op “Zet aan”.';
  else if (pushAan()) uitleg = 'Dit toestel krijgt een melding bij elke oproep, ook als de app dicht is. Zet “In dienst” uit als je niet werkt.';
  else uitleg = 'Krijg een melding bij elke oproep, ook als deze app dicht is of je in de kassa werkt.';
  const lijst = mijn.map((p) => `<div class="schakel-rij"><div><strong>${esc(p.naam)}</strong><span>${p.actief ? 'In dienst: krijgt meldingen' : 'Niet in dienst'}</span></div>
    <label class="schakel"><input type="checkbox" data-push-id="${esc(p.id)}" ${p.actief ? 'checked' : ''}><span class="baan"></span><span class="sr">In dienst</span></label></div>`).join('');
  return `<section class="blok" style="padding:16px">
    <div class="blok-kop"><div><h2 style="font-size:16px">Meldingen op dit toestel</h2><p>${uitleg}</p></div>
    ${isIos() && !isStandalone() ? '' : `<button class="btn ${pushAan() ? 'btn-licht' : 'btn-geel'} btn-klein" data-a="push-aan">${pushAan() ? 'Opnieuw instellen' : 'Zet aan'}</button>`}</div>
    ${lijst ? `<div style="margin-top:12px">${lijst}</div>` : ''}
  </section>`;
}

function b64NaarBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function zetPushAan() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error(isIos() ? 'Zet guido. eerst op je beginscherm (Deel → Zet op beginscherm) en open de app van daar.' : 'Deze browser ondersteunt geen pushmeldingen.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Meldingen zijn geweigerd. Zet ze aan in de instellingen van je toestel (Meldingen → guido.).');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { publicKey } = await api('/api/push/sleutel');
  let sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64NaarBytes(publicKey) });
  await api('/api/push', { method: 'POST', body: { sub: sub.toJSON(), naam: toestelNaam() } });
  try { localStorage.setItem('guido-push', 'aan'); } catch { /* */ }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data === 'ververs' && store) store.refresh(true).catch(() => {}); });

/* ---------- tafels: beveiligde chips ---------- */
function chipBlok(t) {
  if (store.mode !== 'gedeeld' || rol() !== 'eigenaar') return '';
  const chips = (V.chips || []).filter((c) => c.tafel === t.id);
  const k = V.live.koppelen;
  const bezig = k && k.tot > Date.now() && k.tafel === t.id;
  const lijst = chips.map((c) => `<div class="a-rek-regel"><span class="nm"><code>${esc(c.uid)}</code> <span class="muted small">laatst ${c.laatst ? ago(c.laatst) : 'nooit'} · ${c.ctr} tikken</span></span><button class="ikoon-knop weg" data-a="chip-weg" data-v="${esc(c.uid)}" aria-label="Chip loskoppelen" title="Chip loskoppelen">${I.weg}</button></div>`).join('');
  return `<div style="margin-top:16px;border-top:1px solid var(--soft);padding-top:14px">
    <strong>Beveiligde chips (NTAG 424 DNA)</strong>
    <p class="muted small" style="margin:4px 0 10px">${chips.length ? 'Gekoppeld aan deze tafel:' : 'Nog geen beveiligde chip gekoppeld.'}</p>
    ${lijst}
    ${bezig
      ? `<div class="status" style="margin-top:10px"><div class="status-rij"><span class="stip"></span><div class="status-tekst"><strong>Tik nu de chip aan met eender welke gsm</strong><span>Wacht op een tik… (nog ${Math.max(0, Math.round((k.tot - Date.now()) / 1000))} s)</span></div><button class="btn btn-tekst btn-klein" data-a="koppel-stop">Stop</button></div></div>`
      : `<button class="btn btn-licht btn-klein" style="margin-top:10px" data-a="koppel-start">${I.nfc} Koppel een chip aan deze tafel</button>`}
  </div>`;
}

/* ---------- in de buurt: voorstellen en bronnen ---------- */
function voorstellenBlok() {
  const vs = V.live.voorstellen || [];
  if (!vs.length) return '';
  const lijst = vs.map((v) => `<div class="lijst-item"><div class="li-kop"><span class="titel">${esc(v.titel)}</span><span class="badge">${esc(v.bron || 'bron')}</span></div>
    <div class="small muted">${esc([dateLabel(v.datum, v.tijd), v.plaats].filter(Boolean).join(' · '))}</div>
    ${v.tekst ? `<div class="small">${esc(v.tekst)}</div>` : ''}
    <div class="knoppen-rij"><button class="btn btn-geel btn-klein" data-a="voorstel" data-id="${esc(v.id)}" data-v="ok">Tonen aan klanten</button><button class="btn btn-licht btn-klein" data-a="voorstel" data-id="${esc(v.id)}" data-v="nee">Niet tonen</button>${v.link ? `<a class="btn btn-tekst btn-klein" href="${esc(v.link)}" target="_blank" rel="noopener">Bekijk</a>` : ''}</div></div>`).join('');
  return `<section class="blok"><h2>Voorstellen (${vs.length})</h2><p class="uitleg">Automatisch gevonden. Kies wat klanten te zien krijgen.</p><div class="lijst">${lijst}</div></section>`;
}

function bronnenBlok() {
  const st = V.status || {};
  const ics = draft.buurt.bronnen.ics.map((b, i) => `<div class="lijst-item"><div class="li-kop"><span class="titel">${esc(b.naam || 'Nieuwe agenda')}</span>${knop('weg', I.weg, 'Verwijderen', `data-path="buurt.bronnen.ics" data-i="${i}"`)}</div>
    <div class="li-velden"><div class="grid2">${tekstVeld(`buurt.bronnen.ics.${i}.naam`, 'Naam', { placeholder: 'Bv. BarBroos' })}${tekstVeld(`buurt.bronnen.ics.${i}.url`, 'Agenda-link (.ics)', { type: 'url', placeholder: 'https://calendar.google.com/…/basic.ics' })}</div>
    <div class="schakel-rij" style="border:0;padding:0"><div><strong>Vertrouwd</strong><span>Events van deze agenda meteen tonen, zonder goedkeuring.</span></div>${schakel(`buurt.bronnen.ics.${i}.auto`, 'Vertrouwd')}</div></div></div>`).join('');
  return `<section class="blok"><h2>Automatisch zoeken</h2>
    <p class="uitleg">Elke ochtend zoekt het systeem events voor de komende ${esc(draft.buurt.dagen)} dagen. Nieuwe vondsten komen bij Voorstellen.</p>
    <div class="schakel-rij"><div><strong>UiTdatabank</strong><span>De officiële agenda van Vlaanderen (UiT in Vlaanderen). Sleutel invullen bij Instellingen.</span></div>${schakel('buurt.bronnen.uit.aan', 'UiTdatabank')}</div>
    ${draft.buurt.bronnen.uit.aan ? `<div class="grid2" style="margin:6px 0 12px">${tekstVeld('buurt.bronnen.uit.postcode', 'Postcode', { placeholder: '9000' })}${tekstVeld('buurt.bronnen.uit.soorten', 'Enkel deze soorten (komma’s)', { hulp: 'Leeg = alles.' })}</div>` : ''}
    <div class="schakel-rij"><div><strong>Alles meteen tonen</strong><span>Zonder goedkeuring. Afgeraden voor de UiTdatabank: die bevat ook kindernamiddagen en tentoonstellingen.</span></div>${schakel('buurt.bronnen.auto', 'Alles meteen tonen')}</div>
    <h3 class="groep" style="margin-top:14px">Agenda’s van bevriende zaken</h3>
    <p class="muted small" style="margin:-4px 0 10px">Vraag bv. aan BarBroos de “geheime adres in iCal-indeling” van hun Google Agenda.</p>
    <div class="lijst">${ics}</div>
    <div class="knoppen-rij" style="margin-top:10px"><button class="btn btn-licht btn-klein" data-a="lijst-plus" data-path="buurt.bronnen.ics">${I.plus} Agenda toevoegen</button>
      ${store.mode === 'gedeeld' ? knopBezig('events-nu', 'Nu zoeken', '', 'btn-groen') : ''}</div>
    ${store.mode === 'gedeeld' ? `<p class="muted small" style="margin:10px 0 0">Laatst gezocht: ${st.events ? ago(st.events) : 'nog nooit'}${st.eventsAantal != null ? ` · ${st.eventsAantal} gevonden` : ''}${st.eventsFout ? ` · <span style="color:var(--warn)">${esc(st.eventsFout)}</span>` : ''}</p>` : ''}
    ${uitvoer('events-nu')}
  </section>`;
}

/* ---------- personeel ---------- */
function personeelTab() {
  const lijst = (V.gebruikers || []).map((g) => `<tr>
    <td><strong>${esc(g.naam)}</strong>${V.ik && g.id === V.ik.id ? ' <span class="badge ok">jij</span>' : ''}</td>
    <td>${g.rol === 'eigenaar' ? 'Eigenaar' : 'Personeel'}</td>
    <td>${g.aan ? '<span class="badge ok">Actief</span>' : '<span class="badge">Uit</span>'}</td>
    <td class="small muted">${g.laatst ? ago(g.laatst) : '—'}</td>
    <td><div class="knoppen-rij">
      <button class="btn btn-licht btn-klein" data-a="g-pin" data-id="${g.id}">Nieuw wachtwoord</button>
      <button class="btn btn-licht btn-klein" data-a="g-rol" data-id="${g.id}" data-v="${g.rol === 'eigenaar' ? 'personeel' : 'eigenaar'}">${g.rol === 'eigenaar' ? 'Maak personeel' : 'Maak eigenaar'}</button>
      <button class="btn btn-licht btn-klein" data-a="g-aan" data-id="${g.id}" data-v="${g.aan ? '0' : '1'}">${g.aan ? 'Uitzetten' : 'Aanzetten'}</button>
      <button class="ikoon-knop weg" data-a="g-weg" data-id="${g.id}" aria-label="Verwijderen" title="Verwijderen">${I.weg}</button>
    </div></td></tr>`).join('');
  return kop('Personeel', 'Iedereen meldt zich aan met een eigen naam en pincode. Personeel ziet enkel Meldingen; de eigenaar ziet alles. Uitzetten of een nieuwe pincode meldt die persoon meteen overal af.') + `
    <section class="blok"><div class="tabel-wrap"><table class="tabel"><thead><tr><th>Naam</th><th>Rol</th><th>Status</th><th>Laatst aangemeld</th><th></th></tr></thead><tbody>${lijst}</tbody></table></div></section>
    <section class="blok"><h2>Iemand toevoegen</h2>
      <form id="nieuw-personeel" class="grid3" autocomplete="off" style="align-items:end">
        <div class="veldrij"><label for="np-naam">Naam</label><input type="text" id="np-naam" maxlength="40" required></div>
        <div class="veldrij"><label for="np-pin">Wachtwoord (min. 8 tekens, letters en cijfers)</label><input type="password" id="np-pin" minlength="8" maxlength="72" required></div>
        <div class="veldrij"><label for="np-rol">Rol</label><select id="np-rol"><option value="personeel">Personeel</option><option value="eigenaar">Eigenaar</option></select></div>
        <div class="veldrij"><label for="np-huidig">Jouw huidige wachtwoord ter bevestiging — of de opstartcode als je het vergeten bent</label><input type="password" id="np-huidig" required></div>
        <div><button class="btn btn-groen btn-klein" type="submit">Toevoegen</button></div>
      </form>
      <p class="small muted" style="margin:10px 0 0">Geef het wachtwoord mondeling door. Op een iPhone: open <code>${esc(location.origin)}/beheer.html</code>, meld je aan, zet de app op het beginscherm en zet meldingen aan.</p>
    </section>`;
}

/* ---------- acties voor de nieuwe onderdelen ---------- */
async function opdracht(a, type, data, sleutelUit) {
  ui.bezig = a; renderMain();
  try {
    const r = await store.beheer(type, data);
    return r;
  } catch (err) {
    if (sleutelUit) ui.uitvoer[sleutelUit] = 'Mislukt: ' + err.message;
    else toast(err.message, true);
    if (err.code === 'pin') { ingelogd = false; renderAll(); }
    return undefined;
  } finally { ui.bezig = ''; if (ingelogd) renderMain(); }
}

async function extraKlik(a, el) {
  switch (a) {
    case 'push-aan':
      try { await zetPushAan(); toast('Meldingen staan aan op dit toestel.'); await store.refresh(true); }
      catch (err) { toast(err.message, true); }
      renderMain(); return true;
    case 'koppel-start': if (dirty()) { clearTimeout(saveTimer); await bewaar(); } await doe({ type: 'koppel-start', tafel: ui.tafel }); return true;
    case 'koppel-stop': await doe({ type: 'koppel-stop' }); return true;
    case 'chip-weg': if (confirm('Deze chip loskoppelen? Hij werkt dan niet meer tot je hem opnieuw koppelt.')) await opdracht(a, 'chip-weg', { uid: el.dataset.v }); return true;
    case 'voorstel': await doe({ type: 'voorstel', id: el.dataset.id, keuze: el.dataset.v }); return true;
    case 'events-nu': {
      if (dirty()) { clearTimeout(saveTimer); await bewaar(); }
      const r = await opdracht(a, 'events-nu', {}, 'events-nu');
      if (r) ui.uitvoer['events-nu'] = `${r.gevonden} events gevonden, ${r.nieuw} nieuw.` + (r.fouten.length ? '\n' + r.fouten.join('\n') : '');
      renderMain(); return true;
    }
    case 'geheim-sun': case 'geheim-uit': {
      const soort = el.dataset.soort; const waarden = {};
      document.querySelectorAll(`[data-geheim^="${soort}."]`).forEach((i) => { if (i.value.trim()) waarden[i.dataset.geheim.split('.')[1]] = i.value.trim(); });
      if (!Object.keys(waarden).length) { toast('Vul eerst iets in.', true); return true; }
      const r = await opdracht(a, 'geheim', { soort, waarden });
      if (r) toast('Bewaard.');
      return true;
    }
    case 'onderhoud-nu': { const r = await opdracht(a, 'onderhoud-nu', {}, 'status'); if (r) ui.uitvoer.status = r.length ? r.join('\n') : 'Klaar, niets te doen.'; renderMain(); return true; }
    case 'push-test': { const r = await opdracht(a, 'push-test', {}, 'status'); if (r) ui.uitvoer.status = `Testmelding verstuurd naar ${r.verstuurd} toestel(len).`; renderMain(); return true; }
    case 'g-pin': {
      const pin = prompt('Nieuw wachtwoord (minstens 8 tekens, met letters en cijfers):');
      if (!pin) return true;
      const huidig = prompt('Bevestig met je eigen huidige wachtwoord (of de opstartcode als je het vergeten bent):');
      if (!huidig) return true;
      const r = await opdracht(a, 'gebruiker-wijzig', { id: el.dataset.id, pin: pin.trim(), huidig: huidig.trim() });
      if (r) toast('Wachtwoord gewijzigd. Die persoon moet zich opnieuw aanmelden.');
      return true;
    }
    case 'g-rol': { const r = await opdracht(a, 'gebruiker-wijzig', { id: el.dataset.id, rol: el.dataset.v }); if (r) toast('Rol gewijzigd.'); return true; }
    case 'g-aan': { const r = await opdracht(a, 'gebruiker-wijzig', { id: el.dataset.id, aan: el.dataset.v === '1' }); if (r) toast('Bijgewerkt.'); return true; }
    case 'g-weg': if (confirm('Deze persoon verwijderen?')) { const r = await opdracht(a, 'gebruiker-weg', { id: el.dataset.id }); if (r) toast('Verwijderd.'); } return true;
    default: return false;
  }
}

/* ============================================================
   RENDER
   ============================================================ */
function mainHtml() {
  switch (ui.tab) {
    case 'klantscherm': return klantschermTab();
    case 'thema': return themaTab();
    case 'mededelingen': return mededelingenTab();
    case 'buurt': return buurtTab();
    case 'instellingen': return instellingenTab();
    case 'cijfers': return cijfersTab();
    case 'personeel': return personeelTab();
    default: return meldingenTab();
  }
}

let breedteVoorbeeld = window.innerWidth >= 1280;
function renderAll() {
  if (V && !zichtbareTabs().some((t) => t.id === ui.tab)) ui.tab = 'meldingen';
  if (!ingelogd || !V) { app.innerHTML = loginHtml(); const p = document.getElementById('pin'); if (p) p.focus(); return; }
  const nav = navHtml();
  const metVoorbeeld = window.innerWidth >= 1280;
  breedteVoorbeeld = metVoorbeeld;
  app.innerHTML = `${nav.mobiel}<div class="a-layout ${metVoorbeeld ? 'met-voorbeeld' : ''}">${nav.zij}<main class="a-main" id="main">${mainHtml()}</main>${metVoorbeeld ? voorbeeldHtml() : ''}</div>`;
  document.title = (openMeldingen().length ? '(' + openMeldingen().length + ') ' : '') + (draft.cafe.naam || 'guido.') + ' team';
}

function renderNav() {
  const nav = navHtml();
  const z = app.querySelector('.a-nav'); if (z) z.outerHTML = nav.zij;
  const m = app.querySelector('.mobiel-nav'); if (m) { const x = m.scrollLeft; m.outerHTML = nav.mobiel; app.querySelector('.mobiel-nav').scrollLeft = x; }
  document.title = (openMeldingen().length ? '(' + openMeldingen().length + ') ' : '') + (draft.cafe.naam || 'guido.') + ' team';
}

function renderMain() {
  const main = document.getElementById('main');
  if (!main) return renderAll();
  const act = document.activeElement;
  const sleutel = act && main.contains(act) ? (act.dataset.bind || act.dataset.tag || act.id) : null;
  const sel = act && 'selectionStart' in act ? [act.selectionStart, act.selectionEnd] : null;
  const y = window.scrollY;
  main.innerHTML = mainHtml();
  if (sleutel) {
    const el = main.querySelector(`[data-bind="${CSS.escape(sleutel)}"]`) || main.querySelector(`[data-tag="${CSS.escape(sleutel)}"]`) || document.getElementById(sleutel);
    if (el) { el.focus({ preventScroll: true }); try { if (sel && el.setSelectionRange) el.setSelectionRange(sel[0], sel[1]); } catch { /* */ } }
  }
  window.scrollTo(0, y);
}

function toonBewaard(tekst) {
  const b = document.getElementById('bewaard');
  if (!b) return;
  b.textContent = tekst;
  b.classList.add('zichtbaar');
  clearTimeout(b._t);
  if (tekst.startsWith('Bewaard')) b._t = setTimeout(() => b.classList.remove('zichtbaar'), 1800);
}

/* ---------------- bewaren ---------------- */
function wijzig() {
  editVersie++;
  toonBewaard('Bewaren…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(bewaar, 450);
}
async function bewaar() {
  const versie = editVersie;
  try {
    await store.dispatch({ type: 'config', config: clone(draft) });
    bewaardVersie = versie;
    if (editVersie === bewaardVersie) toonBewaard('Bewaard ✓');
  } catch (err) {
    toonBewaard('');
    toast(err.message, true);
    if (err.code === 'pin') { ingelogd = false; renderAll(); }
  }
}
const dirty = () => editVersie !== bewaardVersie;

/* ---------------- updates uit de opslag ---------------- */
function onUpdate(v) {
  const eerste = !V;
  V = v;
  // nieuwe meldingen detecteren
  let nieuw = false;
  for (const m of v.live.meldingen) {
    if (!bekend.has(m.id)) {
      bekend.add(m.id);
      if (!eerste && m.status === 'nieuw') { nieuw = true; flits.add(m.id); setTimeout(() => flits.delete(m.id), 1500); }
    }
  }
  if (nieuw) ping();

  const act = document.activeElement;
  const typt = !!(act && (act.tagName === 'INPUT' || act.tagName === 'TEXTAREA') && act.type !== 'checkbox' && act.closest && act.closest('#main'));
  if (!draft || (!dirty() && !sameConfig(draft, v.config))) {
    const wasLeeg = !draft;
    draft = clone(v.config);
    if (!wasLeeg && ingelogd && !typt) { renderAll(); return; }
  } else if (!dirty()) {
    draft.rev = v.config.rev;
  }
  if (!ingelogd) return;
  if (eerste || !document.getElementById('main')) { renderAll(); return; }
  renderNav();
  if (['meldingen', 'cijfers', 'personeel', 'instellingen'].includes(ui.tab) && !typt && !ui.bezig) renderMain();
}

/* ============================================================
   ACTIES
   ============================================================ */
async function doe(action) {
  try { return await store.dispatch(action); }
  catch (err) {
    toast(err.message, true);
    if (err.code === 'pin') { ingelogd = false; renderAll(); }
    return null;
  }
}

function verplaats(path, i, d) {
  const lijst = getPath(draft, path);
  const j = i + d;
  if (j < 0 || j >= lijst.length) return;
  [lijst[i], lijst[j]] = [lijst[j], lijst[i]];
}

function voegTagToe(path) {
  const input = document.querySelector(`[data-tag="${CSS.escape(path)}"]`);
  if (!input) return;
  const lijst = getPath(draft, path);
  let v = input.value.trim();
  if (!v) { input.focus(); return; }
  if (input.type === 'number') {
    v = Math.max(0, Math.min(50, Math.round(Number(v))));
    if (Number.isNaN(v)) return;
    if (!lijst.includes(v)) { lijst.push(v); lijst.sort((a, b) => a - b); }
  } else if (!lijst.includes(v)) lijst.push(v);
  input.value = '';
  wijzig(); renderMain();
  const n = document.querySelector(`[data-tag="${CSS.escape(path)}"]`); if (n) n.focus();
}

function nieuwItem(path) {
  if (path === 'verzoekjes.items') return { id: uid(), emoji: '✨', label: '', tekst: false, hint: '', aan: true };
  if (path === 'buurt.bronnen.ics') return { naam: '', url: '', auto: false };
  if (path === 'mededelingen.items') return { id: uid(), soort: 'event', titel: '', tekst: '', datum: '', tijd: '', aan: true };
  return { id: uid(), titel: '', plaats: '', tekst: '', datum: isoDate(), tijd: '', link: '', aan: true };
}

function leesLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('Kies een afbeelding.')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, 480 / img.width, 160 / img.height);
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * sc)); cv.height = Math.max(1, Math.round(img.height * sc));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      let data = cv.toDataURL('image/png');
      if (data.length > 300000) data = cv.toDataURL('image/webp', 0.9);
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Dit bestand kan niet gelezen worden.')); };
    img.src = url;
  });
}

function leesMededelingAfbeelding(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { reject(new Error('Kies een png-, jpg-, webp- of gif-bestand.')); return; }
    if (file.type === 'image/gif') {
      // GIF niet via canvas: dat zou de animatie plat maken. Enkel een grootte-check.
      if (file.size > 1_500_000) { reject(new Error('Deze gif is te groot (max. 1,5 MB).')); return; }
      const lezer = new FileReader();
      lezer.onload = () => resolve(lezer.result);
      lezer.onerror = () => reject(new Error('Dit bestand kan niet gelezen worden.'));
      lezer.readAsDataURL(file);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, 240 / img.width, 240 / img.height);
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * sc)); cv.height = Math.max(1, Math.round(img.height * sc));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      let data = cv.toDataURL('image/png');
      if (data.length > 300000) data = cv.toDataURL('image/webp', 0.9);
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Dit bestand kan niet gelezen worden.')); };
    img.src = url;
  });
}

async function onClick(e) {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const a = el.dataset.a;
  const i = Number(el.dataset.i);
  const path = el.dataset.path;
  if (await extraKlik(a, el)) return;
  switch (a) {
    case 'tab':
      ui.tab = el.dataset.v; history.replaceState(null, '', '#' + ui.tab);
      renderAll(); window.scrollTo(0, 0); break;
    case 'uitloggen': store.logout(); ingelogd = false; V = null; renderAll(); break;
    case 'geluid':
      ui.geluid = !ui.geluid;
      try { localStorage.setItem('guido-geluid', ui.geluid ? 'aan' : 'uit'); } catch { /* */ }
      if (ui.geluid) { if (!audio && 'AudioContext' in window) audio = new AudioContext(); ping(); }
      renderMain(); break;

    /* meldingen */
    case 'status': await doe({ type: 'melding', id: el.dataset.id, status: el.dataset.v }); break;
    case 'opruimen': await doe({ type: 'opruimen' }); break;

    /* tafels */
    case 'kies-tafel': ui.tafel = el.dataset.v; renderMain(); break;
    case 'tafel-plus': {
      const nrs = draft.tafels.map((t) => Number(t.id)).filter((n) => !Number.isNaN(n));
      const id = String((nrs.length ? Math.max(...nrs) : 0) + 1);
      draft.tafels.push({ id, naam: 'Tafel ' + id });
      ui.tafel = id; wijzig(); renderMain(); break;
    }
    case 'tafel-weg': {
      const t = draft.tafels.find((x) => x.id === ui.tafel);
      if (!t || !confirm(`“${t.naam}” verwijderen? De clip met code ${t.id} werkt dan niet meer.`)) break;
      draft.tafels = draft.tafels.filter((x) => x.id !== ui.tafel);
      ui.tafel = draft.tafels[0] ? draft.tafels[0].id : '';
      wijzig(); renderMain(); break;
    }
    case 'kopieer':
      try { await navigator.clipboard.writeText(el.dataset.v); toast('Link gekopieerd.'); }
      catch { const inp = document.getElementById('nfc-url'); inp.select(); toast('Selecteer en kopieer de link.'); }
      break;
    case 'schrijf-nfc':
      try {
        toast('Hou de chip tegen de achterkant van je gsm…');
        const ndef = new window.NDEFReader();
        await ndef.write({ records: [{ recordType: 'url', data: el.dataset.v }] });
        toast('Chip geschreven!');
      } catch (err) { toast('Schrijven mislukt: ' + (err.message || err), true); }
      break;

    /* lijsten */
    case 'tag-plus': voegTagToe(path); break;
    case 'tag-weg': getPath(draft, path).splice(i, 1); wijzig(); renderMain(); break;
    case 'lijst-plus':
      getPath(draft, path).push(nieuwItem(path)); wijzig(); renderMain();
      setTimeout(() => { const l = document.querySelectorAll('#main .lijst-item'); const last = l[l.length - 1]; if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); const f = last.querySelector('input[type=text]:not(.emoji-veld)'); if (f) f.focus({ preventScroll: true }); } }, 30);
      break;
    case 'op': verplaats(path, i, -1); wijzig(); renderMain(); break;
    case 'neer': verplaats(path, i, 1); wijzig(); renderMain(); break;
    case 'weg': {
      const it = getPath(draft, path)[i];
      const naam = it && (it.titel || it.label || it.naam);
      if (naam && !confirm(`“${naam}” verwijderen?`)) break;
      getPath(draft, path).splice(i, 1); wijzig(); renderMain(); break;
    }
    case 'logo-weg': draft.cafe.logo = ''; wijzig(); renderMain(); break;
    case 'thema-reset':
      draft.theme = { kleurPrimair: '#174B00', kleurAccent: '#FFDE5A', lettertype: 'inter', logoGrootte: 100, banner: 'normaal' };
      wijzig(); renderMain(); break;
    case 'mededeling-afbeelding-weg': draft.mededelingen.items[i].afbeelding = ''; wijzig(); renderMain(); break;
    case 'csv': {
      const stats = V.live.stats || {};
      const regels = ['dag;ober;afrekenen;verzoekjes;geannuleerd;gemiddelde reactietijd (s)'].concat(Object.keys(stats).sort().map((k) => { const x = stats[k]; return [k, x.ober || 0, x.afrekenen || 0, x.verzoek || 0, x.geannuleerd || 0, x.reactieN ? Math.round(x.reactieS / x.reactieN) : ''].join(';'); }));
      const aEl = document.createElement('a');
      aEl.href = URL.createObjectURL(new Blob(['\ufeff' + regels.join('\r\n')], { type: 'text/csv' })); aEl.download = 'tafelclip-cijfers.csv';
      document.body.appendChild(aEl); aEl.click(); aEl.remove();
      setTimeout(() => URL.revokeObjectURL(aEl.href), 2000);
      break;
    }

    /* instellingen */
    case 'export': {
      const { adminPin, ...rest } = draft;
      const blob = new Blob([JSON.stringify(rest, null, 2)], { type: 'application/json' });
      const aEl = document.createElement('a');
      aEl.href = URL.createObjectURL(blob); aEl.download = 'tafelclip-instellingen.json';
      document.body.appendChild(aEl); aEl.click(); aEl.remove();
      setTimeout(() => URL.revokeObjectURL(aEl.href), 2000);
      break;
    }
    case 'reset':
      if (!confirm('Alles terugzetten? Je eigen instellingen, meldingen en cijfers gaan verloren.')) break;
      clearTimeout(saveTimer); bewaardVersie = editVersie;
      draft = null;
      await doe({ type: 'reset' });
      if (!draft && V) draft = clone(V.config);
      renderAll();
      toast('Alles is teruggezet.');
      break;
  }
}

async function onChange(e) {
  const el = e.target;
  if (el.dataset.pushId) {
    try { await api('/api/push', { method: 'POST', body: { id: el.dataset.pushId, actief: el.checked } }); await store.refresh(true); toast(el.checked ? 'In dienst: je krijgt meldingen.' : 'Niet in dienst: geen meldingen.'); }
    catch (err) { toast(err.message, true); }
    return;
  }
  if (el.id === 'v-tafel') {
    ui.voorbeeld = el.value;
    const f = document.getElementById('voorbeeld'); if (f) f.src = './?t=' + encodeURIComponent(el.value) + '&voorbeeld=1';
    return;
  }
  if (el.dataset.a === 'logo' && el.files && el.files[0]) {
    try { draft.cafe.logo = await leesLogo(el.files[0]); wijzig(); renderMain(); }
    catch (err) { toast(err.message, true); }
    return;
  }
  if (el.dataset.a === 'mededeling-afbeelding' && el.files && el.files[0]) {
    const i = Number(el.dataset.i);
    try { draft.mededelingen.items[i].afbeelding = await leesMededelingAfbeelding(el.files[0]); wijzig(); renderMain(); }
    catch (err) { toast(err.message, true); }
    return;
  }
  if (el.dataset.a === 'import' && el.files && el.files[0]) {
    try {
      const data = JSON.parse(await el.files[0].text());
      if (!data || !data.cafe || !Array.isArray(data.tafels)) throw new Error('Dit is geen instellingenbestand van de tafelclip.');
      const basis = clone(draft);
      for (const k of Object.keys(basis)) if (k !== 'adminPin' && k !== 'rev' && data[k] !== undefined) basis[k] = data[k];
      draft = basis; wijzig(); renderAll(); toast('Instellingen ingeladen.');
    } catch (err) { toast(err.message || 'Kon het bestand niet lezen.', true); }
    el.value = '';
    return;
  }
  if (el.dataset.bind) {
    if (el.type === 'checkbox' || el.tagName === 'SELECT') { bind(el); renderMain(); return; }
    // tekstvelden: enkel de titel bovenaan het item bijwerken (niets vervangen, anders gaat een klik verloren)
    const item = el.closest('.lijst-item');
    const titel = item && item.querySelector('.li-kop .titel');
    if (titel && /\.(titel|label|emoji)$/.test(el.dataset.bind)) {
      const m = el.dataset.bind.match(/^(.*\.items\.\d+)\./);
      const it = m && getPath(draft, m[1]);
      if (it) titel.textContent = it.label !== undefined ? ((it.emoji || '') + ' ' + (it.label || 'Nieuw verzoekje')) : (it.titel || 'Nieuwe mededeling');
    }
  }
}

function bind(el) {
  const path = el.dataset.bind;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.dataset.num) { v = el.value === '' ? 0 : Number(el.value); if (Number.isNaN(v)) return; }
  else v = el.value;
  setPath(draft, path, v);
  wijzig();
}

function onInput(e) {
  const el = e.target;
  if (el.dataset.bind && el.type !== 'checkbox' && el.tagName !== 'SELECT') bind(el);
}

function onKeydown(e) {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.tag) { e.preventDefault(); voegTagToe(e.target.dataset.tag); }
}

async function onSubmit(e) {
  e.preventDefault();
  const waarde = (id) => (document.getElementById(id) || {}).value || '';
  if (e.target.id === 'login') {
    try {
      await store.login(waarde('naam').trim(), waarde('pin').trim());
      ui.loginFout = ''; ingelogd = true; renderAll();
    } catch (err) { ui.loginFout = err.message; renderAll(); }
  }
  if (e.target.id === 'setup') {
    try {
      await store.setup(waarde('s-code').trim(), waarde('s-naam').trim(), waarde('s-pin').trim());
      ui.setup = null; ui.loginFout = ''; ingelogd = true; ui.tab = 'meldingen'; renderAll();
      toast('Welkom! Zet nu de meldingen aan op dit toestel.');
    } catch (err) { ui.loginFout = err.message; renderAll(); }
  }
  if (e.target.id === 'nieuw-personeel') {
    const r = await opdracht('np', 'gebruiker-plus', { naam: waarde('np-naam').trim(), pin: waarde('np-pin').trim(), rol: waarde('np-rol'), huidig: waarde('np-huidig').trim() });
    if (r) { toast('Toegevoegd.'); e.target.reset(); }
  }
  if (e.target.id === 'pin-form') {
    const inp = document.getElementById('nieuwe-pin');
    const huidigInp = document.getElementById('huidige-pin');
    const nieuw = inp.value.trim();
    const huidig = huidigInp.value.trim();
    try {
      await store.dispatch({ type: 'pin', nieuw, huidig });
      savedPin.set(nieuw);
      inp.value = ''; huidigInp.value = '';
      toast('Wachtwoord gewijzigd.');
    } catch (err) { toast(err.message, true); }
  }
}

document.addEventListener('click', onClick);
document.addEventListener('change', onChange);
document.addEventListener('input', onInput);
document.addEventListener('keydown', onKeydown);
document.addEventListener('submit', onSubmit);
window.addEventListener('resize', () => { if (ingelogd && V && (window.innerWidth >= 1280) !== breedteVoorbeeld) renderAll(); });
window.addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
setInterval(() => {
  if (!ingelogd || !V || document.visibilityState !== 'visible') return;
  // Wacht een tafel al meer dan 2 minuten? Dan belt het opnieuw, tot iemand reageert.
  if (V.live.meldingen.some((m) => m.status === 'nieuw' && ['ober', 'afrekenen'].includes(m.soort) && Date.now() - m.ts > 2 * 60e3)) ping();
  const act = document.activeElement;
  if (ui.tab === 'meldingen' && !(act && act.closest && act.closest('#main') && /INPUT|TEXTAREA|SELECT/.test(act.tagName))) renderMain();
}, 30000);

/* ---------------- opstarten ---------------- */
(async function start() {
  try {
    // Met pushmeldingen aan ververst de app meteen bij elke melding; anders kijken we zelf om de 4 tellen.
    store = await createStore({ admin: true, tempo: () => (pushAan() ? 12000 : 4000) });
    store.subscribe((v) => {
      if (!store.isAangemeld()) return;       // afgemeld: niets tonen
      if (!ingelogd) { ingelogd = true; V = null; }
      onUpdate(v);
    });
    if (store.mode === 'gedeeld' && !store.isAangemeld()) {
      try { ui.setup = await store.setupNodig(); } catch { ui.setup = null; }
    }
    await store.start();
    if (!ingelogd) renderAll();
    const m = location.hash.match(/melding=([^&]+)/);
    if (m) { setTimeout(() => toast(decodeURIComponent(m[1])), 300); history.replaceState(null, '', '#' + ui.tab); }
  } catch (err) {
    app.innerHTML = `<div class="a-login"><div style="background:var(--ground);border-radius:20px;padding:24px;max-width:360px"><h1 class="hand" style="color:var(--green);margin:0">Geen verbinding</h1><p>${esc(err.message)}</p><a class="btn btn-groen" href="beheer.html">Opnieuw</a></div></div>`;
  }
})();
