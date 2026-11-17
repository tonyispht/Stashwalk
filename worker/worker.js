// Stashwalk shared-world backend: one Cloudflare Worker + one free D1 (SQLite) database.
// Stores a flat key/value table; the game talks to it through db.js. See README.md for setup.
//
// Bindings/variables needed:
//   DB               (D1 database binding)
//   ALLOWED_ORIGINS  (text, comma separated, e.g. https://tonyispht.github.io)  - only these sites may call the Worker
//   ADMIN_USERS      (optional text, comma separated) - accounts that can see the admin stats; defaults to TonyIspht

const TOP = new Set(['users', 'players', 'chests', 'cells', 'invites', 'feed']);
const FLAGS_TO_REMOVE = 3;   // distinct players who must flag a chest before it is dropped
const SEG = /^[A-Za-z0-9_-]{1,64}$/;
const TEAMS = new Set(['ember', 'tide', 'grove']);
const TEAM_COOLDOWN = 7 * 86400000;        // switch teams at most once a week
const FIELD_RE = /^([A-Z]{2}|g-?\d{1,2}_-?\d{1,3})$/;   // a US state code, or a ~5° grid sector elsewhere
const ITEM_ID = /^(\d{1,3}_[0-4]|c\d{1,3}|sh[0-4])$/;   // base items, crafted relics (c0, c1, ...) or shields (sh0-sh4)
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
    const optStr = (v, max) => v === undefined || (typeof v === 'string' && v.length <= max);
    return /^[A-Za-z0-9_-]{3,16}$/.test(value.name || '') && value.name.toLowerCase() === segs[1] &&
      typeof value.salt === 'string' && value.salt.length <= 64 && typeof value.hash === 'string' && value.hash.length <= 128 &&
      optStr(value.rsalt, 64) && optStr(value.rhash, 128);
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

// ---- admin ----
// Only the server knows every account, so the admin numbers are worked out here. Who counts
// as admin is decided here too - the game's own check only decides whether to show the panel.
const adminsOf = env => new Set(String(env.ADMIN_USERS || 'tonyispht').toLowerCase().split(',').map(s => s.trim()).filter(Boolean));
const ONLINE_MS = 150000;          // seen in the last 2.5 minutes = online (the game pings once a minute)
function seenOf(val) {
  try { const o = JSON.parse(val); if (o && typeof o === 'object') return { t: +o.t || 0, lat: o.lat, lon: o.lon }; return { t: +o || 0 }; }
  catch (e) { return { t: +val || 0 }; }
}
const nameOfUser = async (env, key) => { try { const u = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('users/' + key).first(); return u ? (JSON.parse(u.val).name || key) : key; } catch (e) { return key; } };
async function requireAdmin(env, req) {
  const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
  if (!me) return { err: 401, msg: 'not logged in' };
  if (!adminsOf(env).has(me)) return { err: 403, msg: 'not an admin' };
  return { me };
}
const AWAY_MS = 10 * 60000;        // back after this long counts as "came online" again
async function adminEvent(env, ev) {
  const row = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('admin/events').first();
  let list = [];
  if (row) { try { list = JSON.parse(row.val) || []; } catch (e) { list = []; } }
  list.unshift(ev);
  if (list.length > 600) list.length = 600;
  await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1')
    .bind('admin/events', JSON.stringify(list)).run();
}

// ---- shields & towers -------------------------------------------------------------------
// shield/<target> = { team, r, hp, max, by, at, lat, lon, kind }   target = chest id or tower id
// tower/<id>      = { id, team, lat, lon, by, user, at }
const SHIELD_HP = [1, 2, 3, 5, 8], TOWER_MAX = 3, TOWER_GAP_M = 1000;
const teamOfUser = async (env, me) => { const t = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('team/' + me).first(); try { const v = t && JSON.parse(t.val).team; return TEAMS.has(v) ? v : null; } catch (e) { return null; } };
// An enemy shield on the target takes the hit instead: returns its state, or null when nothing shields it.
async function shieldHit(env, target, attackerTeam) {
  const row = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('shield/' + target).first();
  if (!row) return null;
  let sh; try { sh = JSON.parse(row.val); } catch (e) { return null; }
  if (!sh || sh.team === attackerTeam || !(sh.hp > 0)) return null;
  sh.hp -= 1;
  if (sh.hp <= 0) await env.DB.prepare('DELETE FROM kv WHERE path = ?').bind('shield/' + target).run();
  else await env.DB.prepare('UPDATE kv SET val = ?, v = v + 1 WHERE path = ?').bind(JSON.stringify(sh), 'shield/' + target).run();
  return { hp: Math.max(0, sh.hp), max: sh.max, r: sh.r, team: sh.team, gone: sh.hp <= 0 };
}
const geoM = (a, b) => { const rad = Math.PI / 180, dLa = (b.lat - a.lat) * rad, dLo = (b.lon - a.lon) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLo / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };

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

      // ---- presence & admin --------------------------------------------------------
      // The game pings once a minute while it is open. Coming back after ten minutes away is
      // recorded as an "online" event for the admin.
      if (url.pathname === '/ping' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const now = Date.now();
        const b = await req.json().catch(() => ({}));
        const row = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('seen/' + me).first();
        const prev = row ? seenOf(row.val).t : 0;
        const rec = { t: now };
        const lat = +b.lat, lon = +b.lon;
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { rec.lat = Math.round(lat * 1000) / 1000; rec.lon = Math.round(lon * 1000) / 1000; }
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1')
          .bind('seen/' + me, JSON.stringify(rec)).run();
        if (!prev || now - prev > AWAY_MS) {
          let name = me, created = 0;
          try { const u = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('users/' + me).first(); if (u) { const o = JSON.parse(u.val); name = o.name || me; created = o.created || 0; } } catch (e) {}
          // a brand-new account already announced itself with its sign-up
          if (!(created && now - created < 5 * 60000)) await adminEvent(env, { k: 'online', u: String(name).slice(0, 16), t: now });
        }
        return json({ ok: true, admin: adminsOf(env).has(me) }, 200, cors);
      }

      // ---- leaderboards ----------------------------------------------------------------
      // Players submit their own cumulative stats; the board is computed here. lb/<user> is not
      // reachable through /kv (it is not a top-level collection), so only this endpoint writes it.
      if (url.pathname === '/lb/submit' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const b = await req.json().catch(() => ({}));
        const num = (v, max) => Math.max(0, Math.min(max, Math.round(+v || 0)));
        const rec = { name: (await nameOfUser(env, me)).slice(0, 16),
          coins: num(b.coins, 1e9), miles: Math.max(0, Math.min(1e6, +b.miles || 0)), opened: num(b.opened, 1e6), dex: num(b.dex, 1e5),
          wk: num(b.wk, 1e6), wkCoins: num(b.wkCoins, 1e9), t: Date.now() };
        if (/^(#[0-9a-f]{6}|rainbow|gold)$/i.test(String(b.nc || ''))) rec.nc = String(b.nc);
        const bd = String(b.bd || ''); if (bd && bd.length <= 8 && !/[<>&"'\sA-Za-z0-9]/.test(bd)) rec.bd = bd;
        rec.miles = Math.round(rec.miles * 10) / 10;
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1')
          .bind('lb/' + me, JSON.stringify(rec)).run();
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === '/lb' && req.method === 'GET') {
        const metric = ['coins', 'miles', 'opened', 'dex'].includes(url.searchParams.get('metric')) ? url.searchParams.get('metric') : 'coins';
        const period = url.searchParams.get('period') === 'week' ? 'week' : 'all';
        const wk = Math.round(+url.searchParams.get('wk') || 0);
        const rows = (await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'lb/%' LIMIT 20000").all()).results;
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        let list = [];
        rows.forEach(r => { try { const o = JSON.parse(r.val); const v = period === 'week' ? (o.wk === wk ? o.wkCoins : 0) : o[metric]; list.push({ key: r.path.slice(3), name: o.name, v: v || 0, nc: o.nc, bd: o.bd }); } catch (e) {} });
        list = list.filter(x => x.v > 0).sort((a, b) => b.v - a.v);
        const rank = me ? (list.findIndex(x => x.key === me) + 1) : 0;
        const you = rank ? { rank, v: list[rank - 1].v, name: list[rank - 1].name } : null;
        return json({ metric, period, wk, total: list.length, top: list.slice(0, 100).map((x, i) => ({ rank: i + 1, name: x.name, v: x.v, nc: x.nc, bd: x.bd, me: x.key === me })), you }, 200, cors);
      }

      // ---- factions / teams ----------------------------------------------------------------
      // The server is the source of truth for a player's team and enforces the weekly switch
      // cooldown. team/<user> = { team, at }. Not reachable through /kv.
      if (url.pathname === '/team' && req.method === 'GET') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const row = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('team/' + me).first();
        let t = null; if (row) { try { t = JSON.parse(row.val); } catch (e) {} }
        return json({ team: t && t.team || null, at: t && t.at || 0, cooldownMs: TEAM_COOLDOWN }, 200, cors);
      }
      if (url.pathname === '/team/set' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const b = await req.json().catch(() => ({}));
        if (!TEAMS.has(String(b.team))) return json({ error: 'unknown team' }, 400, cors);
        const row = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('team/' + me).first();
        let cur = null; if (row) { try { cur = JSON.parse(row.val); } catch (e) {} }
        const now = Date.now();
        if (cur && cur.team && cur.team !== b.team && now - (cur.at || 0) < TEAM_COOLDOWN)
          return json({ error: 'cooldown', team: cur.team, at: cur.at, nextAt: (cur.at || 0) + TEAM_COOLDOWN }, 429, cors);
        const rec = { team: b.team, at: (cur && cur.team === b.team) ? (cur.at || now) : now };
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1')
          .bind('team/' + me, JSON.stringify(rec)).run();
        return json({ ok: true, team: rec.team, at: rec.at }, 200, cors);
      }

      // ---- control fields / cell scoring ---------------------------------------------------
      // Opening a new chest scores its map cell for the opener's team. cs/<cell>/<team> is a
      // counter. Reads are batched. Not reachable through /kv.
      if (url.pathname === '/cell/score' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const b = await req.json().catch(() => ({}));
        const cell = String(b.cell || '');
        if (!FIELD_RE.test(cell)) return json({ error: 'bad cell' }, 400, cors);
        const trow = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('team/' + me).first();
        let team = null; if (trow) { try { team = JSON.parse(trow.val).team; } catch (e) {} }
        if (!TEAMS.has(team)) return json({ ok: true, scored: false, reason: 'no team' }, 200, cors);
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = CAST(CAST(kv.val AS INTEGER) + 1 AS TEXT), v = kv.v + 1')
          .bind('cs/' + cell + '/' + team, '1').run();
        return json({ ok: true, scored: true, team }, 200, cors);
      }
      if (url.pathname === '/cells/scores' && req.method === 'GET') {
        const keys = (url.searchParams.get('cells') || '').split(',').filter(k => FIELD_RE.test(k)).slice(0, 80);
        if (!keys.length) return json({ value: {} }, 200, cors);
        const sql = 'SELECT path, val FROM kv WHERE ' + keys.map(() => 'path LIKE ?').join(' OR ') + ' LIMIT 4000';
        const { results } = await env.DB.prepare(sql).bind(...keys.map(k => 'cs/' + k + '/%')).all();
        const out = {};
        keys.forEach(k => { out[k] = {}; });
        results.forEach(r => { const seg = r.path.split('/'); const cell = seg[1], team = seg[2]; if (out[cell]) out[cell][team] = +r.val || 0; });
        return json({ value: out }, 200, cors);
      }
      // install a shield on a chest or one of your faction's towers
      if (url.pathname === '/shield/install' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const team = await teamOfUser(env, me); if (!team) return json({ error: 'join a faction first' }, 400, cors);
        const b = await req.json().catch(() => ({}));
        const target = String(b.target || ''), kind = b.kind === 'tower' ? 'tower' : 'chest', r = Math.floor(+b.r);
        if (!/^[a-z0-9_]{3,40}$/i.test(target) || !(r >= 0 && r <= 4)) return json({ error: 'bad shield' }, 400, cors);
        let lat = +b.lat, lon = +b.lon;
        if (kind === 'tower') {
          const tw = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('tower/' + target).first();
          if (!tw) return json({ error: 'no such tower' }, 404, cors);
          const t = JSON.parse(tw.val); if (t.team !== team) return json({ error: 'not your faction\'s tower' }, 403, cors); lat = t.lat; lon = t.lon;
        }
        if (!isFinite(lat) || !isFinite(lon)) return json({ error: 'bad position' }, 400, cors);
        const cur = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('shield/' + target).first();
        if (cur) { try { const c = JSON.parse(cur.val);
          if (c.team !== team && c.hp > 0) return json({ error: 'enemy shield', team: c.team, hp: c.hp, max: c.max }, 409, cors);
          if (c.team === team && c.hp > 0 && r <= c.r) return json({ error: 'already shielded', r: c.r, hp: c.hp, max: c.max }, 409, cors); } catch (e) {} }
        const rec = { team, r, hp: SHIELD_HP[r], max: SHIELD_HP[r], by: await nameOfUser(env, me), at: Date.now(), lat, lon, kind };
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1').bind('shield/' + target, JSON.stringify(rec)).run();
        return json({ ok: true, shield: rec }, 200, cors);
      }
      // place a faction tower where you stand (bought in the shop)
      if (url.pathname === '/tower/place' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const team = await teamOfUser(env, me); if (!team) return json({ error: 'join a faction first' }, 400, cors);
        const b = await req.json().catch(() => ({}));
        const lat = +b.lat, lon = +b.lon;
        if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'bad position' }, 400, cors);
        const { results } = await env.DB.prepare("SELECT val FROM kv WHERE path LIKE 'tower/%' LIMIT 5000").all();
        const all = []; results.forEach(r => { try { all.push(JSON.parse(r.val)); } catch (e) {} });
        if (all.filter(t => t.user === me).length >= TOWER_MAX) return json({ error: 'tower limit', max: TOWER_MAX }, 409, cors);
        const near = all.find(t => geoM(t, { lat, lon }) < TOWER_GAP_M);
        if (near) return json({ error: 'too close', team: near.team, gap: TOWER_GAP_M }, 409, cors);
        const id = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const rec = { id, team, lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, by: await nameOfUser(env, me), user: me, at: Date.now() };
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1)').bind('tower/' + id, JSON.stringify(rec)).run();
        return json({ ok: true, tower: rec }, 200, cors);
      }
      // raise a tower of your own faction one level (1-5): wider reach and more bonus loot
      if (url.pathname === '/tower/upgrade' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const team = await teamOfUser(env, me); if (!team) return json({ error: 'join a faction first' }, 400, cors);
        const b = await req.json().catch(() => ({}));
        const id = String(b.tower || ''); if (!/^t_[a-z0-9]{3,30}$/i.test(id)) return json({ error: 'bad tower' }, 400, cors);
        const tw = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('tower/' + id).first();
        if (!tw) return json({ error: 'no such tower' }, 404, cors);
        const t = JSON.parse(tw.val); if (t.team !== team) return json({ error: 'not your faction' }, 400, cors);
        const lvl = (t.lvl || 1); if (lvl >= 5) return json({ error: 'max level' }, 409, cors);
        t.lvl = lvl + 1;
        await env.DB.prepare('UPDATE kv SET val = ?, v = v + 1 WHERE path = ?').bind(JSON.stringify(t), 'tower/' + id).run();
        return json({ ok: true, lvl: t.lvl }, 200, cors);
      }
      // faction banners: one per player, visible to everyone for 24 hours
      if (url.pathname === '/banner/place' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const team = await teamOfUser(env, me); if (!team) return json({ error: 'join a faction first' }, 400, cors);
        const b = await req.json().catch(() => ({}));
        const lat = +b.lat, lon = +b.lon, em = String(b.em || '🚩');
        if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'bad position' }, 400, cors);
        if (em.length > 8 || /[<>&"'\sA-Za-z0-9]/.test(em)) return json({ error: 'bad emblem' }, 400, cors);
        const now = Date.now(), rec = { team, em, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, by: await nameOfUser(env, me), at: now, until: now + 86400000 };
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1').bind('banner/' + me, JSON.stringify(rec)).run();
        return json({ ok: true, banner: rec }, 200, cors);
      }
      // a won Hard glyph hack against an enemy tower: its shield soaks the hit, otherwise it falls
      if (url.pathname === '/tower/attack' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const team = await teamOfUser(env, me); if (!team) return json({ error: 'join a faction first' }, 400, cors);
        const b = await req.json().catch(() => ({}));
        const id = String(b.tower || ''); if (!/^t_[a-z0-9]{3,30}$/i.test(id)) return json({ error: 'bad tower' }, 400, cors);
        const tw = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('tower/' + id).first();
        if (!tw) return json({ error: 'no such tower' }, 404, cors);
        const t = JSON.parse(tw.val); if (t.team === team) return json({ error: 'that tower is yours' }, 400, cors);
        const sh = await shieldHit(env, id, team);
        if (sh) return json({ ok: true, shield: sh, destroyed: false }, 200, cors);
        await env.DB.prepare('DELETE FROM kv WHERE path = ?').bind('tower/' + id).run();
        await env.DB.prepare('DELETE FROM kv WHERE path = ?').bind('shield/' + id).run();
        return json({ ok: true, destroyed: true, team: t.team, by: t.by }, 200, cors);
      }
      // ---- keys, links & fields (Ingress-style) -------------------------------------------
      // link/<a>~<b> = { a, b, alat, alon, blat, blon, an, bn, team, by, at }   (a < b)
      // field/<a>~<b>~<c> = { pts:[{id,lat,lon}x3], team, by, at, km2 }
      if (url.pathname === '/links/make' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const trow = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('team/' + me).first();
        let team = null; if (trow) { try { team = JSON.parse(trow.val).team; } catch (e) {} }
        if (!TEAMS.has(team)) return json({ error: 'join a faction first' }, 400, cors);
        const b = await req.json().catch(() => ({}));
        const pt = o => o && /^[a-z0-9_]{3,40}$/i.test(String(o.id)) && isFinite(+o.lat) && isFinite(+o.lon) && Math.abs(+o.lat) <= 90 && Math.abs(+o.lon) <= 180
          ? { id: String(o.id), lat: +o.lat, lon: +o.lon, n: String(o.name || '').replace(/[<>]/g, '').slice(0, 40) } : null;
        const A = pt(b.from), B = pt(b.to);
        if (!A || !B || A.id === B.id) return json({ error: 'bad chests' }, 400, cors);
        for (const x of [A, B]) { const bl = await env.DB.prepare('SELECT 1 FROM kv WHERE path = ?').bind('block/' + x.id).first(); if (bl) return json({ error: 'that chest was removed' }, 400, cors); }
        const R = 6371000, rad = Math.PI / 180;
        const dm = (p, q) => { const dLa = (q.lat - p.lat) * rad, dLo = (q.lon - p.lon) * rad, h = Math.sin(dLa / 2) ** 2 + Math.cos(p.lat * rad) * Math.cos(q.lat * rad) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
        // range comes from the origin chest's level: 1 km per level
        const crow = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('chests/' + A.id).first();
        let xp = 0; if (crow) { try { const c = JSON.parse(crow.val); xp = (c.visits || 0) + (c.hacks || 0); } catch (e) {} }
        const LV = [0, 3, 6, 10, 16, 25, 40, 60]; let lvl = 1; for (let i = 1; i < LV.length; i++) if (xp >= LV[i]) lvl = i + 1;
        const maxM = lvl * 1000, len = dm(A, B);
        if (len > maxM) return json({ error: 'too far', len: Math.round(len), max: maxM, lvl }, 400, cors);
        const [P1, P2] = A.id < B.id ? [A, B] : [B, A], lid = P1.id + '~' + P2.id;
        const { results: all } = await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'link/%' LIMIT 5000").all();
        const links = []; for (const r of all) { try { links.push(JSON.parse(r.val)); } catch (e) {} }
        if (links.some(l => l.a === P1.id && l.b === P2.id)) return json({ error: 'already linked' }, 409, cors);
        // no crossing any existing link (sharing an end chest is fine)
        const X = p => [p.lon * Math.cos(p.lat * rad), p.lat];
        const cross = (p1, p2, p3, p4) => { const d = (a, b2, c) => (b2[0] - a[0]) * (c[1] - a[1]) - (b2[1] - a[1]) * (c[0] - a[0]);
          const a1 = X(p1), a2 = X(p2), b1 = X(p3), b2 = X(p4);
          const d1 = d(b1, b2, a1), d2 = d(b1, b2, a2), d3 = d(a1, a2, b1), d4 = d(a1, a2, b2);
          return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 && d2 && d3 && d4; };
        for (const l of links) {
          if (l.a === P1.id || l.a === P2.id || l.b === P1.id || l.b === P2.id) continue;
          if (cross(P1, P2, { lat: l.alat, lon: l.alon }, { lat: l.blat, lon: l.blon })) return json({ error: 'crosses a link', team: l.team }, 409, cors);
        }
        const name = await nameOfUser(env, me), now = Date.now();
        const L = { a: P1.id, b: P2.id, alat: P1.lat, alon: P1.lon, blat: P2.lat, blon: P2.lon, an: P1.n, bn: P2.n, team, by: name, at: now };
        const put = 'INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1';
        await env.DB.prepare(put).bind('link/' + lid, JSON.stringify(L)).run();
        // every triangle this link closes with two more links of the same faction becomes a field
        const mine = links.filter(l => l.team === team).concat([L]);
        const nb = id => { const m = new Map(); mine.forEach(l => { if (l.a === id) m.set(l.b, { id: l.b, lat: l.blat, lon: l.blon }); else if (l.b === id) m.set(l.a, { id: l.a, lat: l.alat, lon: l.alon }); }); return m; };
        const n1 = nb(P1.id), n2 = nb(P2.id), fields = [];
        for (const [cid, C] of n1) {
          if (!n2.has(cid)) continue;
          const pts = [P1, P2, C].map(p => ({ id: p.id, lat: p.lat, lon: p.lon })).sort((x, y) => x.id < y.id ? -1 : 1);
          const fid = pts.map(p => p.id).join('~');
          const ex = await env.DB.prepare('SELECT 1 FROM kv WHERE path = ?').bind('field/' + fid).first(); if (ex) continue;
          const xy = pts.map(p => [p.lon * Math.cos(pts[0].lat * rad) * 111.32, p.lat * 110.57]);
          const km2 = Math.abs((xy[1][0] - xy[0][0]) * (xy[2][1] - xy[0][1]) - (xy[2][0] - xy[0][0]) * (xy[1][1] - xy[0][1])) / 2;
          const F = { pts, team, by: name, at: now, km2: Math.round(km2 * 1000) / 1000 };
          await env.DB.prepare(put).bind('field/' + fid, JSON.stringify(F)).run();
          fields.push(Object.assign({ id: fid }, F));
        }
        return json({ ok: true, link: Object.assign({ id: lid }, L), fields, len: Math.round(len), max: maxM }, 200, cors);
      }
      if (url.pathname === '/links' && req.method === 'GET') {
        const bb = String(url.searchParams.get('b') || '').split(',').map(Number);
        if (bb.length !== 4 || bb.some(x => !isFinite(x))) return json({ error: 'bad box' }, 400, cors);
        const [s0, w0, n0, e0] = bb;
        const hit = (la1, lo1, la2, lo2) => !(Math.max(la1, la2) < s0 || Math.min(la1, la2) > n0 || Math.max(lo1, lo2) < w0 || Math.min(lo1, lo2) > e0);
        const { results: lr } = await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'link/%' LIMIT 5000").all();
        const { results: fr } = await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'field/%' LIMIT 5000").all();
        const links = [], fields = [];
        lr.forEach(r => { try { const l = JSON.parse(r.val); if (hit(l.alat, l.alon, l.blat, l.blon)) links.push(Object.assign({ id: r.path.slice(5) }, l)); } catch (e) {} });
        fr.forEach(r => { try { const f = JSON.parse(r.val), la = f.pts.map(p => p.lat), lo = f.pts.map(p => p.lon);
          if (hit(Math.min(...la), Math.min(...lo), Math.max(...la), Math.max(...lo))) fields.push(Object.assign({ id: r.path.slice(6) }, f)); } catch (e) {} });
        // towers reach 5 miles, so look a little beyond the box for them
        const pad = 0.09, towers = [], shields = [];
        const { results: tr } = await env.DB.prepare("SELECT val FROM kv WHERE path LIKE 'tower/%' LIMIT 5000").all();
        tr.forEach(r => { try { const t = JSON.parse(r.val); if (t.lat >= s0 - pad && t.lat <= n0 + pad && t.lon >= w0 - pad && t.lon <= e0 + pad) towers.push({ id: t.id, team: t.team, lat: t.lat, lon: t.lon, by: t.by, at: t.at, lvl: t.lvl || 1 }); } catch (e) {} });
        const { results: sr } = await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'shield/%' LIMIT 5000").all();
        sr.forEach(r => { try { const v = JSON.parse(r.val); if (v.hp > 0 && v.lat >= s0 - pad && v.lat <= n0 + pad && v.lon >= w0 - pad && v.lon <= e0 + pad) shields.push({ target: r.path.slice(7), team: v.team, r: v.r, hp: v.hp, max: v.max, kind: v.kind, by: v.by }); } catch (e) {} });
        const banners = [], bnow = Date.now();
        const { results: br } = await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'banner/%' LIMIT 5000").all();
        for (const r of br) { try { const v = JSON.parse(r.val);
          if (v.until < bnow) { await env.DB.prepare('DELETE FROM kv WHERE path = ?').bind(r.path).run(); continue; }
          if (v.lat >= s0 && v.lat <= n0 && v.lon >= w0 && v.lon <= e0) banners.push({ team: v.team, em: v.em, lat: v.lat, lon: v.lon, by: v.by, at: v.at, until: v.until }); } catch (e) {} }
        return json({ links: links.slice(0, 800), fields: fields.slice(0, 600), towers: towers.slice(0, 300), shields: shields.slice(0, 800), banners: banners.slice(0, 300) }, 200, cors);
      }
      // a won Hard glyph hack at a chest breaks the other factions' links (and their fields) there
      if (url.pathname === '/links/break' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const trow = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('team/' + me).first();
        let team = null; if (trow) { try { team = JSON.parse(trow.val).team; } catch (e) {} }
        if (!TEAMS.has(team)) return json({ ok: true, links: 0, fields: 0 }, 200, cors);
        const b = await req.json().catch(() => ({}));
        const chest = String(b.chest || ''); if (!/^[a-z0-9_]{3,40}$/i.test(chest)) return json({ error: 'bad chest' }, 400, cors);
        const sh = await shieldHit(env, chest, team);
        if (sh) return json({ ok: true, links: 0, fields: 0, shield: sh }, 200, cors);
        const { results: lr } = await env.DB.prepare('SELECT path, val FROM kv WHERE path LIKE ? OR path LIKE ?').bind('link/' + chest + '~%', 'link/%~' + chest).all();
        const { results: fr } = await env.DB.prepare('SELECT path, val FROM kv WHERE path LIKE ? OR path LIKE ? OR path LIKE ?').bind('field/' + chest + '~%', 'field/%~' + chest + '~%', 'field/%~' + chest).all();
        const gone = [];
        // LIKE treats '_' as a wildcard, so re-check the exact chest before deleting anything
        lr.forEach(r => { try { const l = JSON.parse(r.val); if (l.team !== team && (l.a === chest || l.b === chest)) gone.push(r.path); } catch (e) {} });
        const nl = gone.length;
        fr.forEach(r => { try { const f = JSON.parse(r.val); if (f.team !== team && f.pts.some(p => p.id === chest)) gone.push(r.path); } catch (e) {} });
        for (let i = 0; i < gone.length; i += 90) { const part = gone.slice(i, i + 90);
          await env.DB.prepare('DELETE FROM kv WHERE path IN (' + part.map(() => '?').join(',') + ')').bind(...part).run(); }
        return json({ ok: true, links: nl, fields: gone.length - nl }, 200, cors);
      }
      // ---- drones other players can see: drone/<user> = { lat, lon, state, em, col, team, t } ----
      // Display only. Flying drones report every couple of seconds; a parked one stays put until
      // its owner calls it home. Not reachable through /kv.
      if (url.pathname === '/drone/set' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const b = await req.json().catch(() => ({}));
        const lat = +b.lat, lon = +b.lon, state = b.state === 'park' ? 'park' : 'fly';
        if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'bad position' }, 400, cors);
        const em = String(b.em || '').slice(0, 8), col = /^#[0-9a-f]{3,8}$/i.test(String(b.col || '')) ? String(b.col) : '';
        const dl = /^#[0-9a-f]{3,8},#[0-9a-f]{3,8},#[0-9a-f]{3,8}$/i.test(String(b.dl || '')) ? String(b.dl) : '';
        const prev = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('drone/' + me).first();
        let team = null, tt = 0; if (prev) { try { const p = JSON.parse(prev.val); team = p.team || null; tt = p.tt || 0; } catch (e) {} }
        const now = Date.now();
        if (!tt || now - tt > 600000) {            // refresh the faction now and then, not on every fix
          const trow = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('team/' + me).first();
          team = null; if (trow) { try { team = JSON.parse(trow.val).team; } catch (e) {} } tt = now;
        }
        const rec = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, state, em, col, dl, team: TEAMS.has(team) ? team : null, tt, t: now };
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1').bind('drone/' + me, JSON.stringify(rec)).run();
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === '/drone/clear' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        await env.DB.prepare('DELETE FROM kv WHERE path = ?').bind('drone/' + me).run();
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === '/drones' && req.method === 'GET') {
        const bb = String(url.searchParams.get('b') || '').split(',').map(Number);
        if (bb.length !== 4 || bb.some(x => !isFinite(x))) return json({ error: 'bad box' }, 400, cors);
        const [s0, w0, n0, e0] = bb;
        if (n0 - s0 > 3 || Math.abs(e0 - w0) > 4) return json({ value: [] }, 200, cors);   // zoomed way out: skip
        const self = String(req.headers.get('X-User') || '').toLowerCase(), now = Date.now(), out = [];
        const { results } = await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'drone/%' LIMIT 5000").all();
        for (const r of results) {
          const k = r.path.slice(6); if (k === self) continue;
          let d; try { d = JSON.parse(r.val); } catch (e) { continue; }
          if (d.lat < s0 || d.lat > n0 || d.lon < w0 || d.lon > e0) continue;
          // a flying drone that stopped reporting (app closed) just hangs where it was
          const state = d.state === 'fly' && now - d.t < 45000 ? 'fly' : 'park';
          let h = 0; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;       // stable id, no names
          out.push({ k: h.toString(36), lat: d.lat, lon: d.lon, state, em: d.em || '', col: d.col || '', dl: d.dl || '', team: d.team || null });
          if (out.length >= 150) break;
        }
        return json({ value: out }, 200, cors);
      }
      // ---- world pulse: anonymous recent activity near you, so the map feels alive -----------
      // No names, and positions are rounded to ~100 m (done at /act).
      if (url.pathname === '/pulse' && req.method === 'GET') {
        const bb = String(url.searchParams.get('b') || '').split(',').map(Number);
        if (bb.length !== 4 || bb.some(x => !isFinite(x))) return json({ error: 'bad box' }, 400, cors);
        const [s0, w0, n0, e0] = bb;
        if (n0 - s0 > 1 || Math.abs(e0 - w0) > 1.5) return json({ value: [] }, 200, cors);
        const PUB = new Set(['open', 'newchest', 'hide', 'glyph', 'link', 'field', 'break', 'tower', 'towerdown', 'ach', 'levelup', 'gift', 'trade', 'craft', 'merge']);
        const now = Date.now(), row = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('admin/events').first();
        let list = []; if (row) { try { list = JSON.parse(row.val) || []; } catch (e) {} }
        const me = String(req.headers.get('X-User') || '').toLowerCase(), out = [];
        for (const ev of list) {
          const age = now - ev.t; if (age > 1800000) break;
          if (!PUB.has(ev.k) || ev.lat == null) continue;
          if (me && String(ev.u || '').toLowerCase() === me) continue;
          if (ev.lat < s0 || ev.lat > n0 || ev.lon < w0 || ev.lon > e0) continue;
          let h = 0; for (const ch of String(ev.t) + ev.k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          out.push({ id: h.toString(36), k: ev.k, lat: ev.lat, lon: ev.lon, t: ev.t });
          if (out.length >= 40) break;
        }
        return json({ value: out }, 200, cors);
      }
      // ---- player activity for the admin feed ----------------------------------------------
      // The game reports what players do; location is rounded to ~100 m before it is stored.
      if (url.pathname === '/act' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const b = await req.json().catch(() => ({}));
        const KINDS = new Set(['newchest', 'open', 'trade', 'gift', 'hide', 'glyph', 'glyphfail', 'levelup', 'fx', 'team', 'ach', 'merge', 'craft', 'daily', 'drone', 'link', 'field', 'break', 'shield', 'tower', 'towerdown']);
        const k = String(b.k || '');
        if (!KINDS.has(k)) return json({ error: 'bad kind' }, 400, cors);
        const ev = { k, u: String(await nameOfUser(env, me)).slice(0, 16), t: Date.now() };
        const x = String(b.x || '').replace(/[<>]/g, '').slice(0, 80); if (x) ev.x = x;
        const lat = +b.lat, lon = +b.lon;
        if (b.lat != null && b.lon != null && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { ev.lat = Math.round(lat * 1000) / 1000; ev.lon = Math.round(lon * 1000) / 1000; }
        await adminEvent(env, ev);
        return json({ ok: true }, 200, cors);
      }
      // ---- beacons & fireworks: short-lived effects anyone can see at a chest ----------------
      // fx/<chest> = { type, by, team, lat, lon, at, until }. Not reachable through /kv.
      if (url.pathname === '/fx/set' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const b = await req.json().catch(() => ({}));
        const chest = String(b.chest || ''), type = String(b.type || ''), lat = +b.lat, lon = +b.lon;
        const DUR = { beacon: 3600000, fireworks: 1800000 };
        if (!/^[a-z0-9_]{3,40}$/i.test(chest) || !DUR[type] || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
          return json({ error: 'bad effect' }, 400, cors);
        const now = Date.now();
        const cur = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('fx/' + chest).first();
        if (cur) { try { const c = JSON.parse(cur.val); if (c.until > now && c.user !== me) return json({ error: 'busy', until: c.until, by: c.by }, 409, cors); } catch (e) {} }
        const lastRow = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('fxlast/' + me).first();
        if (lastRow && now - (+lastRow.val || 0) < 60000) return json({ error: 'slow down' }, 429, cors);
        const trow = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('team/' + me).first();
        let team = null; if (trow) { try { team = JSON.parse(trow.val).team; } catch (e) {} }
        const rec = { type, user: me, by: await nameOfUser(env, me), team: TEAMS.has(team) ? team : null, lat, lon, at: now, until: now + DUR[type] };
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1').bind('fx/' + chest, JSON.stringify(rec)).run();
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1').bind('fxlast/' + me, String(now)).run();
        return json({ ok: true, until: rec.until }, 200, cors);
      }
      if (url.pathname === '/fx/active' && req.method === 'GET') {
        const now = Date.now(), out = [], dead = [];
        const { results } = await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'fx/%' LIMIT 2000").all();
        results.forEach(r => { try { const c = JSON.parse(r.val); if (c.until > now) out.push({ chest: r.path.slice(3), type: c.type, by: c.by, team: c.team, lat: c.lat, lon: c.lon, until: c.until }); else dead.push(r.path); } catch (e) { dead.push(r.path); } });
        if (dead.length) for (let i = 0; i < dead.length; i += 90) { const part = dead.slice(i, i + 90);
          await env.DB.prepare('DELETE FROM kv WHERE path IN (' + part.map(() => '?').join(',') + ')').bind(...part).run(); }
        return json({ value: out, now }, 200, cors);
      }
      // Unique-visitor counts for a batch of chests (drives chest levels on the map).
      if (url.pathname === '/chests/levels' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter(i => /^[a-z0-9_]{3,40}$/i.test(i)).slice(0, 300);
        const out = {};
        for (let i = 0; i < ids.length; i += 90) {               // D1 caps bound parameters per query
          const part = ids.slice(i, i + 90);
          const { results } = await env.DB.prepare('SELECT path, val FROM kv WHERE path IN (' + part.map(() => '?').join(',') + ')')
            .bind(...part.map(x => 'chests/' + x)).all();
          results.forEach(r => { try { const c = JSON.parse(r.val), v = (c.visits || 0) + (c.hacks || 0); if (v) out[r.path.slice(7)] = v; } catch (e) {} });
        }
        return json({ value: out }, 200, cors);
      }
      // Global faction standings: cells led (ties count for nobody), total points, members.
      if (url.pathname === '/teams/standings' && req.method === 'GET') {
        const out = {}; TEAMS.forEach(t => { out[t] = { cells: 0, points: 0, members: 0 }; });
        const cs = (await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'cs/%' LIMIT 50000").all()).results;
        const byCell = {};
        cs.forEach(r => { const seg = r.path.split('/'); const cell = seg[1], team = seg[2]; if (!out[team] || !FIELD_RE.test(cell)) return;
          const n = +r.val || 0; out[team].points += n; (byCell[cell] = byCell[cell] || {})[team] = n; });
        const held = {}; TEAMS.forEach(t => { held[t] = []; });
        Object.entries(byCell).forEach(([cell, sc]) => { let best = null, bn = 0, tie = false;
          for (const t in sc) { if (sc[t] > bn) { best = t; bn = sc[t]; tie = false; } else if (sc[t] === bn) tie = true; }
          if (best && !tie) { out[best].cells++; held[best].push(cell); } });
        const tm = (await env.DB.prepare("SELECT val FROM kv WHERE path LIKE 'team/%' LIMIT 50000").all()).results;
        tm.forEach(r => { try { const t = JSON.parse(r.val).team; if (out[t]) out[t].members++; } catch (e) {} });
        TEAMS.forEach(t => { out[t].links = 0; out[t].fields = 0; out[t].km2 = 0; });
        const lk = (await env.DB.prepare("SELECT val FROM kv WHERE path LIKE 'link/%' LIMIT 5000").all()).results;
        lk.forEach(r => { try { const t = JSON.parse(r.val).team; if (out[t]) out[t].links++; } catch (e) {} });
        const fl = (await env.DB.prepare("SELECT val FROM kv WHERE path LIKE 'field/%' LIMIT 5000").all()).results;
        fl.forEach(r => { try { const f = JSON.parse(r.val); if (out[f.team]) { out[f.team].fields++; out[f.team].km2 += f.km2 || 0; } } catch (e) {} });
        TEAMS.forEach(t => { out[t].km2 = Math.round(out[t].km2 * 100) / 100; });
        TEAMS.forEach(t => { out[t].towers = 0; });
        const tw = (await env.DB.prepare("SELECT val FROM kv WHERE path LIKE 'tower/%' LIMIT 5000").all()).results;
        tw.forEach(r => { try { const t = JSON.parse(r.val).team; if (out[t]) out[t].towers++; } catch (e) {} });
        return json({ value: out, held, cellsTotal: Object.keys(byCell).length, at: Date.now() }, 200, cors);
      }

      if (url.pathname === '/admin/stats' && req.method === 'GET') {
        const ad = await requireAdmin(env, req); if (ad.err) return json({ error: ad.msg }, ad.err, cors);
        const now = Date.now();
        const users = (await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'users/%' LIMIT 50000").all()).results;
        const seen = (await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'seen/%' LIMIT 50000").all()).results;
        const players = (await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'players/%' LIMIT 5000").all()).results;
        const cells = (await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'cells/%' LIMIT 20000").all()).results;
        const blocked = await env.DB.prepare("SELECT count(*) AS n FROM kv WHERE path LIKE 'block/%'").first();
        const evRow = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('admin/events').first();
        let events = []; if (evRow) { try { events = JSON.parse(evRow.val) || []; } catch (e) {} }
        const people = {};
        users.forEach(r => { try { const u = JSON.parse(r.val); people[r.path.slice(6)] = { key: r.path.slice(6), name: u.name, created: u.created || 0 }; } catch (e) {} });
        seen.forEach(r => { const k = r.path.slice(5), sv = seenOf(r.val); people[k] = Object.assign(people[k] || { key: k, name: k }, { seen: sv.t, lat: sv.lat, lon: sv.lon }); });
        // totals across every player record
        const tot = { opened: 0, trades: 0, hidden: 0, miles: 0, coins: 0, coinsEarned: 0, items: 0, crafted: 0, merges: 0, drones: 0, roadCoins: 0, logins: 0 };
        players.forEach(r => {
          try {
            const p = JSON.parse(r.val), st = p.stats || {}, k = r.path.slice(8);
            tot.opened += Object.keys(st.visited || {}).length; tot.trades += st.ex || 0; tot.hidden += st.hidden || 0;
            tot.miles += (st.walkedM || 0) / 1609.344; tot.coins += p.coins || 0; tot.coinsEarned += st.coinsEarned || 0;
            tot.items += Object.keys(p.dex || {}).length; tot.crafted += st.crafted || 0; tot.merges += st.merges || 0;
            tot.roadCoins += st.roadCoins || 0; tot.logins += (p.daily && p.daily.n) || 0; if (p.drone && p.drone.lvl) tot.drones++;
            if (people[k]) { people[k].miles = +((st.walkedM || 0) / 1609.344).toFixed(1); people[k].opened = Object.keys(st.visited || {}).length; people[k].trades = st.ex || 0; people[k].title = p.title || ''; }
          } catch (e) {}
        });
        tot.miles = +tot.miles.toFixed(1);
        const hiddenChests = cells.map(r => { try { const c = JSON.parse(r.val), seg = r.path.split('/'); return { id: seg[2], cell: seg[1], name: c.name, lat: c.lat, lon: c.lon, by: c.by || '', at: c.at || 0 }; } catch (e) { return null; } })
          .filter(Boolean).sort((a, b) => (b.at || 0) - (a.at || 0));
        const list = Object.values(people);
        const since = ms => list.filter(p => p.seen && now - p.seen < ms).length;
        return json({
          now, accounts: users.length, online: since(ONLINE_MS), active24h: since(86400000), active7d: since(7 * 86400000),
          signups7d: list.filter(p => p.created && now - p.created < 7 * 86400000).length,
          totals: tot, chestsHidden: hiddenChests.length, chestsRemoved: (blocked && blocked.n) || 0,
          players: list.sort((a, b) => (b.seen || 0) - (a.seen || 0)).slice(0, 300),
          hiddenChests: hiddenChests.slice(0, 60),
          events: events.slice(0, 600)
        }, 200, cors);
      }

      // one player's record, for the admin's player card
      if (url.pathname === '/admin/user' && req.method === 'GET') {
        const ad = await requireAdmin(env, req); if (ad.err) return json({ error: ad.msg }, ad.err, cors);
        const k = String(url.searchParams.get('u') || '').toLowerCase(); if (!SEG.test(k)) return json({ error: 'bad name' }, 400, cors);
        const u = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('users/' + k).first();
        if (!u) return json({ error: 'no such player' }, 404, cors);
        const p = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('players/' + k).first();
        const sn = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('seen/' + k).first();
        const inv = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('invites/' + k).first();
        let pl = {}; try { pl = p ? JSON.parse(p.val) : {}; } catch (e) {}
        const st = pl.stats || {}, uu = JSON.parse(u.val), sv = sn ? seenOf(sn.val) : {};
        return json({
          key: k, name: uu.name, created: uu.created || 0, seen: sv.t || 0, lat: sv.lat, lon: sv.lon,
          title: pl.title || '', coins: pl.coins || 0, coinsEarned: st.coinsEarned || 0,
          opened: Object.keys(st.visited || {}).length, trades: st.ex || 0, hidden: st.hidden || 0, gifts: st.given || 0,
          items: Object.keys(pl.dex || {}).length, pack: Object.values(pl.inv || {}).reduce((a, b) => a + b, 0),
          crafted: st.crafted || 0, merges: st.merges || 0, miles: +((st.walkedM || 0) / 1609.344).toFixed(2),
          roadCoins: st.roadCoins || 0, logins: (pl.daily && pl.daily.n) || 0, streak: (pl.daily && pl.daily.max) || 0,
          drone: (pl.drone && pl.drone.lvl) || 0, achievements: Object.keys(pl.ach || {}).length,
          invited: inv ? +JSON.parse(inv.val) || 0 : 0, ref: pl.ref || ''
        }, 200, cors);
      }

      // remove any chest (place, road/trail or player-hidden) for everyone, straight away.
      // What it held is kept inside block/<chest>, so /admin/restore can bring it back.
      if (url.pathname === '/admin/remove' && req.method === 'POST') {
        const ad = await requireAdmin(env, req); if (ad.err) return json({ error: ad.msg }, ad.err, cors);
        const b = await req.json().catch(() => ({}));
        const chest = String(b.chest || ''), cell = String(b.cell || '');
        if (!SEG.test(chest)) return json({ error: 'bad chest' }, 400, cors);
        const cRow = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('chests/' + chest).first();
        const cellRow = /^-?\d+_-?\d+$/.test(cell)
          ? await env.DB.prepare('SELECT path, val FROM kv WHERE path = ?').bind('cells/' + cell + '/' + chest).first()
          : await env.DB.prepare('SELECT path, val FROM kv WHERE path LIKE ? LIMIT 1').bind('cells/%/' + chest).first();
        const rec = { at: Date.now(), by: ad.me, name: String(b.name || '').slice(0, 60), kind: String(b.kind || '').slice(0, 20),
          lat: isFinite(+b.lat) ? +b.lat : null, lon: isFinite(+b.lon) ? +b.lon : null,
          chestVal: cRow ? cRow.val : null, cellPath: cellRow ? cellRow.path : null, cellVal: cellRow ? cellRow.val : null };
        await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1').bind('block/' + chest, JSON.stringify(rec)).run();
        await env.DB.prepare('DELETE FROM kv WHERE path = ?').bind('chests/' + chest).run();
        if (cellRow) await env.DB.prepare('DELETE FROM kv WHERE path = ?').bind(cellRow.path).run();
        return json({ ok: true }, 200, cors);
      }
      // removed chests, newest first (admin)
      if (url.pathname === '/admin/removed' && req.method === 'GET') {
        const ad = await requireAdmin(env, req); if (ad.err) return json({ error: ad.msg }, ad.err, cors);
        const { results } = await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'block/%' LIMIT 3000").all();
        const list = results.map(r => { let o = {}; try { o = JSON.parse(r.val); } catch (e) {} if (typeof o !== 'object' || !o) o = {};
          return { id: r.path.slice(6), name: o.name || '', kind: o.kind || '', at: o.at || 0, by: o.by || '', lat: o.lat, lon: o.lon, flagged: !o.by }; })
          .sort((x, y) => y.at - x.at).slice(0, 300);
        return json({ value: list, total: results.length }, 200, cors);
      }
      // bring a removed chest back, with what it held when it was removed
      if (url.pathname === '/admin/restore' && req.method === 'POST') {
        const ad = await requireAdmin(env, req); if (ad.err) return json({ error: ad.msg }, ad.err, cors);
        const b = await req.json().catch(() => ({}));
        const chest = String(b.chest || ''); if (!SEG.test(chest)) return json({ error: 'bad chest' }, 400, cors);
        const row = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('block/' + chest).first();
        if (!row) return json({ error: 'not removed' }, 404, cors);
        let o = {}; try { o = JSON.parse(row.val) || {}; } catch (e) {}
        const put = 'INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1';
        if (o.cellPath && o.cellVal && /^cells\/-?\d+_-?\d+\/[A-Za-z0-9_-]+$/.test(o.cellPath)) await env.DB.prepare(put).bind(o.cellPath, o.cellVal).run();
        if (o.chestVal) await env.DB.prepare(put).bind('chests/' + chest, o.chestVal).run();
        await env.DB.prepare('DELETE FROM kv WHERE path = ?').bind('block/' + chest).run();
        await env.DB.prepare('DELETE FROM kv WHERE path LIKE ?').bind('flagv/' + chest + '/%').run();
        return json({ ok: true }, 200, cors);
      }
      // rename any chest for everyone; an empty name goes back to the original
      if (url.pathname === '/admin/rename' && req.method === 'POST') {
        const ad = await requireAdmin(env, req); if (ad.err) return json({ error: ad.msg }, ad.err, cors);
        const b = await req.json().catch(() => ({}));
        const chest = String(b.chest || ''); if (!SEG.test(chest)) return json({ error: 'bad chest' }, 400, cors);
        const name = String(b.name || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!name) await env.DB.prepare('DELETE FROM kv WHERE path = ?').bind('rename/' + chest).run();
        else await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1').bind('rename/' + chest, name).run();
        return json({ ok: true, name }, 200, cors);
      }
      // every renamed chest, for all players
      if (url.pathname === '/renames' && req.method === 'GET') {
        const { results } = await env.DB.prepare("SELECT path, val FROM kv WHERE path LIKE 'rename/%' LIMIT 5000").all();
        const out = {}; results.forEach(r => { out[r.path.slice(7)] = r.val; });
        return json({ value: out }, 200, cors);
      }

      // ---- account recovery -------------------------------------------------------
      // A player's only way back in if they forget their password. The code itself is never
      // stored: only a hash of it, derived in the browser exactly like the password.

      // Attach (or replace) a recovery code on an account you are already signed in to.
      if (url.pathname === '/setrec' && req.method === 'POST') {
        const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
        if (!me) return json({ error: 'not logged in' }, 401, cors);
        const b = await req.json().catch(() => ({}));
        const rsalt = String(b.rsalt || ''), rhash = String(b.rhash || '');
        if (rsalt.length < 4 || rsalt.length > 64 || rhash.length < 16 || rhash.length > 128) return json({ error: 'bad code' }, 400, cors);
        const row = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('users/' + me).first();
        if (!row) return json({ error: 'no account' }, 404, cors);
        let u; try { u = JSON.parse(row.val); } catch (e) { return json({ error: 'bad record' }, 500, cors); }
        u.rsalt = rsalt; u.rhash = rhash;
        await env.DB.prepare('UPDATE kv SET val = ?, v = v + 1 WHERE path = ?').bind(JSON.stringify(u), 'users/' + me).run();
        await env.DB.prepare('DELETE FROM kv WHERE path = ?').bind('rl/' + me).run();
        return json({ ok: true }, 200, cors);
      }

      // Set a new password using the recovery code. The old code is spent in the process.
      if (url.pathname === '/recover' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const who = String(b.user || '').toLowerCase();
        if (!SEG.test(who)) return json({ error: 'bad name' }, 400, cors);
        const tries = String(b.rhash || ''), salt = String(b.salt || ''), hash = String(b.hash || '');
        const rsalt = String(b.rsalt || ''), rhash = String(b.rhash2 || '');
        if (!tries || salt.length < 4 || salt.length > 64 || hash.length < 16 || hash.length > 128 ||
            rsalt.length < 4 || rsalt.length > 64 || rhash.length < 16 || rhash.length > 128)
          return json({ error: 'bad request' }, 400, cors);

        // Guessing a code must not be worth trying.
        const WINDOW = 3600000, MAX = 6;
        const rl = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('rl/' + who).first();
        let fails = 0, since = Date.now();
        if (rl) { try { const o = JSON.parse(rl.val); if (Date.now() - o.t < WINDOW) { fails = o.n; since = o.t; } } catch (e) {} }
        if (fails >= MAX) return json({ error: 'too many attempts, try again later' }, 429, cors);

        const row = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind('users/' + who).first();
        const bump = async () => {
          await env.DB.prepare('INSERT INTO kv (path, val, v) VALUES (?, ?, 1) ON CONFLICT(path) DO UPDATE SET val = excluded.val, v = kv.v + 1')
            .bind('rl/' + who, JSON.stringify({ n: fails + 1, t: since })).run();
        };
        if (!row) { await bump(); return json({ error: 'wrong code' }, 401, cors); }
        let u; try { u = JSON.parse(row.val); } catch (e) { return json({ error: 'bad record' }, 500, cors); }
        if (!u.rhash) return json({ error: 'this account has no recovery code' }, 400, cors);
        if (!same(u.rhash, tries)) { await bump(); return json({ error: 'wrong code' }, 401, cors); }

        u.salt = salt; u.hash = hash; u.rsalt = rsalt; u.rhash = rhash;   // new password, fresh code
        await env.DB.prepare('UPDATE kv SET val = ?, v = v + 1 WHERE path = ?').bind(JSON.stringify(u), 'users/' + who).run();
        await env.DB.prepare('DELETE FROM kv WHERE path = ?').bind('rl/' + who).run();
        return json({ ok: true, name: u.name }, 200, cors);
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
            // never expose password hashes; the salts are not secret and are needed to sign in
            if (segs[0] === 'users' && segs.length === 2) value = { name: value.name, salt: value.salt, rsalt: value.rsalt || '', hasR: !!value.rhash };
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
            if (r.meta.changes) { try { await adminEvent(env, { k: 'signup', u: String(value.name).slice(0, 16), t: Date.now() }); } catch (e) {} }
            return r.meta.changes ? json({ ok: true, v: 1 }, 200, cors) : json({ error: 'exists' }, 409, cors);
          }
          if (segs[0] === 'invites' || segs[0] === 'feed') return json({ error: 'set by the server only' }, 403, cors);
          const me = await verify(env, req.headers.get('X-User'), req.headers.get('X-Hash'));
          if (!me) return json({ error: 'not logged in' }, 401, cors);
          if (segs[0] === 'players' && segs[1] !== me) return json({ error: 'not your record' }, 403, cors);
          // Who hid a chest is written by the server, never taken from the client: a new hidden
          // chest (cells entry, or a u_ chest record) gets the writer's name, and later writes
          // (trades) keep whatever was there.
          if (segs[0] === 'cells' || (segs[0] === 'chests' && /^u_/.test(segs[1]))) {
            const ex = await env.DB.prepare('SELECT val FROM kv WHERE path = ?').bind(path).first();
            let keep = null; if (ex) { try { const o = JSON.parse(ex.val); if (o && o.by) keep = { by: o.by, at: o.at }; } catch (e) {} }
            if (keep) { value.by = keep.by; value.at = keep.at || 0; }
            else if (ex) { delete value.by; delete value.at; }            // older chest: nobody on record
            else { value.by = (await nameOfUser(env, me)).slice(0, 16); value.at = Date.now(); }
          }

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
