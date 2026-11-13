// Tiny key/value "file database" with two backends behind one API.
//  - LOCAL : one JSON blob in the browser's localStorage (no server, single device)
//  - SHARED: Firebase Realtime Database REST API (no server of yours; all players share one world)
// API: DB.get(path) DB.set(path,val) DB.tx(path, fn) -> {value, changed}
window.DB = (function () {
  const cfg = window.GEO_CONFIG || {};
  const base = (cfg.DB_URL || '').replace(/\/+$/, '');
  const remote = !!base;
  const LS = 'stashwalk_db_v1';
  const parts = p => p.split('/').filter(Boolean);

  // ---------- local ----------
  const lread = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } };
  const lwrite = o => { localStorage.setItem(LS, JSON.stringify(o)); };
  function lget(p) {
    let o = lread();
    for (const k of parts(p)) { if (o === null || typeof o !== 'object') return null; o = o[k]; }
    return o === undefined ? null : o;
  }
  function lset(p, v) {
    const root = lread(), ks = parts(p);
    let o = root;
    ks.slice(0, -1).forEach(k => { if (o[k] === null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    const last = ks[ks.length - 1];
    if (v === null || v === undefined) delete o[last]; else o[last] = v;
    lwrite(root);
  }

  // ---------- shared ----------
  const url = p => base + '/' + parts(p).join('/') + '.json';
  async function rget(p) {
    const r = await fetch(url(p));
    if (!r.ok) throw new Error('db read ' + r.status);
    return r.json();
  }
  async function rset(p, v) {
    const r = await fetch(url(p), { method: 'PUT', body: JSON.stringify(v === undefined ? null : v) });
    if (!r.ok) throw new Error('db write ' + r.status);
  }
  async function rtx(p, fn) {
    for (let i = 0; i < 6; i++) {
      const g = await fetch(url(p), { headers: { 'X-Firebase-ETag': 'true' } });
      if (!g.ok) throw new Error('db read ' + g.status);
      const etag = g.headers.get('ETag');           // may be hidden by CORS -> falls back to plain write
      const cur = await g.json();
      const nv = fn(cur === undefined ? null : cur);
      if (nv === undefined) return { value: cur, changed: false };
      const headers = etag ? { 'if-match': etag } : {};
      const put = await fetch(url(p), { method: 'PUT', headers, body: JSON.stringify(nv) });
      if (put.ok) return { value: nv, changed: true };
      if (put.status !== 412) throw new Error('db write ' + put.status);
    }
    throw new Error('db busy, try again');
  }

  return {
    remote,
    async get(p) { return remote ? rget(p) : lget(p); },
    async set(p, v) { return remote ? rset(p, v) : lset(p, v); },
    async tx(p, fn) {
      if (remote) return rtx(p, fn);
      const cur = lget(p), nv = fn(cur);
      if (nv === undefined) return { value: cur, changed: false };
      lset(p, nv);
      return { value: nv, changed: true };
    },
    dump() { return lread(); },
    load(obj) { lwrite(obj || {}); }
  };
})();
