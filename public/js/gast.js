/* ============================================================
   Klantscherm — opent wanneer een klant de NFC-clip aantikt.
   Adres op de chip: https://<jouw-site>/?t=<tafelcode>
   ============================================================ */
import { createStore, api, sessie, personeel, isGedeeld } from './store.js';
import { dateLabel as datumNl, dateBadge, visibleNews, isOpenMelding } from './core.js';
import { I } from './icons.js';

const params = new URLSearchParams(location.search);
let TAFEL = (params.get('t') || params.get('tafel') || '').trim();
const CHIP = { e: params.get('e') || '', c: params.get('c') || '' };
const VOORBEELD = params.has('voorbeeld'); // voorbeeld in het beheer: altijd als klant

const app = document.getElementById('app');
const sheetEl = document.getElementById('sheet');
const backdrop = document.getElementById('achtergrond');
const toastEl = document.getElementById('toast');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- taal: Nederlands of Engels ---------------- */
let taal = 'nl';
try { taal = localStorage.getItem('guido-taal') || ((navigator.language || 'nl').toLowerCase().startsWith('nl') ? 'nl' : 'en'); } catch { /* */ }
if (taal !== 'en') taal = 'nl';
document.documentElement.lang = taal;
/** Kiest de tekst in de taal van de klant. */
const L = (nl, en) => (taal === 'en' ? en : nl);
/* Foutmeldingen van de server zijn Nederlands; in het Engels vertalen we op de code. */
const FOUT_EN = {
  uit: 'This is switched off at the moment.', wacht: 'You just called us. We’ll be right there.', gesloten: 'We’re closed right now.',
  druk: 'It’s very busy. Please let us know at the bar.', annuleer: 'Too late to cancel: we’re already on our way.', item: 'This request is no longer available.',
  veel: 'The bar already has your requests. Try again in a moment.', leeg: 'Please type something first.', tafel: 'This table no longer exists.',
  sessie: 'Hold your phone against the clip on your table again.', sun: 'Hold your phone against the clip on your table again.', net: 'No connection. Check your wifi or mobile data.'
};
const foutTekst = (err) => (taal === 'en' ? (FOUT_EN[err.code] || 'Something went wrong. Please try again.') : err.message);
/** Eigen teksten van het café (welkomtekst, mededelingen, verzoekjes): Engels als het ingevuld is, anders gewoon Nederlands. */
const kiesTaal = (nl, en) => (taal === 'en' && en ? en : nl);

let store = null;
let V = null; // huidige weergave (instellingen + meldingen van deze tafel)

const ui = {
  sheet: null,          // 'afrekenen' | 'verzoek'
  stap: '',
  fout: '',
  bezig: '',            // welke knop is bezig
  verzoek: null,
  tekst: '',
  wijze: 'kaart'
};

/* ---------------- hulpjes ---------------- */
let toastTimer;
function toast(msg, isFout) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('fout', !!isFout);
  toastEl.classList.add('zichtbaar');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('zichtbaar'), 2800);
}
const tafel = () => V && V.config.tafels.find((t) => t.id === TAFEL);
const lopend = (soort) => V && V.live.meldingen.find((m) => m.soort === soort && isOpenMelding(m));
const actieveVerzoekjes = () => (V && V.config.verzoekjes.aan ? V.config.verzoekjes.items.filter((x) => x.aan && x.label) : []);
/* Datums: de kern geeft Nederlands; voor Engels vertalen we de vaste woorden. */
const DATUM_EN = { Vanavond: 'Tonight', Vandaag: 'Today', Morgen: 'Tomorrow', zo: 'Sun', ma: 'Mon', di: 'Tue', wo: 'Wed', do: 'Thu', vr: 'Fri', za: 'Sat', jan: 'Jan', feb: 'Feb', mrt: 'Mar', apr: 'Apr', mei: 'May', jun: 'Jun', jul: 'Jul', aug: 'Aug', sep: 'Sep', okt: 'Oct', nov: 'Nov', dec: 'Dec' };
const vertaalDatum = (t) => (taal === 'en' ? String(t).replace(/[A-Za-z]+/g, (w) => DATUM_EN[w] || w) : t);
const dateLabel = (d, t) => vertaalDatum(datumNl(d, t));
const taalKnop = () => `<div class="taal" role="group" aria-label="Taal / Language">
  <button data-a="taal" data-v="nl" aria-pressed="${taal === 'nl'}" lang="nl" aria-label="Nederlands">NL</button>
  <button data-a="taal" data-v="en" aria-pressed="${taal === 'en'}" lang="en" aria-label="English">EN</button></div>`;
const cafeNaam = () => (V && V.config.cafe.naam) || 'guido.';

function woordmerk(c) {
  if (c.cafe.logo) return `<h1 class="sr">${esc(c.cafe.naam)}</h1><img class="g-logo" src="${esc(c.cafe.logo)}" alt="${esc(c.cafe.naam)}">`;
  if ((c.cafe.naam || 'guido.') === 'guido.') return `<h1 class="sr">guido.</h1><img class="g-logo" src="img/logo.png" alt="guido." width="150" height="60">`;
  const naam = c.cafe.naam || 'guido.';
  const m = naam.match(/^(.*?)([.!]?)$/);
  return `<h1 class="woordmerk">${esc(m[1])}<b>${esc(m[2])}</b></h1>`;
}

/* ---------------- schermen zonder tafel ---------------- */
function geenTafelHtml(lokaleDemo) {
  const demo = lokaleDemo ? `<p class="tiny" style="margin-top:18px;opacity:.75">Demo zonder clip? Kies een tafel:</p>
    <nav class="tafels-demo" aria-label="Demotafels">${Array.from({ length: 8 }, (_, i) => `<a href="?t=${i + 1}">${i + 1}</a>`).join('')}</nav>
    <p class="tiny" style="margin-top:8px"><a href="beheer.html" style="color:#FFDE5A">Naar beheer</a></p>` : '';
  return `<main class="leeg-scherm">
    <div class="nfc-ico">${I.nfc}</div>
    <img class="g-logo" src="img/logo.png" alt="guido." style="height:70px">
    <p>${L('Hou de bovenkant van je gsm tegen de clip op je tafel. Dan kan je hier de ober roepen, afrekenen en meer.', 'Hold the top of your phone against the clip on your table. Then you can call the waiter, ask for the bill and more.')}</p>
    ${demo}
  </main>`;
}

function berichtHtml(titel, msg, knop) {
  return `<main class="leeg-scherm">
    <div class="nfc-ico">${I.nfc}</div>
    <h1 class="woordmerk">${titel}</h1>
    <p>${esc(msg)}</p>
    ${knop ? `<button class="btn btn-geel" data-a="herlaad">${L('Opnieuw proberen', 'Try again')}</button>` : ''}
  </main>`;
}
const onbekendeTafelHtml = () => berichtHtml(L('Oeps', 'Oops') + '<b>.</b>', L('Deze clip kennen we niet (meer). Vraag het gerust even aan de bar, we helpen je graag.', 'We don’t recognise this clip (any more). Just ask at the bar, we’re happy to help.'));
const sessieNodigHtml = (msg) => berichtHtml(L('Tik opnieuw', 'Tap again') + '<b>.</b>', taal === 'en' ? FOUT_EN.sessie : (msg || 'Hou je gsm nog eens tegen de clip op je tafel.'));
const foutHtml = (msg) => berichtHtml(L('Even geduld', 'One moment') + '<b>.</b>', taal === 'en' ? 'We can’t connect right now.' : msg, true);

/* ---------------- blokken op de pagina ---------------- */
function statusKaart(m) {
  const c = V.config;
  const onderweg = m.status === 'onderweg';
  let titel; let sub;
  if (m.soort === 'ober') {
    titel = onderweg ? L('We komen eraan!', 'We’re on our way!') : L('De bar weet het', 'The bar has been told');
    sub = onderweg ? L('Iemand is onderweg naar je tafel.', 'Someone is coming to your table.') : L(`We komen zo naar ${esc(tafel().naam)}.`, 'We’ll be with you shortly.');
    if (m.tekst) sub += ' · ' + esc(m.tekst);
  } else {
    const keuze = taal === 'en'
      ? (m.wijze === 'kaart' ? 'By card' : m.wijze === 'contant' ? 'Cash' : '')
      : m.tekst;
    titel = onderweg ? L('We komen eraan met de rekening', 'We’re bringing the bill') : L('Je rekening is gevraagd', 'Bill requested');
    sub = (keuze ? esc(keuze) + '. ' : '') + (onderweg ? L('Tot zo!', 'See you in a moment!') : L('Je betaalt aan tafel, bij de ober.', 'You pay at the table, with the waiter.'));
  }
  const redenen = m.soort === 'ober' && !onderweg && !m.tekst && c.ober.redenen.length
    ? `<div class="status-extra"><span>${L('Waarvoor is het?', 'What is it for?')} <em>${L('Mag je overslaan.', 'Optional.')}</em></span><div class="chips">${c.ober.redenen.map((r) => `<button class="chip" data-a="reden" data-id="${esc(m.id)}" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>` : '';
  return `<section class="status ${onderweg ? 'onderweg' : ''}" aria-live="polite">
    <div class="status-rij">
      <span class="stip" aria-hidden="true">${onderweg ? I.vink : ''}</span>
      <div class="status-tekst"><strong>${titel}</strong><span>${sub}</span></div>
      ${onderweg ? '' : `<button class="btn btn-tekst btn-klein" data-a="annuleer" data-id="${esc(m.id)}">${L('Annuleren', 'Cancel')}</button>`}
    </div>${redenen}
  </section>`;
}

function actiesHtml(c) {
  if (!V.open) {
    return `<section class="gesloten"><span class="ico">${I.maan}</span><div><strong>${esc(L(c.uren.tekst || 'We zijn nu gesloten.', 'We’re closed right now.'))}</strong><span>${L('De ober roepen kan weer als we open zijn.', 'You can call the waiter again when we’re open.')}</span></div></section>`;
  }
  const ober = lopend('ober'); const afr = lopend('afrekenen');
  const verzoekjes = actieveVerzoekjes();
  let html = '';
  if (ober) html += statusKaart(ober);
  if (afr) html += statusKaart(afr);
  if (c.ober.aan && !ober) {
    html += `<button class="actie actie-hoofd" data-a="roep" ${ui.bezig === 'roep' ? 'disabled' : ''}>
      <span class="ico">${I.hand}</span>
      <span><span class="lbl">${L('Ober roepen', 'Call the waiter')}</span><span class="sub">${L('Eén tik en we komen naar je tafel', 'One tap and we’ll come to your table')}</span></span>
    </button>`;
  }
  const kleine = [];
  if (c.afrekenen.aan && !afr) kleine.push(`<button class="actie" data-a="afrekenen" ${ui.bezig === 'afrekenen' ? 'disabled' : ''}><span class="ico">${I.bon}</span><span><span class="lbl">${L('Afrekenen', 'Pay')}</span><span class="sub">${L('Vraag de rekening', 'Ask for the bill')}</span></span></button>`);
  if (verzoekjes.length) kleine.push(`<button class="actie" data-a="open" data-s="verzoek"><span class="ico">${I.noot}</span><span><span class="lbl">${L('Verzoekje', 'Request')}</span><span class="sub">${esc(verzoekjes.slice(0, 4).map((v) => v.emoji).join(' '))}</span></span></button>`);
  if (kleine.length) html += `<div class="acties ${kleine.length === 1 ? 'een' : ''}">${kleine.join('')}</div>`;
  return html;
}

function wifiHtml(c) {
  const w = c.wifi;
  if (!w || !w.aan || !w.naam) return '';
  return `<section class="wifi"><span class="ico">${I.wifi}</span>
    <div class="wifi-tekst"><strong>Wifi: ${esc(w.naam)}</strong>${w.wachtwoord ? `<code>${esc(w.wachtwoord)}</code>` : `<span>${L('Geen wachtwoord nodig', 'No password needed')}</span>`}</div>
    ${w.wachtwoord ? `<button class="btn btn-licht btn-klein" data-a="kopieer-wifi">${I.kopie} ${L('Kopieer', 'Copy')}</button>` : ''}</section>`;
}

function pageHtml() {
  const c = V.config;
  const t = tafel();
  const nieuws = visibleNews(c);
  const med = nieuws.mededelingen.map((m) => {
    const b = m.soort === 'event' ? dateBadge(m.datum) : null;
    const badge = m.afbeelding
      ? `<button type="button" class="badge-afb" data-a="vergroot" data-src="${esc(m.afbeelding)}" aria-label="${esc(L('Afbeelding vergroten', 'Enlarge image'))}"><img src="${esc(m.afbeelding)}" alt=""></button>`
      : b
        ? `<div class="datum" aria-hidden="true"><div class="d">${b.dag}</div><div class="n">${b.nr}</div><div class="m">${b.maand}</div></div>`
        : `<div class="badge-actie" aria-hidden="true">${m.soort === 'event' ? 'Event' : L('Actie', 'Deal')}</div>`;
    const meta = m.soort === 'event' ? dateLabel(m.datum, m.tijd) : (m.datum ? L('Loopt tot ', 'Until ') + (taal === 'en' ? dateLabel(m.datum, '') : dateLabel(m.datum, '').toLowerCase()) : '');
    const titel = kiesTaal(m.titel, m.titelEn); const tekst = kiesTaal(m.tekst, m.tekstEn);
    return `<article class="kaart">${badge}<div><h3>${esc(titel)}</h3>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}${tekst ? `<p>${esc(tekst)}</p>` : ''}</div></article>`;
  }).join('');
  const buurt = nieuws.buurt.map((b) => {
    const meta = [dateLabel(b.datum, b.tijd), b.plaats].filter(Boolean).join(' · ');
    const link = /^https?:\/\//i.test(b.link || '') ? `<a class="meer" href="${esc(b.link)}" target="_blank" rel="noopener noreferrer">${L('Meer info', 'More info')}</a>` : '';
    return `<article class="kaart"><div class="badge-buurt" aria-hidden="true">${I.pin}</div><div><h3>${esc(b.titel)}</h3>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}${b.tekst ? `<p>${esc(b.tekst)}</p>` : ''}${link}</div></article>`;
  }).join('');

  const ik = personeel.ik();
  const strook = ik && !VOORBEELD && store && store.mode === 'gedeeld' ? `<div class="personeel-strook"><span>Aangemeld als <strong>${esc(ik.naam)}</strong></span><a href="beheer.html#meldingen">Meldingen</a></div>` : '';
  return `${strook}<div class="g-app">
    <header class="g-top">
      <div class="g-top-rij">${woordmerk(c)}<div class="g-top-rechts"><span class="tafel-pil">${esc(t.naam)}</span>${taalKnop()}</div></div>
      ${(() => { const w = kiesTaal(c.cafe.welkom, c.cafe.welkomEn); return w ? `<p class="g-welkom">${esc(w)}</p>` : ''; })()}
    </header>
    <main class="g-main">
      ${actiesHtml(c)}
      ${wifiHtml(c)}
      ${med ? `<section class="sectie" aria-labelledby="h-med"><h2 id="h-med">${L('Bij', 'At')} ${esc(c.cafe.naam || L('ons', 'ours'))}</h2><div class="kaarten">${med}</div></section>` : ''}
      ${buurt ? `<section class="sectie" aria-labelledby="h-buurt"><h2 id="h-buurt">${L('In de buurt', 'Nearby')}</h2><div class="kaarten">${buurt}</div></section>` : ''}
    </main>
    <footer class="g-voet">
      ${c.cafe.instagram ? `<p style="margin:0 0 10px">${L('Volg ons op Instagram', 'Follow us on Instagram')}: <strong>${esc(c.cafe.instagram)}</strong></p>` : ''}
      ${sociaalHtml(c)}
    </footer>
  </div>`;
}

function sociaalHtml(c) {
  const knoppen = [
    c.cafe.googleReviewUrl && { url: c.cafe.googleReviewUrl, ico: I.ster, label: L('Google Reviews', 'Google Reviews') },
    c.cafe.instagramUrl && { url: c.cafe.instagramUrl, ico: I.instagram, label: 'Instagram' },
    c.cafe.facebookUrl && { url: c.cafe.facebookUrl, ico: I.facebook, label: 'Facebook' }
  ].filter(Boolean);
  if (!knoppen.length) return '';
  return `<div class="sociaal-rij">${knoppen.map((k) => `<a class="sociaal-knop" href="${esc(k.url)}" target="_blank" rel="noopener noreferrer">${k.ico}<span>${esc(k.label)}</span></a>`).join('')}</div>`;
}

/* ---------------- sheets ---------------- */
function kop(titel, terug) {
  return `<div class="sheet-kop">
    ${terug ? `<button class="terug" data-a="terug" aria-label="${L('Terug', 'Back')}">${I.terug}</button>` : ''}
    <h2 id="sheet-titel">${esc(titel)}</h2>
    <button class="sluit" data-a="sluit" aria-label="${L('Sluiten', 'Close')}">${I.sluit}</button>
  </div>`;
}
const foutBlok = () => (ui.fout ? `<div class="melding-fout" role="alert">${esc(ui.fout)}</div>` : '');
const klaarBlok = (titel, tekst) => `<div class="klaar"><div class="vink">${I.vink}</div><h3>${esc(titel)}</h3>${tekst ? `<p>${tekst}</p>` : ''}</div>`;
const seg = (naam, label, opties) => `<div><p class="vraag">${label}</p><div class="seg" role="group" aria-label="${label}">${opties.map(([v, t]) => `<button data-a="kies" data-k="${naam}" data-v="${v}" aria-pressed="${ui[naam] === v}">${t}</button>`).join('')}</div></div>`;

function afrekenSheet() {
  const c = V.config.afrekenen;
  return kop(L('Afrekenen', 'Pay')) + `<div class="sheet-inhoud">
    ${c.wijze ? seg('wijze', L('Hoe wil je betalen?', 'How would you like to pay?'), [['kaart', L('Met de kaart', 'By card')], ['contant', L('Contant', 'Cash')]]) : ''}
    ${foutBlok()}
    <button class="btn btn-geel btn-vol" data-a="vraag-rekening" ${ui.bezig ? 'disabled' : ''}>${L('Vraag de rekening', 'Ask for the bill')}</button>
    <p class="proto">${L('Je betaalt aan tafel, bij de ober. Zo weten we meteen wat we moeten meebrengen.', 'You pay at the table, with the waiter. This way we know what to bring.')}</p>
  </div>`;
}

function verzoekSheet() {
  const items = actieveVerzoekjes();
  if (ui.stap === 'klaar') {
    return kop(L('Verzoekje', 'Request')) + `<div class="sheet-inhoud">${klaarBlok(L('Verstuurd!', 'Sent!'), L('De bar heeft je verzoekje ontvangen.', 'The bar has received your request.'))}
      <div class="knoppen"><button class="btn btn-groen btn-vol" data-a="sluit">${L('Sluiten', 'Close')}</button></div></div>`;
  }
  const it = items.find((x) => x.id === ui.verzoek);
  if (ui.stap === 'tekst' && it) {
    const label = kiesTaal(it.label, it.labelEn);
    const hint = kiesTaal(it.hint, it.hintEn) || L('Typ hier…', 'Type here…');
    return kop(label, true) + `<div class="sheet-inhoud">
      <label class="sr" for="vz-tekst">${esc(label)}</label>
      <textarea class="veld" id="vz-tekst" rows="3" maxlength="200" placeholder="${esc(hint)}">${esc(ui.tekst)}</textarea>
      ${foutBlok()}
      <button class="btn btn-geel btn-vol" data-a="stuur-verzoek" ${ui.bezig ? 'disabled' : ''}>${L('Versturen naar de bar', 'Send to the bar')}</button>
    </div>`;
  }
  const lijst = items.map((x) => `<button class="optie" data-a="kies-verzoek" data-v="${esc(x.id)}" ${ui.bezig ? 'disabled' : ''}><span class="em" aria-hidden="true">${esc(x.emoji)}</span><span>${esc(kiesTaal(x.label, x.labelEn))}</span><span class="pijl">${x.tekst ? I.pijl.replace('<svg', '<svg width="20" height="20"') : ''}</span></button>`).join('');
  return kop(L('Verzoekje', 'Request')) + `<div class="sheet-inhoud"><p class="muted" style="margin:0">${L('Waarmee kunnen we je blij maken?', 'How can we make your evening?')}</p>${foutBlok()}<div class="opties">${lijst}</div></div>`;
}

function renderSheet() {
  if (!ui.sheet || !V) return;
  const actief = document.activeElement;
  if (actief && actief.tagName === 'TEXTAREA' && sheetEl.contains(actief)) return; // niet storen tijdens het typen
  sheetEl.innerHTML = ui.sheet === 'afrekenen' ? afrekenSheet() : verzoekSheet();
}

function render() {
  if (!V) return;
  if (!tafel()) { app.innerHTML = onbekendeTafelHtml(); closeSheet(); return; }
  document.title = tafel().naam + ' · ' + cafeNaam();
  if (!V.open && ui.sheet) closeSheet();
  app.innerHTML = pageHtml();
  renderSheet();
}

/* ---------------- sheet openen / sluiten ---------------- */
let lastFocus = null;
function openSheet(naam) {
  lastFocus = document.activeElement;
  Object.assign(ui, { sheet: naam, stap: '', fout: '', bezig: '', verzoek: null, tekst: '' });
  sheetEl.hidden = false; backdrop.hidden = false;
  renderSheet();
  requestAnimationFrame(() => { sheetEl.classList.add('open'); backdrop.classList.add('open'); });
  setTimeout(() => { const f = sheetEl.querySelector('.sluit'); if (f) f.focus({ preventScroll: true }); }, 260);
  document.body.style.overflow = 'hidden';
}
/* ---------------- lightbox: afbeelding van een mededeling vergroten ---------------- */
let lightboxEl = null;
function openLightbox(src) {
  if (!src) return;
  closeLightbox();
  lightboxEl = document.createElement('div');
  lightboxEl.className = 'lightbox';
  lightboxEl.innerHTML = `<button type="button" class="lightbox-sluit" aria-label="${esc(L('Sluiten', 'Close'))}">${I.sluit}</button><img src="${esc(src)}" alt="">`;
  lightboxEl.addEventListener('click', (e) => { if (e.target === lightboxEl || e.target.closest('.lightbox-sluit')) closeLightbox(); });
  document.body.appendChild(lightboxEl);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => lightboxEl && lightboxEl.classList.add('open'));
}
function closeLightbox() {
  if (!lightboxEl) return;
  const el = lightboxEl; lightboxEl = null;
  el.classList.remove('open');
  document.body.style.overflow = ui.sheet ? 'hidden' : '';
  setTimeout(() => el.remove(), 200);
}

function closeSheet() {
  if (!ui.sheet) return;
  ui.sheet = null;
  sheetEl.classList.remove('open'); backdrop.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => { if (!ui.sheet) { sheetEl.hidden = true; backdrop.hidden = true; sheetEl.innerHTML = ''; } }, 260);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}
function zetStap(stap) { ui.stap = stap; ui.fout = ''; sheetEl.innerHTML = ''; renderSheet(); }

/* ---------------- acties ---------------- */
async function doe(naam, action) {
  ui.bezig = naam; ui.fout = '';
  if (ui.sheet) renderSheet(); else render();
  try { return await store.dispatch({ ...action, tafel: TAFEL }); }
  finally { ui.bezig = ''; }
}

async function onClick(e) {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const a = el.dataset.a;
  try {
    switch (a) {
      case 'herlaad': location.reload(); break;
      case 'taal':
        taal = el.dataset.v === 'en' ? 'en' : 'nl';
        try { localStorage.setItem('guido-taal', taal); } catch { /* */ }
        document.documentElement.lang = taal;
        ui.fout = '';
        render();
        break;
      case 'open': openSheet(el.dataset.s); break;
      case 'sluit': closeSheet(); break;
      case 'terug': zetStap(''); break;
      case 'vergroot': openLightbox(el.dataset.src); break;

      /* ober: één tik */
      case 'roep':
        await doe('roep', { type: 'ober' });
        if (navigator.vibrate) navigator.vibrate(30);
        break;
      case 'reden': await doe('reden', { type: 'ober-reden', id: el.dataset.id, reden: el.dataset.v }); break;
      case 'annuleer':
        await doe('annuleer', { type: 'annuleer', id: el.dataset.id });
        toast(L('Geannuleerd.', 'Cancelled.'));
        break;

      /* afrekenen */
      case 'afrekenen': {
        const c = V.config.afrekenen;
        if (c.wijze) openSheet('afrekenen');
        else { await doe('afrekenen', { type: 'afrekenen' }); toast(L('We komen eraan met de rekening.', 'We’re bringing the bill.')); }
        break;
      }
      case 'kies': ui[el.dataset.k] = el.dataset.v; renderSheet(); break;
      case 'vraag-rekening':
        await doe('afrekenen', { type: 'afrekenen', wijze: ui.wijze });
        closeSheet(); toast(L('De bar weet het. We komen eraan met de rekening.', 'The bar has been told. We’re bringing the bill.'));
        break;

      /* verzoekjes */
      case 'kies-verzoek': {
        const it = actieveVerzoekjes().find((x) => x.id === el.dataset.v);
        if (!it) break;
        ui.verzoek = it.id; ui.tekst = '';
        if (it.tekst) { zetStap('tekst'); setTimeout(() => { const t = document.getElementById('vz-tekst'); if (t) t.focus(); }, 50); }
        else { await doe('verzoek', { type: 'verzoek', item: it.id }); zetStap('klaar'); }
        break;
      }
      case 'stuur-verzoek': {
        const t = document.getElementById('vz-tekst');
        ui.tekst = t ? t.value : ui.tekst;
        if (t) t.blur();
        await doe('verzoek', { type: 'verzoek', item: ui.verzoek, tekst: ui.tekst });
        zetStap('klaar');
        break;
      }

      case 'kopieer-wifi':
        try { await navigator.clipboard.writeText(V.config.wifi.wachtwoord); toast(L('Wachtwoord gekopieerd.', 'Password copied.')); }
        catch { toast(L('Kopiëren lukt niet. Typ het wachtwoord over.', 'Copying failed. Please type the password.'), true); }
        break;
    }
  } catch (err) {
    if (ui.sheet) { ui.fout = foutTekst(err); const act = document.activeElement; if (act && act.tagName === 'TEXTAREA') act.blur(); renderSheet(); }
    else { toast(foutTekst(err), true); render(); }
  }
}

document.addEventListener('click', onClick);
backdrop.addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (lightboxEl) closeLightbox(); else closeSheet(); } });
sheetEl.addEventListener('input', (e) => { if (e.target.id === 'vz-tekst') ui.tekst = e.target.value; });

/* ---------------- opstarten ---------------- */
async function start() {
  const gedeeld = await isGedeeld();
  if (!TAFEL && !CHIP.e) { app.innerHTML = geenTafelHtml(!gedeeld); return; }
  try {
    if (gedeeld && !VOORBEELD && (CHIP.e || personeel.token())) {
      // Echte tik op de clip (of ober met zijn telefoon): sessie ophalen
      try {
        const j = await api('/api/sessie', { method: 'POST', body: { t: TAFEL, e: CHIP.e, c: CHIP.c } });
        TAFEL = j.tafel;
        sessie.zet(TAFEL, j.token);
        if (j.afgevinkt) setTimeout(() => toast('Oproep van deze tafel afgevinkt ✓'), 400);
      } catch (err) {
        if (err.code === 'pin') { personeel.zet(''); personeel.zetIk(null); }
        else if (err.code === 'sessie' || err.code === 'sun' || err.code === 'tafel') { app.innerHTML = sessieNodigHtml(err.message); return; }
      }
      if (CHIP.e) history.replaceState(null, '', '?t=' + encodeURIComponent(TAFEL));
    }
    // Vlug verversen zolang er een oproep loopt, anders heel rustig.
    store = await createStore({ tafel: TAFEL, tempo: (v) => (v && v.live.meldingen.some(isOpenMelding) ? 4000 : 60000) });
    store.onFout = (err) => { if (err.code === 'sessie') { app.innerHTML = sessieNodigHtml(err.message); closeSheet(); } };
    store.subscribe((v) => { V = v; render(); });
    try { await store.start(); }
    catch (err) { if (err.code === 'sessie') { app.innerHTML = sessieNodigHtml(err.message); return; } throw err; }
  } catch (err) {
    app.innerHTML = foutHtml(err.message || 'We kunnen even geen verbinding maken.');
  }
  setInterval(() => { if (V && !ui.sheet && document.visibilityState === 'visible') render(); }, 20000);
}
start();
