// Stashwalk shared-world backend: one Cloudflare Worker + one free D1 (SQLite) database.
// Stores a flat key/value table; the game talks to it through db.js. See README.md for setup.
//
// Bindings/variables needed:
//   DB               (D1 database binding)
//   ALLOWED_ORIGINS  (text, comma separated, e.g. https://tonyispht.github.io)  - only these sites may call the Worker

const TOP = new Set(['users', 'players', 'chests', 'cells', 'invites', 'feed']);
const FLAGS_TO_REMOVE = 3;   // distinct players who must flag a chest before it is dropped
const SEG = /^[A-Za-z0-9_-]{1,64}$/;
const ITEM_ID = /^(\d{1,3}_[0-4]|c\d{1,3})$/;   // base items, or crafted relics (c0, c1, ...)
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
const KINDS = new Set(['camp', 'picnic', 'view', 'peak', 'play', 'fire', 'shelter', 'reserve', 'park', 'landmark']);
const CELL_DEG = 0.1;                                  // ~11 km grid
const osmCell = (lat, lon) => (Math.round(lat / CELL_DEG) * CELL_DEG).toFixed(1) + '_' + (Math.round(lon / CELL_DEG) * CELL_DEG).toFixed(1);
// Players' devices supply this data, so check every record before storing it for everyone else.
function cleanPlaces(places, cell) {
  if (!Array.isArray(places) || !places.length || places.length > 400) return null;
  const parts = cell.split('_'), cLat = +parts[0], cLon = +parts[1];
  if (!Number.isFinite(cLat) || !Number.isFinite(cLon)) return null;
  // Everything must sit in or near the cell it claims, so nobody can scatter chests wherever they like.
  const latPad = 0.35, lonPad = 0.35 / Math.max(0.2, Math.cos(cLat * Math.PI / 180));
  const seen = new Set(), out = [];
  for (const p of places) {
    if (!p || typeof p !== 'object') continue;
    const id = String(p.id || ''), name = String(p.name || ''), lat = +p.lat, lon = +p.lon, kind = String(p.kind || '');
    if (!/^osm_[nwr]\d{1,12}$/.test(id) || seen.has(id)) continue;
    if (!name || name.length > 60) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat - cLat) > latPad || Math.abs(lon - cLon) > lonPad) continue;
    if (!KINDS.has(kind)) continue;
    seen.add(id);
    out.push({ id, name, lat: +lat.toFixed(5), lon: +lon.toFixed(5), kind });
    if (out.length >= 400) break;
  }
  return out.length ? out : null;
}

// The feed is written by the server only, from what actually changed in a chest, so an
// event cannot be forged by a client claiming "someone took your item".
async function pushFeed(env, user, ev) {
  const key = String(user || '').toLowerCase();
  if (!SEG.test(key)) return;
  const row = await env.DB.prepare('SELECT val, v FROM kv WHERE path = ?').bind('feed/' + key).first();
  let list = [];
  if (row) { try { list = JSON.parse(row.val) || []; } catch (e) { list = []; } }
  list.unshift(ev);
  if (list.length > 30) list.length = 30;
  await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1')
    .bind('feed/' + key, JSON.stringify(list)).run();
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
      // Park/campground lookup. Cloudflare cannot reach the OpenStreetMap query service (datacenter
      // IPs are blocked there), so players fetch it on their own connection and POST the result back.
      // After the first player visits an area, everyone else is served from this database instantly.
      if (url.pathname === '/osm' && req.method === 'GET') {
        const lat = +url.searchParams.get('lat'), lon = +url.searchParams.get('lon');
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'bad coords' }, 400, cors);
        const cell = osmCell(lat, lon);
        const hit = await env.DB.prepare('SELECT val, v FROM kv WHERE path = ?').bind('osm/' + cell).first();
        if (hit) return json({ value: JSON.parse(hit.val), cell, cached: true, refresh: Date.now() - hit.v > 30 * 86400000 }, 200, cors);
        return json({ value: null, cell, cached: false, refresh: true }, 200, cors);
      }

      // A player sends back what their own device found for one grid cell.
      if (url.pathname === '/osm' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const raw = await req.text(); if (raw.length > 120000) return json({ error: 'too large' }, 413, cors);
        let body; try { body = JSON.parse(raw); } catch (e) { return json({ error: 'bad json' }, 400, cors); }
        const cell = String(body.cell || '');
        if (!/^-?\d{1,3}\.\d_-?\d{1,3}\.\d$/.test(cell)) return json({ error: 'bad cell' }, 400, cors);
        const clean = cleanPlaces(body.places, cell);
        if (!clean) return json({ error: 'bad places' }, 400, cors);
        const prev = await env.DB.prepare('SELECT val, v FROM kv WHERE path = ?').bind('osm/' + cell).first();
        // First good answer for an area wins; later ones must be fresher or fuller to replace it.
        if (prev) {
          const old = JSON.parse(prev.val);
          if (Date.now() - prev.v < 30 * 86400000 && clean.length <= old.length) return json({ ok: true, kept: 'existing', count: old.length }, 200, cors);
        }
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = excluded.v')
          .bind('osm/' + cell, JSON.stringify(clean), Date.now()).run();
        return json({ ok: true, stored: clean.length, cell }, 200, cors);
      }

      // The invited player's own client calls this once they have opened their first chest.
      if (url.pathname === '/refer' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const already = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('refer/' + me).first();
        if (already) return json({ ok: true, counted: false, reason: 'already counted' }, 200, cors);
        const prow = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('players/' + me).first();
        if (!prow) return json({ error: 'no player record' }, 400, cors);
        let p; try { p = JSON.parse(prow.val); } catch (e) { return json({ error: 'bad record' }, 400, cors); }
        const ref = String(p.ref || '').toLowerCase();
        if (!ref || !SEG.test(ref) || ref === me) return json({ ok: true, counted: false, reason: 'no referrer' }, 200, cors);
        const visited = p.stats && p.stats.visited ? Object.keys(p.stats.visited).length : 0;
        if (visited < 1) return json({ ok: true, counted: false, reason: 'no chest opened yet' }, 200, cors);
        const refUser = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('users/' + ref).first();
        if (!refUser) return json({ ok: true, counted: false, reason: 'referrer not found' }, 200, cors);
        // mark this player as counted first, so a double call cannot pay twice
        const mark = await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO NOTHING')
          .bind('refer/' + me, JSON.stringify(ref)).run();
        if (!mark.meta.changes) return json({ ok: true, counted: false, reason: 'already counted' }, 200, cors);
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = CAST(CAST(kv.val AS INTEGER) + 1 AS TEXT), v = kv.v + 1')
          .bind('invites/' + ref, '1').run();
        const row = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('invites/' + ref).first();
        return json({ ok: true, counted: true, referrer: ref, total: row ? JSON.parse(row.val) : 1 }, 200, cors);
      }

      // Chests the community has flagged often enough to drop.
      if (url.pathname === '/blocked' && req.method === 'GET') {
        const { results } = await env.DB.prepare("SELECT path FROM kv WHERE path LIKE 'block/%' LIMIT 3000").all();
        return json({ value: results.map(r => r.path.slice(6)) }, 200, cors);
      }

      if (url.pathname === '/flag' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const b = await req.json().catch(() => ({}));
        const chest = String(b.chest || ''), cell = String(b.cell || '');
        if (!SEG.test(chest)) return json({ error: 'bad chest' }, 400, cors);
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO NOTHING')
          .bind('flagv/' + chest + '/' + me, '1').run();
        const c = await env.DB.prepare("SELECT count(*) AS n FROM kv WHERE path LIKE ?").bind('flagv/' + chest + '/%').first();
        const n = (c && c.n) || 0;
        let removed = false;
        if (n >= FLAGS_TO_REMOVE) {
          await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO NOTHING').bind('block/' + chest, '1').run();
          if (/^-?\d+_-?\d+$/.test(cell)) await env.DB.prepare('DELETE FROM kv WHERE path = ?').bind('cells/' + cell + '/' + chest).run();
          await env.DB.prepare('DELETE FROM kv WHERE path = ?').bind('chests/' + chest).run();
          removed = true;
        }
        return json({ ok: true, flags: n, needed: FLAGS_TO_REMOVE, removed }, 200, cors);
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
          if (segs[0] === 'invites' || segs[0] === 'feed') return json({ error: 'set by the server only' }, 403, cors);
          const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
          if (!me) return json({ error: 'not logged in' }, 401, cors);
          if (segs[0] === 'players' && segs[1] !== me) return json({ error: 'not your record' }, 403, cors);

          // Keep the previous chest so we can tell whose item just left it.
          let prevChest = null;
          if (segs[0] === 'chests') {
            const pr = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind(path).first();
            if (pr) { try { prevChest = JSON.parse(pr.val); } catch (e) {} }
          }
          const str = JSON.stringify(value); let r;
          if (ifv === 0) r = await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO NOTHING').bind(path, str).run();
          else if (Number.isInteger(ifv)) r = await env.DB.prepare('UPDATE kv SET val = ?, v = v + 1 WHERE path = ? AND v = ?').bind(str, path, ifv).run();
          else r = await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1').bind(path, str).run();
          if (!r.meta.changes) return json({ error: 'version conflict' }, 409, cors);
          if (prevChest && prevChest.items && value.items) {
            const where = String(value.name || prevChest.name || '').slice(0, 52);
            for (const slot of Object.keys(prevChest.items)) {
              const was = prevChest.items[slot], now = value.items[slot];
              if (!was || !was.by || !now || now.id === was.id) continue;
              if (String(was.by).toLowerCase() === me) continue;          // you took back your own
              await pushFeed(env, was.by, { t: Date.now(), k: 'taken', item: String(was.id), got: String(now.id), by: String(now.by || me).slice(0, 16), where });
            }
          }
          return json({ ok: true }, 200, cors);
        }
      }
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      return json({ error: 'server error' }, 500, cors);
    }
  }
};
