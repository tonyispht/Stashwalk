(function () {
'use strict';
const C = window.GEO_CONFIG, ITEMS = window.ITEMS, BY_ID = window.ITEM_BY_ID, BY_R = window.ITEMS_BY_R,
      RAR = window.RARITIES, RELICS = window.RELICS || [], DB = window.DB;
const UNLOCK_M = C.UNLOCK_FT * 0.3048, FT = 3.28084;
const unlockM = () => C.UNLOCK_FT * 0.3048;
const DEV = /[?&]dev=1/.test(location.search);
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------- helpers ----------------
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function dist(a, b) {
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function dirName(a, b) {
  const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  const d = (Math.atan2(y, x) / r + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];
}
function fmtDist(m) { const ft = m * FT; if (ft < 1000) return Math.round(ft) + ' ft'; const mi = ft / 5280; return mi.toFixed(mi < 10 ? 2 : 1) + ' mi'; }
const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const utcDay = () => Math.floor(Date.now() / 86400000);
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
function toast(msg, kind) {
  if (kind === 'bad') FX.sfx('error');
  const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3700);
}
const modalOpen = () => $('#modal').classList.contains('open');
function modal(html, mount) {
  const m = $('#modal'); m.innerHTML = '<div class="sheet">' + html + '</div>'; m.classList.add('open');
  document.body.classList.add('modal-open');          // pauses looping background animations
  m.onclick = e => { if (e.target === m) closeModal(); };
  if (mount) mount(m.firstChild);
}
function closeModal() {
  const m = $('#modal'); m.classList.remove('open'); m.innerHTML = '';
  document.body.classList.remove('modal-open');
  if (view === 'explore') renderNearby(true);         // catch up on anything skipped while it was open
}
// Every item gets its own plate: rarity decides the material, the base object decides
// the angle, the highlight and a faint accent tint. Deterministic, so an item always
// looks the same, and it is all painted once - no filters, no per-frame cost.
function plateVars(it) {
  // relics share base -1, so fall back to their own id - otherwise all 20 would
  // be handed the same angle, highlight and tint and look identical
  const b = it.base >= 0 ? it.base : 150 + (parseInt(String(it.id).replace(/\D/g, ''), 10) || 0) * 7;
  const hue = (b * 47) % 360;
  return `--a:${(b * 37) % 360}deg;--sx:${24 + (b * 13) % 52}%;--sy:${18 + (b * 29) % 48}%;` +
         `--ac:hsla(${hue},72%,62%,.20);--ac2:hsla(${hue},72%,48%,.13)`;
}
function tile(it, o = {}) {
  const pv = plateVars(it);
  // Silhouettes use their own rarity classes, so the shelf never runs the live
  // Legendary glow and shine on hundreds of tiles at once.
  if (o.sil) return `<div class="tile sil sr${it.r}" data-id="${it.id}" style="${pv}"><span class="em">${it.e}</span></div>`;
  return `<div class="tile r${it.r}${it.crafted ? ' cr' : ''}${o.sel ? ' sel' : ''}${o.big ? ' big' : ''}" data-id="${it.id}" data-slot="${o.slot || ''}" title="${esc(it.n)}" style="${pv}">` +
    (o.by ? `<span class="by">${esc(o.by)}</span>` : '') +
    `<span class="em">${it.e}</span>` +
    (o.count > 1 ? `<b class="cnt">×${o.count}</b>` : '') + (o.big ? '' : `<i class="nm">${esc(it.n)}</i>`) + '</div>';
}
const revealBox = it => `<div class="revealbox r${it.r}"><i class="rays"></i>${tile(it, { big: true })}</div>`;
const badge = r => `<span class="badge" style="background:${RAR[r].c}">${RAR[r].n}</span>`;

// ---------------- rolling items ----------------
const KIND = {
  camp: ['Campsite', '⛺', 1.6], picnic: ['Picnic Spot', '🧺', 1.2], view: ['Viewpoint', '🔭', 1.8], peak: ['Summit', '⛰️', 2],
  play: ['Playground', '🛝', 1], fire: ['Fire Ring', '🔥', 1.3], shelter: ['Trail Shelter', '🛖', 1.3], reserve: ['Nature Reserve', '🌲', 1.4],
  park: ['Park', '🌳', 1], landmark: ['Landmark', '🏛️', 2], player: ['Hidden Cache', '📦', 1]
};
const kindInfo = k => KIND[k] || KIND.park;
function rollRarity(r, boost) {
  const w = RAR.map((x, i) => x.w * (i >= 2 ? boost : 1)); let x = r() * w.reduce((a, b) => a + b);
  for (let i = 0; i < w.length; i++) { if ((x -= w[i]) < 0) return i; } return 0;
}
function rollItem(r, boost = 1, tier) {
  const t = tier == null ? rollRarity(r, boost) : tier, a = BY_R[t]; return a[Math.floor(r() * a.length)];
}
const SLOT_IDS = 'abcdefgh'.split('');
function wildItems(id, day, boost, slots) {
  const out = {};
  slots.forEach(s => { out[s] = { id: rollItem(rng(hashStr(id + '|' + day + '|' + s)), boost).id, w: 1, at: Date.now() }; });
  return out;
}
function makeChest(meta, day) {
  const boost = kindInfo(meta.kind)[2];
  return { name: meta.name, lat: meta.lat, lon: meta.lon, kind: meta.kind, day, created: Date.now(),
           items: wildItems(meta.id, day, boost, SLOT_IDS.slice(0, C.CHEST_SLOTS)) };
}
function refreshChest(cur, meta, day) {
  // Wild (auto-generated) items rotate daily. Items left by players stay until somebody swaps them.
  const items = {};
  Object.keys(cur.items || {}).forEach(s => { const it = cur.items[s]; if (it && BY_ID[it.id]) items[s] = it; });
  const wildSlots = Object.keys(items).filter(s => items[s].w);
  // Make sure the chest is never left empty, even if its stored record was damaged or partial.
  SLOT_IDS.slice(0, C.CHEST_SLOTS).forEach(s => { if (!items[s] && wildSlots.indexOf(s) < 0) wildSlots.push(s); });
  const fresh = wildItems(meta.id, day, kindInfo(cur.kind || meta.kind)[2], wildSlots);
  cur.items = Object.assign(items, fresh); cur.day = day; return cur;
}

// ---------------- activity ----------------
// The server records what happened to items other players left, so coming back shows
// that the world moved while you were away.
async function checkFeed() {
  if (!KEY) return;
  let list = [];
  try { list = (await DB.get('feed/' + KEY)) || []; } catch (e) { return; }
  if (!Array.isArray(list) || !list.length) return;
  const fresh = list.filter(e => e && e.t > (P.feedSeen || 0));
  if (!fresh.length) return;
  P.feedSeen = fresh[0].t; save();
  showFeed(fresh.slice(0, 12));
}
function feedLine(e) {
  const gone = BY_ID[e.item], got = BY_ID[e.got];
  if (e.k === 'taken' && gone) {
    return `<div class="fitem">${tile(gone)}<div><b>${esc(gone.n)}</b>
      <small>taken by ${esc(e.by || 'someone')}${e.where ? ' at ' + esc(e.where) : ''}</small>
      <small class="fine">${got ? 'They left ' + esc(got.n) : ''}</small></div></div>`;
  }
  return '';
}
function showFeed(events) {
  const body = events.map(feedLine).filter(Boolean).join('');
  if (!body) return;
  modal(`<h3>While you were away</h3>
    <p class="sub">${events.length === 1 ? 'Someone found something you left.' : events.length + ' of your items found a new owner.'}</p>
    <div class="feed">${body}</div>
    <button class="btn big" id="okBtn" style="margin-top:14px">Nice</button>`,
    m => { $('#okBtn', m).onclick = closeModal; FX.sfx('ping'); });
}

// ---------------- workshop ----------------
// Each level is unlocked by an achievement, so crafting is something you grow into.
// Your level is also the highest rarity you can merge up to (1 = Uncommon ... 4 = Legendary).
const WORKSHOP = [
  { lvl: 1, name: 'Apprentice',  ach: 'ex1',    how: 'Complete your first trade' },
  { lvl: 2, name: 'Tinker',      ach: 'visit5', how: 'Open 5 different chests' },
  { lvl: 3, name: 'Artisan',     ach: 'dex50',  how: 'Collect 50 different items' },
  { lvl: 4, name: 'Master',      ach: 'ex50',   how: 'Complete 50 trades' },
  { lvl: 5, name: 'Grandmaster', ach: 'dex100', how: 'Collect 100 different items' }
];
const workshopLevel = () => WORKSHOP.filter(w => P.ach[w.ach]).length;
const nextWorkshop = () => WORKSHOP.find(w => !P.ach[w.ach]);

// Three of the same item become one of the next rarity up.
function mergeOptions() {
  const lvl = workshopLevel(), out = [];
  Object.keys(P.inv).forEach(id => {
    const it = BY_ID[id];
    if (!it || it.crafted || it.r >= 4 || P.inv[id] < C.MERGE_COUNT) return;
    const to = BY_R[it.r + 1].find(x => x.base === it.base);
    if (to) out.push({ from: it, to, have: P.inv[id], ok: lvl >= it.r + 1 });
  });
  return out.sort((a, b) => b.from.r - a.from.r || a.from.n.localeCompare(b.from.n));
}
function doMerge(id) {
  if (needNet('Merging')) return;
  const it = BY_ID[id];
  if (!it || P.inv[id] < C.MERGE_COUNT || it.r >= 4) return toast('Not enough to merge', 'bad');
  if (workshopLevel() < it.r + 1) return toast(`Workshop level ${it.r + 1} needed for that`, 'bad');
  const to = BY_R[it.r + 1].find(x => x.base === it.base);
  if (!to) return toast('Nothing to merge into', 'bad');
  for (let i = 0; i < C.MERGE_COUNT; i++) removeItem(id);
  const isNew = addItem(to.id);
  P.stats.merges = (P.stats.merges || 0) + 1;
  earn(CO.merge, 'Merge');
  save(); checkAch(); renderAll();
  showMade(to, `${C.MERGE_COUNT} × ${it.n} became`, isNew);
}

// Which ingredients a recipe still needs, and the cheapest thing you own that satisfies each.
function recipeState(relic) {
  const used = {}, parts = relic.req.map(([base, minR]) => {
    let pick = null;
    for (let r = minR; r <= 4 && !pick; r++) {
      const cand = BY_R[r].find(x => x.base === base);
      if (cand && (P.inv[cand.id] || 0) > (used[cand.id] || 0)) { pick = cand; used[cand.id] = (used[cand.id] || 0) + 1; }
    }
    return { base, minR, pick, sample: BY_R[minR].find(x => x.base === base) };
  });
  return { locked: workshopLevel() < relic.lvl, parts, ready: parts.every(p => p.pick) };
}
function doCraft(id) {
  if (needNet('Crafting')) return;
  const relic = BY_ID[id]; if (!relic || !relic.crafted) return;
  const st = recipeState(relic);
  if (st.locked) return toast(`Workshop level ${relic.lvl} needed`, 'bad');
  if (!st.ready) return toast('You are missing an ingredient', 'bad');
  st.parts.forEach(p => removeItem(p.pick.id));
  const isNew = addItem(relic.id);
  P.stats.crafted = (P.stats.crafted || 0) + 1;
  earn(CO.craft, 'Relic crafted');
  save(); checkAch(); renderAll();
  showMade(relic, 'You crafted', isNew);
}
function showMade(it, lead, isNew) {
  FX.sfx('coin');
  modal(`<div style="text-align:center"><p class="sub">${esc(lead)}</p>${revealBox(it)}
    <h3 style="margin-top:12px">${esc(it.n)}</h3>${badge(it.r)}${it.crafted ? ' <span class="badge" style="background:#6a5acd">Crafted only</span>' : ''}
    <p class="sub" style="margin-top:10px">${isNew ? '✨ New for your shelf!' : 'Added to your pack.'}</p>
    <button class="btn big" id="okBtn">Great</button></div>`,
    m => { $('#okBtn', m).onclick = closeModal; setTimeout(() => FX.reveal(it.r, $('.tile.big', m)), 200); });
}

// ---------------- player state ----------------
let P = null, KEY = null, inviteCount = 0;
function newPlayer(name, ref) {
  return { name, created: Date.now(), inv: {}, dex: {}, ach: {}, exch: {}, title: 'Newcomer', ref: ref || '', refPaid: 0, refSent: 0,
           stats: { visited: {}, ex: 0, hidden: 0, gaveRare: 0, walkedM: 0, walkPaid: 0, coinsEarned: 0, coinsSpent: 0, bought: 0 },
           daily: { n: 0, last: '', streak: 0, max: 0 }, hideDay: '', hideN: 0,
           coins: (C.COINS && C.COINS.start) || 0, coinsV: 1, shop: { day: 0, bought: {} }, found: {} };
}
// One trade per chest per TRADE_COOLDOWN_MIN. P.exch[chestId] is when you last traded there.
const TRADE_MS = () => (C.TRADE_COOLDOWN_MIN || 60) * 60000;
function tradeWait(id) { const t = P.exch[id]; return typeof t === 'number' ? Math.max(0, t + TRADE_MS() - Date.now()) : 0; }
function fmtWait(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000)), h = Math.floor(m / 60), r = m % 60;
  if (!h) return m + ' min';
  return r ? `${h} h ${r} min` : `${h} hour${h === 1 ? '' : 's'}`;
}
function normalize(p) {
  p.inv = p.inv || {}; p.dex = p.dex || {}; p.ach = p.ach || {}; p.exch = p.exch || {};
  // drop finished cooldowns (and the old once-a-day date strings) so the record stays small
  const cut = Date.now() - (C.TRADE_COOLDOWN_MIN || 60) * 60000;
  Object.keys(p.exch).forEach(k => { if (typeof p.exch[k] !== 'number' || p.exch[k] < cut) delete p.exch[k]; });
  p.stats = Object.assign({ visited: {}, ex: 0, hidden: 0, gaveRare: 0 }, p.stats || {}); p.stats.visited = p.stats.visited || {};
  p.daily = Object.assign({ n: 0, last: '', streak: 0, max: 0 }, p.daily || {}); p.title = p.title || 'Newcomer';
  p.refPaid = p.refPaid || 0;                       // referrals already rewarded
  p.feedSeen = p.feedSeen || 0;                     // newest activity already shown
  p.coins = p.coins || 0;
  p.found = p.found && typeof p.found === 'object' ? p.found : {};
  p.shop = p.shop && typeof p.shop === 'object' ? p.shop : { day: 0, bought: {} };
  p.shop.bought = p.shop.bought || {};
  return p;
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  snapshot();
  saveTimer = setTimeout(() => DB.set('players/' + KEY, P)
    .then(() => { if (OFFLINE) backOnline(); })
    .catch(() => { goOffline(); toast('Could not sync – check your connection', 'bad'); }), 150);
}
// A copy of your record kept on the device, so the game still opens with no signal.
function snapshot() {
  try { if (KEY && P) localStorage.setItem('sw_snap_' + KEY, JSON.stringify({ t: Date.now(), p: P })); } catch (e) {}
}
function snapshotOf(key) {
  try { const o = JSON.parse(localStorage.getItem('sw_snap_' + key) || 'null'); return o && o.p ? o : null; } catch (e) { return null; }
}
function packCount() { return Object.values(P.inv).reduce((a, b) => a + b, 0); }
function addItem(id, bought) {
  P.inv[id] = (P.inv[id] || 0) + 1;
  if (P.dex[id]) return false;
  P.dex[id] = Date.now();
  if (!bought) earn(CO.newItem, 'New for your shelf');
  return true;
}
function removeItem(id) { if (!P.inv[id]) return false; if (--P.inv[id] <= 0) delete P.inv[id]; return true; }

// A starting kit, so a new player can trade at the very first chest they find.
function grantStarter(p, extra) {
  const ids = [];
  for (let i = 0; i < C.STARTER_ITEMS + (extra || 0); i++) ids.push(rollItem(Math.random, 1).id);
  ids.forEach(id => { p.inv[id] = (p.inv[id] || 0) + 1; p.dex[id] = Date.now(); });
  return ids;
}
// Accounts made before the starting kit existed, still untouched, get one on their next sign-in.
function starterIfEmpty(p) {
  const fresh = !Object.keys(p.inv).length && !Object.keys(p.dex).length && !(p.stats && p.stats.ex) && !p.daily.n;
  return fresh ? grantStarter(p, 0) : null;
}

// A Rare for every friend who joins and opens a chest, with bigger milestones at 5 and 10.
function referralRewards(from, to) {
  const out = [];
  for (let n = from + 1; n <= to; n++) {
    out.push(rollItem(Math.random, 1, 2));
    if (n === 5) out.push(rollItem(Math.random, 1, 3));
    if (n === 10) out.push(rollItem(Math.random, 1, 4));
  }
  return out;
}
// Re-read the tally and pay out anything owed. Safe to call often.
async function refreshInvites(quiet) {
  if (!KEY) return;
  let n = 0;
  try { n = (await DB.get('invites/' + KEY)) || 0; } catch (e) { return; }
  if (typeof n !== 'number' || n < 0) return;
  inviteCount = n;
  const paid = P.refPaid || 0;
  if (n > paid) {
    const items = referralRewards(paid, n), gained = n - paid;
    P.refPaid = n;
    items.forEach(it => addItem(it.id));
    earn(CO.referral * gained, gained === 1 ? 'Friend joined' : gained + ' friends joined');
    save(); checkAch(); renderAll();
    if (!quiet) showReferralReward(gained, items);
  } else { checkAch(); renderHeader(); }
}
function showReferralReward(count, items) {
  const best = items.reduce((a, b) => (b.r > a.r ? b : a));
  modal(`<div style="text-align:center"><h3>${count === 1 ? 'A friend joined!' : count + ' friends joined!'}</h3>
    <p class="sub">They found their first chest, so here's your thank-you.</p>
    <div class="grid" style="justify-content:center">${items.map(it => tile(it)).join('')}</div>
    <p class="fine" style="margin-top:12px">${esc(String(inviteCount))} friend${inviteCount === 1 ? '' : 's'} invited so far.</p>
    <button class="btn big" id="okBtn" style="margin-top:12px">Nice</button></div>`,
    m => { $('#okBtn', m).onclick = closeModal; setTimeout(() => { FX.sfx('reveal', best.r); FX.confetti(['#4aa3ff', '#ffd98a', '#ffffff'], 50); }, 250); });
}

// ---------------- trail coins ----------------
// Earned for walking and for playing; spent in the shop on the exact items a merge or a
// relic recipe is waiting on. Every amount lives in config.js under COINS.
const CO = Object.assign({ start: 50, mile: 100, daily: 20, dailyStreak: 5, dailyBig: 75, chestNew: 15, trade: 10, gift: 5,
  hide: 10, newItem: 3, merge: 5, craft: 25, achievement: 50, referral: 200 }, C.COINS || {});
const PRICE = C.PRICES || [40, 110, 280, 700, 1800];
const priceOf = it => PRICE[it.r] || PRICE[0];
const fmtC = n => Math.round(n).toLocaleString();

function earn(n, why) {
  n = Math.round(n || 0); if (!(n > 0) || !P) return;
  P.coins = (P.coins || 0) + n;
  P.stats.coinsEarned = (P.stats.coinsEarned || 0) + n;
  coinPop(n, why);
  renderCoins();
}
function spend(n) {
  if ((P.coins || 0) < n) return false;
  P.coins -= n; P.stats.coinsSpent = (P.stats.coinsSpent || 0) + n;
  renderCoins(); return true;
}
function renderCoins() {
  const c = $('#hCoins'), v = $('#hCoinsV'); if (!c || !P) return;
  if (v) v.textContent = fmtC(P.coins || 0);
  c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
  if (view === 'shop' && shopSub === 'shop') renderShopHead();
}
// "+15 🪙 New chest" just under the coin counter. Several earned at once (a trade that is
// also new for your shelf) become one pop rather than a stack of them.
let popAcc = null;
function coinPop(n, why) {
  if (!popAcc) popAcc = { n: 0, why: [] };
  popAcc.n += n; if (why && !popAcc.why.includes(why)) popAcc.why.push(why);
  clearTimeout(popAcc.t);
  popAcc.t = setTimeout(flushPop, 350);
}
function flushPop() {
  const a = popAcc; popAcc = null; if (!a || !a.n) return;
  // never on top of the chest opening - wait for it to finish
  if (document.querySelector('.cine')) { popAcc = a; popAcc.t = setTimeout(flushPop, 400); return; }
  const host = $('#coinpops'); if (!host) return;
  const el = document.createElement('div'); el.className = 'coinpop';
  el.innerHTML = `<b>+${fmtC(a.n)} 🪙</b>${a.why.length ? `<small>${esc(a.why.slice(0, 2).join(' · '))}</small>` : ''}`;
  host.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

// What everyone who played before coins existed has already earned, paid once.
function retroCoins() {
  const s = statView();
  return s.visited * CO.chestNew + s.ex * CO.trade + s.logins * CO.daily + Object.keys(P.ach).length * CO.achievement +
         s.given * CO.gift + s.hidden * CO.hide + s.merges * CO.merge + s.crafted * CO.craft + s.dex * CO.newItem +
         (P.refPaid || 0) * CO.referral;
}
function showCoinIntro(amt, tries) {
  if ($('#modal').classList.contains('open')) { if ((tries || 0) < 20) setTimeout(() => showCoinIntro(amt, (tries || 0) + 1), 1500); return; }
  modal(`<div style="text-align:center"><div class="coinbig">🪙</div><h3>Trail Coins are here</h3>
    <p class="sub">Walk with Stashwalk open and you earn ${CO.mile} coins a mile. Chests, trades, daily rewards and
    achievements pay out too. Spend them in the new <b>Shop</b> on the exact items your merges and recipes need.</p>
    <p class="sub" style="color:var(--acc2)"><b>+${fmtC(amt)} 🪙</b> for everything you have already done.</p>
    <div class="trade"><button class="btn ghost" id="okBtn">Later</button><button class="btn" id="goShop">Open the shop</button></div></div>`,
    m => { $('#okBtn', m).onclick = closeModal; $('#goShop', m).onclick = () => { closeModal(); shopSub='shop'; show('shop'); };
           FX.sfx('coin'); });
}

// ---------------- miles walked ----------------
// The browser only reports position while the game is open, so this counts walking done
// with Stashwalk on screen. GPS drifts a few metres even when you stand still, so a move only
// counts once it beats both a floor and the reported uncertainty, and anything faster than
// a run is treated as a vehicle and ignored.
const MI = 1609.344, WALK_STEP = MI / 10;
let walkLast = null;
function trackWalk(lat, lon, acc, manual) {
  if (manual || DEV || !P) { walkLast = null; return; }
  if (!(acc > 0) || acc > 30) return;                          // too fuzzy to trust
  const now = Date.now();
  if (!walkLast) { walkLast = { lat, lon, t: now, acc }; return; }
  const d = dist(walkLast, { lat, lon });
  if (d < Math.max(10, (acc + walkLast.acc) * 0.6)) return;     // still within the wobble: keep the anchor
  const speed = d / Math.max(1, (now - walkLast.t) / 1000);
  walkLast = { lat, lon, t: now, acc };
  if (speed > (C.MAX_WALK_MPS || 6.5)) return;                  // driving, or a GPS jump
  addWalk(d);
}
function addWalk(m) {
  P.stats.walkedM = (P.stats.walkedM || 0) + m;
  const paid = P.stats.walkPaid || 0, steps = Math.floor(P.stats.walkedM / WALK_STEP);
  if (steps > paid) {
    P.stats.walkPaid = steps;
    earn((steps - paid) * CO.mile / 10, 'Walking');
    if (Math.floor(steps / 10) > Math.floor(paid / 10)) {
      const miles = Math.floor(steps / 10);
      toast(`🥾 ${miles} mile${miles === 1 ? '' : 's'} walked!`, 'gold'); FX.sfx('ach'); FX.vibe([20, 30, 20]);
    }
    checkAch(); save();
  } else snapshot();
  renderWalk();
}
const milesOf = () => (P.stats.walkedM || 0) / MI;
function renderWalk() {
  const el = $('#walkTxt'); if (el && P) el.textContent = '🥾 ' + milesOf().toFixed(2) + ' mi';
  if (view === 'shop' && shopSub === 'shop') renderShopHead();
}

// ---------------- shop ----------------
// Today's stock is the same for every player and turns over at midnight UTC; a Legendary
// joins it on Sundays. Under it, offers built from your own pack: the copies that would
// finish a merge, and the ingredients your relic recipes are still missing.
const SHOP_SLOTS = [0, 0, 0, 1, 1, 2, 2, 3];
const sundayShop = d => (d + 4) % 7 === 0;                     // utcDay 3 was a Sunday
function dailyStock() {
  const day = utcDay(), R = rng(hashStr('stashwalk-shop-' + day)), seen = new Set();
  const want = SHOP_SLOTS.slice(); if (sundayShop(day)) want[want.length - 1] = 4;
  return want.map(r => {
    let it, guard = 0;
    do { it = BY_R[r][Math.floor(R() * BY_R[r].length)]; } while (seen.has(it.base) && ++guard < 40);
    seen.add(it.base); return it;
  });
}
function shopState() {
  const d = utcDay();
  if (P.shop.day !== d) P.shop = { day: d, bought: {} };
  return P.shop;
}
function mergeOffers() {
  const lvl = workshopLevel(), out = [];
  Object.keys(P.inv).forEach(id => {
    const it = BY_ID[id]; if (!it || it.crafted || it.r >= 4) return;
    const have = P.inv[id]; if (have >= C.MERGE_COUNT) return;
    const need = C.MERGE_COUNT - have, to = BY_R[it.r + 1].find(x => x.base === it.base);
    if (to) out.push({ it, to, need, have, price: Math.round(priceOf(it) * need * 0.9), locked: lvl < it.r + 1 });
  });
  return out.sort((a, b) => a.locked - b.locked || a.need - b.need || b.it.r - a.it.r || a.it.n.localeCompare(b.it.n)).slice(0, 6);
}
function craftOffers() {
  const lvl = workshopLevel(), out = [], seen = new Set();
  RELICS.filter(r => r.lvl <= Math.max(1, lvl + 1)).sort((a, b) => a.lvl - b.lvl).forEach(rel => {
    const st = recipeState(rel);
    st.parts.forEach(pt => {
      if (pt.pick || !pt.sample || seen.has(pt.sample.id)) return;
      seen.add(pt.sample.id);
      out.push({ it: pt.sample, relic: rel, price: priceOf(pt.sample), locked: st.locked });
    });
  });
  return out.slice(0, 8);
}
function timeToReset() {
  const ms = (utcDay() + 1) * 86400000 - Date.now(), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
function renderShopHead() {
  const el = $('#shopHead'); if (!el) return;
  const into = ((P.stats.walkedM || 0) % WALK_STEP) / WALK_STEP;
  el.innerHTML = `<div class="shopbal"><span>Balance</span><b>🪙 ${fmtC(P.coins || 0)}</b></div>
    <div class="walkcard"><div><b>🥾 ${milesOf().toFixed(2)} mi</b><small>walked with Stashwalk open</small></div>
      <div class="walknext"><span class="bar"><i style="width:${Math.round(into * 100)}%"></i></span>
      <small>+${CO.mile / 10} 🪙 in ${((1 - into) * 0.1).toFixed(2)} mi</small></div></div>`;
}
function renderShop() {
  const st = shopState(), stock = dailyStock(), merges = mergeOffers(), crafts = craftOffers();
  const can = n => (P.coins || 0) >= n;
  let h = `<div class="card shoptop" id="shopHead"></div>` + droneCard();
  h += `<h2 class="sec">Today's stock <small>new stock in ${timeToReset()}${sundayShop(utcDay()) ? ' · 🌟 Sunday Legendary' : ''}</small></h2>
    <div class="grid shopgrid">${stock.map((it, i) => {
      const sold = !!st.bought[i];
      return `<div class="shopit${sold ? ' sold' : ''}${!sold && !can(priceOf(it)) ? ' dear' : ''}" data-buy="d${i}">${tile(it)}
        <b class="price">${sold ? 'Sold' : '🪙 ' + fmtC(priceOf(it))}</b></div>`;
    }).join('')}</div>`;
  h += `<h2 class="sec">Finish a merge <small>${C.MERGE_COUNT} of a kind → next rarity</small></h2>`;
  h += merges.length ? merges.map((o, i) => `<div class="offer${can(o.price) ? '' : ' dear'}" data-buy="m${i}">
      ${tile(o.it, { count: o.need })}<div class="otxt"><b>${o.need} × ${esc(o.it.n)}</b>
      <small>You have ${o.have}. ${o.locked ? `Workshop level ${o.it.r + 1} merges it.` : `Makes a ${esc(o.to.n)}.`}</small></div>
      <button class="btn sm">🪙 ${fmtC(o.price)}</button></div>`).join('')
    : `<div class="empty">Pick up an item and its merge partners will be offered here.</div>`;
  h += `<h2 class="sec">Recipe ingredients <small>relics are still craft-only</small></h2>`;
  h += crafts.length ? crafts.map((o, i) => `<div class="offer${can(o.price) ? '' : ' dear'}" data-buy="c${i}">
      ${tile(o.it)}<div class="otxt"><b>${esc(o.it.n)}</b>
      <small>For ${esc(o.relic.n)}${o.locked ? ` · Workshop level ${o.relic.lvl}` : ''}</small></div>
      <button class="btn sm">🪙 ${fmtC(o.price)}</button></div>`).join('')
    : `<div class="empty">You have everything your available recipes need.</div>`;
  h += `<div class="card earnlist"><b>Ways to earn</b><ul>
    <li>🥾 Walking <b>${CO.mile} / mile</b></li><li>🎁 Daily reward <b>${CO.daily}–${CO.daily + CO.dailyStreak * 6 + CO.dailyBig}</b></li>
    <li>📦 A chest you have never opened <b>${CO.chestNew}</b></li><li>🔁 Trade <b>${CO.trade}</b></li>
    <li>🏅 Achievement <b>${CO.achievement}</b></li><li>⚒️ Craft a relic <b>${CO.craft}</b></li>
    <li>🫳 Hide a chest <b>${CO.hide}</b></li><li>🎁 Leave a gift <b>${CO.gift}</b></li>
    <li>🔗 Merge <b>${CO.merge}</b></li><li>✨ New for your shelf <b>${CO.newItem}</b></li>
    <li>💌 Friend joins <b>${CO.referral}</b></li>
    <li>🛣️ Coins on streets &amp; trails <b>${RCF.value[0]}–${RCF.value[1] + RCF.pathBonus}</b></li><li>💰 Gold stack <b>${RCF.stackValue}</b></li></ul></div>`;
  $('#shopBox').innerHTML = h;
  renderShopHead();
  const bd = $('#buyDrone'); if (bd) bd.onclick = buyDrone;
  const ud = $('#upDrone'); if (ud) ud.onclick = upgradeDrone;
  $('#shopBox').onclick = e => {
    const b = e.target.closest('[data-buy]'); if (!b) return;
    const k = b.dataset.buy, i = +k.slice(1);
    if (k[0] === 'd') { if (st.bought[i]) return toast('Sold out until tomorrow'); const it = stock[i]; buyDialog([it.id], priceOf(it), it.n, () => { shopState().bought[i] = 1; }); }
    if (k[0] === 'm') { const o = merges[i]; buyDialog(Array(o.need).fill(o.it.id), o.price, `${o.need} × ${o.it.n}`); }
    if (k[0] === 'c') { const o = crafts[i]; buyDialog([o.it.id], o.price, o.it.n); }
  };
}
function buyDialog(ids, price, label, after) {
  const it = BY_ID[ids[0]], short = (P.coins || 0) < price;
  modal(`<div style="text-align:center">${revealBox(it)}<h3 style="margin-top:12px">${esc(label)}</h3>${badge(it.r)}
    <p class="sub" style="margin-top:10px">${short ? `You need <b>${fmtC(price - (P.coins || 0))}</b> more 🪙 – about ${((price - (P.coins || 0)) / CO.mile).toFixed(1)} mi of walking.`
      : `Balance after: 🪙 ${fmtC((P.coins || 0) - price)}`}</p>
    <div class="trade"><button class="btn ghost" id="okBtn">Cancel</button>
    <button class="btn" id="buyGo" ${short ? 'disabled' : ''}>Buy for 🪙 ${fmtC(price)}</button></div></div>`,
    m => { $('#okBtn', m).onclick = closeModal; $('#buyGo', m).onclick = () => doBuy(ids, price, label, after); });
}
function doBuy(ids, price, label, after) {
  if (needNet('Buying')) return;
  if (!spend(price)) return toast('Not enough coins', 'bad');
  const fresh = ids.filter((id, i) => ids.indexOf(id) === i && !P.dex[id]);
  ids.forEach(id => addItem(id, true));
  if (after) after();
  P.stats.bought = (P.stats.bought || 0) + 1;
  save(); checkAch(); renderAll();
  const it = BY_ID[ids[0]];
  FX.sfx('coin');
  modal(`<div style="text-align:center"><p class="sub">Bought</p>${revealBox(it)}<h3 style="margin-top:12px">${esc(label)}</h3>${badge(it.r)}
    <p class="sub" style="margin-top:10px">${fresh.length ? '✨ New for your shelf!' : 'Added to your pack.'}</p>
    <button class="btn big" id="okBtn">Great</button></div>`,
    m => { $('#okBtn', m).onclick = closeModal; setTimeout(() => FX.reveal(it.r, $('.tile.big', m), true), 200); });
}

// ---------------- drone ----------------
// Bought and upgraded in the shop, flown from the map. You steer it with the stick in the
// corner; the map follows it, and the locator's heat bar, ticking and sonar all run from
// the drone instead of from you. Hover it close to a chest and it can open it for you.
// The only limit is range, set by its level.
const DL = C.DRONE_LEVELS || [{ ft: 300, cost: 0 }];
const DRONE_MAX = DL.length;
const droneRangeM = lvl => (DL[Math.max(0, Math.min(DRONE_MAX, lvl) - 1)] || DL[0]).ft * 0.3048;
const DRONE_REACH = () => (C.DRONE_REACH_FT || 50) * 0.3048;
const DRONE_LISTEN = () => (C.DRONE_LISTEN_FT || 400) * 0.3048;
const fmtFt = m => { const ft = m * FT; return ft >= 1000 ? (ft / 5280).toFixed(2) + ' mi' : Math.round(ft) + ' ft'; };
const droneTop = lvl => Math.max(C.DRONE_SPEED_MPS || 45, droneRangeM(lvl) / (C.DRONE_EDGE_S || 30));

function droneState() {
  if (!P.drone || typeof P.drone !== 'object') P.drone = { lvl: 0 };
  return P.drone;
}
const hasDrone = () => droneState().lvl > 0;
function buyDrone() {
  if (needNet('Buying')) return;
  if (hasDrone()) return;
  if (!spend(C.DRONE_PRICE || 500)) return toast('Not enough coins', 'bad');
  const d = droneState();
  d.lvl = 1;
  P.stats.bought = (P.stats.bought || 0) + 1;
  save(); checkAch(); renderAll(); FX.sfx('drone');
  modal(`<div style="text-align:center">${droneSVG('big')}<h3>Your drone is ready</h3>
    <p class="sub">Tap 🛸 on the map to launch it. Steer with the stick, follow the ticking, and hover it
    over a chest to open it from up to ${fmtFt(droneRangeM(1))} away.</p>
    <button class="btn big" id="okBtn">Let's fly</button></div>`, m => { $('#okBtn', m).onclick = closeModal; });
}
function upgradeDrone() {
  if (needNet('Upgrading')) return;
  const d = droneState(); if (!d.lvl || d.lvl >= DRONE_MAX) return;
  const cost = DL[d.lvl].cost;
  if (!spend(cost)) return toast('Not enough coins', 'bad');
  d.lvl++;
  save(); checkAch(); renderAll(); FX.sfx('ach'); FX.vibe([20, 30, 20]);
  toast(`🛸 Drone level ${d.lvl} – range ${fmtFt(droneRangeM(d.lvl))}`, 'gold');
}
function droneSVG(cls) {
  return `<svg class="dronesvg ${cls || ''}" viewBox="0 0 64 64" aria-hidden="true">
    <g class="darms" stroke="#2c3e35" stroke-width="5" stroke-linecap="round"><path d="M14 14 L50 50 M50 14 L14 50"/></g>
    <g class="drotors">${[[14, 14], [50, 14], [14, 50], [50, 50]].map(([x, y]) =>
      `<g transform="translate(${x} ${y})"><circle r="11" fill="#9fd6ff22" stroke="#9fd6ff66" stroke-width="1"/>
       <g class="rotor"><rect x="-10" y="-1.6" width="20" height="3.2" rx="1.6" fill="#dff1ff"/></g>
       <circle r="2.6" fill="#1b2a22"/></g>`).join('')}</g>
    <rect x="22" y="22" width="20" height="20" rx="6" fill="#f2b84b" stroke="#a8761f" stroke-width="2"/>
    <circle cx="32" cy="32" r="4.5" fill="#1b2a22"/><circle cx="32" cy="32" r="2" fill="#7ff0ff"/>
  </svg>`;
}

// ---- flight ----
let fly = null;          // { ll:{lat,lon}, vx, vy, raf, last, marker, tether, ring, near, lastProbe }
const joy = { x: 0, y: 0 };
const keys = {};
function launchDrone() {
  if (fly) return;
  if (!hasDrone()) { shopSub = 'shop'; return show('shop'); }
  if (!pos || !map || !window.L) return toast('Turn on GPS first', 'bad');
  if (needNet('Flying the drone')) return;
  const d = droneState();
  stopLocate(true);
  const ll = { lat: pos.lat, lon: pos.lon };
  const icon = L.divIcon({ className: 'droneicon', html: `<div class="dronewrap">${droneSVG()}</div>`, iconSize: [52, 52] });
  fly = {
    ll, raf: 0, last: performance.now(), near: null, lastProbe: 0,
    marker: L.marker([ll.lat, ll.lon], { icon, zIndexOffset: 2000, interactive: false, keyboard: false }).addTo(map),
    tether: L.polyline([[pos.lat, pos.lon], [ll.lat, ll.lon]], { color: '#7ff0ff', weight: 2, opacity: .55, dashArray: '4 6', interactive: false }).addTo(map),
    ring: L.circle([pos.lat, pos.lon], { radius: droneRangeM(d.lvl), color: '#7ff0ff', weight: 1.5, opacity: .45, fillOpacity: .04, interactive: false }).addTo(map),
    layer: L.layerGroup().addTo(map), local: [], scanAt: null
  };
  droneScan(true);
  try { map.dragging.disable(); } catch (e) {}
  RC.lastDraw = null;
  const z = d.lvl >= 7 ? 15 : d.lvl >= 5 ? 16 : 17;
  if (map.getZoom() !== z) map.setView([ll.lat, ll.lon], z, { animate: false });
  document.body.classList.add('flying');
  // the map grows to fill the screen; once it has, put the drone back in view
  requestAnimationFrame(() => { try { map.invalidateSize({ animate: false }); map.setView([fly.ll.lat, fly.ll.lon], map.getZoom(), { animate: false }); } catch (e) {} });
  renderDroneHud(true);
  FX.unlock(); FX.sfx('drone'); FX.vibe(40);
  fly.raf = requestAnimationFrame(flyStep);
}
function endFlight(why) {
  if (!fly) return;
  RC.lastDraw = null;
  cancelAnimationFrame(fly.raf);
  try { fly.marker.remove(); fly.tether.remove(); fly.ring.remove(); fly.layer.remove(); } catch (e) {}
  fly = null; joy.x = joy.y = 0;
  try { map.dragging.enable(); } catch (e) {}
  document.body.classList.remove('flying');
  try { map.invalidateSize({ animate: false }); } catch (e) {}
  document.body.style.removeProperty('--sonar');
  FX.geiger(Infinity, 1);
  const hud = $('#droneHud'); if (hud) { hud.hidden = true; hud.innerHTML = ''; }
  if (why !== 'open') { FX.sfx('dock'); if (pos && map) map.setView([pos.lat, pos.lon], map.getZoom(), { animate: true }); }
  if (why === 'range') toast('🛸 Signal lost – the drone flew home');
  markNear();
}
function flyStep(now) {
  if (!fly) return;
  const dt = Math.min(0.05, (now - fly.last) / 1000); fly.last = now;
  // stick, or arrow keys / WASD on a computer
  let ix = joy.x, iy = joy.y;
  const kx = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
  const ky = (keys.ArrowDown || keys.s ? 1 : 0) - (keys.ArrowUp || keys.w ? 1 : 0);
  if (kx || ky) { const l = Math.hypot(kx, ky); ix = kx / l; iy = ky / l; }
  // speed is the stick and nothing else: a light push creeps, a full push races, and the
  // drone never slows, steers or opens anything on its own
  // a thumb rarely reaches the rim of the stick, so 85% of the way out already counts as full
  const sp = droneTop(droneState().lvl) * Math.pow(Math.min(1, Math.hypot(ix, iy) / 0.85), 1.3);
  if (sp > 0.01) {
    const a = Math.atan2(iy, ix), mx = Math.cos(a) * sp * dt, my = -Math.sin(a) * sp * dt;   // screen up = north
    let lat = fly.ll.lat + my / 111320, lon = fly.ll.lon + mx / (111320 * Math.cos(fly.ll.lat * Math.PI / 180));
    // hold it inside the range circle around wherever you are now
    const R = droneRangeM(droneState().lvl), d = dist(pos, { lat, lon });
    if (d > R) { const k = R / d; lat = pos.lat + (lat - pos.lat) * k; lon = pos.lon + (lon - pos.lon) * k; }
    fly.ll = { lat, lon };
    fly.marker.setLatLng([lat, lon]);
    const tilt = Math.max(-18, Math.min(18, ix * 18));
    const w = fly.marker.getElement && fly.marker.getElement(); if (w) w.style.setProperty('--tilt', tilt + 'deg');
    // keep the drone in the clear part of the map - below the HUD, above the stick - without
    // re-centring every frame
    const cp = map.latLngToContainerPoint([lat, lon]), sz = map.getSize();
    const hudB = (($('#droneHud') || {}).offsetHeight || 0) + 24, top = Math.max(sz.y * .3, hudB), bot = Math.max(top + 40, sz.y * .72);
    const ox = cp.x < sz.x * .3 ? cp.x - sz.x * .3 : cp.x > sz.x * .7 ? cp.x - sz.x * .7 : 0;
    const oy = cp.y < top ? cp.y - top : cp.y > bot ? cp.y - bot : 0;
    if (ox || oy) map.panBy([ox, oy], { animate: false });
  }
  fly.tether.setLatLngs([[pos.lat, pos.lon], [fly.ll.lat, fly.ll.lon]]);
  if (!fly.ringAt || fly.ringAt.lat !== pos.lat || fly.ringAt.lon !== pos.lon) { fly.ring.setLatLng([pos.lat, pos.lon]); fly.ringAt = { lat: pos.lat, lon: pos.lon }; }
  if (now - fly.lastProbe > 160) { fly.lastProbe = now; probeFromDrone(); rcEnsureAround(fly.ll); rcDraw(); }
  rcCollect(fly.ll, true);
  fly.raf = requestAnimationFrame(flyStep);
}
// the locator, run from the drone's position
// Places near the drone. The main list only holds the player's nearest 150 places, so a drone
// a few miles out would otherwise fly over chests the game never loaded.
const DRONE_SCAN = 1200;
function droneScan(force) {
  if (!fly) return;
  const at = fly.ll;
  if (!force && fly.scanAt && dist(fly.scanAt, at) < 150) return;
  fly.scanAt = { lat: at.lat, lon: at.lon };
  const take = () => {
    if (!fly) return;
    const local = placesWithin(at.lat, at.lon, DRONE_SCAN).filter(p => !BLOCKED.has(p.id));
    const known = new Set(chests.map(c => c.id));
    fly.local = local;
    // markers for what the player's own list does not already show
    fly.layer.clearLayers();
    local.filter(p => !known.has(p.id) && isFound(p)).slice(0, 80).forEach(c => {
      L.marker([c.lat, c.lon], { icon: L.divIcon({ className: 'cm far', html: '<span>' + kindInfo(c.kind)[1] + '</span>', iconSize: [30, 30] }),
        interactive: false, keyboard: false }).addTo(fly.layer);
    });
  };
  take();
  loadTiles(at.lat, at.lon, DRONE_SCAN).then(take).catch(() => {});
}
function droneCandidates() {
  const seen = new Set(), out = [];
  for (const c of chests) { seen.add(c.id); out.push(c); }
  for (const c of (fly.local || [])) if (!seen.has(c.id)) out.push(c);
  return out;
}
function probeFromDrone() {
  if (!fly) return;
  droneScan();
  let best = null, bd = Infinity;
  droneCandidates().forEach(c => { const d = dist(fly.ll, c); if (d < bd) { bd = d; best = c; } });
  fly.near = best ? { c: best, d: bd } : null;
  if (best && !isFound(best) && bd <= Math.max(DRONE_REACH(), DISCOVER_M())) {
    if (!chests.some(c => c.id === best.id)) chests.push(Object.assign({}, best));
    discover(best);
  }
  refreshSearch();
  const gap = best ? Math.max(0, bd - DRONE_REACH()) : Infinity;
  FX.geiger(gap, DRONE_LISTEN());
  renderDroneHud();
}
function renderDroneHud(build) {
  const hud = $('#droneHud'); if (!hud || !fly) return;
  const d = droneState(), R = droneRangeM(d.lvl), out = dist(pos, fly.ll);
  if (build || !hud.firstChild) {
    hud.hidden = false;
    hud.innerHTML = `<div class="dhead"><i>🛸</i><b>Drone · Lv ${d.lvl}</b>
        <button class="dhide" id="droneHide" title="Hide a chest where the drone is">🫳 Hide</button>
        <button class="locx" id="droneHome" title="Bring it home">✕</button></div>
      <div class="drange"><span class="bar"><i id="dRange"></i></span><small id="dRangeTxt"></small></div>
      <div class="locbar"><i id="dFill"></i></div>
      <div class="locfoot"><span id="dWord">Searching…</span><span id="dName"></span></div>`;
    $('#droneHome', hud).onclick = () => endFlight('home');
    $('#droneHide', hud).onclick = () => { if (fly) hideDialog({ lat: fly.ll.lat, lon: fly.ll.lon }, true); };
  }
  const rf = Math.min(1, out / R);
  const ri = $('#dRange', hud); if (ri) { ri.style.width = Math.round(rf * 100) + '%'; ri.style.background = rf > .9 ? 'var(--bad)' : '#7ff0ff'; }
  const rt = $('#dRangeTxt', hud); if (rt) rt.textContent = `${fmtFt(out)} / ${fmtFt(R)}${rf > .97 ? ' · edge of range' : ''}`;
  const n = fly.near, openBtn = $('#droneOpen');
  if (!n) { $('#dWord', hud).textContent = 'No chests nearby'; if (openBtn) openBtn.hidden = true; return; }
  const gap = Math.max(0, n.d - DRONE_REACH()), frac = Math.max(0, Math.min(1, gap / DRONE_LISTEN()));
  const [, word, col] = heatOf(frac);
  const f = $('#dFill', hud); f.style.width = Math.round((1 - frac) * 100) + '%'; f.style.background = col; f.style.boxShadow = '0 0 12px ' + col;
  const w = $('#dWord', hud); w.textContent = gap <= 0 ? 'In reach' : word; w.style.color = col;
  $('#dName', hud).textContent = `${isFound(n.c) ? n.c.name : 'Hidden chest'} · ${fmtFt(n.d)}`;
  document.body.style.setProperty('--sonar', (0.42 + frac * 1.5).toFixed(2) + 's');
  document.body.style.setProperty('--sonarc', col);
  if (openBtn) {
    const inReach = gap <= 0 && isFound(n.c);
    openBtn.hidden = !inReach;
    if (inReach) { openBtn.textContent = `📦 Open ${n.c.name}`; openBtn.dataset.id = n.c.id; }
  }
}
async function droneOpen() {
  if (!fly || !fly.near || fly.near.d > DRONE_REACH()) return;
  const id = fly.near.c.id;
  if (!chests.some(c => c.id === id)) chests.push(Object.assign({}, fly.near.c));
  P.stats.droneOpens = (P.stats.droneOpens || 0) + 1;
  endFlight('open');
  await openChest(id, true);
  if (pos && map) map.setView([pos.lat, pos.lon], map.getZoom(), { animate: false });
}
function wireDrone() {
  const pad = $('#droneJoy'), knob = $('#droneKnob'); if (!pad) return;
  let pid = null;
  const R = () => pad.clientWidth / 2;
  const move = e => {
    const b = pad.getBoundingClientRect(), r = R();
    let dx = e.clientX - (b.left + r), dy = e.clientY - (b.top + r);
    const l = Math.hypot(dx, dy); if (l > r) { dx *= r / l; dy *= r / l; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    joy.x = dx / r; joy.y = dy / r;
  };
  pad.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); pid = e.pointerId; try { pad.setPointerCapture(pid); } catch (er) {} move(e); });
  pad.addEventListener('pointermove', e => { if (e.pointerId === pid) { e.preventDefault(); move(e); } });
  const up = e => { if (e.pointerId !== pid) return; pid = null; joy.x = joy.y = 0; knob.style.transform = ''; };
  pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
  $('#droneOpen').onclick = droneOpen;
  addEventListener('keydown', e => {
    if (!fly || (e.target && e.target.closest && e.target.closest('input,textarea,select'))) return;
    if (/^(Arrow|[wasd]$)/.test(e.key)) { keys[e.key] = true; e.preventDefault(); }
  });
  addEventListener('keyup', e => { keys[e.key] = false; });
}
function renderDroneBtn() {
  const b = $('#droneBtn'); if (!b || !P) return;
  b.hidden = !hasDrone();
}
// the drone card at the top of the shop
function droneCard() {
  const d = droneState(), price = C.DRONE_PRICE || 500, can = n => (P.coins || 0) >= n;
  if (!d.lvl) return `<div class="card dronecard"><div class="dtop">${droneSVG('shop')}<div><b>Scout drone</b>
      <small>Fly it from the map to chests up to ${fmtFt(droneRangeM(1))} away and open them remotely.
      Upgrades reach ${fmtFt(droneRangeM(DRONE_MAX))} at level ${DRONE_MAX}.</small></div></div>
      <button class="btn big" id="buyDrone" ${can(price) ? '' : 'disabled'}>Buy drone · 🪙 ${fmtC(price)}</button>
      ${can(price) ? '' : `<p class="fine" style="margin:6px 0 0;text-align:center">${fmtC(price - (P.coins || 0))} more 🪙 – about ${((price - (P.coins || 0)) / CO.mile).toFixed(1)} mi of walking</p>`}</div>`;
  const next = d.lvl < DRONE_MAX ? DL[d.lvl] : null;
  const pips = Array.from({ length: DRONE_MAX }, (_, i) => `<u class="${i < d.lvl ? 'on' : ''}"></u>`).join('');
  return `<div class="card dronecard"><div class="dtop">${droneSVG('shop')}<div><b>Scout drone · level ${d.lvl}</b>
      <span class="dlv">${pips}</span>
      <small>Range ${fmtFt(droneRangeM(d.lvl))}${next ? ` · level ${d.lvl + 1} reaches ${fmtFt(next.ft * 0.3048)}` : ''}</small></div></div>
    ${next ? `<button class="btn big" id="upDrone" ${can(next.cost) ? '' : 'disabled'}>Upgrade to level ${d.lvl + 1} – range ${fmtFt(next.ft * 0.3048)} · 🪙 ${fmtC(next.cost)}</button>`
           : `<p class="fine" style="margin:4px 0 0;color:var(--acc2);text-align:center"><b>Max level</b> – ${fmtFt(droneRangeM(DRONE_MAX))} of range.</p>`}</div>`;
}

// ---------------- road coins ----------------
// Coins lying along real streets and trails. The geometry comes from OpenStreetMap vector
// tiles (OpenFreeMap: free, no key), decoded here with a small reader rather than a library.
// The same coins appear for everyone on a given day; who has picked up what is per player.
// Walk - or fly the drone - close and they are pulled in.
const RCF = Object.assign({ on: true, tiles: 'https://tiles.openfreemap.org/planet', pathEvery: 90, roadEvery: 180, chance: 0.55,
  value: [2, 3], pathBonus: 1, stackChance: 0.04, stackValue: 25, magnetFt: 80, droneMagnetFt: 100, dronePerDay: 60 }, C.ROAD_COINS || {});
const RZ = 14;                                     // the deepest zoom the vector tiles carry
const RC = { tpl: null, tj: null, tiles: new Map(), loading: new Set(), layer: null, marks: new Map(), lastDraw: null, lastDrawDrone: null, combo: 0, comboT: 0 };

// --- a tiny Mapbox Vector Tile reader: just enough for the road lines ---
const RC_KEEP_SERVICE = new Set(['alley', 'spur', 'yard', '']);     // no parking-lot aisles or driveways
function rcClassify(pr) {
  if (pr.brunnel === 'tunnel' || pr.ramp || pr.access === 'no' || pr.access === 'private') return null;
  const c = pr.class;
  if (c === 'path' || c === 'track') return 'path';
  if (c === 'minor' || c === 'tertiary') return 'road';
  if (c === 'service') return RC_KEEP_SERVICE.has(pr.service || '') ? 'road' : null;   // no private driveways
  return null;                                     // highways, main roads, rail, ferries...
}
function rcDecode(buf, z, tx, ty) {
  let p = 0;
  const td = new TextDecoder();
  const rv = () => { let r = 0, m = 1, b; do { b = buf[p++]; r += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return r; };
  const skip = w => { if (w === 0) rv(); else if (w === 1) p += 8; else if (w === 2) { const l = rv(); p += l; } else if (w === 5) p += 4; else p = buf.length; };
  const lines = [];
  const n = 2 ** z;
  while (p < buf.length) {
    const tag = rv(), f = Math.floor(tag / 8), w = tag & 7;
    if (f === 3 && w === 2) { const l = rv(), end = p + l; layer(end); p = end; } else skip(w);
  }
  return lines;
  function layer(end) {
    let name = '', extent = 4096; const keys = [], vals = [], feats = [];
    while (p < end) {
      const tag = rv(), f = Math.floor(tag / 8), w = tag & 7;
      if (f === 1 && w === 2) { const l = rv(); name = td.decode(buf.subarray(p, p + l)); p += l; if (name !== 'transportation') return; }
      else if (f === 2 && w === 2) { const l = rv(); feats.push([p, p + l]); p += l; }
      else if (f === 3 && w === 2) { const l = rv(); keys.push(td.decode(buf.subarray(p, p + l))); p += l; }
      else if (f === 4 && w === 2) {
        const l = rv(), e = p + l; let v = null;
        while (p < e) {
          const t = rv(), ff = Math.floor(t / 8), ww = t & 7;
          if (ff === 1 && ww === 2) { const L2 = rv(); v = td.decode(buf.subarray(p, p + L2)); p += L2; }
          else if ((ff === 4 || ff === 5 || ff === 7) && ww === 0) v = rv();
          else if (ff === 6 && ww === 0) { const z2 = rv(); v = z2 % 2 ? -(z2 + 1) / 2 : z2 / 2; }
          else skip(ww);
        }
        vals.push(v); p = e;
      }
      else if (f === 5 && w === 0) extent = rv();
      else skip(w);
    }
    for (const [a, b] of feats) { p = a; feature(b, keys, vals, extent); }
  }
  function feature(end, keys, vals, extent) {
    const tags = []; let type = 0, gs = 0, ge = 0;
    while (p < end) {
      const tag = rv(), f = Math.floor(tag / 8), w = tag & 7;
      if (f === 2 && w === 2) { const l = rv(), e = p + l; while (p < e) tags.push(rv()); }
      else if (f === 3 && w === 0) type = rv();
      else if (f === 4 && w === 2) { const l = rv(); gs = p; ge = p + l; p = ge; }
      else skip(w);
    }
    if (type !== 2) return;
    const pr = {}; for (let i = 0; i + 1 < tags.length; i += 2) pr[keys[tags[i]]] = vals[tags[i + 1]];
    const kind = rcClassify(pr); if (!kind) return;
    p = gs; let cx = 0, cy = 0, line = null;
    const pt = () => {
      const fx = (tx + cx / extent) / n, fy = (ty + cy / extent) / n;
      return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * fy))) * 180 / Math.PI, lon: fx * 360 - 180,
               inside: cx >= 0 && cy >= 0 && cx < extent && cy < extent };
    };
    while (p < ge) {
      const cmd = rv(), id = cmd & 7, cnt = cmd >> 3;
      if (id === 1 || id === 2) {
        for (let i = 0; i < cnt; i++) {
          const dx = rv(), dy = rv();
          cx += (dx >>> 1) ^ -(dx & 1); cy += (dy >>> 1) ^ -(dy & 1);
          if (id === 1) { if (line && line.length > 1) lines.push({ path: kind === 'path', pts: line }); line = []; }
          line.push(pt());
        }
      }
    }
    if (line && line.length > 1) lines.push({ path: kind === 'path', pts: line });
  }
}

// --- placing coins: the same for everyone on a given day ---
function rcPlace(key, lines, day) {
  const R = rng(hashStr('stashwalk-rc|' + key + '|' + day)), out = [];
  let idx = 0;
  for (const ln of lines) {
    const every = ln.path ? RCF.pathEvery : RCF.roadEvery;
    let s = R() * every;
    for (let i = 1; i < ln.pts.length; i++) {
      const a = ln.pts[i - 1], b = ln.pts[i], seg = dist(a, b);
      while (s < seg) {
        const roll = R(), roll2 = R(), roll3 = R(), my = idx++;
        const t = s / seg;
        // a tile carries a margin of its neighbours' roads - only keep coins on our own ground
        if (roll < RCF.chance && (a.inside || b.inside)) {
          const lat = a.lat + (b.lat - a.lat) * t, lon = a.lon + (b.lon - a.lon) * t;
          if (rcInTile(key, lat, lon)) {
            const stack = roll2 < RCF.stackChance;
            const v = stack ? RCF.stackValue : RCF.value[0] + Math.floor(roll3 * (RCF.value[1] - RCF.value[0] + 1)) + (ln.path ? RCF.pathBonus : 0);
            out.push({ id: key + ':' + my, k: key, i: my, lat, lon, v, stack, path: ln.path });
          }
        }
        s += every;
      }
      s -= seg;
    }
  }
  // Downtowns map a sidewalk on each side of the street as well as the street itself, so the
  // same block would get three coins. Keep at most one per ~80 m square (first come, so it is
  // still the same for everyone).
  const cell = (RCF.spacingM || 80), seen = new Set(), kept = [];
  for (const c of out) {
    const k2 = Math.floor(c.lat * 111320 / cell) + ':' + Math.floor(c.lon * 111320 * Math.cos(c.lat * Math.PI / 180) / cell);
    if (seen.has(k2)) continue; seen.add(k2); kept.push(c);
  }
  return kept;
}
function rcTileOf(lat, lon) {
  const n = 2 ** RZ, x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  return { x, y, key: x + '/' + y };
}
function rcInTile(key, lat, lon) { return rcTileOf(lat, lon).key === key; }
function rcGot() {
  const d = utcDay();
  if (!P.rc || P.rc.day !== d) P.rc = { day: d, got: {}, drone: 0 };
  return P.rc;
}
const rcTaken = c => { const g = rcGot().got[c.k]; return !!(g && g.includes(c.i)); };

async function rcTemplate() {
  if (RC.tpl) return RC.tpl;
  if (!RC.tj) RC.tj = fetch(RCF.tiles).then(r => r.json()).then(j => { RC.tpl = j.tiles && j.tiles[0]; return RC.tpl; }).catch(() => { RC.tj = null; return null; });
  return RC.tj;
}
async function rcLoad(key) {
  if (RC.tiles.has(key) || RC.loading.has(key)) return;
  const tpl = await rcTemplate(); if (!tpl) return;
  RC.loading.add(key);
  try {
    const [x, y] = key.split('/').map(Number);
    const r = await fetch(tpl.replace('{z}', RZ).replace('{x}', x).replace('{y}', y));
    if (!r.ok) throw new Error(r.status);
    let buf = new Uint8Array(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b && window.DecompressionStream)
      buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    const lines = rcDecode(buf, RZ, x, y);
    RC.tiles.set(key, { lines, day: -1, coins: [] });
    while (RC.tiles.size > 16) RC.tiles.delete(RC.tiles.keys().next().value);
  } catch (e) { /* no roads for this tile right now; try again later */ }
  RC.loading.delete(key);
  rcDraw(true);
  // anything already within reach when the roads arrive is pulled in straight away
  if (fly) rcCollect(fly.ll, true); else if (pos && pos.acc <= 40) rcCollect(pos, false);
}
// the tile you are on, plus any neighbour you are close to the edge of
function rcEnsureAround(at) {
  if (!RCF.on || !at) return;
  const n = 2 ** RZ, fx = (at.lon + 180) / 360 * n;
  const fy = (1 - Math.log(Math.tan(at.lat * Math.PI / 180) + 1 / Math.cos(at.lat * Math.PI / 180)) / Math.PI) / 2 * n;
  const x = Math.floor(fx), y = Math.floor(fy), mx = fx - x, my = fy - y, edge = 0.28;
  const want = [[x, y]];
  const ex = mx < edge ? -1 : mx > 1 - edge ? 1 : 0, ey = my < edge ? -1 : my > 1 - edge ? 1 : 0;
  if (ex) want.push([x + ex, y]); if (ey) want.push([x, y + ey]); if (ex && ey) want.push([x + ex, y + ey]);
  want.forEach(([a, b]) => rcLoad(a + '/' + b));
}
function rcCoinsNear(at, rM) {
  const day = utcDay(), out = [];
  RC.tiles.forEach((t, key) => {
    if (t.day !== day) { t.coins = rcPlace(key, t.lines, day); t.day = day; }
    for (const c of t.coins) if (Math.abs(c.lat - at.lat) < rM / 111000 && dist(at, c) <= rM && !rcTaken(c)) out.push(c);
  });
  return out;
}
// markers for the coins around you (and around the drone, when it is up)
function rcDraw(force) {
  if (!RCF.on || !map || !window.L || !P || !pos) return;
  if (!RC.layer) {
    RC.layer = L.layerGroup().addTo(map);
    try { map.attributionControl.addAttribution('Road data <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a>'); } catch (e) {}
    map.on('zoomend', () => rcDraw(true));
  }
  const at = fly ? fly.ll : pos;
  if (!force && RC.lastDraw && dist(RC.lastDraw, at) < 40) return;
  RC.lastDraw = { lat: at.lat, lon: at.lon };
  const show = map.getZoom() >= 15;
  const want = show ? rcCoinsNear(at, 900).sort((a, b) => dist(at, a) - dist(at, b)).slice(0, 160) : [];
  const keep = new Set(want.map(c => c.id));
  RC.marks.forEach((m, id) => { if (!keep.has(id)) { m.remove(); RC.marks.delete(id); } });
  for (const c of want) {
    if (RC.marks.has(c.id)) continue;
    const m = L.marker([c.lat, c.lon], { icon: L.divIcon({ className: 'rcm' + (c.stack ? ' stack' : ''), html: '<i></i>', iconSize: c.stack ? [19, 19] : [12, 12] }),
      interactive: false, keyboard: false });
    m.coin = c; m.addTo(RC.layer); RC.marks.set(c.id, m);
  }
  if (want.length) rcHintOnce();
}
function rcHintOnce() {
  try { if (localStorage.getItem('sw_rchint')) return; localStorage.setItem('sw_rchint', '1'); } catch (e) { return; }
  toast('🪙 Coins are lying along streets and trails today – walk close to scoop them up');
}

// --- pick-up: coins inside the magnet radius fly into whoever pulled them ---
function rcCollect(at, byDrone) {
  if (!RCF.on || !P || !map || OFFLINE) return;
  const R = (byDrone ? RCF.droneMagnetFt : RCF.magnetFt) * 0.3048;
  const g = rcGot();
  if (byDrone && RCF.dronePerDay && g.drone >= RCF.dronePerDay) return;
  RC.marks.forEach((m, id) => {
    const c = m.coin; if (!c || m.flying) return;
    const d = dist(at, c);
    const tug = d <= R * 2;
    if (m.tug !== tug) { m.tug = tug; const el = m.getElement && m.getElement(); if (el) el.classList.toggle('tug', tug); }
    if (d > R) return;
    if (byDrone && RCF.dronePerDay && g.drone >= RCF.dronePerDay) return;
    (g.got[c.k] = g.got[c.k] || []).push(c.i);
    if (byDrone) { g.drone++; if (RCF.dronePerDay && g.drone === RCF.dronePerDay) toast(`🛸 The drone's coin bag is full for today – coins on foot still count`); }
    m.flying = true;
    rcFlyIn(m, byDrone);
  });
}
function rcFlyIn(m, byDrone) {
  const c = m.coin, host = $('#maprow');
  const start = map.latLngToContainerPoint([c.lat, c.lon]);
  m.remove(); RC.marks.delete(c.id);
  const el = document.createElement('i');
  el.className = 'rcfly' + (c.stack ? ' stack' : '');
  host.appendChild(el);
  const t0 = performance.now(), dur = 520 + Math.random() * 120, side = Math.random() < .5 ? -1 : 1;
  const target = () => {
    const ll = byDrone && fly ? [fly.ll.lat, fly.ll.lon] : [pos.lat, pos.lon];
    return map.latLngToContainerPoint(ll);
  };
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = k * k * (3 - 2 * k), pull = k * k;   // slow lift, then snapped in
    const tp = target();
    const x = start.x + (tp.x - start.x) * pull, y = start.y + (tp.y - start.y) * pull;
    const arc = Math.sin(e * Math.PI) * 26;
    el.style.transform = `translate(${x + side * arc * .6}px, ${y - arc}px) scale(${1 + Math.sin(k * Math.PI) * .35 - k * .45})`;
    el.style.opacity = k > .9 ? (1 - k) * 10 : 1;
    if (k < 1) requestAnimationFrame(step);
    else {
      el.remove();
      const now2 = performance.now();
      RC.combo = now2 - RC.comboT < 1400 ? RC.combo + 1 : 0; RC.comboT = now2;
      FX.sfx('pickup', RC.combo);
      if (c.stack) { FX.sfx('coin'); const p = FX.centerOf(byDrone && fly && fly.marker.getElement ? fly.marker.getElement() : document.querySelector('.me-dot')); FX.burst(p.x, p.y, ['#ffd98a', '#f2b84b', '#fff'], 18); }
      FX.vibe(c.stack ? [20, 30, 20] : 12);
      P.stats.roadCoins = (P.stats.roadCoins || 0) + 1;
      earn(c.v, c.stack ? 'Gold stack!' : 'Road coins');
      clearTimeout(RC.saveT); RC.saveT = setTimeout(() => { checkAch(); save(); }, 900);
    }
  };
  requestAnimationFrame(step);
}

// ---------------- hidden chests ----------------
// A chest stays off the map and out of the list until you find it. Undiscovered chests near
// you show only as a dashed search circle with the chest somewhere inside (never the centre);
// the locator does the last stretch. Walk - or fly the drone - within DISCOVER_FT and it is
// yours to see from then on. Chests you have opened before, and ones you hid, count as found.
const SEARCH_R = () => (C.SEARCH_RADIUS_FT || 300) * 0.3048;
const DISCOVER_M = () => (C.DISCOVER_FT || 60) * 0.3048;
const isFound = c => !!(c && P && ((P.found && P.found[c.id]) || (P.stats && P.stats.visited && P.stats.visited[c.id])));
function discover(c) {
  if (!c || isFound(c)) return false;
  (P.found = P.found || {})[c.id] = 1;
  toast(`📍 Found ${c.name}!`, 'gold'); FX.sfx('ping'); FX.vibe([30, 40, 30]);
  save(); refreshChestViews(); if (view === 'explore') renderNearby(true);
  return true;
}
function discoverAround(at, rM) {
  if (!P || !at) return;
  for (const c of chests) if (!isFound(c) && dist(at, c) <= rM) discover(c);
}
// a fixed, per-chest offset so the circle never gives the exact spot away
function searchCenter(c) {
  const h = hashStr('stashwalk-search|' + c.id), a = (h % 3600) / 10 * Math.PI / 180;
  const f = 0.18 + ((h >>> 12) % 1000) / 1000 * 0.52, r = SEARCH_R() * f;
  return { lat: c.lat + r * Math.sin(a) / 111320, lon: c.lon + r * Math.cos(a) / (111320 * Math.cos(c.lat * Math.PI / 180)) };
}
let searchLayer = null, searchAt = null;
function refreshSearch(force) {
  if (!map || !window.L || !P || !pos) return;
  if (!searchLayer) searchLayer = L.layerGroup().addTo(map);
  const at = fly ? fly.ll : pos;
  if (!force && searchAt && dist(searchAt, at) < 60) return;
  searchAt = { lat: at.lat, lon: at.lon };
  const pool = fly ? droneCandidates() : chests, lim = (C.SEARCH_SHOW_MI || 1) * MI;
  const near = pool.filter(c => !isFound(c)).map(c => ({ c, d: dist(at, c) })).filter(x => x.d <= lim)
    .sort((a, b) => a.d - b.d).slice(0, C.SEARCH_MAX || 12);
  searchLayer.clearLayers();
  near.forEach(({ c }) => {
    const ctr = searchCenter(c);
    L.circle([ctr.lat, ctr.lon], { radius: SEARCH_R(), color: '#f2b84b', weight: 1.6, opacity: .75, dashArray: '5 7',
      fillColor: '#f2b84b', fillOpacity: .07, interactive: false, className: 'searchzone' }).addTo(searchLayer);
    L.marker([ctr.lat, ctr.lon], { icon: L.divIcon({ className: 'searchq', html: '<span>?</span>', iconSize: [22, 22] }), interactive: false, keyboard: false }).addTo(searchLayer);
  });
}
function fogIntroOnce() {
  try { if (localStorage.getItem('sw_fogintro')) return; localStorage.setItem('sw_fogintro', '1'); } catch (e) { return; }
  const go = (tries) => {
    if ($('#modal').classList.contains('open')) { if (tries < 20) setTimeout(() => go(tries + 1), 1500); return; }
    modal(`<div style="text-align:center"><div class="coinbig">🔍</div><h3>Chests are hidden now</h3>
      <p class="sub">A chest stays off the map until you find it. Dashed circles show roughly where undiscovered
      chests are – the chest is somewhere inside. Head in, start the 📡 locator and follow the ticking.</p>
      <p class="sub">Get within ${C.DISCOVER_FT || 60} ft (or fly the drone close) and it's found for good.
      Chests you've already opened stay on your map.</p>
      <button class="btn big" id="okBtn">Let's hunt</button></div>`, m => { $('#okBtn', m).onclick = closeModal; });
  };
  setTimeout(() => go(0), 3000);
}

// ---------------- presence & admin ----------------
// Every player's game says "I'm here" once a minute while it is on screen; that is what the
// online count is made of. The admin (C.ADMIN_USER, enforced by the Worker) gets a panel in
// the Me tab and a notification when someone signs up or comes back online.
const isAdmin = () => !!KEY && KEY === String(C.ADMIN_USER || 'TonyIspht').toLowerCase();
let pingTimer = null, adminTimer = null, adminData = null, adminErr = '';
// The game sends a rough location (rounded to ~100 m by the server) so the admin - and only the
// admin, through the admin-only endpoints - can see where players are. It is disclosed in Settings.
function startPresence() {
  const beat = () => { if (!document.hidden && !OFFLINE) DB.ping(pos ? { lat: pos.lat, lon: pos.lon } : null).catch(() => {}); };
  clearInterval(pingTimer); beat(); pingTimer = setInterval(beat, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });
  if (isAdmin()) { clearInterval(adminTimer); adminPoll(); adminTimer = setInterval(adminPoll, 30000); }
}
const adminSeen = () => { try { return +localStorage.getItem('sw_admin_seen') || 0; } catch (e) { return 0; } };
const setAdminSeen = t => { try { localStorage.setItem('sw_admin_seen', String(t)); } catch (e) {} };
function evText(e) {
  return e.k === 'signup' ? `🆕 ${e.u} created an account` : e.k === 'online' ? `🟢 ${e.u} came online` : `${e.u} ${e.k}`;
}
async function adminPoll() {
  if (!isAdmin() || OFFLINE) return;
  try { adminData = await DB.adminStats(); adminErr = ''; }
  catch (e) { adminErr = e.message || 'could not load'; if (view === 'me') renderAdmin(); return; }
  const me = (P && P.name || '').toLowerCase();
  const evs = (adminData.events || []).filter(e => String(e.u).toLowerCase() !== me);
  const seen = adminSeen(), fresh = evs.filter(e => e.t > seen).reverse();
  if (!seen) setAdminSeen(evs.length ? evs[0].t : Date.now());       // first run: start from now, no backlog
  else if (fresh.length) {
    setAdminSeen(fresh[fresh.length - 1].t);
    fresh.slice(-5).forEach((e, i) => setTimeout(() => adminNotify(e), i * 900));
    $('#meDot').hidden = view === 'me';
  }
  if (view === 'me') renderAdmin();
  if (admShowAll) drawAdminPlayers();
}
async function adminNotify(e) {
  const text = evText(e);
  if (!document.hidden) { toast(text, 'gold'); FX.sfx('ping'); }
  // a system notification too, so it shows when the game is in the background
  try {
    if (window.Notification && Notification.permission === 'granted' && (document.hidden || isStandalone())) {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification('Stashwalk', { body: text, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'sw-admin-' + e.t });
    }
  } catch (er) {}
}
// Who put a chest there: player chests carry the hider's name (stamped by the server).
const chestBy = c => c.src === 'player' ? (c.by ? `Hidden by ${esc(c.by)}${c.at ? ' · ' + ago(c.at) : ''}` : 'Hidden by a player') : 'Stashwalk chest';
const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'; };
const adminSkeleton = () => `<div class="ahead"><b>🛡️ Admin</b></div>
  <div class="apills">${'<div class="apill skel"></div>'.repeat(4)}</div>
  <div class="arows">${'<div class="arow skel"></div>'.repeat(8)}</div>`;
function adminCardShell() { return isAdmin() ? `<div class="card admincard" id="adminCard">${adminSkeleton()}</div>` : ''; }
let admTab = 'players', admQ = '';
const uLink = (name, extra) => `<button class="ulink" data-user="${esc(name)}">${esc(name)}</button>${extra || ''}`;
function renderAdmin() {
  const el = $('#adminCard'); if (!el) return;
  if (adminErr) { el.innerHTML = `<b>🛡️ Admin</b><p class="fine" style="color:var(--bad)">${esc(adminErr)}</p><button class="btn sm ghost" id="admRefresh">Try again</button>`; }
  else if (!adminData) { el.innerHTML = adminSkeleton(); }
  else {
    const d = adminData, perm = window.Notification ? Notification.permission : 'unsupported', T = d.totals || {}, now = Date.now();
    const pill = (n, l) => `<div class="apill"><b>${typeof n === 'number' ? fmtC(n) : n}</b><span>${l}</span></div>`;
    const srow = (ic, l, n) => `<div class="arow"><span>${ic} ${l}</span><b>${typeof n === 'number' ? fmtC(n) : n}</b></div>`;
    const ppl = (d.players || (d.onlineList || []).map(u => ({ name: u.name, seen: u.t })));
    const online = p => p.seen && now - p.seen < 150000;
    const q = admQ.trim().toLowerCase();
    const shown = ppl.filter(p => !q || String(p.name).toLowerCase().includes(q)).slice(0, 60);
    const tabs = [['players', '👥 Players'], ['chests', '📦 Hidden chests'], ['activity', '🔔 Activity']];
    let body = '';
    if (admTab === 'players') body = `<input id="admQ" class="admq" placeholder="Search players" value="${esc(admQ)}">
      <div class="alist">${shown.map(p => `<div><span>${online(p) ? '🟢' : p.seen && now - p.seen < 86400000 ? '🟡' : '⚪'} ${uLink(p.name)}${p.lat != null ? ' <small title="has a location">📍</small>' : ''}</span>
        <small>${p.seen ? ago(p.seen) : p.created ? 'joined ' + ago(p.created) : 'never'}</small></div>`).join('') || '<p class="fine">No players match.</p>'}</div>`;
    else if (admTab === 'chests') body = `<p class="fine">Chests hidden by players, newest first. Tap a name to see it on the map.</p>
      <div class="alist">${(d.hiddenChests || []).map(c => `<div><span><button class="ulink" data-chestgo="${esc(c.id)}">📦 ${esc(c.name)}</button><small> ${c.by ? 'by ' + uLink(c.by) : ''}</small></span>
        <small>${c.at ? ago(c.at) : ''} <button class="btn sm ghost danger" data-rm="${esc(c.id)}" data-cell="${esc(c.cell)}">Remove</button></small></div>`).join('') || '<p class="fine">No hidden chests yet.</p>'}</div>`;
    else body = `<div class="alist">${(d.events || []).slice(0, 40).map(e => `<div><span>${e.k === 'signup' ? '🆕 ' + uLink(e.u, ' created an account') : e.k === 'online' ? '🟢 ' + uLink(e.u, ' came online') : esc(evText(e))}</span><small>${ago(e.t)}</small></div>`).join('') || '<p class="fine">Nothing yet.</p>'}</div>`;
    el.innerHTML = `<div class="ahead"><b>🛡️ Admin</b><button class="btn sm ghost" id="admRefresh">↻</button></div>
      <div class="apills">${pill(d.accounts, 'accounts')}${pill(d.online, 'online')}${pill(d.active24h, '24 h')}${pill(d.active7d, '7 days')}</div>
      ${d.totals ? `<div class="arows">${srow('🆕', 'New this week', d.signups7d || 0)}${srow('📦', 'Chests opened', T.opened)}
        ${srow('🔁', 'Trades', T.trades)}${srow('🚶', 'Miles walked', T.miles)}
        ${srow('🪙', 'Coins earned', T.coinsEarned)}${srow('📚', 'Items collected', T.items)}
        ${srow('⚒️', 'Merges + crafts', T.crafted + T.merges)}${srow('🧲', 'Road coins', T.roadCoins)}
        ${srow('📍', 'Player chests', d.chestsHidden)}${srow('🗑️', 'Chests removed', d.chestsRemoved)}
        ${srow('🛸', 'Drones owned', T.drones)}${srow('📅', 'Daily claims', T.logins)}</div>` :
        '<p class="fine">Update the Worker to see game-wide totals, player details and locations.</p>'}
      <div class="row2 admbtns"><button class="btn sm" id="admPlace">${admPlacing ? '✖ Stop placing' : '📍 Place chests on the map'}</button>
        <button class="btn sm ghost" id="admMap">${admShowAll ? '🙈 Hide players on map' : '🗺️ Show players on map'}</button></div>
      <div class="segs admtabs">${tabs.map(([k, l]) => `<button class="${admTab === k ? 'on' : ''}" data-atab="${k}">${l}</button>`).join('')}</div>
      ${body}
      ${perm === 'granted' ? '<p class="fine" style="margin-top:10px">🔔 Notifications are on for new accounts and players coming online.</p>'
        : perm === 'denied' ? '<p class="fine" style="margin-top:10px">🔕 Notifications are blocked for this site in your browser settings.</p>'
        : perm === 'unsupported' ? '<p class="fine" style="margin-top:10px">This browser cannot show notifications – you will still get alerts in the game.</p>'
        : '<button class="btn sm" id="admNotify" style="margin-top:10px">🔔 Turn on notifications</button>'}`;
  }
  const r = $('#admRefresh', el); if (r) r.onclick = () => { r.disabled = true; adminPoll(); };
  const n = $('#admNotify', el); if (n) n.onclick = async () => {
    try { const res = await Notification.requestPermission(); toast(res === 'granted' ? '🔔 Notifications on' : 'Notifications not allowed', res === 'granted' ? 'gold' : 'bad'); } catch (e) {}
    renderAdmin();
  };
  const qi = $('#admQ', el); if (qi) qi.oninput = () => { admQ = qi.value; const pos0 = qi.selectionStart; renderAdmin(); const q2 = $('#admQ'); if (q2) { q2.focus(); try { q2.setSelectionRange(pos0, pos0); } catch (e) {} } };
  const pb = $('#admPlace', el); if (pb) pb.onclick = () => adminPlaceMode(!admPlacing);
  const mb = $('#admMap', el); if (mb) mb.onclick = () => { admShowAll = !admShowAll; drawAdminPlayers(); renderAdmin(); if (admShowAll) { show('explore'); fitAdminPlayers(); } };
  el.onclick = async e => {
    const t = e.target.closest('[data-atab]'); if (t) { admTab = t.dataset.atab; return renderAdmin(); }
    const u = e.target.closest('[data-user]'); if (u) return adminUserCard(u.dataset.user);
    const cg = e.target.closest('[data-chestgo]'); if (cg) { const c = (adminData.hiddenChests || []).find(x => x.id === cg.dataset.chestgo); if (c) showSpotOnMap(c.lat, c.lon, '📦 ' + c.name, 'chest'); return; }
    const rm = e.target.closest('[data-rm]'); if (rm) adminRemoveChest(rm.dataset.rm, rm.dataset.cell);
  };
}
// ---- admin: players on the map ----
let admLayer = null, admShowAll = false, admFocus = null, admPlacing = false;
function admIcon(name, kind) {
  return L.divIcon({ className: 'admpin ' + (kind || ''), html: `<div><i></i><span>${esc(name)}</span></div>`, iconSize: [0, 0], iconAnchor: [0, 0] });
}
function drawAdminPlayers() {
  if (!map || !window.L) return;
  if (!admLayer) admLayer = L.layerGroup().addTo(map);
  admLayer.clearLayers();
  const me = KEY, now = Date.now();
  if (admShowAll && adminData) (adminData.players || []).forEach(p => {
    if (p.lat == null || p.key === me) return;
    L.marker([p.lat, p.lon], { icon: admIcon(p.name, now - p.seen < 150000 ? 'on' : 'off'), zIndexOffset: 900 })
      .on('click', () => adminUserCard(p.name)).addTo(admLayer);
  });
  if (admFocus) L.marker([admFocus.lat, admFocus.lon], { icon: admIcon(admFocus.label, 'focus ' + (admFocus.kind || '')), zIndexOffset: 1000 })
    .on('click', () => admFocus.user && adminUserCard(admFocus.user)).addTo(admLayer);
}
function fitAdminPlayers() {
  const pts = ((adminData && adminData.players) || []).filter(p => p.lat != null).map(p => [p.lat, p.lon]);
  if (!pts.length) return toast('No players have shared a location yet');
  setTimeout(() => { try { pts.length === 1 ? map.setView(pts[0], 14) : map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 }); } catch (e) {} }, 120);
}
function showSpotOnMap(lat, lon, label, kind, user) {
  if (!map) return toast('The map is not available', 'bad');
  closeModal(); admFocus = { lat, lon, label, kind, user }; show('explore'); drawAdminPlayers();
  setTimeout(() => { try { map.invalidateSize(); map.setView([lat, lon], 16); } catch (e) {} }, 120);
}
async function adminUserCard(name) {
  modal(`<h3>👤 ${esc(name)}</h3><p class="fine">Loading…</p>`);
  let u; try { u = await DB.adminUser(name); } catch (e) { return modal(`<h3>👤 ${esc(name)}</h3><p class="fine" style="color:var(--bad)">${esc(e.message)}</p><div class="trade"><button class="btn ghost" id="cancelBtn">Close</button></div>`, m => { $('#cancelBtn', m).onclick = closeModal; }); }
  const on = u.seen && Date.now() - u.seen < 150000, row = (l, v) => `<div><span>${l}</span><b>${v}</b></div>`;
  modal(`<h3>👤 ${esc(u.name)} <small style="font-size:13px;color:var(--mut)">${esc(u.title || '')}</small></h3>
    <p class="sub">${on ? '🟢 Online now' : u.seen ? 'Last seen ' + ago(u.seen) : 'Never seen online'} · joined ${u.created ? ago(u.created) : 'long ago'}${u.ref ? ' · invited by ' + esc(u.ref) : ''}</p>
    <div class="ustats">${row('🪙 Coins', fmtC(u.coins))}${row('Earned in total', fmtC(u.coinsEarned))}${row('📦 Chests opened', u.opened)}${row('🔁 Trades', u.trades)}
      ${row('🫳 Chests hidden', u.hidden)}${row('🎁 Gifts left', u.gifts)}${row('📚 Items collected', u.items)}${row('🎒 In pack', u.pack)}
      ${row('🔗 Merges', u.merges)}${row('⚒️ Crafts', u.crafted)}${row('🚶 Miles walked', u.miles)}${row('🪙 Road coins', fmtC(u.roadCoins))}
      ${row('📅 Daily claims', u.logins)}${row('🔥 Best streak', u.streak)}${row('🛸 Drone', u.drone ? 'level ' + u.drone : 'none')}${row('🏅 Achievements', u.achievements)}
      ${row('💌 Friends invited', u.invited)}</div>
    <p class="fine">${u.lat != null ? `Last known spot (about 100 m) from ${ago(u.seen)}.` : 'No location – this player has not shared one (or turned sharing off).'}</p>
    <div class="trade"><button class="btn ghost" id="cancelBtn">Close</button>${u.lat != null ? '<button class="btn" id="uMap">🗺️ Show on map</button>' : ''}</div>`, m => {
    $('#cancelBtn', m).onclick = closeModal;
    const b = $('#uMap', m); if (b) b.onclick = () => showSpotOnMap(u.lat, u.lon, u.name, on ? 'on' : 'off', u.name);
  });
}
async function adminRemoveChest(id, cell) {
  const c = ((adminData && adminData.hiddenChests) || []).find(x => x.id === id) || { name: id };
  modal(`<h3>Remove "${esc(c.name)}"?</h3><p class="sub">It disappears for every player straight away, with whatever is inside. This cannot be undone.</p>
    <div class="trade"><button class="btn ghost" id="cancelBtn">Keep it</button><button class="btn danger" id="rmGo">Remove</button></div>`, m => {
    $('#cancelBtn', m).onclick = closeModal;
    $('#rmGo', m).onclick = async () => {
      $('#rmGo', m).disabled = true;
      try { await DB.adminRemove(id, cell); } catch (e) { $('#rmGo', m).disabled = false; return toast('Could not remove: ' + e.message, 'bad'); }
      BLOCKED.add(id); chests = chests.filter(x => x.id !== id);
      if (adminData) adminData.hiddenChests = (adminData.hiddenChests || []).filter(x => x.id !== id);
      closeModal(); refreshChestViews(); renderAdmin(); toast('🗑️ Chest removed', 'gold');
    };
  });
}
// ---- admin: hide a chest anywhere by tapping the map ----
function adminPlaceMode(on) {
  if (!isAdmin()) return;
  admPlacing = !!on; document.body.classList.toggle('admplacing', admPlacing);
  const bar = $('#admBar');
  if (admPlacing) {
    show('explore');
    if (bar) bar.hidden = false;
    toast('📍 Tap anywhere on the map to hide a chest there');
  } else if (bar) bar.hidden = true;
  if (view === 'me') renderAdmin();
}
function adminMapClick(e) {
  if (!admPlacing || !isAdmin()) return;
  hideDialog({ lat: e.latlng.lat, lon: e.latlng.lng }, false, true);
}

// ---------------- achievements ----------------
const ACH = [];
function ach(id, n, t, d, get, goal, icon) { ACH.push({ id, n, t, d, get, goal, icon: icon || '🏅' }); }
ach('login1', 'First Footprints', 'Newcomer', 'Claim your first daily reward', s => s.logins, 1, '👣');
ach('login7', 'Week Wanderer', 'Trail Regular', 'Claim 7 daily rewards', s => s.logins, 7, '📅');
ach('login14', 'Fortnight Finder', 'Camp Veteran', 'Claim 14 daily rewards', s => s.logins, 14, '🏕️');
ach('login28', 'Full Moon Cycle', 'Keeper of the Calendar', 'Claim 28 daily rewards', s => s.logins, 28, '🌕');
ach('login60', 'Devoted Drifter', 'Old Faithful', 'Claim 60 daily rewards', s => s.logins, 60, '⛲');
ach('streak7', 'Seven Straight', 'Streaker', 'Log in 7 days in a row', s => s.streak, 7, '🔥');
ach('streak30', 'Unbroken', 'Ironwalker', 'Log in 30 days in a row', s => s.streak, 30, '🌋');
ach('visit1', 'Treasure Spotted', 'Scout', 'Open your first chest', s => s.visited, 1, '📦');
ach('visit5', 'Getting Around', 'Trailblazer', 'Open 5 different chests', s => s.visited, 5, '🥾');
ach('visit15', 'Regional Rambler', 'Pathfinder', 'Open 15 different chests', s => s.visited, 15, '🧭');
ach('visit40', 'Park Pilgrim', 'Wayfarer', 'Open 40 different chests', s => s.visited, 40, '🌲');
ach('visit100', 'Cartographer', 'Cartographer', 'Open 100 different chests', s => s.visited, 100, '🗺️');
ach('ex1', 'First Swap', 'Trader', 'Complete your first trade', s => s.ex, 1, '🔁');
ach('ex10', 'Fair Trader', 'Peddler', 'Complete 10 trades', s => s.ex, 10, '🤝');
ach('ex50', 'Market Mover', 'Merchant', 'Complete 50 trades', s => s.ex, 50, '💰');
ach('ex200', 'Swap Legend', 'Tycoon of the Trail', 'Complete 200 trades', s => s.ex, 200, '👑');
ach('dex10', 'Shelf Started', 'Collector', 'Collect 10 different items', s => s.dex, 10, '📚');
ach('dex50', 'Growing Shelf', 'Curator', 'Collect 50 different items', s => s.dex, 50, '🖼️');
ach('dex100', 'Display Case', 'Archivist', 'Collect 100 different items', s => s.dex, 100, '🏛️');
ach('dex250', 'Museum Wing', 'Keeper of Wonders', 'Collect 250 different items', s => s.dex, 250, '🦕');
ach('dexall', 'Gotta Find \'Em All', 'The Completionist', 'Collect every item', s => s.dex, ITEMS.length, '🏆');
ach('rare1', 'Silver Lining', 'Lucky Finder', 'Collect a Rare item', s => s.byR[2], 1, '🔷');
ach('epic1', 'Purple Patch', 'Gem Hunter', 'Collect an Epic item', s => s.byR[3], 1, '🟣');
ach('leg1', 'Legend Found', 'Legendary', 'Collect a Legendary item', s => s.byR[4], 1, '🌟');
ach('rare25', 'Rare Habit', 'Rare Breed', 'Collect 25 different Rare items', s => s.byR[2], 25, '💠');
ach('epic10', 'Epic Shelf', 'Epic Collector', 'Collect 10 different Epic items', s => s.byR[3], 10, '🔮');
ach('leg5', 'Dragon Hoard', 'Dragon Keeper', 'Collect 5 different Legendary items', s => s.byR[4], 5, '🐉');
ach('gave1', 'Generous Soul', 'Philanthropist', 'Leave an Epic or Legendary item in a chest', s => s.gaveRare, 1, '🎁');
ach('given5', 'Trail Angel', 'Trail Angel', 'Leave 5 items for other players without swapping', s => s.given, 5, '😇');
ach('hide1', 'Cache Keeper', 'Hider', 'Hide your first chest', s => s.hidden, 1, '🫳');
ach('hide5', 'Chest Smith', 'Master of Hiding', 'Hide 5 chests', s => s.hidden, 5, '🔨');
ach('merge5', 'Fusionist', 'Alchemist', 'Merge items 5 times', s => s.merges, 5, '🔗');
ach('merge25', 'Transmuter', 'Transmuter', 'Merge items 25 times', s => s.merges, 25, '⚗️');
ach('craft1', 'First Relic', 'Artificer', 'Craft your first relic', s => s.crafted, 1, '⚒️');
ach('craft5', 'Workshop Regular', 'Relicsmith', 'Craft 5 relics', s => s.crafted, 5, '🛠️');
ach('craftall', 'Complete Workshop', 'Grand Artificer', 'Collect every relic', s => s.relics, RELICS.length || 20, '🏵️');
ach('inv1', 'Bring a Friend', 'Recruiter', 'Invite 1 friend who joins', s => s.invites, 1, '💌');
ach('inv5', 'Party Leader', 'Party Leader', 'Invite 5 friends who join', s => s.invites, 5, '🎉');
ach('walk1', 'First Mile', 'Wanderer', 'Walk 1 mile with Stashwalk open', s => s.miles, 1, '🚶');
ach('walk10', 'Ten-Miler', 'Trail Legs', 'Walk 10 miles', s => s.miles, 10, '👟');
ach('walk50', 'Long Haul', 'Long Hauler', 'Walk 50 miles', s => s.miles, 50, '🏔️');
ach('walk100', 'Century Walker', 'Centurion', 'Walk 100 miles', s => s.miles, 100, '💯');
ach('shop1', 'Window Shopper', 'Shopper', 'Buy something from the shop', s => s.bought, 1, '🛍️');
ach('rc100', 'Pocket Change', 'Scavenger', 'Pick up 100 road coins', s => s.roadCoins, 100, '🪙');
ach('rc1000', 'Coin Magnet', 'Magnet', 'Pick up 1,000 road coins', s => s.roadCoins, 1000, '🧲');
ach('drone1', 'Eye in the Sky', 'Drone Pilot', 'Open a chest with your drone', s => s.droneOpens, 1, '🛸');
ach('drone8', 'Full Range', 'Sky Captain', 'Upgrade your drone to level 8', s => s.droneLvl, 8, '📡');
// The locked achievement you are nearest to finishing - something concrete to aim at.
function nextAch() {
  const s = statView();
  let best = null;
  ACH.forEach(a => {
    if (P.ach[a.id]) return;
    const have = Math.max(0, Math.min(a.get(s), a.goal)), frac = have / a.goal;
    if (!best || frac > best.frac || (frac === best.frac && a.goal < best.goal))
      best = { a, have, goal: a.goal, frac };
  });
  return best;
}
function renderNextAch() {
  const el = $('#nextAch'); if (!el) return;
  const n = nextAch();
  if (!n) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<i>${n.a.icon}</i><b>${esc(n.a.n)}</b><span class="bar"><i style="width:${Math.round(n.frac * 100)}%"></i></span><u>${n.have}/${n.goal}</u>`;
}

function statView() {
  const ids = Object.keys(P.dex), byR = [0, 0, 0, 0, 0]; ids.forEach(id => { if (BY_ID[id]) byR[BY_ID[id].r]++; });
  return { logins: P.daily.n, streak: P.daily.max || 0, visited: Object.keys(P.stats.visited).length, ex: P.stats.ex || 0,
           dex: ids.length, byR, hidden: P.stats.hidden || 0, invites: inviteCount, gaveRare: P.stats.gaveRare || 0,
           given: P.stats.given || 0, merges: P.stats.merges || 0, crafted: P.stats.crafted || 0, relics: ids.filter(id => BY_ID[id] && BY_ID[id].crafted).length,
           miles: Math.floor(milesOf() * 10) / 10, bought: P.stats.bought || 0, coinsEarned: P.stats.coinsEarned || 0,
           droneOpens: P.stats.droneOpens || 0, droneLvl: (P.drone && P.drone.lvl) || 0, roadCoins: P.stats.roadCoins || 0 };
}
function checkAch() {
  const s = statView(), got = [];
  ACH.forEach(a => { if (!P.ach[a.id] && a.get(s) >= a.goal) { P.ach[a.id] = Date.now(); got.push(a); } });
  got.forEach(a => earn(CO.achievement, a.n));
  got.forEach((a, i) => setTimeout(() => { toast(`🏅 ${a.n} – new title: ${a.t}`, 'gold'); FX.sfx('ach'); FX.confetti(['#ffb02e', '#ffd98a', '#ffffff'], 45); FX.vibe([30, 40, 30]); }, 600 * i + 400));
  if (got.length) save();
}

// ---------------- account recovery ----------------
// No email address is collected, so a forgotten password would otherwise mean a lost
// account. Instead every account gets a one-off code. Only a hash of it is ever stored,
// derived in the browser the same way the password is.
const RC_ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';          // Crockford base32: no I, L, O or U
function makeRecoveryCode() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let out = ''; for (let i = 0; i < 16; i++) out += RC_ALPHA[b[i] % 32];
  return out.replace(/(.{4})(?=.)/g, '$1-');
}
// Accept what people actually type: lower case, spaces, and the usual lookalikes.
function normCode(c) {
  return String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}
function saveLocalCode(key, code) { try { localStorage.setItem('sw_rec_' + key, code); } catch (e) {} }
function localCode(key) { try { return localStorage.getItem('sw_rec_' + key) || ''; } catch (e) { return ''; } }

// pfx keeps the modal copy and the Me-tab copy from sharing element ids
function codeBox(code, pfx) {
  const p = pfx || 'rec';
  return `<div class="codebox"><code id="${p}Code">${esc(code)}</code></div>
    <div class="row2" style="padding:0;margin-top:8px">
      <button class="btn sm" id="${p}Copy">Copy</button>
      <button class="btn sm ghost" id="${p}Save">Save as file</button></div>`;
}
function wireCodeBox(m, name, code, pfx) {
  const p = pfx || 'rec';
  const c = $('#' + p + 'Copy', m); if (c) c.onclick = () => {
    try { navigator.clipboard.writeText(code); } catch (e) {}
    toast('Recovery code copied');
  };
  const d = $('#' + p + 'Save', m); if (d) d.onclick = () => {
    const txt = `Stashwalk recovery code\n\nPlayer: ${name}\nCode:   ${code}\n\n` +
      `Keep this somewhere safe. It is the only way back into the account if the password\n` +
      `is forgotten. Using it sets a new password and gives you a new code.\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    a.download = 'stashwalk-recovery-' + name + '.txt';
    document.body.appendChild(a); a.click(); a.remove();
  };
}
function showRecoveryCode(name, code, firstTime) {
  modal(`<h3>🔑 Your recovery code</h3>
    <p class="sub">${firstTime ? 'Save this now.' : 'Here is your new code.'} There is no email address on your account,
    so this code is the only way back in if you forget your password.</p>
    ${codeBox(code)}
    <p class="fine" style="margin-top:12px">Screenshot it, or put it in your notes or password manager.
    You can see it again under <b>Me ▸ Account recovery</b> on this device.</p>
    <button class="btn big" id="okBtn">I have saved it</button>`,
    m => { wireCodeBox(m, name, code); $('#okBtn', m).onclick = closeModal; });
}
// Make a new code for the account you are signed in to. Any older code stops working.
async function regenRecovery(btn) {
  if (needNet('Setting a recovery code')) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
  try {
    const code = makeRecoveryCode(), rsalt = randHex(), rhash = await hashPw(normCode(code), rsalt);
    await DB.setRecovery(rsalt, rhash);
    saveLocalCode(KEY, code);
    showRecoveryCode(P.name, code, false);
    renderMe();
  } catch (e) {
    toast(e.message || 'Could not save the code', 'bad');
    if (btn) { btn.disabled = false; btn.textContent = 'New code'; }
  }
}
// Older accounts were made before codes existed, so ask once.
async function nudgeRecovery() {
  if (OFFLINE || !KEY) return;
  try { if (localStorage.getItem('sw_recnudge_' + KEY)) return; } catch (e) { return; }
  let u = null; try { u = await DB.get('users/' + KEY); } catch (e) { return; }
  if (!u || u.hasR) return;
  try { localStorage.setItem('sw_recnudge_' + KEY, '1'); } catch (e) {}
  modal(`<h3>🔑 Set up a recovery code</h3>
    <p class="sub">Your account was created before these existed. Without one, a forgotten password
    means losing ${esc(P.name)} and everything in the pack - there is no email address to reset it with.</p>
    <p class="fine">It takes one tap. You will get a code to keep somewhere safe.</p>
    <div class="row2" style="padding:0"><button class="btn big" id="recNow">Create my code</button>
    <button class="btn ghost big" id="recLater">Later</button></div>`,
    m => { $('#recNow', m).onclick = () => { closeModal(); regenRecovery(null); }; $('#recLater', m).onclick = closeModal; });
}

// The "forgot password" flow on the sign-in screen.
function forgotDialog() {
  modal(`<h3>Reset your password</h3>
    <p class="sub">Enter your name and the recovery code you were given when the account was made.</p>
    <form id="fgForm" autocomplete="off">
      <input id="fgName" placeholder="Player name" maxlength="16" autocapitalize="off" spellcheck="false" required>
      <input id="fgCode" placeholder="Recovery code" maxlength="32" autocapitalize="characters" spellcheck="false" required>
      <input id="fgPass" type="password" placeholder="New password" maxlength="64" required>
      <button class="btn big" id="fgGo">Reset password</button>
      <p class="err" id="fgErr"></p>
    </form>
    <p class="fine">Using the code sets a new password and replaces the code with a fresh one.
    If you do not have a code, the account cannot be recovered - nothing on the server can identify you without it.</p>`,
    m => {
      const f = $('#fgForm', m);
      f.onsubmit = async e => {
        e.preventDefault();
        const btn = $('#fgGo', m), err = $('#fgErr', m);
        const name = $('#fgName', m).value.trim(), raw = $('#fgCode', m).value, pw = $('#fgPass', m).value;
        err.textContent = ''; btn.disabled = true; btn.textContent = 'Checking…';
        try {
          if (pw.length < 3) throw new Error('Password needs at least 3 characters');
          const key = name.toLowerCase();
          const u = await DB.get('users/' + key);
          if (!u) throw new Error('No player with that name');
          if (!u.hasR) throw new Error('That account has no recovery code');
          const rhash = await hashPw(normCode(raw), u.rsalt || '');
          const salt = randHex(), hash = await hashPw(pw, salt);
          const code2 = makeRecoveryCode(), rsalt2 = randHex(), rhash2 = await hashPw(normCode(code2), rsalt2);
          await DB.recover({ user: key, rhash, salt, hash, rsalt: rsalt2, rhash2 });
          saveLocalCode(key, code2);
          closeModal();
          toast('Password reset – signing you in');
          const r = await login(name, pw);
          remember(r.key, r.hash);
          await boot(r.key, r.p);
          setTimeout(() => showRecoveryCode(r.p.name, code2, false), 700);
        } catch (ex) {
          err.textContent = ex.message || 'Could not reset';
          btn.disabled = false; btn.textContent = 'Reset password';
        }
      };
    });
}

// ---------------- offline ----------------
// The world lives on the server, so trading needs a connection. Everything that is only
// about you - pack, shelf, achievements, the map - keeps working without one.
let OFFLINE = false;
function setOffPill() { const el = $('#hOff'); if (el) el.hidden = !OFFLINE; }
function goOffline(quiet) {
  if (OFFLINE) return; OFFLINE = true; setOffPill();
  if (!quiet) toast('📴 Offline – you can look around, but trading needs a connection');
}
async function backOnline() {
  if (!OFFLINE) return;
  OFFLINE = false; setOffPill();
  toast('📶 Back online');
  try { if (KEY) { const fresh = await DB.get('players/' + KEY); if (fresh) { P = normalize(fresh); snapshot(); renderAll(); } } } catch (e) { goOffline(true); }
}
// Guard for anything that changes the shared world or your saved record.
function needNet(what) {
  if (!OFFLINE && navigator.onLine !== false) return false;
  toast((what || 'That') + ' needs a connection', 'bad');
  return true;
}

// ---------------- auth ----------------
async function hashPw(pw, salt) {
  if (window.crypto && crypto.subtle) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 60000, hash: 'SHA-256' }, k, 256);
    return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = ''; for (let i = 0; i < 4; i++) h += hashStr(salt + i + pw + i).toString(16).padStart(8, '0'); return 'w' + h;
}
const randHex = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
const getRef = () => { try { const m = /[?&]ref=([\w-]{3,16})/.exec(location.search); return m ? m[1] : sessionStorage.getItem('sw_ref') || ''; } catch (e) { return ''; } };
async function register(name, pw) {
  if (!/^[A-Za-z0-9_-]{3,16}$/.test(name)) throw new Error('Name must be 3–16 letters, numbers, - or _');
  if (pw.length < 3) throw new Error('Password needs at least 3 characters');
  const key = name.toLowerCase(), salt = randHex(), hash = await hashPw(pw, salt);
  // A recovery code is minted with the account - it is the only way back in if the
  // password is forgotten, since there is no email address to send a reset to.
  const code = makeRecoveryCode(), rsalt = randHex(), rhash = await hashPw(normCode(code), rsalt);
  const r = await DB.tx('users/' + key, cur => cur ? undefined : { name, salt, hash, rsalt, rhash, created: Date.now() });
  if (!r.changed) throw new Error('That name is already taken');
  saveLocalCode(key, code);
  DB.setAuth(key, hash);
  let ref = getRef(); if (ref && ref.toLowerCase() === key) ref = '';
  // The tally is not touched here: the server credits the referrer only once this player has
  // actually opened a chest (see DB.reportReferral), so invites cannot be farmed by signing up.
  if (ref) { const u = await DB.get('users/' + ref.toLowerCase()); if (!u) ref = ''; }
  const p = newPlayer(name, ref ? ref.toLowerCase() : '');
  const starter = grantStarter(p, ref ? 1 : 0);
  await DB.set('players/' + key, p);
  return { key, hash, p, starter, code };
}
async function login(name, pw) {
  const key = name.toLowerCase(), u = await DB.get('users/' + key);
  if (!u) throw new Error('No player with that name');
  const hash = await hashPw(pw, u.salt);
  if (!(await DB.verify(key, hash))) throw new Error('Wrong password');
  DB.setAuth(key, hash);
  const p = normalize((await DB.get('players/' + key)) || newPlayer(u.name));
  const starter = starterIfEmpty(p);
  if (starter) await DB.set('players/' + key, p);
  return { key, hash, p, starter };
}
function remember(key, hash) { try { localStorage.setItem('stashwalk_session', JSON.stringify({ key, hash })); } catch (e) {} }
function armFs() {
  if (!FX.prefs.fs || !FX.fsSupported || FX.inFs()) return;
  toast('Tap anywhere to go fullscreen');
  document.addEventListener('pointerdown', () => { FX.unlock(); if (FX.prefs.fs) FX.enterFs(); }, { once: true });
}
async function resume() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('stashwalk_session') || 'null'); } catch (e) {}
  if (!s) return false;
  try {
    const u = await DB.get('users/' + s.key); if (!u || !(await DB.verify(s.key, s.hash))) return false;
    DB.setAuth(s.key, s.hash);
    const p = normalize((await DB.get('players/' + s.key)) || newPlayer(u.name));
    await boot(s.key, p); armFs(); return true;
  } catch (e) {
    // No connection. If this device has a copy of the record, open the game anyway.
    const snap = snapshotOf(s.key);
    if (!snap) return false;
    DB.setAuth(s.key, s.hash);
    goOffline(true);
    await boot(s.key, normalize(snap.p)); armFs();
    toast('📴 Offline – showing your last saved pack. Trading needs a connection.');
    return true;
  }
}
async function boot(key, p) {
  KEY = key; P = p;
  if (P.coinsV !== 1 && !OFFLINE) {
    const amt = retroCoins();
    P.coins = (P.coins || 0) + amt; P.stats.coinsEarned = (P.stats.coinsEarned || 0) + amt; P.coinsV = 1;
    save();
    setTimeout(() => showCoinIntro(amt), 5200);
  }
  try { inviteCount = (await DB.get('invites/' + key)) || 0; } catch (e) { inviteCount = 0; }
  setTimeout(() => refreshInvites(), 1200);
  setTimeout(() => checkFeed(), 2200);
  setTimeout(() => maybeNudgeInstall(), 4000);
  setTimeout(() => nudgeRecovery(), 2600);
  startPresence();
  fogIntroOnce();
  snapshot();                       // keep a copy on the device for offline launches
  $('#auth').hidden = true; $('#app').hidden = false;
  $('#dev').hidden = !DEV;
  initMap(); renderHeader(); renderAll(); checkAch(); show('explore');
  startGPS(true);
  if (P.daily.last !== dayKey()) { show('daily'); setTimeout(() => toast('🎁 Your daily reward is ready!', 'gold'), 300); }
  setTimeout(coachOnce, 1500);
}

// First-run coachmarks: a few pointers at the map, the sheet grip and the Daily tab. Shown
// once. Waits politely if the welcome or daily modal is still up.
function coachOnce() {
  try { if (localStorage.getItem('sw_coach')) return; } catch (e) { return; }
  if (modalOpen() || view !== 'explore') { setTimeout(coachOnce, 1800); return; }
  try { localStorage.setItem('sw_coach', '1'); } catch (e) {}
  runCoach([
    { sel: '#map', text: '🗺️ Walk toward chests here. A dashed circle means an undiscovered chest is inside it.' },
    { sel: '#sheetGrip', text: '📋 Drag this handle up for the full list of nearby chests.' },
    { sel: '[data-v="daily"]', text: '🎁 Come back each day for a free reward and a coin bonus.' }
  ], 0);
}
function runCoach(steps, i) {
  const old = $('#coach'); if (old) old.remove();
  if (i >= steps.length) return;
  const s = steps[i], tgt = $(s.sel);
  if (!tgt) return runCoach(steps, i + 1);
  const r = tgt.getBoundingClientRect();
  const wrap = document.createElement('div'); wrap.id = 'coach'; wrap.className = 'coach';
  const pad = 6, ringTop = Math.max(4, r.top - pad), ringH = Math.min(innerHeight - ringTop - 4, r.height + pad * 2);
  const below = ringTop + ringH + 12, place = below + 120 < innerHeight ? below : Math.max(12, ringTop - 112);
  wrap.innerHTML = `<div class="coachring" style="left:${Math.max(4, r.left - pad)}px;top:${ringTop}px;width:${Math.min(innerWidth - 8, r.width + pad * 2)}px;height:${ringH}px"></div>
    <div class="coachtip" style="top:${place}px"><p>${s.text}</p><div class="coachrow"><small>${i + 1} / ${steps.length}</small><button class="btn sm" id="coachNext">${i === steps.length - 1 ? 'Got it' : 'Next'}</button></div></div>`;
  document.body.appendChild(wrap);
  const next = () => runCoach(steps, i + 1);
  $('#coachNext', wrap).onclick = e => { e.stopPropagation(); FX.vibe(8); next(); };
  wrap.onclick = next;
}

// ---------------- navigation / rendering ----------------
let view = 'explore';
// The Items tab holds Pack + Shelf; the Shop tab holds Shop + Craft. These remember which
// half you were last looking at.
let itemsSub = 'pack', shopSub = 'shop';
function syncSubViews() {
  $$('#itemsSeg button').forEach(b => b.classList.toggle('on', b.dataset.sub === itemsSub));
  $$('#shopSeg button').forEach(b => b.classList.toggle('on', b.dataset.sub === shopSub));
  const sp = $('#sub-pack'), sd = $('#sub-dex'); if (sp && sd) { sp.hidden = itemsSub !== 'pack'; sd.hidden = itemsSub !== 'dex'; }
  const ss = $('#sub-shop'), sc = $('#sub-craft'); if (ss && sc) { ss.hidden = shopSub !== 'shop'; sc.hidden = shopSub !== 'craft'; }
}
function setSub(group, sub) {
  if (group === 'items') itemsSub = sub; else shopSub = sub;
  syncSubViews(); FX.sfx('tap'); FX.vibe(8);
  if (group === 'items') (itemsSub === 'pack' ? renderPack() : renderDex());
  else (shopSub === 'shop' ? renderShop() : renderCraft());
  const sv = $('#v-' + group); if (sv) sv.scrollTop = 0;
}
function show(v) {
  if (v !== 'explore' && fly) endFlight('home');
  view = v;
  $$('.view').forEach(s => s.hidden = s.id !== 'v-' + v);
  if (v === 'explore') { lastRender = 0; lastRowIds = ''; }
  if (v === 'items' || v === 'shop') syncSubViews();
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  renderAll(); window.scrollTo(0, 0);
  if (v === 'explore' && map) setTimeout(() => map.invalidateSize(), 50);
  if (v === 'me') refreshInvites();
}
function renderHeader() {
  $('#hAv').textContent = P.name[0].toUpperCase(); $('#hName').textContent = P.name;
  $('#hStreakV').textContent = streakNow(); $('#hPackV').textContent = packCount();
  $('#hCoinsV').textContent = fmtC(P.coins || 0);
  renderWalk(); renderDroneBtn();
  $('#dailyDot').hidden = P.daily.last === dayKey();
}
function streakNow() { return P.daily.last && daysBetween(P.daily.last, dayKey()) <= 1 ? P.daily.streak : 0; }
function renderAll() {
  if (!P) return; renderHeader();
  renderNextAch();
  if (view === 'explore') renderNearby();
  else if (view === 'items') (itemsSub === 'pack' ? renderPack() : renderDex());
  else if (view === 'daily') renderDaily();
  else if (view === 'shop') (shopSub === 'shop' ? renderShop() : renderCraft());
  else if (view === 'me') renderMe();
}

// First thing a new player sees: the items they can start trading with.
function showStarter(ids, then) {
  const items = ids.map(id => BY_ID[id]).filter(Boolean);
  if (!items.length) { if (then) then(); return; }
  const best = items.reduce((a, b) => (b.r > a.r ? b : a));
  modal(`<div style="text-align:center"><h3>Welcome to Stashwalk</h3>
    <p class="sub">Here's your starting pack. Walk to a chest and swap any of these for what's inside.</p>
    <div class="grid" style="justify-content:center">${items.map(it => tile(it)).join('')}</div>
    <p class="fine" style="margin-top:12px">Everything you ever collect stays on your Shelf, even after you trade it away.</p>
    <button class="btn big" id="okBtn" style="margin-top:12px">Let's go</button></div>`,
    m => { $('#okBtn', m).onclick = () => { closeModal(); if (then) setTimeout(then, 320); };
           setTimeout(() => { FX.sfx('reveal', best.r); FX.confetti(['#ffd98a', '#f2b84b', '#ffffff'], 40); }, 250); });
}

// A friendly empty state: big icon, one line, optional action button.
function emptyState(icon, msg, btnLabel, btnId) {
  return `<div class="empty full"><div class="eico">${icon}</div><p>${msg}</p>${btnLabel ? `<button class="btn sm" id="${btnId}">${btnLabel}</button>` : ''}</div>`;
}
// ---- pack ----
function renderPack() {
  const ids = Object.keys(P.inv).map(id => BY_ID[id]).filter(Boolean).sort((a, b) => b.r - a.r || a.n.localeCompare(b.n));
  if (ids.length) {
    $('#packNote').textContent = 'Tap an item for details. Trade at chests – everything you have ever owned stays on your Shelf.';
    $('#packGrid').innerHTML = ids.map(it => tile(it, { count: P.inv[it.id] })).join('');
  } else {
    $('#packNote').textContent = '';
    $('#packGrid').innerHTML = emptyState('🎒', 'Your pack is empty. Claim today\'s login reward to get your first item.', '🎁 Open Daily', 'emptyDaily');
    const b = $('#emptyDaily'); if (b) b.onclick = () => show('daily');
  }
}
function showStats() {
  const s = statView(), got = ACH.filter(a => P.ach[a.id]);
  const titles = [...new Set(['Newcomer'].concat(got.map(a => a.t)))];
  const n = nextAch();
  const row = (label, val) => `<div class="srow"><span>${label}</span><b>${val}</b></div>`;
  modal(`<div style="text-align:center"><div class="av big">${esc(P.name[0].toUpperCase())}</div>
      <h3 style="margin:8px 0 2px">${esc(P.name)}</h3><p class="sub" style="color:var(--acc2);margin:0">${esc(P.title)}</p></div>
    <div class="lbl">Equipped title</div>
    <select id="titleSel2">${titles.map(t => `<option ${t === P.title ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <p class="fine">${titles.length === 1 ? 'Earn achievements to unlock more titles.' : titles.length + ' titles earned.'}</p>
    <div class="lbl">Your record</div>
    <div class="stats">
      ${row('Chests opened', s.visited)}${row('Trades made', s.ex)}
      ${row('Items collected', s.dex + ' / ' + ITEMS.length)}${row('Relics crafted', s.relics + ' / ' + (RELICS.length || 0))}
      ${row('Items merged', s.merges)}${row('Gifts left', s.given)}
      ${row('Chests hidden', s.hidden)}${row('Friends invited', s.invites)}
      ${row('Daily rewards', s.logins)}${row('Best streak', s.streak)}
      ${row('Legendaries', s.byR[4])}${row('Achievements', got.length + ' / ' + ACH.length)}
      ${row('Miles walked', milesOf().toFixed(2))}${row('Coins earned', fmtC(s.coinsEarned))}
    </div>
    ${n ? `<div class="lbl">Closest achievement</div>
      <div class="nextbig"><i>${n.a.icon}</i><div><b>${esc(n.a.n)}</b><small>${esc(n.a.d)}</small>
        <span class="bar"><i style="width:${Math.round(n.frac * 100)}%"></i></span></div><u>${n.have}/${n.goal}</u></div>` : ''}
    <div class="trade"><button class="btn ghost" id="okBtn">Close</button><button class="btn" id="allAch">All achievements</button></div>`,
    m => {
      $('#okBtn', m).onclick = closeModal;
      $('#titleSel2', m).onchange = e => { P.title = e.target.value; save(); renderHeader(); toast('Title set to ' + P.title); };
      $('#allAch', m).onclick = () => { closeModal(); show('me'); setTimeout(() => { const a = $('#meBox .sec'); if (a) a.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 300); };
    });
}

function showItem(id) {
  const it = BY_ID[id]; if (!it) return;
  const own = P.inv[id] || 0, first = P.dex[id];
  modal(`<div style="text-align:center">${revealBox(it)}<h3 style="margin-top:12px">${esc(it.n)}</h3>${badge(it.r)}
    <p class="sub" style="margin-top:10px"><i>${esc(it.flavor)}</i></p>
    <p class="fine">${first ? 'First collected ' + new Date(first).toLocaleDateString() : 'Not collected yet'} · In your pack: ${own}</p>
    <button class="btn ghost" onclick="document.getElementById('modal').onclick({target:document.getElementById('modal')})">Close</button></div>`);
}

async function runDiag() {
  const out = $('#diagOut'), btn = $('#diagBtn');
  out.hidden = false; btn.disabled = true; out.textContent = 'Loading…';
  const lines = [];
  try {
    await loadTileIndex();
    lines.push(`${tileIndex.size.toLocaleString()} map tiles available`);
    let n = 0; TILES.forEach(t => n += t.length);
    lines.push(`${TILES.size} tile(s) downloaded, ${n.toLocaleString()} places in memory`);
    lines.push(`build ${window.ASSET_V || 'unknown'}`);
    if (pos) {
      await loadTiles(pos.lat, pos.lon, radiusM());
      const within = placesWithin(pos.lat, pos.lon, radiusM());
      lines.push(`${within.length} within your ${radiusMi} mi radius`);
      const by = {}; within.forEach(p => by[p.kind] = (by[p.kind] || 0) + 1);
      if (within.length) lines.push(Object.keys(by).sort((a, b) => by[b] - by[a]).map(k => `  ${kindInfo(k)[0]}: ${by[k]}`).join('\n'));
      const nr = nearestLoaded(pos.lat, pos.lon);
      if (nr) lines.push(`nearest: ${isFound(nr) ? nr.name : 'an undiscovered chest'} - ${fmtDist(nr.d)}`);
    } else lines.push('turn on GPS to see what is near you');
  } catch (e) { lines.push('place tiles failed to load: ' + (e.message || e)); }
  if (DB.osmBase) {
    try { const r = await fetch(DB.osmBase + '/'); lines.push('shared database: ' + (r.ok ? 'connected' : 'error ' + r.status)); }
    catch (e) { lines.push('shared database: unreachable'); }
  } else lines.push('shared database: not configured (local mode)');
  out.textContent = lines.join('\n');
  btn.disabled = false;
}

// ---- workshop tab ----
function renderCraft() {
  const lvl = workshopLevel(), nxt = nextWorkshop(), cur = WORKSHOP[lvl - 1];
  let h = `<div class="card wsHead"><div><b>Workshop level ${lvl}</b><small class="fine">${lvl ? esc(cur.name) : 'Locked'}</small></div>
    <div class="wsPips">${WORKSHOP.map(w => `<i class="${P.ach[w.ach] ? 'on' : ''}" title="${esc(w.name)}"></i>`).join('')}</div></div>`;
  if (nxt) h += `<p class="fine pad">Next: <b>level ${nxt.lvl} – ${esc(nxt.name)}</b> · ${esc(nxt.how)}</p>`;
  else h += `<p class="fine pad">Workshop fully unlocked. Everything is craftable.</p>`;
  if (!lvl) h += `<div class="empty">Trade at a chest to open the Workshop.</div>`;

  const merges = mergeOptions();
  h += `<h2 class="sec">Merge <small>${C.MERGE_COUNT} of a kind → 1 of the next rarity</small></h2>`;
  h += merges.length ? '<div class="list">' + merges.map(m => `<div class="mrow${m.ok ? '' : ' off'}">
      ${tile(m.from, { count: m.have })}<span class="arrow">→</span>${tile(m.to)}
      <button class="btn sm" data-merge="${esc(m.from.id)}" ${m.ok ? '' : 'disabled'}>${m.ok ? 'Merge' : 'Lv ' + (m.from.r + 1)}</button>
    </div>`).join('') + '</div>'
    : `<div class="empty">Nothing to merge yet. Collect ${C.MERGE_COUNT} of the same item and you can fuse them.</div>`;

  h += `<h2 class="sec">Relics <small>${statView().relics} / ${RELICS.length} collected</small></h2>
    <p class="fine pad">Relics are craft-only — they never appear in chests.</p><div class="list">`;
  RELICS.forEach(r => {
    const st = recipeState(r);
    h += `<div class="recipe${st.locked ? ' off' : ''}">
      <div class="rhead">${tile(r, st.locked || !P.dex[r.id] ? { sil: true } : {})}
        <div><b>${esc(r.n)}</b><small>${badge(r.r)} · Tier ${r.tier}${P.dex[r.id] ? ' · ✓ made' : ''}</small>
        <small class="fine"><i>${esc(r.flavor)}</i></small></div>
        <button class="btn sm" data-craft="${esc(r.id)}" ${st.locked || !st.ready ? 'disabled' : ''}>${st.locked ? 'Lv ' + r.lvl : 'Craft'}</button></div>
      <div class="ring">${st.parts.map(p => `<span class="ing${p.pick ? ' got' : ''}">${p.sample ? p.sample.e : '?'} ${esc(p.sample ? p.sample.n.replace(/^\S+\s/, '') : '')}<b>${p.minR ? ' ' + RAR[p.minR].n + '+' : ''}</b></span>`).join('')}</div>
    </div>`;
  });
  h += '</div>';
  $('#craftBox').innerHTML = h;
}

// ---- dex ----
let dexFilter = 'got';      // the shelf opens on what you have collected
function renderDex() {
  const have = Object.keys(P.dex).filter(id => BY_ID[id]).length;
  $('#dexCount').textContent = `${have} / ${ITEMS.length}`; $('#dexBar').style.width = (have / ITEMS.length * 100) + '%';
  const f = [['all', 'All'], ['got', 'Collected'], ['miss', 'Missing']].concat(RAR.map((r, i) => ['r' + i, r.n]));
  $('#dexFilters').innerHTML = f.map(([k, n]) => `<button data-f="${k}" class="${dexFilter === k ? 'on' : ''}">${n}</button>`).join('');
  const q = ($('#dexSearch').value || '').trim().toLowerCase();
  const list = ITEMS.filter(it => {
    const g = !!P.dex[it.id];
    if (dexFilter === 'got' && !g) return false; if (dexFilter === 'miss' && g) return false;
    if (dexFilter[0] === 'r' && it.r !== +dexFilter[1]) return false;
    if (q) return g && it.n.toLowerCase().includes(q); return true;
  });
  $('#dexGrid').innerHTML = list.map(it => tile(it, P.dex[it.id] ? { count: 0 } : { sil: true })).join('') ||
    emptyState('📚', dexFilter === 'got' ? 'No items collected yet. Open chests to start your shelf.' : 'Nothing matches this filter.');
}

// ---- daily ----
const TIERS = [0,0,1,0,1,0,2, 0,1,1,0,1,0,3, 1,0,2,1,0,1,3, 1,1,2,1,2,1,4];
const TIER_ICON = ['🎁', '🎁', '💙', '💜', '🌟'];
const dailyCoins = (streak, day) => CO.daily + CO.dailyStreak * Math.min(Math.max(0, streak - 1), 6) + (day % 7 === 0 ? CO.dailyBig : 0);
function renderDaily() {
  const n = P.daily.n, claimed = P.daily.last === dayKey(), cycleDay = (n % 28) + 1, cycle = Math.floor(n / 28) + 1;
  let h = `<div class="claim"><div style="font-size:13px;color:var(--mut)">Cycle ${cycle} · Streak 🔥 ${streakNow()}</div>`;
  if (claimed) h += `<h3 style="margin:6px 0">Come back tomorrow!</h3><p class="fine" style="margin:0">Next up: Day ${cycleDay} – ${RAR[TIERS[cycleDay - 1]].n} reward.</p>`;
  else {
    const nextStreak = P.daily.last && daysBetween(P.daily.last, dayKey()) === 1 ? P.daily.streak + 1 : 1;
    h += `<h3 style="margin:6px 0">Day ${cycleDay} reward is ready</h3><p class="fine">${RAR[TIERS[cycleDay - 1]].n} item + ${fmtC(dailyCoins(nextStreak, cycleDay))} 🪙</p><button class="btn big" id="claimBtn">Claim reward</button>`;
  }
  h += '</div><div class="cal">';
  // coins shown on each day assume the streak keeps going from today
  const baseStreak = claimed ? P.daily.streak : (P.daily.last && daysBetween(P.daily.last, dayKey()) === 1 ? P.daily.streak : 0);
  for (let d = 1; d <= 28; d++) {
    const t = TIERS[d - 1], done = d < cycleDay || (d === cycleDay && claimed && false), now = d === cycleDay && !claimed;
    const calStreak = baseStreak + (d - cycleDay) + 1;
    h += `<div class="day t${t}${d < cycleDay ? ' done' : ''}${now ? ' now' : ''}"><b>Day ${d}</b><span>${TIER_ICON[t]}</span><small style="color:${RAR[t].c}">${t >= 2 ? RAR[t].n : ''}</small>${d >= cycleDay ? `<em>+${dailyCoins(calStreak, d)}🪙</em>` : ''}</div>`;
  }
  h += `</div><p class="fine pad">Missing a day never resets your progress – just claim the next reward when you're back. Every day pays coins too – more for each day in a row (up to +${CO.dailyStreak * 6}), and a +${CO.dailyBig} bonus on days 7, 14, 21 and 28.</p>`;
  $('#dailyBox').innerHTML = h;
  const b = $('#claimBtn'); if (b) b.onclick = claimDaily;
}
function claimDaily() {
  if (needNet('Claiming your reward')) return;
  const today = dayKey(); if (P.daily.last === today) return;
  const day = (P.daily.n % 28) + 1, it = rollItem(Math.random, 1, TIERS[day - 1]);
  P.daily.streak = P.daily.last && daysBetween(P.daily.last, today) === 1 ? P.daily.streak + 1 : 1;
  P.daily.max = Math.max(P.daily.max || 0, P.daily.streak); P.daily.n++; P.daily.last = today;
  const coins = dailyCoins(P.daily.streak, day);
  const isNew = addItem(it.id); earn(coins, 'Daily reward'); save(); checkAch(); renderAll();
  FX.sfx('daily');
  modal(`<div style="text-align:center"><p class="sub">Day ${day} reward</p>${revealBox(it)}<h3 style="margin-top:12px">${esc(it.n)}</h3>${badge(it.r)}
    <p class="sub" style="margin-top:10px">${isNew ? '✨ New for your shelf!' : 'Added to your pack.'}</p>
    <p class="coinline">+${fmtC(coins)} 🪙${P.daily.streak > 1 ? ` <small>streak ${P.daily.streak}</small>` : ''}</p>
    <button class="btn big" id="okBtn">Nice!</button></div>`, m => { $('#okBtn', m).onclick = closeModal; FX.reveal(it.r, $('.tile.big', m), true); });
}

// ---- me ----
// The account-recovery card in the Me tab.
function recoveryCard() {
  const code = localCode(KEY);
  return `<div class="card"><b>Account recovery</b>
    <p class="fine">There is no email address on your account, so this code is the only way back in
    if you forget your password. Keep it somewhere safe.</p>
    ${code ? codeBox(code, 'mine') + '<p class="fine" style="margin-top:8px">Shown from this device. Make a new one if you think someone else has seen it – the old one stops working.</p>'
           : '<p class="fine" style="color:var(--acc2)"><b>Not stored on this device.</b> Your code still works if you wrote it down. Make a new one if you did not.</p>'}
    <button class="btn sm ghost" id="recNew" style="margin-top:10px">New code</button></div>`;
}

// The install / offline card in the Me tab.
function appCard() {
  const standalone = isStandalone();
  let action;
  if (PWA.waiting) action = `<button class="btn big" id="updBtn">⬇️ Update now</button>`;
  else if (standalone) action = `<p class="fine" style="color:var(--acc2);margin:0"><b>✅ Installed</b> – running as an app.</p>`;
  else if (canInstall() || iosInstallable()) action = `<button class="btn big" id="insBtn">📲 Install Stashwalk</button>`;
  else action = `<p class="fine" style="margin:0">Your browser can add this to your home screen from its own menu.</p>`;
  return `<div class="card"><b>Install &amp; offline</b>
    <p class="fine">Installed, Stashwalk opens straight from your home screen with no browser bars –
    which is also the reliable fix for the tab bar hiding behind them.</p>
    ${action}
    <p class="fine" style="margin-top:12px"><b>Without a signal</b> you can still open the game and look at your
    pack, your shelf, your achievements and the map wherever you have already been.
    Opening chests, trading and daily rewards all need a connection, because those chests are shared with every other player.</p>
    <p class="fine">${OFFLINE ? '📴 <b>Offline right now.</b>' : '📶 Connected.'} Map and park data stored on this device.</p></div>`;
}

function renderMe() {
  const s = statView(), unlocked = ACH.filter(a => P.ach[a.id]);
  const titles = ['Newcomer'].concat(unlocked.map(a => a.t));
  const link = location.origin + location.pathname.replace(/index\.html$/, '') + '?ref=' + encodeURIComponent(P.name);
  let h = adminCardShell() + `<div class="card"><b>${esc(P.name)}</b><br><small class="fine">Equipped title</small>
    <select id="titleSel">${[...new Set(titles)].map(t => `<option ${t === P.title ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <p class="fine" style="margin-bottom:0">${s.visited} chests opened · ${s.ex} trades · ${s.dex}/${ITEMS.length} collected · ${s.hidden} hidden · ${s.invites} invited</p></div>
    <div class="card"><b>Invite friends</b>
    <p class="fine">Share this link or let them scan the code. They start with a bonus item, and you get a Rare
    once they open their first chest - plus an Epic at 5 friends and a Legendary at 10.</p>
    <p class="fine"><b style="color:var(--acc2)">${s.invites} friend${s.invites === 1 ? '' : 's'} joined</b>${s.invites ? ` \u00b7 ${P.refPaid || 0} rewarded` : ''}
      <button class="btn sm ghost" id="refBtn" style="margin-left:6px">Check</button></p>
    <div id="qr"></div><div class="linkbox"><input id="inviteLink" readonly value="${esc(link)}"><button class="btn sm" id="copyBtn">Copy</button></div>
    ${navigator.share ? '<button class="btn ghost big" id="shareBtn" style="margin-top:8px">Share…</button>' : ''}</div>
    <h2 class="sec">Achievements <small>${unlocked.length} / ${ACH.length}</small></h2><div style="padding:0 14px">`;
  ACH.forEach(a => {
    const v = Math.min(a.get(s), a.goal), got = !!P.ach[a.id];
    const pct = Math.round(v / a.goal * 100);
    h += `<div class="ach${got ? '' : ' lock'}"><div class="ai">${got ? a.icon : a.icon}</div><div><b>${esc(a.n)}</b>
      <small style="display:inline;color:var(--acc2)">${got ? '· ' + esc(a.t) : ''}</small>
      <small>${esc(a.d)}</small>
      <div class="achbar"><span class="bar"><i style="width:${got ? 100 : pct}%" class="${got ? 'done' : ''}"></i></span>
        <u>${got ? '✓ earned' : v + ' / ' + a.goal}</u></div></div></div>`;
  });
  h += `</div>${recoveryCard()}${appCard()}<div class="card"><b>This build</b>
    <p class="fine">Version <b>${esc(String(window.ASSET_V || 'unknown'))}</b>. Use this if an update does not seem to have arrived -
    it reloads everything from scratch without touching your sign-in or settings.</p>
    <button class="btn sm" id="reloadBtn">Hard refresh</button>
    <p class="fine" style="margin-top:12px"><b>Tab bar hidden behind your browser's toolbar?</b>
    Nudge the game up until you can see it. Saved for next time.</p>
    <div class="row2" style="padding:0;align-items:center">
      <button class="btn sm ghost" id="insetDown">− less</button>
      <b id="insetVal" style="color:var(--acc2);min-width:52px;text-align:center">${getInset()} px</b>
      <button class="btn sm ghost" id="insetUp">+ more</button>
      <button class="btn sm ghost" id="insetAuto">Auto</button>
    </div>
    <pre id="layoutOut" class="diag" style="margin-top:10px"></pre></div>
    <div class="card"><b>Place list</b><p class="fine">Chest locations ship with the game - no internet service is needed to find them.</p>
    <button class="btn sm ghost" id="diagBtn">Show details</button><pre id="diagOut" class="diag" hidden></pre></div>
    <div class="card"><b>Settings</b>
    <label class="tg"><input type="checkbox" id="setSnd" ${FX.prefs.snd ? 'checked' : ''}><span>🔊 Sound effects</span></label>
    <label class="tg"><input type="checkbox" id="setFx" ${FX.prefs.fx ? 'checked' : ''}><span>✨ Visual effects &amp; vibration</span></label>
    <label class="tg"><input type="checkbox" id="setGei" ${FX.prefs.geiger ? 'checked' : ''}><span>📡 Ticking sound while the locator is running</span></label>
    <label class="tg"><input type="checkbox" id="setMap" ${FX.prefs.darkmap ? 'checked' : ''}><span>🌙 Dark map</span></label>
    ${DB.remote ? `<p class="fine">📍 Your approximate location is shared with the server and admin team for further development.</p>` : ''}
    ${FX.fsSupported ? `<label class="tg"><input type="checkbox" id="setFs" ${FX.inFs() ? 'checked' : ''}><span>⛶ Fullscreen (also on login)</span></label>` : ''}</div>
    <div class="card"><b>Your data</b><p class="fine">${DB.remote ? 'Shared world: chests and trades are visible to every player.' : 'Local mode: saved in this browser only. Export a backup file to move devices.'}</p>
    <div class="row2" style="padding:0"><button class="btn sm ghost" id="expBtn">Export save file</button><button class="btn sm ghost" id="impBtn">Import save file</button>
    <button class="btn sm ghost" id="outBtn">Log out</button></div><input type="file" id="impFile" accept="application/json" hidden></div>`;
  $('#meBox').innerHTML = h;
  if (isAdmin()) { renderAdmin(); $('#meDot').hidden = true; if (!adminData) adminPoll(); }
  $('#titleSel').onchange = e => { P.title = e.target.value; save(); renderHeader(); };
  $('#refBtn').onclick = async e => { e.target.disabled = true; e.target.textContent = 'Checking…'; const was = inviteCount; await refreshInvites(); if (inviteCount === was) toast(`${inviteCount} friend${inviteCount === 1 ? '' : 's'} joined so far`); renderMe(); };
  $('#copyBtn').onclick = () => { const i = $('#inviteLink'); i.select(); try { navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand('copy'); } toast('Invite link copied'); };
  const sb = $('#shareBtn'); if (sb) sb.onclick = () => navigator.share({ title: 'Stashwalk', text: 'Come find loot with me on Stashwalk!', url: link }).catch(() => {});
  if (window.QRCode) { try { new QRCode($('#qr'), { text: link, width: 176, height: 176, colorDark: '#0f1a14', colorLight: '#ffffff' }); } catch (e) {} }
  else $('#qr').outerHTML = '<p class="fine">QR code library unavailable offline – use the link.</p>';
  $('#diagBtn').onclick = runDiag;
  const showLayout = () => {
    const r = layoutReport();
    $('#layoutOut').textContent =
      `window.innerHeight  ${r.win}\nvisualViewport      ${r.vv}\ndocument client     ${r.doc}\n` +
      `100svh              ${r.svh}\nscreen              ${r.scr} (dpr ${r.dpr})\n` +
      `--vh applied        ${r.vh}\nbottom inset        ${r.inset}px\ntab bar ends at     ${r.tabsEnd}\n` +
      `width ${r.winW} of screen ${r.scrW}\npage zoom           ~${r.zoom}%${r.zoom > 112 ? '  <-- set this to 100%' : ''}\npinch scale         ${r.scale}`;
    $('#insetVal').textContent = r.inset + ' px';
  };
  showLayout();
  const nudge = d => { setInset(getInset() + d); setTimeout(showLayout, 120); };
  $('#insetUp').onclick = () => nudge(16);
  $('#insetDown').onclick = () => nudge(-16);
  $('#insetAuto').onclick = () => { setInset(0); setTimeout(showLayout, 120); toast('Bottom inset cleared'); };
  $('#reloadBtn').onclick = e => { e.target.disabled = true; e.target.textContent = 'Reloading…'; hardRefresh(); };
  $('#setSnd').onchange = e => { FX.set('snd', e.target.checked); FX.sfx('coin'); };
  $('#setFx').onchange = e => { FX.set('fx', e.target.checked); if (e.target.checked) { FX.burst(innerWidth / 2, innerHeight / 2, ['#f2b84b', '#fff'], 24); FX.vibe(30); } };
  $('#setGei').onchange = e => { FX.set('geiger', e.target.checked); if (e.target.checked) FX.geigerDemo(); };
  $('#setMap').onchange = e => { FX.set('darkmap', e.target.checked); applyBasemap(); toast(e.target.checked ? 'Dark map on' : 'Standard map on'); };
  const sf = $('#setFs'); if (sf) sf.onchange = e => { if (e.target.checked) { FX.set('fs', true); FX.enterFs(); } else { FX.set('fs', false); FX.exitFs(); } };
  const rc = $('#recNew'); if (rc) rc.onclick = e => regenRecovery(e.target);
  const rcode = localCode(KEY); if (rcode) wireCodeBox($('#meBox'), P.name, rcode, 'mine');
  const ib = $('#insBtn'); if (ib) ib.onclick = doInstall;
  const ub = $('#updBtn'); if (ub) ub.onclick = e => { e.target.disabled = true; e.target.textContent = 'Updating…'; applyUpdate(); };
  $('#expBtn').onclick = exportSave; $('#impBtn').onclick = () => $('#impFile').click();
  $('#impFile').onchange = importSave;
  $('#outBtn').onclick = () => { try { localStorage.removeItem('stashwalk_session'); } catch (e) {} location.href = location.pathname; };
}
// A full reload that defeats the browser cache. Scripts and styles are version-stamped, but
// index.html itself can be served stale, which pins you to an old build - a changing query
// string forces a fresh copy. Sign-in and settings are left alone.
async function hardRefresh() {
  try { if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } } catch (e) {}
  try {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) {}
  try {
    Object.keys(localStorage).filter(k => k.startsWith('sw_osm')).forEach(k => localStorage.removeItem(k));
  } catch (e) {}
  const u = new URL(location.href);
  u.searchParams.set('r', Date.now().toString(36));
  location.replace(u.toString());
}

// ---------------- install & offline support ----------------
// Registering the service worker does two things: the game opens straight from the
// home screen with no browser bars, and the code, park list and map tiles you have
// already seen stay available with no signal.
const PWA = {
  evt: null,          // Chrome's install prompt, captured until the player asks for it
  reg: null,
  waiting: null,      // a newer version sitting ready
  installed: false
};
function isStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  } catch (e) { return false; }
}
function canInstall() { return !!PWA.evt && !isStandalone(); }
function iosInstallable() { return isIOS() && !isStandalone(); }

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js', { scope: './' }).then(reg => {
    PWA.reg = reg;
    if (reg.waiting && navigator.serviceWorker.controller) updateReady(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) updateReady(w);
      });
    });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return; reloading = true;
    if (PWA.applying) location.reload();
  });
  // Check for a new build whenever the game comes back to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && PWA.reg) PWA.reg.update().catch(() => {});
  });
  // people leave this open on walks for a long time - look for a new build every 15 minutes too
  setInterval(() => { if (PWA.reg && !document.hidden) PWA.reg.update().catch(() => {}); }, 15 * 60 * 1000);
}
// A new build is sitting ready: say so on every screen, with one tap to switch.
// Only a genuinely newer build gets the banner. A waiting worker that is the same build the
// page is already running (which is what happened right after every update, because the
// worker used to be registered under a per-build address) is switched in silently.
function swVersion(worker) {
  return new Promise(res => {
    const ch = new MessageChannel(), t = setTimeout(() => res(null), 1500);
    ch.port1.onmessage = e => { clearTimeout(t); res(e.data && e.data.sw); };
    try { worker.postMessage('version', [ch.port2]); } catch (e) { clearTimeout(t); res(null); }
  });
}
async function updateReady(worker) {
  const v = await swVersion(worker);
  if (v && v === String(window.ASSET_V)) { try { worker.postMessage('skipWaiting'); } catch (e) {} return; }
  PWA.waiting = worker;
  const bar = $('#updBar'); if (bar) bar.hidden = false;
  if (!$('#v-me').hidden) renderMe();
}
function applyUpdate() {
  if (!PWA.waiting) return hardRefresh();
  PWA.applying = true;
  PWA.waiting.postMessage('skipWaiting');
  setTimeout(() => location.reload(), 1200);     // in case controllerchange never fires
}
async function doInstall() {
  if (iosInstallable()) return iosInstallHelp();
  if (!PWA.evt) return toast('Your browser will offer this from its own menu', 'bad');
  const e = PWA.evt; PWA.evt = null;
  try { e.prompt(); const r = await e.userChoice; if (r && r.outcome === 'accepted') toast('Installing…'); } catch (err) {}
  renderMe();
}
function iosInstallHelp() {
  modal(`<h3>Add Stashwalk to your home screen</h3>
    <p class="sub">It opens like a normal app – no address bar eating the screen, and it still
    works where there is no signal.</p>
    <ol class="steps"><li>Tap the <b>Share</b> button at the bottom of Safari <span class="em">⬆️</span></li>
    <li>Scroll down and tap <b>Add to Home Screen</b></li>
    <li>Tap <b>Add</b></li></ol>
    <p class="fine">Safari only offers this from its own Share menu, so a button here cannot do it for you.</p>
    <button class="btn big" id="okBtn">Got it</button>`, m => { $('#okBtn', m).onclick = closeModal; });
}
// Suggested once, after the player has actually played a little.
function maybeNudgeInstall() {
  if (isStandalone()) return;
  if (!canInstall() && !iosInstallable()) return;
  try { if (localStorage.getItem('sw_nudged')) return; } catch (e) { return; }
  if ((P.stats && Object.keys(P.stats.visited || {}).length) < 1) return;
  try { localStorage.setItem('sw_nudged', '1'); } catch (e) {}
  setTimeout(() => {
    modal(`<h3>📲 Put Stashwalk on your home screen</h3>
      <p class="sub">You walk around with this. Installed, it opens full screen with no browser bars,
      and your pack, shelf and the map keep working when the signal drops.</p>
      <div class="row2" style="padding:0"><button class="btn big" id="insNow">Install</button>
      <button class="btn ghost big" id="insLater">Not now</button></div>`,
      m => { $('#insNow', m).onclick = () => { closeModal(); doInstall(); }; $('#insLater', m).onclick = closeModal; });
  }, 1500);
}

function exportSave() {
  const data = DB.remote ? { _t: 'stashwalk-player', key: KEY, player: P } : { _t: 'stashwalk-local', db: DB.dump() };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = 'stashwalk-' + (DB.remote ? KEY : 'local') + '-save.json'; document.body.appendChild(a); a.click(); a.remove();
}
function importSave(e) {
  const f = e.target.files[0]; if (!f) return; const r = new FileReader();
  r.onload = async () => {
    try {
      const d = JSON.parse(r.result);
      if (d._t === 'stashwalk-local' && !DB.remote) { DB.load(d.db); toast('Save imported – reloading'); setTimeout(() => location.reload(), 800); }
      else if (d._t === 'stashwalk-player' && d.key === KEY) { await DB.set('players/' + KEY, normalize(d.player)); toast('Save imported – reloading'); setTimeout(() => location.reload(), 800); }
      else toast('That file does not match this game mode/account', 'bad');
    } catch (err) { toast('Not a valid save file', 'bad'); }
  };
  r.readAsText(f);
}

// ---------------- map / GPS / chests ----------------
let map, meMarker, accCircle, pos = null, chests = [], markers = [], watchId = null, lastLoad = null, loading = false, nearSeen = {}, radCircle = null, lastR = 0, osmErr = '';
let radiusMi = 25; try { radiusMi = +localStorage.getItem('sw_radius') || C.DEFAULT_RADIUS_MI || 25; } catch (e) {}
const radiusM = () => radiusMi * 1609.344;
// Dark by default: the standard bright map fights a dark green game, and chest
// markers are much easier to pick out against it. Switchable in Me > Settings.
// The tiles are OpenStreetMap's own either way - the dark look is a CSS filter on
// the tile layer, so there is no second tile service to depend on, nothing to cache
// twice, and the markers (a separate Leaflet pane) are untouched by it.
let baseLayer = null;
function applyBasemap() {
  if (!map || !window.L) return;
  if (!baseLayer) {
    baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
    baseLayer.setZIndex(0);
  }
  $('#map').classList.toggle('darkmap', !!FX.prefs.darkmap);
}
function initMap() {
  if (map || !window.L) { if (!window.L) $('#map').innerHTML = '<div class="nomap">Map unavailable offline – the chest list below still works.</div>'; return; }
  map = L.map('map', { zoomControl: false }).setView([39.5, -98.35], 4);
  applyBasemap();
  map.on('click', e => { if (admPlacing) return adminMapClick(e); if (DEV) setPos(e.latlng.lat, e.latlng.lng, 2, true); });
  // re-cluster the chest markers whenever the view changes
  map.on('zoomend', () => drawChestMarkers());
  const fix = () => { try { map.invalidateSize({ animate: false }); } catch (e) {} };
  [0, 150, 500, 1200].forEach(ms => setTimeout(fix, ms));
  addEventListener('resize', fix); addEventListener('orientationchange', () => setTimeout(fix, 300));
  if (window.ResizeObserver) { try { new ResizeObserver(fix).observe($('#map')); } catch (e) {} }
}
function startGPS(quiet) {
  if (!navigator.geolocation) { gpsMsg('This browser has no GPS support', 'bad'); return; }
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  gpsMsg('Finding your location…');
  watchId = navigator.geolocation.watchPosition(p => setPos(p.coords.latitude, p.coords.longitude, p.coords.accuracy, false),
    err => gpsMsg(err.code === 1 ? 'Location blocked – allow it in your browser settings (HTTPS required)' : 'Can\'t get a GPS fix yet…', 'bad'),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.platform || '') ||
  (/Mac/.test(navigator.userAgent) && 'ontouchend' in document) || /iPhone|iPad/.test(navigator.userAgent);
// A fix of several hundred feet means the device gave a coarse, network-level position rather
// than real GPS. On iOS that is almost always the Precise Location switch.
let coarseWarned = 0;
function coarseHint(accFt) {
  if (accFt < C.COARSE_FT) return '';
  if (Date.now() - coarseWarned > 120000) {
    coarseWarned = Date.now();
    setTimeout(() => showCoarseHelp(accFt), 800);
  }
  return ' · imprecise';
}
function showCoarseHelp(accFt) {
  const ios = isIOS();
  modal(`<h3>📍 Location is only roughly right</h3>
    <p class="sub">Your device reported a position accurate to about ${Math.round(accFt)} ft. That is a
    network-level guess rather than real GPS, so chests will look like they are in the wrong place and
    will not update as you walk.</p>
    ${ios ? `<div class="lbl">On iPhone or iPad</div>
    <ol class="help">
      <li><b>Settings → Privacy &amp; Security → Location Services</b> — make sure this is on.</li>
      <li>In that list, find your browser (Safari, Brave, Chrome) and set it to <b>While Using the App</b>.</li>
      <li>Turn on <b>Precise Location</b> for it. This is the setting that usually causes this.</li>
      <li>Reload this page and choose <b>Allow While Using</b>, not "Allow Once".</li>
      <li>Turn off <b>Low Power Mode</b>, which slows location updates.</li>
    </ol>`
    : `<div class="lbl">On Android</div>
    <ol class="help">
      <li><b>Settings → Location</b> — make sure it is on.</li>
      <li>Set <b>Location accuracy</b> (or Google Location Accuracy) to on.</li>
      <li>In your browser's site settings, allow Location for this site and choose <b>precise</b>.</li>
      <li>Turn off Battery Saver, which slows location updates.</li>
    </ol>`}
    <p class="fine">Step outside if you can - indoors a device often falls back to wi-fi positioning.</p>
    <div class="trade"><button class="btn ghost" id="okBtn">Got it</button><button class="btn" id="retryGps">Try again</button></div>`,
    m => {
      $('#okBtn', m).onclick = closeModal;
      $('#retryGps', m).onclick = () => { closeModal(); startGPS(); toast('Asking your device again…'); };
    });
}

function gpsMsg(t, cls) {
  if (cls === 'bad') FX.geiger(Infinity, 1); const g = $('#gps'); g.className = 'gpspill ' + (cls || ''); $('#gpsText').textContent = t; $('#gpsBtn').hidden = cls === 'ok'; }
function setPos(lat, lon, acc, manual) {
  const first = !pos; pos = { lat, lon, acc: acc || 0 };
  if (first && KEY && !OFFLINE) DB.ping({ lat, lon }).catch(() => {});   // so the admin map is right straight away
  trackWalk(lat, lon, pos.acc, manual);
  if (!fly) { rcEnsureAround(pos); rcDraw(); if (!manual && pos.acc <= 40) rcCollect(pos, false); }
  const accFt = pos.acc * FT;
  gpsMsg(`${manual ? 'DEV position' : 'GPS'} ±${Math.round(accFt)} ft${manual ? '' : coarseHint(accFt)}`,
         accFt >= C.COARSE_FT ? 'bad' : 'ok');
  if (window.L && map) {
    if (!meMarker) {
      meMarker = L.marker([lat, lon], { icon: L.divIcon({ className: 'me-icon', html: '<div class="me-dot"></div>', iconSize: [16, 16] }), zIndexOffset: 1000, interactive: false, keyboard: false }).addTo(map);
      accCircle = L.circle([lat, lon], { radius: pos.acc, weight: 1, color: '#3b9cff', fillOpacity: .08, interactive: false }).addTo(map);
    }
    else { meMarker.setLatLng([lat, lon]); accCircle.setLatLng([lat, lon]).setRadius(pos.acc); }
    if (first) map.setView([lat, lon], 16); else if (manual) map.setView([lat, lon], 18);
    updateRadiusCircle();
  }
  if (!lastLoad || dist(pos, lastLoad) > Math.min(1000, Math.max(250, radiusM() * 0.3))) loadNearby();
  markNear(); if (view === 'explore') renderNearby();
}
// ---------------- chest locator ----------------
// The proximity ticking used to switch itself on whenever a chest was close, which
// is startling when you did not ask for it. Now getting close only offers it: a quiet
// panel appears on the map, and nothing makes a sound until the player taps it.
let locMode = 'off', locTarget = null, locName = '';
const LOC_RANGE = () => C.GEIGER_FT * 0.3048;
const HEAT = [[.78, 'Cold', '#4aa3ff'], [.55, 'Cool', '#49c8d8'], [.34, 'Warm', '#7ed08a'],
              [.18, 'Hot', '#f2b84b'], [.06, 'Burning', '#ff9a3c'], [0, 'Steps away', '#fff3c4']];
function heatOf(frac) { for (const h of HEAT) if (frac >= h[0]) return h; return HEAT[HEAT.length - 1]; }

function stopLocate(quiet) {
  if (locMode !== 'on') return;
  locMode = 'off'; locTarget = null;
  FX.geiger(Infinity, 1);
  document.body.classList.remove('locating');
  document.body.style.removeProperty('--sonar');
  if (!quiet) toast('Locator off');
  renderLocator(null, Infinity);
  refreshChestViews();                      // drop the ring from the map marker
}
function startLocate(c) {
  if (!c) return;
  locMode = 'on'; locTarget = c.id; locName = c.name;
  document.body.classList.add('locating');
  FX.unlock(); FX.sfx('ping'); FX.vibe(30);
  const gap = Math.max(0, dist(pos, c) - unlockM(c));
  FX.geiger(gap, LOC_RANGE());              // start ticking now, not on the next GPS fix
  renderLocator(c, gap);
  refreshChestViews();                      // put the target ring on the map marker
}
// Rebuilt only when the state or the target changes; the numbers update in place so the
// bar can animate instead of jumping.
let locShape = '';
function renderLocator(c, gap) {
  const box = $('#locator'); if (!box) return;
  const shape = locMode + '|' + (c ? c.id + (isFound(c) ? '+' : '?') : '');
  if (!c) { box.hidden = true; box.innerHTML = ''; locShape = ''; return; }
  box.hidden = false;
  if (shape !== locShape) {
    locShape = shape;
    box.innerHTML = locMode === 'on'
      ? `<div class="locon">
           <div class="lochead"><i class="locping">📡</i><b>${isFound(c) ? esc(c.name) : 'Hidden chest'}</b>
             <button class="locx" id="locStop" title="Stop locating">✕</button></div>
           <div class="locbar"><i id="locFill"></i></div>
           <div class="locfoot"><span id="locWord">Searching…</span><span id="locDist"></span></div>
         </div>`
      : `<button class="locoffer" id="locGo"><i>📡</i>
           <div><b>${isFound(c) ? 'Locator' : 'A hidden chest is close'}</b><small>${isFound(c) ? 'home in on ' + esc(c.name) : 'start the locator to find it'}</small></div><u>Start</u></button>`;
    const go = $('#locGo', box); if (go) go.onclick = () => startLocate(c);
    const stop = $('#locStop', box); if (stop) stop.onclick = () => stopLocate();
  }
  if (locMode !== 'on') return;
  const range = LOC_RANGE(), frac = Math.max(0, Math.min(1, gap / range));
  const [, word, col] = heatOf(frac);
  const fill = $('#locFill', box), dEl = $('#locDist', box), wEl = $('#locWord', box);
  if (fill) { fill.style.width = Math.round((1 - frac) * 100) + '%'; fill.style.background = col; fill.style.boxShadow = '0 0 12px ' + col; }
  if (wEl) { wEl.textContent = gap <= 0 ? 'Right here – open it' : word; wEl.style.color = col; }
  if (dEl) dEl.textContent = gap <= 0 ? '' : Math.round((gap + unlockM(c)) * FT) + ' ft';
  // the sonar rings on the player dot keep pace with the ticking
  document.body.style.setProperty('--sonar', (0.42 + frac * 1.5).toFixed(2) + 's');
  document.body.style.setProperty('--sonarc', col);
}

function markNear() {
  discoverAround(pos, DISCOVER_M());                 // on foot, even while the drone is up
  if (fly) return;                                   // the drone is doing the locating
  refreshSearch();
  // The locator is offered for the nearest undiscovered chest in range - that is what needs
  // finding - and otherwise for the nearest one you already know.
  let best = Infinity, nearest = null, bestU = Infinity, nearestU = null;
  chests.forEach(c => {
    const d = dist(pos, c) - unlockM(c);
    if (d < best) { best = d; nearest = c; }
    if (!isFound(c) && d < bestU) { bestU = d; nearestU = c; }
  });
  if (nearestU && bestU <= LOC_RANGE()) { nearest = nearestU; best = bestU; }

  if (locMode === 'on') {
    const t = chests.find(c => c.id === locTarget);
    if (!t) stopLocate(true);                                  // target vanished (opened, flagged, out of view)
    else {
      const gap = Math.max(0, dist(pos, t) - unlockM(t));
      if (gap > LOC_RANGE() * 2.5) stopLocate();               // walked away from it
      else { FX.geiger(gap, LOC_RANGE()); renderLocator(t, gap); }
    }
  }
  if (locMode !== 'on') {
    FX.geiger(Infinity, 1);
    const offer = nearest && best <= LOC_RANGE() && !locDismissed(nearest.id);
    renderLocator(offer ? nearest : null, best);
    if (offer) hintLocatorOnce();
  }

  chests.forEach(c => {
    const d = dist(pos, c);
    if (d <= unlockM(c) && !nearSeen[c.id]) { nearSeen[c.id] = 1; toast('📦 ' + c.name + ' is within reach!', 'gold'); FX.sfx('ping'); FX.vibe(200); }
    if (d > unlockM(c) * 3) delete nearSeen[c.id];
  });
}
// Dismissing the offer for a chest keeps it quiet for the rest of the session.
const locOff = {};
const locDismissed = id => !!locOff[id];
// One gentle nudge, the first time a locator is ever offered, then never again.
function hintLocatorOnce() {
  try { if (localStorage.getItem('sw_lochint')) return; localStorage.setItem('sw_lochint', '1'); } catch (e) { return; }
  toast('📡 A chest is close – the locator on the map can walk you in');
}

const CELL = 0.5;   // hidden-chest index cells are ~55 km wide
const cellKey = (lat, lon) => Math.floor(lat / CELL) + '_' + Math.floor(lon / CELL);
function cellsAround(lat, lon, rM) {
  const dLat = rM / 111320, dLon = rM / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180))), out = [];
  const a0 = Math.floor((lat - dLat) / CELL), a1 = Math.floor((lat + dLat) / CELL), b0 = Math.floor((lon - dLon) / CELL), b1 = Math.floor((lon + dLon) / CELL);
  for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) if (out.length < 25) out.push(a + '_' + b);
  return out;
}
// Chest locations ship with the game as map tiles (places/<lat>_<lon>.json, one per degree),
// built from Overture Maps and the Recreation Information Database. Only the tiles around the
// player are downloaded, and each is kept for the session. No outside service is ever contacted.
const TILES = new Map();
let BLOCKED = new Set();
async function loadBlocked() {
  try { (await DB.blockedChests()).forEach(id => BLOCKED.add(id)); } catch (e) {}
}
let tileIndex = null, tileIndexErr = '';
const placeId = (lat, lon) => 'r' + Math.round(lat * 1e4).toString(36).replace('-', 'm') + '_' + Math.round(lon * 1e4).toString(36).replace('-', 'm');
const assetV = () => (window.ASSET_V ? '?v=' + window.ASSET_V : '');

async function loadTileIndex() {
  if (tileIndex) return tileIndex;
  const r = await fetch('places/index.json' + assetV());
  if (!r.ok) throw new Error('place index ' + r.status);
  tileIndex = new Set(await r.json());
  return tileIndex;
}
// Tiles covering the radius, nearest first so the cap always keeps the most useful ones.
function tilesFor(lat, lon, rM) {
  const dLat = rM / 111320, dLon = rM / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180))), out = [];
  for (let a = Math.floor(lat - dLat); a <= Math.floor(lat + dLat); a++)
    for (let b = Math.floor(lon - dLon); b <= Math.floor(lon + dLon); b++)
      out.push({ k: a + '_' + b, d: Math.abs(a + 0.5 - lat) + Math.abs(b + 0.5 - lon) });
  out.sort((x, y) => x.d - y.d);
  return out.slice(0, C.MAX_TILES).map(t => t.k);
}
async function loadTiles(lat, lon, rM) {
  await loadTileIndex();
  const want = tilesFor(lat, lon, rM).filter(k => tileIndex.has(k) && !TILES.has(k));
  await Promise.all(want.map(async k => {
    try {
      const r = await fetch('places/' + k + '.json' + assetV());
      TILES.set(k, r.ok ? (await r.json()).map(a => ({ id: placeId(a[1], a[2]), name: a[0], lat: a[1], lon: a[2], kind: a[3], src: 'place' })) : []);
    } catch (e) { TILES.set(k, []); }
  }));
}
function placesWithin(lat, lon, rM) {
  const dLat = rM / 111320, dLon = rM / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const here = { lat, lon }, out = [];
  for (const k of tilesFor(lat, lon, rM)) {
    const t = TILES.get(k); if (!t) continue;
    for (const p of t) {
      if (Math.abs(p.lat - lat) > dLat || Math.abs(p.lon - lon) > dLon) continue;
      const d = dist(here, p); if (d <= rM) out.push(Object.assign({}, p, { d }));
    }
  }
  out.sort((x, y) => x.d - y.d);
  return out.slice(0, C.MAX_PLACES);
}
// Nearest chest in any tile we already hold, however far - so an empty screen still points somewhere.
function nearestLoaded(lat, lon) {
  const here = { lat, lon }; let best = null;
  TILES.forEach(t => t.forEach(p => { const d = dist(here, p); if (!best || d < best.d) best = Object.assign({}, p, { d }); }));
  return best;
}
async function loadNearby() {
  if (!pos || loading) return; loading = true; osmErr = ''; lastLoad = { lat: pos.lat, lon: pos.lon }; lastR = radiusM();
  const found = new Map();
  if (!BLOCKED.size) await loadBlocked();
  try { await loadTiles(pos.lat, pos.lon, lastR); placesWithin(pos.lat, pos.lon, lastR).forEach(p => { if (!BLOCKED.has(p.id)) found.set(p.id, p); }); }
  catch (e) { osmErr = 'place list failed to load'; tileIndexErr = e.message || 'error'; lastLoad = null; }
  chests = [...found.values()]; discoverAround(pos, DISCOVER_M()); refreshChestViews();
  try {                                            // chests other players hid, from the shared database
    const res = await DB.getMany('cells', cellsAround(pos.lat, pos.lon, lastR));
    res.forEach(o => o && Object.keys(o).forEach(id => { if (!BLOCKED.has(id)) found.set(id, Object.assign({ id, src: 'player' }, o[id])); }));
    chests = [...found.values()];
  } catch (e) {}
  loading = false; discoverAround(pos, DISCOVER_M()); refreshChestViews();
}
function updateRadiusCircle() {
  if (!map || !window.L || !pos) return;
  // solid on purpose: dashes on a circle this big are computed along its whole length on every
  // redraw, which made panning and the drone view stutter
  if (!radCircle) radCircle = L.circle([pos.lat, pos.lon], { radius: radiusM(), weight: 1.5, opacity: .55, color: '#f2b84b', fillOpacity: 0.03, interactive: false }).addTo(map);
  else radCircle.setLatLng([pos.lat, pos.lon]).setRadius(radiusM());
}
function inRadius() {
  if (!pos) return []; const R = radiusM();
  return chests.map(c => Object.assign({}, c, { d: dist(pos, c) })).filter(c => c.d <= R).sort((a, b) => a.d - b.d);
}
function refreshChestViews() {
  if (view === 'explore') renderNearby();
  if (!map || !window.L) return;
  refreshSearch(true);
  drawChestMarkers();
}
// Found chests on the map. When several would overlap at the current zoom they collapse into a
// numbered cluster bubble that spreads apart as you zoom in, so a dense park is not a pile.
function drawChestMarkers() {
  if (!map || !window.L || !pos) return;
  markers.forEach(m => m.remove()); markers = [];
  const found = inRadius().filter(isFound).slice(0, 200);
  const openOne = c => {
    const d = dist(pos, c);
    if (d <= unlockM(c)) return openChest(c.id);
    toast(`${c.name} – ${fmtDist(d)} ${dirName(pos, c)}. Walk closer to open it.`);
    const row = $('[data-open="' + c.id + '"]');
    if (row && row.closest('.chest')) row.closest('.chest').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const one = c => {
    const ic = L.divIcon({ className: 'cm' + (dist(pos, c) <= unlockM(c) ? ' near' : '') + (locTarget === c.id ? ' target' : ''), html: '<span>' + kindInfo(c.kind)[1] + '</span>', iconSize: [30, 30] });
    markers.push(L.marker([c.lat, c.lon], { icon: ic, title: c.name }).addTo(map).on('click', () => openOne(c)));
  };
  // bucket by a ~52px pixel grid at the current zoom
  const CELL = 52, buckets = new Map();
  found.forEach(c => {
    let pt; try { pt = map.latLngToContainerPoint([c.lat, c.lon]); } catch (e) { return one(c); }
    const key = Math.floor(pt.x / CELL) + '_' + Math.floor(pt.y / CELL);
    (buckets.get(key) || buckets.set(key, []).get(key)).push(c);
  });
  buckets.forEach(group => {
    if (group.length === 1) return one(group[0]);
    const near = group.some(c => dist(pos, c) <= unlockM(c));
    const lat = group.reduce((s, c) => s + c.lat, 0) / group.length, lon = group.reduce((s, c) => s + c.lon, 0) / group.length;
    const ic = L.divIcon({ className: 'cmcluster' + (near ? ' near' : ''), html: '<span>' + group.length + '</span>', iconSize: [34, 34] });
    markers.push(L.marker([lat, lon], { icon: ic, title: group.length + ' chests' }).addTo(map).on('click', () => {
      try { map.fitBounds(group.map(c => [c.lat, c.lon]), { padding: [60, 60], maxZoom: 17 }); } catch (e) { map.setView([lat, lon], Math.min(17, map.getZoom() + 2)); }
    }));
  });
}
let lastRowIds = '', lastRender = 0, renderTimer = null;
function renderNearby(force) {
  // A GPS fix arrives about once a second. Rebuilding 60 rows each time is what made the
  // reveal animation stutter, so skip while a dialog is up and otherwise update in place.
  if (modalOpen()) return;
  const now = Date.now();
  if (!force && now - lastRender < 400) {
    // Always run the skipped render a moment later, or the list can be left stale.
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => renderNearby(true), 400 - (now - lastRender));
    return;
  }
  clearTimeout(renderTimer); renderTimer = null;
  lastRender = now;
  const el = $('#nearby');
  const hb = $('#hereBar'), here = pos ? inRadius().filter(c => c.d <= unlockM(c) && isFound(c)) : [];
  hb.hidden = !here.length;
  if (here.length) hb.innerHTML = '<b>📦 ' + esc(here[0].name) + '</b><button class="btn sm" data-open="' + esc(here[0].id) + '">Open chest</button>';
  if (!pos) { el.innerHTML = emptyState('📍', 'Turn on location to see chests around you.', 'Enable GPS', 'emptyGps'); const g = $('#emptyGps'); if (g) g.onclick = () => startGPS(); $('#radInfo').textContent = ''; return; }
  const every = inRadius(), all = every.filter(isFound), unknown = every.length - all.length, list = all.slice(0, 60);
  $('#radInfo').textContent = `${unknown} undiscovered within ${radiusMi} mi` + (loading ? ' · searching parks…' : '') + (osmErr ? ' · park data unavailable' : '');
  $('#panelTitle').textContent = all.length ? `${all.length} found nearby` : 'Chests nearby';
  const hint = $('#hiddenHint');
  if (hint) {
    hint.hidden = !unknown;
    if (unknown) hint.textContent = `🔍 ${unknown} undiscovered chest${unknown === 1 ? '' : 's'} within ${radiusMi} mi – head for a dashed circle on the map, then start the 📡 locator.`;
  }
  if (!list.length && unknown) {
    // Nothing found yet, but there is plenty out there - point at the hunt, never at a chest.
    lastRowIds = '';
    el.innerHTML = `<div class="empty">You haven't found any chests around here yet.<br>Follow a dashed circle on the map – the chest is somewhere inside.</div>`;
    return;
  }
  if (!list.length) {
    lastRowIds = '';
    // Look past the radius so an empty screen still points somewhere worth walking.
    const nearest = [nearestLoaded(pos.lat, pos.lon)].concat(
      chests.map(c => Object.assign({}, c, { d: dist(pos, c) }))).filter(Boolean).sort((a, b) => a.d - b.d)[0];
    el.innerHTML = '<div class="empty">' + (loading ? 'Searching for parks and campgrounds…' : osmErr ? `Couldn't load park data (${esc(osmErr)}). Tap <b>Refresh chests</b> to try again.` : `No chests within ${radiusMi} mi.`) +
      (nearest ? `<br><br>The nearest chest is ${fmtDist(nearest.d)} away${isFound(nearest) ? ` – <b>${esc(nearest.name)}</b>` : ''}.<br>Slide the radius up to reach it, or hide the first chest here!` : '') + '</div>'; return;
  }
  // the trade countdown is part of the key, so a row updates when you trade there and as the minutes tick down
  const rowIds = list.map(c => c.id + (P.exch[c.id] ? ':' + Math.ceil(tradeWait(c.id) / 60000) : '')).join(',');
  if (rowIds === lastRowIds && el.children.length >= list.length) {
    // Same chests, only the distances moved: touch just those nodes instead of re-parsing HTML.
    list.forEach((c, i) => {
      const row = el.children[i]; if (!row || !row.classList.contains('chest')) return;
      const near = c.d <= unlockM(c), cd = row.querySelector('.cd'), btn = row.querySelector('[data-open]');
      const txt = near ? "YOU'RE<br>HERE" : fmtDist(c.d) + '<br><small>' + dirName(pos, c) + '</small>';
      if (cd && cd.innerHTML !== txt) cd.innerHTML = txt;
      row.classList.toggle('near', near);
      if (btn) { btn.disabled = !near; const label = near ? 'OPEN' : 'Open'; if (btn.textContent !== label) btn.textContent = label; }
    });
    return;
  }
  lastRowIds = rowIds;
  el.innerHTML = list.map(c => {
    const near = c.d <= unlockM(c), wait = tradeWait(c.id);
    return `<div class="chest${near ? ' near' : ''}"><div class="ci">${kindInfo(c.kind)[1]}</div><div><b>${esc(c.name)}</b><small>${c.src === 'player' ? chestBy(c) : kindInfo(c.kind)[0]}${wait ? ' · ✓ traded · again in ' + fmtWait(wait) : ''}</small></div>
      <div class="cd">${near ? "YOU'RE<br>HERE" : fmtDist(c.d) + '<br><small>' + dirName(pos, c) + '</small>'}</div>
      <button class="btn sm" data-open="${esc(c.id)}" ${near ? '' : 'disabled'}>${near ? 'OPEN' : 'Open'}</button></div>`;
  }).join('') + (all.length > list.length ? `<div class="empty">+ ${all.length - list.length} more – lower the radius to focus on the closest.</div>` : '');
}

// ---- opening a chest ----
// ---------------- the opening ----------------
// Walking to a chest is the whole point of the game, so opening one gets the screen to
// itself: the chest sits closed, rattles, light forces its way out of the seam, the lid
// swings up on a growing beam, and the moment it is fully open the screen flashes.
// It also covers the trip to the server - if the data is slow the chest simply sits there
// glowing instead of showing a spinner. A tap skips the whole thing.
function chestCinematic(name) {
  const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  if (!FX.prefs.fx || reduce) return { done: Promise.resolve(), kill() {} };

  const ios = document.body.classList.contains('ios') || FX.isLow();
  const T = ios
    ? { lid: 380, flash: 700, end: 1250, motes: 6 }
    : { lid: 520, flash: 900, end: 1700, motes: 16 };

  const el = document.createElement('div');
  el.className = 'cine' + (ios ? ' lite' : '');
  el.style.setProperty('--lid', T.lid + 'ms');
  el.style.setProperty('--flash', T.flash + 'ms');
  let motes = '';
  for (let i = 0; i < T.motes; i++) {
    motes += `<i class="mote" style="--mx:${(i * 97) % 100}%;--md:${600 + (i * 131) % 900}ms;--mt:${1500 + (i * 173) % 1400}ms;--ms:${0.5 + ((i * 59) % 70) / 70}"></i>`;
  }
  // Drawn as SVG so the lid is hinged on the back edge of the box and the glow sits
  // behind the front wall - in plain divs the lid reads as a flap coming loose and the
  // light looks painted on the front.
  el.innerHTML =
    `<i class="rays"></i>
     <div class="stage">
       <i class="beam"></i>
       <svg class="cchest" viewBox="0 0 200 172" aria-hidden="true">
         <defs>
           <linearGradient id="cwood" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0" stop-color="#8a5a30"/><stop offset="1" stop-color="#4b2d15"/>
           </linearGradient>
           <linearGradient id="clidw" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0" stop-color="#9b6736"/><stop offset="1" stop-color="#5d381c"/>
           </linearGradient>
           <linearGradient id="cgold" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0" stop-color="#f3c661"/><stop offset="1" stop-color="#a8761f"/>
           </linearGradient>
           <radialGradient id="cglow" cx="0.5" cy="0.85" r="0.75">
             <stop offset="0" stop-color="#fffdf4"/><stop offset=".32" stop-color="#ffe7ab"/>
             <stop offset=".62" stop-color="#f2b84b"/><stop offset="1" stop-color="#f2b84b" stop-opacity="0"/>
           </radialGradient>
           <clipPath id="cmouth"><rect x="26" y="34" width="148" height="56"/></clipPath>
         </defs>
         <g class="cshadow"><ellipse cx="100" cy="158" rx="68" ry="9"/></g>
         <!-- inside of the chest, clipped to the opening so light never spills onto the front -->
         <g clip-path="url(#cmouth)">
           <rect class="cdark" x="28" y="56" width="144" height="40" rx="6"/>
           <ellipse class="cinner" cx="100" cy="92" rx="72" ry="30"/>
         </g>
         <!-- the lid: hinged on the back-top corner of the box, drawn before the front wall -->
         <g class="clid">
           <path d="M28 88 V62 a72 26 0 0 1 144 0 V88 Z" fill="url(#clidw)" stroke="#b07d24" stroke-width="4" stroke-linejoin="round"/>
           <path d="M40 72 a60 18 0 0 1 120 0" fill="none" stroke="#a9703c" stroke-width="5" opacity=".75"/>
           <rect x="90" y="74" width="20" height="16" rx="3" fill="url(#cgold)"/>
         </g>
         <!-- front wall, over the top of both -->
         <g class="cbody">
           <rect x="26" y="86" width="148" height="66" rx="8" fill="url(#cwood)" stroke="#b07d24" stroke-width="4"/>
           <rect x="26" y="104" width="148" height="9" fill="url(#cgold)"/>
           <rect x="88" y="96" width="24" height="26" rx="4" fill="url(#cgold)"/>
           <circle cx="100" cy="110" r="4" fill="#4a2d12"/>
         </g>
         <rect class="cseam" x="30" y="84" width="140" height="6" rx="3"/>
       </svg>
       ${motes}
     </div>
     <p class="cname">${esc(name || 'A chest')}</p>
     <i class="flash"></i>
     <p class="cskip">tap to skip</p>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('go'));

  FX.sfx('chest');

  const timers = [];
  let finish = null, dead = false;
  const done = new Promise(res => { finish = res; });
  function kill(skipped) {
    if (dead) return; dead = true;
    timers.forEach(clearTimeout);
    el.removeEventListener('pointerdown', onTap);
    el.classList.add('out');
    setTimeout(() => el.remove(), skipped ? 120 : 260);
    finish();
  }
  function onTap() { kill(true); }
  el.addEventListener('pointerdown', onTap);

  // the flash, and the particles that come out with it
  timers.push(setTimeout(() => {
    if (dead) return;
    FX.vibe([18, 40, 26]);
    const p = FX.centerOf(el.querySelector('.cchest'));
    FX.burst(p.x, p.y - 8, ['#ffd98a', '#fff6d8', '#ffffff', '#f2b84b'], ios ? 16 : 40);
    if (!ios) setTimeout(() => FX.confetti(['#ffd98a', '#f2b84b', '#ffffff'], 26), 120);
  }, T.flash));

  timers.push(setTimeout(() => kill(false), T.end));
  return { done, kill: () => kill(true) };
}

async function openChest(id, byDrone) {
  if (needNet('Opening a chest')) return;
  const meta = chests.find(c => c.id === id); if (!meta || !pos) return;
  if (!byDrone && dist(pos, meta) > unlockM(meta)) return toast(`Get within ${Math.round(unlockM(meta) * FT)} ft of the chest first`, 'bad');
  // Start the opening straight away: it is the reward for the walk, and it hides the
  // round trip to the server behind something worth watching.
  const cine = chestCinematic(meta.name);
  try {
    const day = utcDay();
    const r = await DB.tx('chests/' + id, cur => !cur ? makeChest(meta, day) : ((cur.day || 0) < day ? refreshChest(cur, meta, day) : undefined));
    const firstVisit = !P.stats.visited[id];
    P.stats.visited[id] = 1; save();
    if (locTarget === id) stopLocate(true);
    await cine.done;
    showChest(meta, r.value);
    if (firstVisit) earn(CO.chestNew, 'New chest');
    checkAch(); save();
    // First chest opened: let the server credit whoever invited us. The visit has to be stored
    // before we ask, or the server correctly sees no chest yet - so write it, then report, and
    // only mark it done once the server confirms.
    if (P.ref && !P.refSent) {
      (async () => {
        try {
          await DB.set('players/' + KEY, P);
          const res = await DB.reportReferral();
          if (res && (res.counted || res.reason === 'already counted')) { P.refSent = 1; save(); }
        } catch (e) { /* try again next chest */ }
      })();
    }
  } catch (e) { cine.kill(); toast('Could not open chest: ' + e.message, 'bad'); }
}
function showChest(meta, chest) {
  const wait = tradeWait(meta.id), done = wait > 0;
  const slots = Object.keys(chest.items || {}).filter(s => chest.items[s] && BY_ID[chest.items[s].id]).sort();
  if (!slots.length) return toast('That chest looks empty - tap Refresh chests and try again', 'bad');
  let selGet = null, selGive = null;
  const mine = Object.keys(P.inv).map(i => BY_ID[i]).filter(Boolean).sort((a, b) => b.r - a.r);
  modal(`<div class="chestopen still lit" id="chestfx"><i class="cbeam"></i><i class="clid"></i><i class="cbox"></i></div>
    <h3 style="text-align:center">${esc(meta.name)}</h3>
    <p class="chestby">${chestBy(Object.assign({}, meta, meta.by ? {} : { by: chest.by, at: chest.at }))}</p>
    <p class="sub">${done ? `You traded here recently – you can look, and swap again in ${fmtWait(wait)}.` : `Pick one item to take, then one of yours to leave behind. One trade per chest every ${fmtWait(TRADE_MS())}.`}</p>
    <div class="lbl">Inside the chest</div>
    <div class="grid popin" id="chestGrid">${slots.map(s => { const it = BY_ID[chest.items[s].id]; return it ? tile(it, { slot: s, by: chest.items[s].by ? 'from ' + chest.items[s].by : '' }) : ''; }).join('')}</div>
    ${done ? '' : `<div class="lbl">Your pack</div><div class="grid" id="giveGrid">${mine.length ? mine.map(it => tile(it, { count: P.inv[it.id] })).join('') : '<div class="empty" style="grid-column:1/-1">Your pack is empty – claim your Daily reward first.</div>'}</div>
    <div class="trade"><button class="btn ghost" id="cancelBtn">Close</button><button class="btn" id="swapBtn" disabled>Choose items</button></div>`}
    ${done ? '<div class="trade"><button class="btn ghost" id="cancelBtn">Close</button></div>' : ''}
    <div class="chestfoot">
      ${slots.length < C.MAX_CHEST_SLOTS && mine.length ? `<button class="btn sm ghost" id="giveBtn">\u{1F381} Leave an item (no swap)</button>` : ''}
      <button class="btn sm ghost danger" id="flagBtn">\u{1F6A9} Report</button>
    </div>`, m => {
    $('#cancelBtn', m).onclick = closeModal;
    const gb = $('#giveBtn', m); if (gb) gb.onclick = () => donateDialog(meta, chest);
    $('#flagBtn', m).onclick = () => flagDialog(meta);
    // Lid lifts, light spills out, then the items rise one after another. The whole
    // sequence lands in well under a second so it never feels like waiting.
    const ios = document.body.classList.contains('ios');
    const tiles = $$('#chestGrid .tile', m), start = ios ? 300 : 360;
    // squeeze the stagger as slots grow, so a full eight-slot chest still finishes
    // in about the same time as a four-slot one rather than crawling
    const step = Math.min(ios ? 42 : 55, 200 / Math.max(1, tiles.length - 1));
    tiles.forEach((t, i) => { t.style.animationDelay = Math.round(start + i * step) + 'ms'; });

    if (done) return;
    const swap = $('#swapBtn', m);
    const upd = () => { swap.disabled = !(selGet && selGive); swap.textContent = selGet && selGive ? `Trade ${BY_ID[selGive].n} → ${BY_ID[chest.items[selGet].id].n}` : 'Choose items'; };
    $('#chestGrid', m).onclick = e => { const t = e.target.closest('.tile'); if (!t) return; selGet = t.dataset.slot; $$('#chestGrid .tile', m).forEach(x => x.classList.toggle('sel', x === t)); upd(); };
    $('#giveGrid', m).onclick = e => { const t = e.target.closest('.tile'); if (!t) return; selGive = t.dataset.id; $$('#giveGrid .tile', m).forEach(x => x.classList.toggle('sel', x === t)); upd(); };
    swap.onclick = () => doTrade(meta, selGet, chest.items[selGet].id, selGive);
  });
}
async function doTrade(meta, slot, getId, giveId) {
  if (needNet('Trading')) return;
  if (tradeWait(meta.id)) return toast(`You can trade here again in ${fmtWait(tradeWait(meta.id))}`, 'bad');
  if (getId === giveId) return toast('Pick a different item to trade for', 'bad');
  if (!P.inv[giveId]) return toast('You no longer have that item', 'bad');
  let ok = false;
  try {
    const r = await DB.tx('chests/' + meta.id, cur => {
      ok = false; if (!cur || !cur.items || !cur.items[slot] || cur.items[slot].id !== getId) return undefined;
      cur.items[slot] = { id: giveId, by: P.name, at: Date.now() }; ok = true; return cur;
    });
    if (!ok) { toast('Someone else got there first – the chest has changed', 'bad'); return showChest(meta, r.value || makeChest(meta, utcDay())); }
  } catch (e) { return toast('Trade failed: ' + e.message, 'bad'); }
  removeItem(giveId); const isNew = !P.dex[getId]; addItem(getId);
  P.exch[meta.id] = Date.now(); P.stats.ex = (P.stats.ex || 0) + 1; if (BY_ID[giveId].r >= 3) P.stats.gaveRare = (P.stats.gaveRare || 0) + 1;
  earn(CO.trade, 'Trade');
  const it = BY_ID[getId]; save(); checkAch(); renderAll();
  FX.sfx('coin');
  modal(`<div style="text-align:center"><p class="sub">You traded and received</p>${revealBox(it)}<h3 style="margin-top:12px">${esc(it.n)}</h3>${badge(it.r)}
    <p class="sub" style="margin-top:10px">${isNew ? '✨ New for your shelf! ' : ''}${esc(BY_ID[giveId].n)} stays in the chest for the next explorer.</p><button class="btn big" id="okBtn">Great</button></div>`, m => { $('#okBtn', m).onclick = closeModal; setTimeout(() => FX.reveal(it.r, $('.tile.big', m)), 280); });
}

// Leaving an item without taking one. It goes into a free slot, so nothing is overwritten.
function donateDialog(meta, chest) {
  const mine = Object.keys(P.inv).map(i => BY_ID[i]).filter(Boolean).sort((a, b) => b.r - a.r);
  if (!mine.length) return toast('Your pack is empty', 'bad');
  const used = Object.keys(chest.items || {});
  const free = SLOT_IDS.slice(0, C.MAX_CHEST_SLOTS).find(s => used.indexOf(s) < 0);
  if (!free) return toast('This chest is full', 'bad');
  let pick = null;
  modal(`<h3>\u{1F381} Leave an item</h3>
    <p class="sub">A gift for whoever finds this chest next. You get nothing back, and it does not use up your trade for today.</p>
    <div class="grid" id="giveGrid2">${mine.map(it => tile(it, { count: P.inv[it.id] })).join('')}</div>
    <div class="trade"><button class="btn ghost" id="cancelBtn">Cancel</button><button class="btn" id="goGive" disabled>Leave it</button></div>`,
    m => {
      $('#cancelBtn', m).onclick = () => { closeModal(); openChest(meta.id); };
      const go = $('#goGive', m);
      $('#giveGrid2', m).onclick = e => {
        const t = e.target.closest('.tile'); if (!t) return;
        pick = t.dataset.id; $$('#giveGrid2 .tile', m).forEach(x => x.classList.toggle('sel', x === t));
        go.disabled = false; go.textContent = 'Leave ' + BY_ID[pick].n;
      };
      go.onclick = () => doDonate(meta, free, pick);
    });
}
async function doDonate(meta, slot, giveId) {
  if (needNet('Leaving a gift')) return;
  if (!P.inv[giveId]) return toast('You no longer have that item', 'bad');
  let ok = false;
  try {
    await DB.tx('chests/' + meta.id, cur => {
      ok = false;
      if (!cur || !cur.items) return undefined;
      if (cur.items[slot]) return undefined;                       // someone filled it first
      if (Object.keys(cur.items).length >= C.MAX_CHEST_SLOTS) return undefined;
      cur.items[slot] = { id: giveId, by: P.name, at: Date.now() };
      ok = true; return cur;
    });
    if (!ok) { toast('That chest just filled up - try again', 'bad'); return; }
  } catch (e) { return toast('Could not leave it: ' + e.message, 'bad'); }
  removeItem(giveId);
  P.stats.given = (P.stats.given || 0) + 1;
  if (BY_ID[giveId].r >= 3) P.stats.gaveRare = (P.stats.gaveRare || 0) + 1;
  earn(CO.gift, 'Gift left');
  save(); checkAch(); renderAll(); closeModal();
  toast('\u{1F381} ' + BY_ID[giveId].n + ' left for the next explorer', 'gold');
  FX.sfx('place'); FX.burst(innerWidth / 2, innerHeight / 2, ['#f2b84b', '#ffd98a', '#fff'], 22);
}

// Reporting a chest that should not be in the game.
function flagDialog(meta) {
  if (needNet('Flagging a chest')) return;
  modal(`<h3>\u{1F6A9} Report this chest</h3>
    <p class="sub">Report <b>${esc(meta.name)}</b> if it is on private property, unsafe to reach, or not a real public place.
    Once ${C.FLAGS_TO_REMOVE} different players report it, it is removed for everyone.</p>
    <div class="trade"><button class="btn ghost" id="cancelBtn">Cancel</button><button class="btn" id="goFlag">Report it</button></div>`,
    m => {
      $('#cancelBtn', m).onclick = () => { closeModal(); openChest(meta.id); };
      $('#goFlag', m).onclick = async e => {
        e.target.disabled = true; e.target.textContent = 'Reporting…';
        try {
          const r = await DB.flagChest(meta.id, meta.src === 'player' ? cellKey(meta.lat, meta.lon) : '');
          closeModal();
          if (r && r.removed) {
            BLOCKED.add(meta.id);
            chests = chests.filter(c => c.id !== meta.id);
            lastRowIds = ''; refreshChestViews();
            toast('Removed - enough players reported it', 'gold');
          } else {
            const n = (r && r.flags) || 1, need = (r && r.needed) || C.FLAGS_TO_REMOVE;
            toast(`Reported (${n} of ${need})`);
          }
        } catch (err) { toast('Could not report: ' + err.message, 'bad'); }
      };
    });
}

// ---- hiding a chest ----
function hideDialog(spot, byDrone, asAdmin) {
  if (needNet('Hiding a chest')) return;
  asAdmin = !!asAdmin && isAdmin();
  if (!pos && !spot) return toast('Turn on GPS first', 'bad');
  if (asAdmin) return adminHideDialog(spot || pos);
  const at = spot || pos;
  const today = dayKey(); if (P.hideDay !== today) { P.hideDay = today; P.hideN = 0; P.hideDroneN = 0; }
  const boss = isAdmin();                            // the admin hides without limits
  if (!boss && P.hideN >= C.HIDE_PER_DAY) return toast(`You can hide ${C.HIDE_PER_DAY} chests per day`, 'bad');
  const droneMax = C.DRONE_HIDES_PER_DAY == null ? 2 : C.DRONE_HIDES_PER_DAY;
  if (!boss && byDrone && (P.hideDroneN || 0) >= droneMax) return toast(`The drone can hide ${droneMax} chest${droneMax === 1 ? '' : 's'} a day – hide more on foot`, 'bad');
  const pool = byDrone && fly ? droneCandidates() : chests;
  const near = pool.find(c => dist(at, c) < C.MIN_CHEST_GAP_M);
  if (near && !boss) return toast(`Too close to ${isFound(near) ? '"' + near.name + '"' : 'another chest'} – move ${C.MIN_CHEST_GAP_M} m away`, 'bad');
  // Optional: require remote hides to be near a known park or public place (off by default).
  if (byDrone && C.DRONE_HIDE_NEAR_M) {
    const ok = pool.some(c => c.src !== 'player' && dist(at, c) <= C.DRONE_HIDE_NEAR_M) || placesWithin(at.lat, at.lon, C.DRONE_HIDE_NEAR_M).length;
    if (!ok) return toast('The drone can only hide chests in or beside a park, campground or other public place', 'bad');
  }
  const mine = Object.keys(P.inv).map(i => BY_ID[i]).filter(Boolean).sort((a, b) => b.r - a.r); if (!mine.length) return toast('You need an item to hide inside', 'bad');
  let give = null;
  modal(`<h3>🫳 ${byDrone ? 'Hide a chest where the drone is' : 'Hide a chest here'}</h3><p class="sub">${byDrone ? `Drone hides left today: ${droneMax - (P.hideDroneN || 0)}. ` : ''}Hide it anywhere you like. The chest is stocked with a few random items plus the one you leave inside – yours stays until another player swaps it.</p>
    <input id="hideName" placeholder="Name this spot (e.g. Pine Loop Campsite 12)" maxlength="40">
    <div class="lbl">Item to leave inside</div><div class="grid" id="hGrid">${mine.map(it => tile(it, { count: P.inv[it.id] })).join('')}</div>
    <div class="trade"><button class="btn ghost" id="cancelBtn">Cancel</button><button class="btn" id="goHide" disabled>Hide it</button></div>`, m => {
    $('#cancelBtn', m).onclick = closeModal; const go = $('#goHide', m), nm = $('#hideName', m);
    const upd = () => { go.disabled = !(give && nm.value.trim().length >= 3); };
    nm.oninput = upd; $('#hGrid', m).onclick = e => { const t = e.target.closest('.tile'); if (!t) return; give = t.dataset.id; $$('#hGrid .tile', m).forEach(x => x.classList.toggle('sel', x === t)); upd(); };
    go.onclick = async () => {
      go.disabled = true; const id = 'u_' + Date.now().toString(36) + randHex().slice(0, 4), name = nm.value.trim();
      const meta = { id, name, lat: at.lat, lon: at.lon, kind: 'player' }, day = utcDay(), ch = makeChest(meta, day);
      const slot = SLOT_IDS[C.CHEST_SLOTS]; ch.items[slot] = { id: give, by: P.name, at: Date.now() };
      try {
        await DB.set('chests/' + id, ch);
        await DB.set('cells/' + cellKey(at.lat, at.lon) + '/' + id, { name, lat: at.lat, lon: at.lon, kind: 'player' });
      } catch (e) { go.disabled = false; return toast('Could not hide chest: ' + e.message, 'bad'); }
      removeItem(give); P.stats.hidden = (P.stats.hidden || 0) + 1; P.hideN++; (P.found = P.found || {})[id] = 1; if (byDrone) P.hideDroneN = (P.hideDroneN || 0) + 1; if (BY_ID[give].r >= 3) P.stats.gaveRare = (P.stats.gaveRare || 0) + 1;
      earn(CO.hide, 'Chest hidden');
      chests.push(Object.assign({ src: 'player', by: P.name, at: Date.now() }, meta)); save(); checkAch(); closeModal(); refreshChestViews(); renderAll(); toast('📦 Chest hidden! Other players can find it now.', 'gold'); FX.sfx('place'); FX.burst(innerWidth / 2, innerHeight / 2, ['#f2b84b', '#ffd98a', '#fff'], 30);
    };
  });
}

// The admin places chests anywhere, with no daily limit and no spacing rule, and can stock
// them with any item in the game (it is not taken from the admin's pack).
function adminHideDialog(at) {
  let give = null, q = '';
  const list = () => ITEMS.filter(it => !q || it.n.toLowerCase().includes(q)).sort((a, b) => b.r - a.r || a.n.localeCompare(b.n)).slice(0, 80);
  modal(`<h3>📍 Hide a chest here</h3><p class="sub">Admin placement – no limits. ${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}</p>
    <input id="hideName" placeholder="Name this spot" maxlength="40">
    <div class="lbl">Item to put inside (any item)</div><input id="admItemQ" class="admq" placeholder="Search items">
    <div class="grid" id="hGrid"></div>
    <div class="trade"><button class="btn ghost" id="cancelBtn">Cancel</button><button class="btn" id="goHide" disabled>Hide it</button></div>`, m => {
    $('#cancelBtn', m).onclick = closeModal; const go = $('#goHide', m), nm = $('#hideName', m), g = $('#hGrid', m);
    const draw = () => { g.innerHTML = list().map(it => tile(it, {})).join(''); $$('.tile', g).forEach(x => x.classList.toggle('sel', x.dataset.id === give)); };
    const upd = () => { go.disabled = !(give && nm.value.trim().length >= 3); };
    draw(); nm.oninput = upd; $('#admItemQ', m).oninput = e => { q = e.target.value.trim().toLowerCase(); draw(); };
    g.onclick = e => { const t = e.target.closest('.tile'); if (!t) return; give = t.dataset.id; $$('.tile', g).forEach(x => x.classList.toggle('sel', x === t)); upd(); };
    go.onclick = async () => {
      go.disabled = true; const id = 'u_' + Date.now().toString(36) + randHex().slice(0, 4), name = nm.value.trim();
      const meta = { id, name, lat: at.lat, lon: at.lon, kind: 'player' }, ch = makeChest(meta, utcDay());
      ch.items[SLOT_IDS[C.CHEST_SLOTS]] = { id: give, by: P.name, at: Date.now() };
      try {
        await DB.set('chests/' + id, ch);
        await DB.set('cells/' + cellKey(at.lat, at.lon) + '/' + id, { name, lat: at.lat, lon: at.lon, kind: 'player' });
      } catch (e) { go.disabled = false; return toast('Could not hide chest: ' + e.message, 'bad'); }
      (P.found = P.found || {})[id] = 1; save();
      chests.push(Object.assign({ src: 'player', by: P.name, at: Date.now() }, meta));
      if (adminData) (adminData.hiddenChests = adminData.hiddenChests || []).unshift({ id, cell: cellKey(at.lat, at.lon), name, lat: at.lat, lon: at.lon, by: P.name, at: Date.now() });
      closeModal(); refreshChestViews(); toast('📦 Chest hidden – tap the map to place another', 'gold'); FX.sfx('place');
    };
  });
}

// ---------------- wiring ----------------
// Every API for "how tall is the visible page" lies on some mobile browser: innerHeight,
// visualViewport and the vh units each over-report under an overlaying toolbar, and they
// disagree with each other. So rather than trust any of them, measure where the tab bar
// actually landed and shrink the app until it is on screen. Self-correcting beats guessing.
const getInset = () => { try { return Math.max(0, Math.min(220, +localStorage.getItem('sw_inset') || 0)); } catch (e) { return 0; } };
function setInset(px) {
  px = Math.max(0, Math.min(220, Math.round(px)));
  try { localStorage.setItem('sw_inset', px); } catch (e) {}
  document.documentElement.style.setProperty('--inset', px + 'px');
  window.dispatchEvent(new Event('resize'));
  return px;
}
// What each height API claims, for diagnosing a browser whose toolbar overlays the page.
function layoutReport() {
  const vv = window.visualViewport, t = document.getElementById('tabs');
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:100svh';
  document.body.appendChild(probe);
  const svh = Math.round(probe.getBoundingClientRect().height);
  probe.remove();
  return { win: Math.round(innerHeight), vv: vv ? Math.round(vv.height) : 0,
           doc: document.documentElement.clientHeight, svh,
           tabsEnd: t ? Math.round(t.getBoundingClientRect().bottom) : 0,
           vh: getComputedStyle(document.documentElement).getPropertyValue('--vh').trim(),
           inset: getInset(), scr: Math.round(screen.height), dpr: +(devicePixelRatio || 1).toFixed(2),
           zoom: Math.round(zoomFactor() * 100), scale: +((window.visualViewport && visualViewport.scale) || 1).toFixed(2),
           winW: Math.round(innerWidth), scrW: Math.round((screen && screen.width) || 0) };
}

function trackViewport() {
  document.documentElement.style.setProperty('--inset', getInset() + 'px');
  const vv = window.visualViewport, root = document.documentElement;
  let applied = 0;

  const measure = () => {
    const cands = [vv && vv.height, window.innerHeight, root.clientHeight].filter(n => n > 200);
    return cands.length ? Math.round(Math.min.apply(null, cands)) - getInset() : 0;
  };
  const set = h => { if (h > 200 && h !== applied) { applied = h; root.style.setProperty('--vh', h + 'px'); } };

  // Did the tab bar end up below the fold? Then the reported height was too generous.
  const enforce = () => {
    const tabs = document.getElementById('tabs'), app = document.getElementById('app');
    if (!tabs || !app || app.hidden) return;
    const over = Math.round(tabs.getBoundingClientRect().bottom - window.innerHeight);
    if (over > 1) set((applied || measure() || window.innerHeight) - over);
    else if (over < -1 && applied) {
      // Room opened up again (toolbar hidden, or fullscreen): take it back, then re-check.
      set(measure());
      requestAnimationFrame(() => {
        const again = Math.round(document.getElementById('tabs').getBoundingClientRect().bottom - window.innerHeight);
        if (again > 1) set(applied - again);
      });
    }
  };

  const update = () => { set(measure()); requestAnimationFrame(enforce); };
  update();
  [0, 120, 400, 1000, 2000].forEach(ms => setTimeout(update, ms));
  addEventListener('resize', update);
  addEventListener('orientationchange', () => setTimeout(update, 300));
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(e =>
    document.addEventListener(e, () => [60, 300, 700].forEach(ms => setTimeout(update, ms))));
  if (vv) { vv.addEventListener('resize', update); vv.addEventListener('scroll', update); }
  setInterval(enforce, 1500);          // cheap: one getBoundingClientRect, only acts when wrong
}

// Long-press menus, text selection and accidental drags all interfere with tapping chests
// and items. Inputs and the diagnostics block stay selectable so copying still works.
const SELECTABLE = 'input,textarea,select,.diag,#inviteLink,.codebox,.codebox code';
function lockInteractions() {
  const allowed = e => !!(e.target && e.target.closest && e.target.closest(SELECTABLE));
  document.addEventListener('contextmenu', e => { if (!allowed(e)) e.preventDefault(); });
  document.addEventListener('selectstart', e => { if (!allowed(e)) e.preventDefault(); });
  document.addEventListener('dragstart', e => { if (!allowed(e)) e.preventDefault(); });
  // Pinch and double-tap zoom, for browsers that ignore the viewport meta.
  document.addEventListener('gesturestart', e => e.preventDefault());
  let lastTap = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTap < 320 && !allowed(e)) e.preventDefault();
    lastTap = now;
  }, { passive: false });
}

// Page zoom is a browser setting a page cannot change, so the most we can do is notice and say so.
function zoomFactor() {
  const w = window.innerWidth, sw = (screen && screen.width) || 0;
  if (!w || !sw || window.innerHeight < window.innerWidth) return 1;   // skip in landscape
  const z = sw / w;
  return z > 0.5 && z < 4 ? z : 1;
}
function checkZoom() {
  const z = zoomFactor();
  if (z <= 1.12) return;
  try { if (sessionStorage.getItem('sw_zoomwarn')) return; sessionStorage.setItem('sw_zoomwarn', '1'); } catch (e) {}
  toast(`Browser zoom looks like ${Math.round(z * 100)}% - set it to 100% so nothing is cut off`, 'bad');
}

function wire() {
  // iOS pays much more for CSS filters, backdrop blur and large canvases than Android does,
  // so it gets a lighter effect set (see .ios rules in style.css).
  if (isIOS()) { document.body.classList.add('ios'); FX.lowPower(true); }
  trackViewport();
  lockInteractions();
  setTimeout(checkZoom, 2500);
  // The ticking used to switch itself on near a chest, so it shipped disabled. It now
  // only runs while the player is actively using the locator, so enable it once.
  try { if (!localStorage.getItem('sw_locmig')) { localStorage.setItem('sw_locmig', '1'); FX.set('geiger', true); } } catch (e) {}
  registerSW();
  // Chrome hands us the install prompt once; we hold it until the player asks.
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); PWA.evt = e; if (!$('#v-me').hidden) renderMe(); });
  window.addEventListener('appinstalled', () => { PWA.evt = null; PWA.installed = true; toast('📦 Stashwalk installed'); if (!$('#v-me').hidden) renderMe(); });
  window.addEventListener('offline', () => goOffline());
  window.addEventListener('online', () => backOnline());
  if (navigator.onLine === false) goOffline(true);
  let mode = 'reg';
  $('#modeNote').textContent = DB.remote ? 'Shared world: you play alongside everyone else.' : 'Local mode: your progress is saved on this device.';
  const ref = getRef(); if (ref) { try { sessionStorage.setItem('sw_ref', ref); } catch (e) {} const i = $('#invited'); i.hidden = false; i.textContent = '🎉 ' + ref + ' invited you – you get a bonus item!'; }
  $('#authTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.t; $$('#authTabs button').forEach(x => x.classList.toggle('on', x === b)); $('#aGo').textContent = mode === 'reg' ? 'Start playing' : 'Log in'; $('#aErr').textContent = ''; $('#forgotRow').hidden = mode !== 'login'; };
  $('#forgotBtn').onclick = forgotDialog;
  $('#authForm').onsubmit = async e => {
    e.preventDefault(); FX.unlock(); if (FX.prefs.fs) FX.enterFs(); const name = $('#aName').value.trim(), pw = $('#aPass').value, btn = $('#aGo'); btn.disabled = true; $('#aErr').textContent = '';
    try {
      const r = await (mode === 'reg' ? register(name, pw) : login(name, pw));
      remember(r.key, r.hash); await boot(r.key, r.p); FX.sfx('welcome');
      const after = r.code ? () => showRecoveryCode(r.p.name, r.code, true) : null;
      if (r.starter && r.starter.length) showStarter(r.starter, after);
      else if (after) after();
      else if (mode === 'login') toast('Welcome back, ' + r.p.name);
    }
    catch (err) { $('#aErr').textContent = err.message || 'Something went wrong'; } btn.disabled = false;
  };
  document.addEventListener('click', e => {
    const t = e.target.closest('button, .tile, .chest'); if (!t || t.disabled || t.id === 'hSnd') return;
    if (t.closest('#tabs')) FX.sfx('tab'); else if (t.id !== 'claimBtn') FX.sfx('tap');
  }, true);
  const sync = () => {
    const sf = $('#setFs'); if (sf) sf.checked = FX.inFs();
  };
  FX.onChange(sync); sync();
  $('#hWho').onclick = showStats;
  $('#hCoins').onclick = () => { shopSub = 'shop'; show('shop'); };
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.openAdmin && isAdmin()) show('me'); });
  // The chest list is a draggable bottom sheet with three heights: peek (map gets the room),
  // half, and full. Drag the grip to resize, or tap the grip / list header to cycle. Remembered.
  (function sheet() {
    const panel = $('#v-explore .panel'), grip = $('#sheetGrip');
    if (!panel) return;
    const vh = () => { const e = $('#v-explore'); return (e && e.clientHeight) || innerHeight; };
    const heightFor = snap => snap === 'half' ? Math.round(vh() * 0.46) : snap === 'full' ? Math.round(vh() * 0.84) : 0;
    const SNAPS = ['peek', 'half', 'full'];
    let snap = 'peek'; try { snap = SNAPS.includes(localStorage.getItem('sw_snap')) ? localStorage.getItem('sw_snap') : 'peek'; } catch (e) {}
    function paint(px, live) {
      const peek = px <= heightFor('half') * 0.4;
      panel.classList.toggle('closed', peek);
      if (live) { panel.style.transition = 'none'; panel.style.height = px ? px + 'px' : ''; panel.style.maxHeight = px ? 'none' : ''; }
      else { panel.style.transition = ''; panel.style.height = px ? px + 'px' : ''; panel.style.maxHeight = px ? 'none' : ''; }
    }
    function apply(s, persist) {
      snap = s; const px = heightFor(s); paint(px, false);
      $('#pheadBtn').setAttribute('aria-expanded', String(s !== 'peek'));
      if (persist) try { localStorage.setItem('sw_snap', s); } catch (e) {}
      if (s !== 'peek') { lastRender = 0; lastRowIds = ''; if (P) renderNearby(true); }
      if (map) setTimeout(() => { try { map.invalidateSize({ animate: false }); } catch (e) {} }, 190);
    }
    const nearest = px => { const o = SNAPS.map(s => [s, Math.abs(heightFor(s) - px)]).sort((a, b) => a[1] - b[1]); return o[0][0]; };
    const cycle = () => apply(SNAPS[(SNAPS.indexOf(snap) + 1) % 3], true);
    apply(snap, false);
    let drag = null;
    const down = e => { drag = { y: (e.touches ? e.touches[0] : e).clientY, h: panel.getBoundingClientRect().height, moved: false }; try { grip.setPointerCapture(e.pointerId); } catch (x) {} };
    const move = e => { if (!drag) return; const y = (e.touches ? e.touches[0] : e).clientY, dy = drag.y - y; if (Math.abs(dy) > 5) drag.moved = true; const px = Math.max(0, Math.min(vh() * 0.86, drag.h + dy)); paint(px, true); if (e.cancelable) e.preventDefault(); };
    const up = () => { if (!drag) return; const cur = panel.getBoundingClientRect().height; if (!drag.moved) cycle(); else apply(nearest(cur), true); drag = null; };
    if (grip) {
      grip.addEventListener('pointerdown', down); grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    }
    $('#pheadBtn').onclick = cycle;
    addEventListener('resize', () => apply(snap, false));
  })();
  $('#updNow').onclick = e => { e.target.disabled = true; e.target.textContent = 'Updating…'; applyUpdate(); };
  $('#droneBtn').onclick = launchDrone;
  wireDrone();
  // walking only pays out every tenth of a mile, so write what is in hand when the app is put away
  document.addEventListener('visibilitychange', () => { if (document.hidden && P && KEY) save(); });
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) show(b.dataset.v); };
  // sub-toggles inside the merged Items and Shop tabs
  $('#itemsSeg').onclick = e => { const b = e.target.closest('button'); if (b) setSub('items', b.dataset.sub); };
  $('#shopSeg').onclick = e => { const b = e.target.closest('button'); if (b) setSub('shop', b.dataset.sub); };
  $('#gpsBtn').onclick = () => startGPS();
  $('#admBarStop').onclick = () => adminPlaceMode(false);
  $('#locateBtn').onclick = () => { if (pos && map) map.setView([pos.lat, pos.lon], 16); else startGPS(); };
  $('#legendBtn').onclick = () => { const l = $('#legend'); if (l) l.hidden = !l.hidden; };
  $('#refreshBtn').onclick = () => { lastLoad = null; try { Object.keys(localStorage).filter(k => k.startsWith('sw_osm')).forEach(k => localStorage.removeItem(k)); } catch (e) {} loadNearby(); };
  $('#hideBtn').onclick = () => hideDialog();
  const rad = $('#rad'); rad.value = radiusMi; $('#rVal').textContent = radiusMi + ' mi';
  rad.oninput = () => { radiusMi = +rad.value; $('#rVal').textContent = radiusMi + ' mi'; updateRadiusCircle(); refreshChestViews(); };
  rad.onchange = () => {
    try { localStorage.setItem('sw_radius', radiusMi); } catch (e) {}
    if (!pos) return;
    if (map && window.L) map.fitBounds(L.latLng(pos.lat, pos.lon).toBounds(radiusM() * 2), { padding: [8, 8] });
    if (radiusM() > lastR * 1.05 && !loading) { lastLoad = null; loadNearby(); }
  };
  const openFrom = e => { const b = e.target.closest('[data-open]'); if (b && !b.disabled) openChest(b.dataset.open); };
  $('#nearby').onclick = openFrom; $('#hereBar').onclick = openFrom;
  $('#packGrid').onclick = e => { const t = e.target.closest('.tile'); if (t) showItem(t.dataset.id); };
  $('#craftBox').onclick = e => {
    const mg = e.target.closest('[data-merge]'), cf = e.target.closest('[data-craft]');
    if (mg && !mg.disabled) return doMerge(mg.dataset.merge);
    if (cf && !cf.disabled) return doCraft(cf.dataset.craft);
    const t = e.target.closest('.tile'); if (t && !t.classList.contains('sil')) showItem(t.dataset.id);
  };
  $('#dexGrid').onclick = e => { const t = e.target.closest('.tile'); if (!t) return; if (P.dex[t.dataset.id]) showItem(t.dataset.id); else toast('Not collected yet – find it in a chest!'); };
  $('#dexFilters').onclick = e => { const b = e.target.closest('button'); if (b) { dexFilter = b.dataset.f; renderDex(); } };
  $('#dexSearch').oninput = renderDex;
  $('#tpNear').onclick = () => { if (!chests.length) return toast('No chests loaded yet – tap the map somewhere first'); const ref = pos || chests[0]; const c = chests.slice().sort((a, b) => dist(ref, a) - dist(ref, b))[0]; setPos(c.lat, c.lon, 1, true); };
  setInterval(() => { if (P && !$('#app').hidden && P.daily) { renderHeader(); refreshInvites(); } }, 60000);
}
document.addEventListener('DOMContentLoaded', async () => { wire(); await resume(); });

// exposed for tests
window.__sw = { adminUserCard, adminPlaceMode, adminHideDialog, drawAdminPlayers, showSpotOnMap, chestBy, get admPlacing() { return admPlacing; }, dist, rollItem, rng, hashStr, makeChest, refreshChest, TIERS, ACH, hashPw, daysBetween,
  claimDaily, hideDialog, openChest, doMerge, doCraft, needNet, makeRecoveryCode, normCode,
  isStandalone, canInstall, appCard, tile, plateVars, applyBasemap, isAdmin, adminPoll, get adminData() { return adminData; }, isFound, discover, hideDialog, searchCenter, RC, rcDecode, rcCoinsNear, rcGot, rcDraw, launchDrone, endFlight, droneOpen, droneState, get fly() { return fly; }, joy, addWalk, trackWalk, dailyStock, mergeOffers, craftOffers, earn, get P() { return P; }, get offline() { return OFFLINE; }, get chests() { return chests; } };
})();
