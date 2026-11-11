/* Hoofdingang van de Worker. Statische bestanden (index.html, css, js, …)
   worden automatisch door Cloudflare vanuit "public/" bediend; alleen wat
   daar niet bij past (/api/…) komt hier binnen en gaat naar de ene
   Durable Object die alle gegevens bewaart. */
export { GuidoStore } from './store.mjs';

function store(env) {
  const id = env.GUIDO_STORE.idFromName('main');
  return env.GUIDO_STORE.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return store(env).fetch(request);
    }
    return new Response('Niet gevonden.', { status: 404 });
  },

  /** Elk uur (zie [triggers] in wrangler.jsonc): events ophalen, teken van leven. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(store(env).onderhoudTaak());
  }
};
