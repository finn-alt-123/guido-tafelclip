/* ============================================================
   Events in de buurt automatisch ophalen
   - UiTdatabank (publiq) Search API — de officiële agenda van Vlaanderen
   - Agenda-links (.ics) van bevriende zaken, bv. Google Agenda
   ============================================================ */
const UIT = () => process.env.UIT_API_BASE || 'https://search.uitdatabank.be';

const tz = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function brussel(d) {
  const p = Object.fromEntries(tz.formatToParts(d).map((x) => [x.type, x.value]));
  return { datum: `${p.year}-${p.month}-${p.day}`, tijd: `${p.hour}:${p.minute}` };
}
const kort = (t, n = 200) => {
  const s = String(t || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
};
const nl = (v) => (v && typeof v === 'object' ? v.nl || v.en || Object.values(v)[0] : v) || '';

/* ---------- UiTdatabank ---------- */
export async function uitEvents({ sleutel, postcode = '9000', soorten = '', dagen = 7, nu = Date.now() }) {
  const van = new Date(nu).toISOString();
  const tot = new Date(nu + dagen * 864e5).toISOString();
  const q = new URLSearchParams({ embed: 'true', postalCode: postcode, dateFrom: van, dateTo: tot, limit: '50' });
  let r = await fetch(UIT() + '/events?' + q, { headers: { 'x-api-key': sleutel, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (r.status === 401 || r.status === 403) r = await fetch(UIT() + '/events?' + q, { headers: { 'x-client-id': sleutel, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('UiTdatabank antwoordde ' + r.status + (r.status === 401 || r.status === 403 ? ' (sleutel klopt niet?)' : ''));
  const j = await r.json();
  const filters = String(soorten || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const ev of j.member || []) {
    const termen = (ev.terms || []).map((t) => String(t.label || '').toLowerCase()).join(' ');
    const naam = nl(ev.name);
    if (filters.length && !filters.some((f) => termen.includes(f) || naam.toLowerCase().includes(f))) continue;
    // eerste datum binnen het venster (ook bij reeksen)
    const momenten = (ev.subEvent && ev.subEvent.length ? ev.subEvent : [ev]).map((s) => Date.parse(s.startDate)).filter((t) => t >= nu - 3 * 3600e3 && t <= nu + dagen * 864e5).sort((a, b) => a - b);
    if (!momenten.length || ev.calendarType === 'permanent') continue;
    const { datum, tijd } = brussel(new Date(momenten[0]));
    const id = String(ev['@id'] || '').split('/').pop();
    out.push({
      bron: 'UiTdatabank', bronId: 'uit:' + id, titel: kort(naam, 80),
      plaats: kort(nl(ev.location && ev.location.name), 80), tekst: kort(nl(ev.description), 200),
      datum, tijd, link: id ? 'https://www.uitinvlaanderen.be/agenda/e/-/' + id : ''
    });
  }
  return out;
}

/* ---------- ICS (Google Agenda, Outlook, …) ---------- */
function icsDatum(waarde, params) {
  const v = String(waarde).trim();
  if (/^\d{8}$/.test(v)) return { datum: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, tijd: '', ts: Date.parse(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T12:00:00Z`) };
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`;
  if (m[7]) { const d = new Date(iso + 'Z'); return { ...brussel(d), ts: d.getTime() }; }
  // lokale tijd (TZID of zwevend): we nemen Brusselse tijd aan
  return { datum: iso.slice(0, 10), tijd: iso.slice(11, 16), ts: Date.parse(iso + '+01:00') };
}
const icsTekst = (s) => String(s || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');

export function leesIcs(tekst, { bron = 'Agenda', dagen = 7, nu = Date.now() } = {}) {
  const regels = String(tekst).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out = []; let ev = null;
  for (const r of regels) {
    if (r === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (r === 'END:VEVENT') {
      if (ev && ev.DTSTART && ev.SUMMARY) {
        const d = icsDatum(ev.DTSTART.v, ev.DTSTART.p);
        if (d && d.ts >= nu - 3 * 3600e3 && d.ts <= nu + dagen * 864e5 && !(ev.STATUS && /CANCELLED/i.test(ev.STATUS.v))) {
          out.push({ bron, bronId: 'ics:' + (ev.UID ? ev.UID.v : ev.SUMMARY.v + d.datum), titel: kort(icsTekst(ev.SUMMARY.v), 80), plaats: kort(icsTekst(ev.LOCATION ? ev.LOCATION.v : ''), 80), tekst: kort(icsTekst(ev.DESCRIPTION ? ev.DESCRIPTION.v : ''), 200), datum: d.datum, tijd: d.tijd, link: ev.URL ? ev.URL.v.trim() : '' });
        }
      }
      ev = null; continue;
    }
    if (!ev) continue;
    const i = r.indexOf(':'); if (i < 0) continue;
    const [naam, ...params] = r.slice(0, i).split(';');
    ev[naam.toUpperCase()] = { v: r.slice(i + 1), p: params };
  }
  return out;
}

export async function icsEvents({ url, naam, dagen, nu }) {
  const u = String(url).replace(/^webcal:/i, 'https:');
  if (!/^https:\/\//i.test(u)) throw new Error('Een agenda-link moet met https:// beginnen.');
  const r = await fetch(u, { signal: AbortSignal.timeout(15000), headers: { accept: 'text/calendar, text/plain' } });
  if (!r.ok) throw new Error(`${naam || 'Agenda'}: antwoordde ${r.status}`);
  const t = await r.text();
  if (t.length > 3e6) throw new Error(`${naam || 'Agenda'}: bestand te groot`);
  return leesIcs(t, { bron: naam || 'Agenda', dagen, nu });
}
