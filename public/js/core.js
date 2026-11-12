/* ============================================================
   guido. tafelclip — gedeelde logica
   Wordt gebruikt door het klantscherm, het beheerscherm én
   de Netlify-functie. Geen DOM-code hier.
   ============================================================ */

export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

/* ---------------- tijd: altijd Belgische tijd, ook op de server ---------------- */
export const TIJDZONE = 'Europe/Brussels';
const TZ_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: TIJDZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
const WEEKDAG = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Datum, uur en weekdag (0 = zondag) in België. */
export function lokaal(now = Date.now()) {
  const p = Object.fromEntries(TZ_FMT.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { datum: `${p.year}-${p.month}-${p.day}`, uur: Number(p.hour), min: Number(p.minute), dag: WEEKDAG.indexOf(p.weekday) };
}
export const isoDate = (d = new Date()) => lokaal(+d).datum;
/** Een café-avond loopt door na middernacht: tot 5 uur telt bij de vorige dag. */
export const werkdag = (now = Date.now()) => lokaal(now - 5 * 3600e3).datum;

/* ---------------- standaardinstellingen ---------------- */

export function defaultConfig(now = Date.now()) {
  const vandaag = isoDate(new Date(now));
  return {
    rev: 1,
    adminPin: '1234',
    volgorde: ['acties', 'wifi', 'mededelingen', 'buurt', 'sociaal'],
    theme: { kleurPrimair: '#174B00', kleurAccent: '#FFDE5A', lettertype: 'inter', logoGrootte: 100, banner: 'normaal' },
    cafe: {
      naam: 'guido.',
      welkom: 'Fijn dat je er bent! Bestellen doe je gewoon bij ons, aan tafel.',
      welkomEn: '',
      logo: '',
      googleReviewUrl: '',
      instagramUrl: '',
      facebookUrl: ''
    },
    tafels: Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), naam: 'Tafel ' + (i + 1) })),
    beveiliging: { chips: false },
    uren: {
      aan: false,
      tekst: 'We zijn nu gesloten. Tot snel!',
      // index 0 = zondag … 6 = zaterdag. "tot" vroeger dan "van" = na middernacht.
      dagen: Array.from({ length: 7 }, () => ({ dicht: false, van: '11:00', tot: '01:00' }))
    },
    ober: { aan: true, redenen: ['Iets bestellen', 'Een vraagje'], wachttijd: 1 },
    afrekenen: { aan: true, wijze: true },
    verzoekjes: {
      aan: true,
      items: [
        { id: 'liedje', emoji: '🎵', label: 'Liedje aanvragen', labelEn: '', tekst: true, hint: 'Artiest – titel', hintEn: '', aan: true },
        { id: 'kaars', emoji: '🕯️', label: 'Kaarsje aanvullen', labelEn: '', tekst: false, hint: '', hintEn: '', aan: true },
        { id: 'lief', emoji: '💌', label: 'Lief berichtje naar de bar', labelEn: '', tekst: true, hint: 'Jullie zijn top!', hintEn: '', aan: true },
        { id: 'water', emoji: '💧', label: 'Karafje water', labelEn: '', tekst: false, hint: '', hintEn: '', aan: true }
      ]
    },
    wifi: { aan: false, naam: '', wachtwoord: '' },
    mededelingen: {
      aan: true,
      items: [
        { id: 'karaoke', soort: 'event', titel: 'Karaoke-avond', titelEn: '', tekst: 'Zet je stem klaar: de microfoon staat open voor iedereen.', tekstEn: '', afbeelding: '', datum: '2026-11-23', tijd: '19:00', aan: true },
        { id: 'insta', soort: 'actie', titel: '5% korting', titelEn: '', tekst: 'Post een foto op Instagram, tag @cafeguido en toon het aan de bar.', tekstEn: '', afbeelding: '', datum: '', tijd: '', aan: true }
      ]
    },
    buurt: {
      aan: true,
      dagen: 7,
      bronnen: { uit: { aan: false, postcode: '9000', soorten: 'concert, fuif, dj, party, quiz, comedy, festival' }, ics: [], auto: false },
      items: [
        { id: 'bramadonna', titel: 'DJ Bramadonna', plaats: 'BarBroos', tekst: 'Draait de hele nacht door. Wandel gerust verder na je laatste glas.', datum: vandaag, tijd: '22:00', link: '', aan: true }
      ]
    }
  };
}

export function defaultLive() {
  return { rev: 1, meldingen: [], voorstellen: [], geweigerd: [], koppelen: null, stats: {}, tafelScans: {} };
}

export const defaultState = (now = Date.now()) => ({ config: defaultConfig(now), live: defaultLive(now) });

/** Vult ontbrekende velden aan (oudere opgeslagen gegevens blijven werken). */
function vulAan(doel, basis) {
  for (const [k, v] of Object.entries(basis)) {
    if (doel[k] === undefined) doel[k] = JSON.parse(JSON.stringify(v));
    else if (v && typeof v === 'object' && !Array.isArray(v) && doel[k] && typeof doel[k] === 'object' && !Array.isArray(doel[k])) vulAan(doel[k], v);
  }
  return doel;
}
export function migreer(state) {
  if (!state || !state.config || !state.live) return state;
  const basis = defaultConfig();
  const c = state.config;
  // versie 2 → 3: geen rekeningen, kassa of online betalen meer
  if (c.rekening && !c.afrekenen) c.afrekenen = { aan: c.rekening.aan !== false, wijze: true };
  for (const k of ['rekening', 'kassa', 'prijslijst']) delete c[k];
  c.tafels.forEach((t) => { delete t.lsTafel; });
  vulAan(c, { beveiliging: basis.beveiliging, uren: basis.uren, ober: basis.ober, afrekenen: basis.afrekenen, wifi: basis.wifi, buurt: basis.buurt, verzoekjes: { aan: true, items: [] }, mededelingen: { aan: true, items: [] }, theme: basis.theme });
  if (!Array.isArray(c.uren.dagen) || c.uren.dagen.length !== 7) c.uren.dagen = basis.uren.dagen;
  // volgorde: moet precies de gekende onderdelen bevatten, elk één keer (oude lijst zonder 'sociaal' krijgt dat achteraan)
  if (Array.isArray(c.volgorde) && !c.volgorde.includes('sociaal')) c.volgorde = [...c.volgorde, 'sociaal'];
  if (!['normaal', 'compact', 'minimaal'].includes(c.theme.banner)) c.theme.banner = 'normaal';
  if (!Array.isArray(c.volgorde) || c.volgorde.length !== basis.volgorde.length
    || new Set(c.volgorde).size !== basis.volgorde.length || !c.volgorde.every((k) => basis.volgorde.includes(k))) {
    c.volgorde = basis.volgorde.slice();
  }
  // oude teksten: eigen vertaling en afbeelding/GIF nog niet voorzien
  vulAan(c.cafe, basis.cafe);
  (c.mededelingen.items || []).forEach((m) => vulAan(m, { titelEn: '', tekstEn: '', afbeelding: '' }));
  (c.verzoekjes.items || []).forEach((v) => vulAan(v, { labelEn: '', hintEn: '' }));
  for (const k of ['rekeningen', 'splits']) delete state.live[k];
  vulAan(state.live, defaultLive());
  return state;
}

/* ---------------- openingsuren ---------------- */
const minuten = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export function isOpen(config, now = Date.now()) {
  const u = config.uren;
  if (!u || !u.aan) return true;
  const l = lokaal(now);
  const nu = l.uur * 60 + l.min;
  const venster = (d) => {
    const x = u.dagen[d];
    if (!x || x.dicht) return null;
    const a = minuten(x.van); const b = minuten(x.tot);
    return a == null || b == null ? null : [a, b];
  };
  const v = venster(l.dag);
  if (v) {
    if (v[1] > v[0]) { if (nu >= v[0] && nu < v[1]) return true; }
    else if (nu >= v[0]) return true;                       // loopt door tot na middernacht
  }
  const g = venster((l.dag + 6) % 7);                        // de avond van gisteren
  return !!(g && g[1] <= g[0] && nu < g[1]);
}

/* ---------------- tijd en datums voor weergave ---------------- */

const DAGEN = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

export function dateLabel(datum, tijd, now = Date.now()) {
  if (!datum) return tijd ? tijd : '';
  const vandaag = isoDate(new Date(now));
  const morgen = isoDate(new Date(now + 864e5));
  const d = new Date(datum + 'T12:00:00');
  let dag;
  if (datum === vandaag) dag = Number((tijd || '0').slice(0, 2)) >= 17 ? 'Vanavond' : 'Vandaag';
  else if (datum === morgen) dag = 'Morgen';
  else dag = DAGEN[d.getDay()] + ' ' + d.getDate() + ' ' + MAANDEN[d.getMonth()];
  return tijd ? dag + ' · ' + tijd : dag;
}

export function dateBadge(datum) {
  if (!datum) return null;
  const d = new Date(datum + 'T12:00:00');
  return { dag: DAGEN[d.getDay()], nr: d.getDate(), maand: MAANDEN[d.getMonth()] };
}

export function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'net nu';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min geleden';
  const h = Math.floor(m / 60);
  return h + ' u geleden';
}

/** Hoe lang wacht deze tafel al? Voor het personeel. */
export function wachtLabel(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'net binnen';
  return 'wacht ' + Math.floor(s / 60) + ' min';
}

/** Welke mededelingen en buurt-items moet de klant vandaag zien? */
export function visibleNews(config, now = Date.now()) {
  const vandaag = isoDate(new Date(now));
  const tot = isoDate(new Date(now + (Number(config.buurt.dagen) || 7) * 864e5));
  const mededelingen = !config.mededelingen.aan ? [] : config.mededelingen.items
    .filter((m) => m.aan && m.titel && (!m.datum || m.datum >= vandaag));
  const buurt = !config.buurt.aan ? [] : config.buurt.items
    .filter((b) => b.aan && b.titel && (!b.datum || (b.datum >= vandaag && b.datum <= tot)))
    .sort((a, b) => (a.datum + a.tijd).localeCompare(b.datum + b.tijd));
  return { mededelingen, buurt };
}

/* ---------------- views ---------------- */

/** Wat een klant mag zien: nooit pincodes, bronnen of meldingen van andere tafels. */
export function publicView(state, tafel, now = Date.now()) {
  const { adminPin, beveiliging, buurt, wifi, ...rest } = state.config;
  const t = String(tafel || '');
  const recent = now - 3 * 3600e3;
  const { bronnen, ...buurtPubliek } = buurt;
  const open = isOpen(state.config, now);
  return {
    config: { ...rest, buurt: buurtPubliek, wifi: wifi && wifi.aan ? wifi : { aan: false } },
    open,
    live: {
      meldingen: state.live.meldingen
        .filter((m) => m.tafel === t && m.ts > recent && ['ober', 'afrekenen', 'verzoek'].includes(m.soort))
        .map(({ door, ...m }) => m)
    },
    rev: state.config.rev + '-' + state.live.rev + (open ? '' : '-dicht')
  };
}

export function adminView(state, now = Date.now()) {
  return { config: state.config, live: state.live, open: isOpen(state.config, now), rev: state.config.rev + '-' + state.live.rev };
}

/* ---------------- acties ---------------- */

/* Wie mag wat? gast < personeel < eigenaar. 'intern' kan enkel de server zelf. */
export const RECHTEN = {
  gast: new Set(['ober', 'ober-reden', 'afrekenen', 'annuleer', 'verzoek']),
  personeel: new Set(['melding', 'opruimen', 'aan-tafel']),
  eigenaar: new Set(['config', 'pin', 'reset', 'voorstel', 'koppel-start', 'koppel-stop']),
  intern: new Set(['systeem-melding', 'voorstellen-bij', 'scan'])
};
export function magActie(rol, type) {
  if (RECHTEN.intern.has(type)) return rol === 'intern';
  if (RECHTEN.gast.has(type)) return true;
  if (RECHTEN.personeel.has(type)) return rol === 'personeel' || rol === 'eigenaar' || rol === 'intern';
  if (RECHTEN.eigenaar.has(type)) return rol === 'eigenaar' || rol === 'intern';
  return false;
}
export const isAdminAction = (type) => !RECHTEN.gast.has(type);

class Fout extends Error { constructor(msg, code) { super(msg); this.code = code || 'fout'; } }
const fout = (msg, code) => { throw new Fout(msg, code); };
const tekst = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

const OPEN = (m) => m.status === 'nieuw' || m.status === 'onderweg';
export const isOpenMelding = OPEN;

function tafelVan(state, a) {
  const id = String(a.tafel || '');
  const t = state.config.tafels.find((x) => x.id === id);
  if (!t) fout('Deze tafel bestaat niet (meer).', 'tafel');
  return t;
}

function tel(state, now, veld, n = 1) {
  const d = werkdag(now);
  const s = state.live.stats[d] || (state.live.stats[d] = {});
  s[veld] = (s[veld] || 0) + n;
  const dagen = Object.keys(state.live.stats);
  if (dagen.length > 130) dagen.sort().slice(0, dagen.length - 120).forEach((k) => delete state.live.stats[k]);
}

function melding(state, now, data) {
  const m = { id: uid(), ts: now, status: 'nieuw', ...data };
  state.live.meldingen.unshift(m);
  return m;
}

/** Regels voor elke actie van een klant: open, niet te veel tegelijk. */
function gastControle(state, now) {
  if (!isOpen(state.config, now)) fout(state.config.uren.tekst || 'We zijn nu gesloten.', 'gesloten');
  const druk = state.live.meldingen.filter((m) => now - m.ts < 10 * 60e3 && ['ober', 'afrekenen', 'verzoek'].includes(m.soort)).length;
  if (druk >= 60) fout('Het is erg druk. Geef gerust een seintje aan de bar.', 'druk');
}

/** Het personeel reageert voor het eerst: reactietijd bijhouden. */
function reageer(state, m, now, door) {
  if (door) m.door = door;
  if (m.gereageerd || !['ober', 'afrekenen'].includes(m.soort)) return;
  m.gereageerd = now;
  tel(state, now, 'reactieS', Math.min(1800, Math.round((now - m.ts) / 1000)));
  tel(state, now, 'reactieN');
}

/**
 * Past één actie toe. Geeft { state, result } terug of gooit een Fout
 * met een Nederlandstalige uitleg die je zo aan de gebruiker kan tonen.
 */
export function apply(prev, action, now = Date.now()) {
  const state = JSON.parse(JSON.stringify(prev));
  const a = action || {};
  let result = null;
  let raaktConfig = false;
  let raaktLive = true;

  // oude meldingen opruimen: max 24 u en 200 stuks
  const grens = now - 24 * 3600e3;
  state.live.meldingen = state.live.meldingen.filter((m) => m.ts > grens).slice(0, 200);

  switch (a.type) {
    /* ---------- klant ---------- */
    case 'ober': {
      const t = tafelVan(state, a);
      if (!state.config.ober.aan) fout('Ober roepen staat momenteel uit.', 'uit');
      const open = state.live.meldingen.find((m) => m.tafel === t.id && m.soort === 'ober' && OPEN(m));
      if (open) { result = open; raaktLive = false; break; }
      gastControle(state, now);
      const wacht = (Number(state.config.ober.wachttijd) || 0) * 60e3;
      const vorige = state.live.meldingen.find((m) => m.tafel === t.id && m.soort === 'ober' && m.status !== 'geannuleerd');
      if (vorige && now - vorige.ts < wacht) fout('Je riep ons net nog. We komen zo snel mogelijk.', 'wacht');
      const reden = state.config.ober.redenen.includes(a.reden) ? a.reden : '';
      result = melding(state, now, { soort: 'ober', tafel: t.id, tafelNaam: t.naam, tekst: reden });
      tel(state, now, 'ober');
      break;
    }
    case 'ober-reden': {
      // De klant tikt na het roepen nog aan waarvoor het is.
      const t = tafelVan(state, a);
      const m = state.live.meldingen.find((x) => x.id === a.id && x.tafel === t.id && x.soort === 'ober');
      if (!m || !OPEN(m)) { raaktLive = false; break; }
      if (!state.config.ober.redenen.includes(a.reden)) fout('Deze keuze bestaat niet meer.', 'reden');
      m.tekst = a.reden;
      result = m;
      break;
    }
    case 'afrekenen': {
      const t = tafelVan(state, a);
      const c = state.config.afrekenen;
      if (!c.aan) fout('Afrekenen via de clip staat momenteel uit.', 'uit');
      const open = state.live.meldingen.find((m) => m.tafel === t.id && m.soort === 'afrekenen' && OPEN(m));
      if (open) { result = open; raaktLive = false; break; }
      gastControle(state, now);
      const wijze = c.wijze && ['kaart', 'contant'].includes(a.wijze) ? a.wijze : '';
      const delen = [wijze === 'kaart' ? 'Met de kaart' : wijze === 'contant' ? 'Contant' : ''].filter(Boolean);
      result = melding(state, now, { soort: 'afrekenen', tafel: t.id, tafelNaam: t.naam, wijze, tekst: delen.join(' · ') });
      tel(state, now, 'afrekenen');
      break;
    }
    case 'annuleer': {
      const t = tafelVan(state, a);
      const m = state.live.meldingen.find((x) => x.id === a.id && x.tafel === t.id);
      if (!m || m.status !== 'nieuw') fout('Dit kan niet meer geannuleerd worden: we zijn al onderweg.', 'annuleer');
      m.status = 'geannuleerd';
      m.afgehandeld = now;
      tel(state, now, 'geannuleerd');
      result = m;
      break;
    }
    case 'verzoek': {
      const t = tafelVan(state, a);
      if (!state.config.verzoekjes.aan) fout('Verzoekjes staan momenteel uit.', 'uit');
      const item = state.config.verzoekjes.items.find((x) => x.id === a.item && x.aan);
      if (!item) fout('Dit verzoekje bestaat niet meer.', 'item');
      gastControle(state, now);
      const recent = state.live.meldingen.filter((m) => m.tafel === t.id && m.soort === 'verzoek' && now - m.ts < 10 * 60e3);
      if (recent.length >= 4) fout('De bar heeft je verzoekjes al. Probeer het zo meteen opnieuw.', 'veel');
      const tk = item.tekst ? tekst(a.tekst, 200) : '';
      if (item.tekst && !tk) fout('Vul eerst iets in.', 'leeg');
      result = melding(state, now, { soort: 'verzoek', tafel: t.id, tafelNaam: t.naam, item: item.id, emoji: item.emoji, label: item.label, tekst: tk });
      tel(state, now, 'verzoek');
      break;
    }

    /* ---------- server ---------- */
    case 'scan': {
      // elke geslaagde chip-tik (/sessie), gast én personeel — voor "meest gescande tafel"
      const t = tafelVan(state, a);
      state.live.tafelScans[t.id] = (state.live.tafelScans[t.id] || 0) + 1;
      break;
    }
    case 'systeem-melding': {
      const info = a.soort === 'info';
      result = melding(state, now, { soort: info ? 'info' : 'fout', tafel: String(a.tafel || ''), tafelNaam: a.tafelNaam || 'Systeem', tekst: tekst(a.tekst, 300) });
      if (info) { result.status = 'klaar'; result.afgehandeld = now; }   // ter info: niemand hoeft dit af te vinken
      break;
    }
    case 'voorstellen-bij': {
      const vandaag = isoDate(new Date(now));
      const bekend = new Set([...state.config.buurt.items.map((b) => b.bronId).filter(Boolean), ...state.live.geweigerd, ...state.live.voorstellen.map((v) => v.bronId)]);
      const sleutel = (x) => (x.titel || '').toLowerCase().trim() + '|' + x.datum;
      const bekendeSleutels = new Set([...state.config.buurt.items, ...state.live.voorstellen].map(sleutel));
      let nieuw = 0;
      for (const v of a.items || []) {
        if (!v.bronId || bekend.has(v.bronId) || bekendeSleutels.has(sleutel(v)) || !v.datum || v.datum < vandaag) continue;
        const item = { id: uid(), bronId: v.bronId, bron: tekst(v.bron, 60), titel: tekst(v.titel, 80), plaats: tekst(v.plaats, 80), tekst: tekst(v.tekst, 220), datum: v.datum, tijd: tekst(v.tijd, 5), link: tekst(v.link, 300) };
        if (a.auto || v.auto) { state.config.buurt.items.push({ ...item, id: uid(), aan: true }); raaktConfig = true; }
        else state.live.voorstellen.push(item);
        bekend.add(v.bronId); bekendeSleutels.add(sleutel(v)); nieuw++;
      }
      state.live.voorstellen = state.live.voorstellen.filter((v) => v.datum >= vandaag).sort((x, y) => (x.datum + x.tijd).localeCompare(y.datum + y.tijd)).slice(0, 80);
      // voorbije buurt-items opruimen
      const voor = state.config.buurt.items.length;
      state.config.buurt.items = state.config.buurt.items.filter((b) => !b.bronId || !b.datum || b.datum >= vandaag);
      if (state.config.buurt.items.length !== voor) raaktConfig = true;
      result = { nieuw };
      break;
    }

    /* ---------- personeel ---------- */
    case 'melding': {
      const m = state.live.meldingen.find((x) => x.id === a.id);
      if (!m) fout('Deze melding bestaat niet meer.', 'melding');
      if (!['nieuw', 'onderweg', 'klaar'].includes(a.status)) fout('Ongeldige status.', 'status');
      const door = tekst(a.door, 40);
      if (m.status === 'geannuleerd') fout('De klant heeft dit intussen geannuleerd.', 'geannuleerd');
      if (a.status === 'onderweg' && m.status === 'onderweg' && m.door && door && m.door !== door) fout(m.door + ' is al onderweg.', 'bezet');
      if (a.status === 'onderweg' && m.status === 'klaar') fout('Dit is al afgehandeld' + (m.door ? ' door ' + m.door : '') + '.', 'klaar');
      if (a.status !== 'nieuw') reageer(state, m, now, door);
      m.status = a.status;
      if (a.status === 'klaar') m.afgehandeld = now;
      if (a.status === 'nieuw') { delete m.door; delete m.afgehandeld; }
      result = m;
      break;
    }
    case 'aan-tafel': {
      // Een ober tikt de clip aan: openstaande oproepen van die tafel zijn afgehandeld.
      const t = tafelVan(state, a);
      const open = state.live.meldingen.filter((m) => m.tafel === t.id && ['ober', 'afrekenen'].includes(m.soort) && OPEN(m));
      open.forEach((m) => { reageer(state, m, now, tekst(a.door, 40)); m.status = 'klaar'; m.afgehandeld = now; m.aanTafel = true; });
      result = { afgevinkt: open.length };
      if (!open.length) raaktLive = false;
      break;
    }
    case 'opruimen': {
      state.live.meldingen = state.live.meldingen.filter(OPEN);
      break;
    }

    /* ---------- eigenaar ---------- */
    case 'voorstel': {
      const i = state.live.voorstellen.findIndex((v) => v.id === a.id);
      if (i < 0) fout('Dit voorstel bestaat niet meer.', 'voorstel');
      const [v] = state.live.voorstellen.splice(i, 1);
      if (a.keuze === 'ok') {
        state.config.buurt.items.push({ id: uid(), bronId: v.bronId, titel: v.titel, plaats: v.plaats, tekst: v.tekst, datum: v.datum, tijd: v.tijd, link: v.link, aan: true });
        raaktConfig = true;
      } else {
        state.live.geweigerd = [v.bronId, ...state.live.geweigerd].slice(0, 500);
      }
      break;
    }
    case 'koppel-start': {
      const t = tafelVan(state, a);
      state.live.koppelen = { tafel: t.id, tot: now + 3 * 60e3 };
      break;
    }
    case 'koppel-stop': { state.live.koppelen = null; break; }
    case 'config': {
      const c = a.config;
      if (!c || typeof c !== 'object' || !c.cafe || !Array.isArray(c.tafels) || !c.ober || !c.afrekenen || !c.verzoekjes || !c.mededelingen || !c.buurt || !c.uren || !Array.isArray(c.uren.dagen) || c.uren.dagen.length !== 7) fout('Ongeldige instellingen.', 'config');
      if (JSON.stringify(c).length > 1500000) fout('De instellingen zijn te groot. Kies een kleiner logo.', 'groot');
      if (c.cafe.logo && !/^data:image\/(png|jpeg|webp);base64,/.test(c.cafe.logo)) fout('Dit logo kan niet gebruikt worden. Kies een png- of jpg-bestand.', 'logo');
      for (const m of c.mededelingen.items || []) {
        if (m.afbeelding && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(m.afbeelding)) fout('Deze afbeelding kan niet gebruikt worden. Kies een png-, jpg- of gif-bestand.', 'logo');
      }
      const ids = new Set();
      for (const t of c.tafels) {
        t.id = tekst(t.id, 20); t.naam = tekst(t.naam, 40) || ('Tafel ' + t.id);
        if (!t.id || ids.has(t.id)) fout('Elke tafel heeft een unieke code nodig.', 'tafel');
        ids.add(t.id);
      }
      const VOLGORDE_KEYS = ['acties', 'wifi', 'mededelingen', 'buurt', 'sociaal'];
      if (Array.isArray(c.volgorde) && !c.volgorde.includes('sociaal')) c.volgorde = [...c.volgorde, 'sociaal'];
      if (!Array.isArray(c.volgorde) || c.volgorde.length !== VOLGORDE_KEYS.length
        || new Set(c.volgorde).size !== VOLGORDE_KEYS.length || !c.volgorde.every((k) => VOLGORDE_KEYS.includes(k))) {
        fout('Ongeldige volgorde.', 'config');
      }
      if (!c.theme || !/^#[0-9a-fA-F]{6}$/.test(c.theme.kleurPrimair) || !/^#[0-9a-fA-F]{6}$/.test(c.theme.kleurAccent)
        || !['inter', 'gochi', 'systeem'].includes(c.theme.lettertype) || !['normaal', 'compact', 'minimaal'].includes(c.theme.banner)
        || typeof c.theme.logoGrootte !== 'number' || c.theme.logoGrootte < 50 || c.theme.logoGrootte > 200) {
        fout('Ongeldige thema-instelling.', 'config');
      }
      state.config = { ...c, adminPin: state.config.adminPin, rev: state.config.rev };
      raaktConfig = true; raaktLive = false;
      break;
    }
    case 'pin': {
      const huidig = String(a.huidig || '');
      if (huidig !== state.config.adminPin) fout('Je huidige wachtwoord klopt niet.', 'huidig');
      const p = String(a.nieuw || '').trim();
      if (!/^(?=.*[a-zA-Z])(?=.*[0-9]).{8,72}$/.test(p)) fout('Een wachtwoord heeft minstens 8 tekens, met zowel letters als cijfers.', 'pin');
      state.config.adminPin = p;
      raaktConfig = true; raaktLive = false;
      break;
    }
    case 'reset': {
      const vers = defaultState(now);
      vers.config.adminPin = state.config.adminPin;
      vers.config.rev = state.config.rev;
      vers.live.rev = state.live.rev;
      state.config = vers.config; state.live = vers.live;
      raaktConfig = true;
      break;
    }
    default:
      fout('Onbekende actie.', 'actie');
  }

  if (raaktConfig) state.config.rev = (state.config.rev || 0) + 1;
  if (raaktLive) state.live.rev = (state.live.rev || 0) + 1;
  return { state, result };
}
