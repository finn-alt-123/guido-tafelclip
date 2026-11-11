/* De Durable Object: één vaste "instantie" bewaart alle gegevens van het
   café. Cloudflare verwerkt binnen één instantie altijd één verzoek
   tegelijk — dat is precies de veilige-gelijktijdige-schrijfacties-garantie
   die we vroeger met Netlify Blobs' etags zelf moesten regelen. */
import { DurableObject } from 'cloudflare:workers';
import { routeApi } from './routes.mjs';
import { onderhoud, noteerFout } from './kern.mjs';

export class GuidoStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async fetch(request) {
    return routeApi(this.ctx.storage, this.env, request);
  }

  /** Wordt elk uur aangeroepen door de cron trigger in index.mjs. */
  async onderhoudTaak() {
    try { return await onderhoud(this.ctx.storage, this.env); }
    catch (e) { await noteerFout(this.ctx.storage, 'onderhoud', e); return { fout: String(e && e.message || e) }; }
  }
}
