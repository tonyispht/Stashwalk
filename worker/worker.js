// Stashwalk shared-world backend: one Cloudflare Worker + one free D1 (SQLite) database.
// Stores a flat key/value table; the game talks to it through db.js. See README.md for setup.
//
// Bindings/variables needed:
//   DB               (D1 database binding)
//   ALLOWED_ORIGINS  (text, comma separated, e.g. https://tonyispht.github.io)  - only these sites may call the Worker

const TOP = new Set(['users', 'players', 'chests', 'cells', 'invites']);
const SEG = /^[A-Za-z0-9_-]{1,64}$/;
const ITEM_ID = /^\d{1,3}_[0-4]$/;
let ready = false;

const json = (obj, status, cors) => new Response(JSON.stringify(obj), {
  status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors)
});
async function init(db) {
  if (ready) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS kv (path TEXT PRIMARY KEY, val TEXT NOT NULL, v INTEGER NOT NULL DEFAULT 1)').run();
  ready = true;
}
const segsOf = p => p.split('/').filter(Boolean);
const goodPath = segs => segs.length >= 2 && segs.length <= 3 && TOP.has(segs[0]) && segs.every(s => SEG.test(s));
function same(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

async function verify(env, user, hash) {
  user = String(user || '').toLowerCase(); if (!SEG.test(user) || !hash) return null;
  const row = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('users/' + user).first();
  if (!row) return null;
  try { return same(JSON.parse(row.val).hash, String(hash)) ? user : null; } catch (e) { return null; }
}
function tree(rows, prefix) {                      // rebuild nested object from child rows
  const out = {};
  for (const r of rows) {
    const rel = r.path.slice(prefix.length + 1).split('/'); let o = out;
    rel.slice(0, -1).forEach(k => { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; });
    try { o[rel[rel.length - 1]] = JSON.parse(r.val); } catch (e) {}
  }
  return out;
}
function validate(segs, value) {
  const top = segs[0], isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  if (top === 'users') {
    if (segs.length !== 2 || !isObj(value)) return false;
    return /^[A-Za-z0-9_-]{3,16}$/.test(value.name || '') && value.name.toLowerCase() === segs[1] &&
      typeof value.salt === 'string' && value.salt.length <= 64 && typeof value.hash === 'string' && value.hash.length <= 128;
  }
  if (top === 'players') return segs.length === 2 && isObj(value);
  if (top === 'invites') return segs.length === 2 && Number.isInteger(value) && value >= 0 && value < 1e6;
  if (top === 'cells') return segs.length === 3 && isObj(value) && typeof value.name === 'string' && value.name.length <= 60 &&
    Number.isFinite(value.lat) && Number.isFinite(value.lon) && typeof value.kind === 'string' && value.kind.length <= 16;
  if (top === 'chests') {
    if (segs.length !== 2 || !isObj(value) || !isObj(value.items)) return false;
    const slots = Object.keys(value.items); if (slots.length < 1 || slots.length > 8) return false;
    return slots.every(s => /^[a-h]$/.test(s) && isObj(value.items[s]) && ITEM_ID.test(String(value.items[s].id)) &&
      (value.items[s].by === undefined || (typeof value.items[s].by === 'string' && value.items[s].by.length <= 16)));
  }
  return false;
}
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
function osmKind(t) {
  if (t.tourism === 'camp_site') return 'camp'; if (t.tourism === 'picnic_site' || t.leisure === 'picnic_table') return 'picnic';
  if (t.tourism === 'viewpoint') return 'view'; if (t.natural === 'peak') return 'peak'; if (t.leisure === 'playground') return 'play';
  if (t.leisure === 'fire_pit' || t.amenity === 'bbq') return 'fire'; if (t.amenity === 'shelter') return 'shelter';
  if (t.leisure === 'nature_reserve') return 'reserve'; return 'park';
}
const KIND_NAME = { camp: 'Campsite', picnic: 'Picnic Spot', view: 'Viewpoint', peak: 'Summit', play: 'Playground', fire: 'Fire Ring', shelter: 'Trail Shelter', reserve: 'Nature Reserve', park: 'Park' };
async function osmFetch(lat, lon) {
  const a = `(around:6000,${lat},${lon})`, b = `(around:28000,${lat},${lon})`;
  const q = `[out:json][timeout:20];(nwr${a}[tourism~"camp_site|picnic_site|viewpoint"];nwr${a}[leisure~"park|playground|picnic_table|fire_pit|nature_reserve"];nwr${a}[amenity~"shelter|bbq"];nwr${a}[natural=peak];` +
    `nwr${b}[tourism=camp_site];nwr${b}[leisure=nature_reserve][name];nwr${b}[natural=peak][name];);out center 220;`;
  for (const ep of OVERPASS) {
    try {
      const r = await fetch(ep + '?data=' + encodeURIComponent(q), { cf: { cacheTtl: 604800, cacheEverything: true } });
      if (!r.ok) continue;
      const j = await r.json(); if (!j || !j.elements) continue;
      const out = [];
      for (const el of j.elements) {
        const la = el.lat != null ? el.lat : el.center && el.center.lat, lo = el.lon != null ? el.lon : el.center && el.center.lon;
        if (la == null || lo == null) continue;
        const t = el.tags || {}, k = osmKind(t);
        out.push({ id: 'osm_' + el.type[0] + el.id, name: String(t.name || KIND_NAME[k] || 'Park').slice(0, 60), lat: la, lon: lo, kind: k });
        if (out.length >= 220) break;
      }
      if (out.length) return out;
    } catch (e) {}
  }
  return null;
}
const limit = { users: 600, players: 60000, invites: 20, cells: 400, chests: 3000 };

export default {
  async fetch(req, env) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const okOrigin = !origin || allowed.length === 0 || allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = { 'Access-Control-Allow-Origin': okOrigin && origin ? origin : 'null', 'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
                   'Access-Control-Allow-Headers': 'Content-Type,X-User,X-Hash', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!okOrigin) return json({ error: 'origin not allowed' }, 403, cors);
    if (!env.DB) return json({ error: 'D1 binding "DB" is missing' }, 500, cors);
    try {
      await init(env.DB);
      if (url.pathname === '/' ) return json({ ok: true, app: 'stashwalk' }, 200, cors);

      if (url.pathname === '/verify' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        return json({ ok: !!(await verify(env, b.user, b.hash)) }, 200, cors);
      }

      // Park/campground lookup, proxied + cached so players never hit the slow public API directly.
      if (url.pathname === '/osm' && req.method === 'GET') {
        const lat = +url.searchParams.get('lat'), lon = +url.searchParams.get('lon');
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'bad coords' }, 400, cors);
        // Snap to a ~11km grid so everyone in an area shares one cached answer.
        const cl = Math.round(lat * 10) / 10, co = Math.round(lon * 10) / 10, ck = 'osm/' + cl.toFixed(1) + '_' + co.toFixed(1);
        const hit = await env.DB.prepare('SELECT val, v FROM kv WHERE path = ?').bind(ck).first();
        if (hit && Date.now() - hit.v < 30 * 86400000) return json({ value: JSON.parse(hit.val), cached: true }, 200, cors);
        const list = await osmFetch(cl, co);
        if (!list) return json(hit ? { value: JSON.parse(hit.val), cached: true, stale: true } : { error: 'park data unavailable' }, hit ? 200 : 503, cors);
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = excluded.v')
          .bind(ck, JSON.stringify(list), Date.now()).run();
        return json({ value: list, cached: false }, 200, cors);
      }

      if (url.pathname === '/many' && req.method === 'GET') {          // batched read of hidden-chest index cells
        const keys = (url.searchParams.get('keys') || '').split(',').filter(k => /^-?\d+_-?\d+$/.test(k)).slice(0, 25);
        if (!keys.length) return json({ value: {} }, 200, cors);
        const sql = 'SELECT path, val FROM kv WHERE ' + keys.map(() => 'path LIKE ?').join(' OR ') + ' LIMIT 3000';
        const { results } = await env.DB.prepare(sql).bind(...keys.map(k => 'cells/' + k + '/%')).all();
        const out = {}; keys.forEach(k => { out[k] = tree(results.filter(r => r.path.startsWith('cells/' + k + '/')), 'cells/' + k); });
        return json({ value: out }, 200, cors);
      }

      if (url.pathname.startsWith('/kv/')) {
        const segs = segsOf(decodeURIComponent(url.pathname.slice(4))); if (!goodPath(segs)) return json({ error: 'bad path' }, 400, cors);
        const path = segs.join('/');

        if (req.method === 'GET') {
          const row = await env.DB.prepare('SELECT val, v FROM kv WHERE path = ?').bind(path).first();
          if (row) {
            let value = JSON.parse(row.val);
            if (segs[0] === 'users' && segs.length === 2) value = { name: value.name, salt: value.salt };   // never expose password hashes
            return json({ value, v: row.v }, 200, cors);
          }
          const { results } = await env.DB.prepare('SELECT path, val FROM kv WHERE path LIKE ? LIMIT 3000').bind(path + '/%').all();
          return json({ value: results.length ? tree(results, path) : null, v: 0 }, 200, cors);
        }

        if (req.method === 'PUT') {
          const raw = await req.text(); if (raw.length > (limit[segs[0]] || 1000) + 200) return json({ error: 'too large' }, 413, cors);
          let body; try { body = JSON.parse(raw); } catch (e) { return json({ error: 'bad json' }, 400, cors); }
          const value = body.value, ifv = body.ifv;
          if (!validate(segs, value)) return json({ error: 'invalid data' }, 400, cors);
          if (JSON.stringify(value).length > limit[segs[0]]) return json({ error: 'too large' }, 413, cors);

          if (segs[0] === 'users') {                                   // accounts can only be created, never overwritten
            const r = await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO NOTHING').bind(path, JSON.stringify(value)).run();
            return r.meta.changes ? json({ ok: true, v: 1 }, 200, cors) : json({ error: 'exists' }, 409, cors);
          }
          const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
          if (!me) return json({ error: 'not logged in' }, 401, cors);
          if (segs[0] === 'players' && segs[1] !== me) return json({ error: 'not your record' }, 403, cors);

          const str = JSON.stringify(value); let r;
          if (ifv === 0) r = await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO NOTHING').bind(path, str).run();
          else if (Number.isInteger(ifv)) r = await env.DB.prepare('UPDATE kv SET val = ?, v = v + 1 WHERE path = ? AND v = ?').bind(str, path, ifv).run();
          else r = await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1').bind(path, str).run();
          return r.meta.changes ? json({ ok: true }, 200, cors) : json({ error: 'version conflict' }, 409, cors);
        }
      }
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      return json({ error: 'server error' }, 500, cors);
    }
  }
};
