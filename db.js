// Tiny key/value "file database" with two backends behind one API.
//  - LOCAL : one JSON blob in the browser's localStorage (no server, single device)
//  - SHARED: Cloudflare Worker + D1 (cfg.WORKER_URL)  or  Firebase Realtime Database REST API (cfg.DB_URL)
// API: DB.get(path) DB.set(path,val) DB.tx(path, fn) -> {value, changed}
window.DB = (function () {
  const cfg = window.GEO_CONFIG || {};
  const base = (cfg.DB_URL || '').replace(/\/+$/, '');
  const W = (cfg.WORKER_URL || '').replace(/\/+$/, '');   // Cloudflare Worker backend (preferred when set)
  const remote = !!(base || W);
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

  // ---------- cloudflare worker ----------
  let auth = null;
  const wurl = p => W + '/kv/' + parts(p).join('/');
  const whead = () => Object.assign({ 'Content-Type': 'application/json' }, auth ? { 'X-User': auth.user, 'X-Hash': auth.hash } : {});
  const wput = (p, body) => fetch(wurl(p), { method: 'PUT', headers: whead(), body: JSON.stringify(body) });
  async function wget(p) { const r = await fetch(wurl(p)); if (!r.ok) throw new Error('db read ' + r.status); return (await r.json()).value; }
  async function wset(p, v) { const r = await wput(p, { value: v }); if (!r.ok) throw new Error(r.status === 401 ? 'please log in again' : 'db write ' + r.status); }
  async function wtx(p, fn) {
    for (let i = 0; i < 6; i++) {
      const g = await fetch(wurl(p)); if (!g.ok) throw new Error('db read ' + g.status);
      const j = await g.json(), nv = fn(j.value === undefined ? null : j.value);
      if (nv === undefined) return { value: j.value, changed: false };
      const r = await wput(p, { value: nv, ifv: j.v || 0 });
      if (r.ok) return { value: nv, changed: true };
      if (r.status === 409 && p.startsWith('users/')) return { value: j.value, changed: false };
      if (r.status !== 409) throw new Error(r.status === 401 ? 'please log in again' : 'db write ' + r.status);
    }
    throw new Error('db busy, try again');
  }

  return {
    remote,
    osmBase: W,
    async get(p) { return W ? wget(p) : base ? rget(p) : lget(p); },
    async set(p, v) { return W ? wset(p, v) : base ? rset(p, v) : lset(p, v); },
    // Read several children of a prefix at once, e.g. getMany('cells', ['3_-2','3_-1']) -> [obj, obj]
    async getMany(prefix, keys) {
      if (W && prefix === 'cells') {
        const r = await fetch(W + '/many?keys=' + encodeURIComponent(keys.join(','))); if (!r.ok) throw new Error('db read ' + r.status);
        const o = (await r.json()).value || {}; return keys.map(k => o[k] || null);
      }
      return Promise.all(keys.map(k => this.get(prefix + '/' + k)));
    },
    setAuth(user, hash) { auth = { user: String(user).toLowerCase(), hash }; },
    // Tell the server this account's referral now counts (called after its first chest).
    // Flag a chest. Enough distinct players and the server drops it for everyone.
    async flagChest(chest, cell) {
      if (!W) return { ok: false };
      const r = await fetch(W + '/flag', { method: 'POST', headers: whead(), body: JSON.stringify({ chest, cell }) });
      if (!r.ok) throw new Error('flag ' + r.status);
      return r.json();
    },
    async blockedChests() {
      if (!W) return [];
      const r = await fetch(W + '/blocked'); if (!r.ok) return [];
      return (await r.json()).value || [];
    },
    async reportReferral() {
      if (!W) return null;
      const r = await fetch(W + '/refer', { method: 'POST', headers: whead(), body: '{}' });
      if (!r.ok) throw new Error('refer ' + r.status);
      return r.json();
    },
    // ---- account recovery ----
    // Attach a recovery code to the account you are signed in to.
    async setRecovery(rsalt, rhash) {
      if (!W) {                                        // local mode: the record is right here
        const key = auth ? auth.user : null; if (!key) throw new Error('not logged in');
        const u = lget('users/' + key); if (!u) throw new Error('no account');
        u.rsalt = rsalt; u.rhash = rhash; lset('users/' + key, u); return { ok: true };
      }
      const r = await fetch(W + '/setrec', { method: 'POST', headers: whead(), body: JSON.stringify({ rsalt, rhash }) });
      if (r.status === 404) throw new Error('the server has not been updated for recovery codes yet');
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'could not save code');
      return r.json();
    },
    // Swap a correct recovery code for a new password. Spends the old code.
    async recover(body) {
      if (!W) {
        const key = String(body.user || '').toLowerCase();
        const u = lget('users/' + key); if (!u) throw new Error('wrong code');
        if (!u.rhash) throw new Error('this account has no recovery code');
        if (u.rhash !== body.rhash) throw new Error('wrong code');
        u.salt = body.salt; u.hash = body.hash; u.rsalt = body.rsalt; u.rhash = body.rhash2;
        lset('users/' + key, u); return { ok: true, name: u.name };
      }
      const r = await fetch(W + '/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 404) throw new Error('the server has not been updated for recovery codes yet');
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'could not reset');
      return j;
    },
    async verify(user, hash) {                       // does this name+hash belong to a real account?
      if (W) { try { const r = await fetch(W + '/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, hash }) }); return !!(await r.json()).ok; } catch (e) { return false; } }
      const u = await this.get('users/' + String(user).toLowerCase()); return !!u && u.hash === hash;
    },
    async tx(p, fn) {
      if (W) return wtx(p, fn);
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
