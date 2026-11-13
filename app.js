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
function tile(it, o = {}) {
  if (o.sil) return `<div class="tile sil" data-id="${it.id}"><span class="em">${it.e}</span></div>`;
  return `<div class="tile r${it.r}${o.sel ? ' sel' : ''}${o.big ? ' big' : ''}" data-id="${it.id}" data-slot="${o.slot || ''}" title="${esc(it.n)}">` +
    (o.by ? `<span class="by">${esc(o.by)}</span>` : '') +
    `<span class="em" style="filter:hue-rotate(${it.h}deg)">${it.e}</span>` +
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
  const it = BY_ID[id];
  if (!it || P.inv[id] < C.MERGE_COUNT || it.r >= 4) return toast('Not enough to merge', 'bad');
  if (workshopLevel() < it.r + 1) return toast(`Workshop level ${it.r + 1} needed for that`, 'bad');
  const to = BY_R[it.r + 1].find(x => x.base === it.base);
  if (!to) return toast('Nothing to merge into', 'bad');
  for (let i = 0; i < C.MERGE_COUNT; i++) removeItem(id);
  const isNew = !P.dex[to.id];
  addItem(to.id);
  P.stats.merges = (P.stats.merges || 0) + 1;
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
  const relic = BY_ID[id]; if (!relic || !relic.crafted) return;
  const st = recipeState(relic);
  if (st.locked) return toast(`Workshop level ${relic.lvl} needed`, 'bad');
  if (!st.ready) return toast('You are missing an ingredient', 'bad');
  st.parts.forEach(p => removeItem(p.pick.id));
  const isNew = !P.dex[relic.id];
  addItem(relic.id);
  P.stats.crafted = (P.stats.crafted || 0) + 1;
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
           stats: { visited: {}, ex: 0, hidden: 0, gaveRare: 0 }, daily: { n: 0, last: '', streak: 0, max: 0 }, hideDay: '', hideN: 0 };
}
function normalize(p) {
  p.inv = p.inv || {}; p.dex = p.dex || {}; p.ach = p.ach || {}; p.exch = p.exch || {};
  p.stats = Object.assign({ visited: {}, ex: 0, hidden: 0, gaveRare: 0 }, p.stats || {}); p.stats.visited = p.stats.visited || {};
  p.daily = Object.assign({ n: 0, last: '', streak: 0, max: 0 }, p.daily || {}); p.title = p.title || 'Newcomer';
  p.refPaid = p.refPaid || 0;                       // referrals already rewarded
  p.feedSeen = p.feedSeen || 0;                     // newest activity already shown
  return p;
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => DB.set('players/' + KEY, P).catch(() => toast('Could not sync – check your connection', 'bad')), 150);
}
function packCount() { return Object.values(P.inv).reduce((a, b) => a + b, 0); }
function addItem(id) { P.inv[id] = (P.inv[id] || 0) + 1; if (!P.dex[id]) P.dex[id] = Date.now(); }
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
function statView() {
  const ids = Object.keys(P.dex), byR = [0, 0, 0, 0, 0]; ids.forEach(id => { if (BY_ID[id]) byR[BY_ID[id].r]++; });
  return { logins: P.daily.n, streak: P.daily.max || 0, visited: Object.keys(P.stats.visited).length, ex: P.stats.ex || 0,
           dex: ids.length, byR, hidden: P.stats.hidden || 0, invites: inviteCount, gaveRare: P.stats.gaveRare || 0,
           given: P.stats.given || 0, merges: P.stats.merges || 0, crafted: P.stats.crafted || 0, relics: ids.filter(id => BY_ID[id] && BY_ID[id].crafted).length };
}
function checkAch() {
  const s = statView(), got = [];
  ACH.forEach(a => { if (!P.ach[a.id] && a.get(s) >= a.goal) { P.ach[a.id] = Date.now(); got.push(a); } });
  got.forEach((a, i) => setTimeout(() => { toast(`🏅 ${a.n} – new title: ${a.t}`, 'gold'); FX.sfx('ach'); FX.confetti(['#ffb02e', '#ffd98a', '#ffffff'], 45); FX.vibe([30, 40, 30]); }, 600 * i + 400));
  if (got.length) save();
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
  const r = await DB.tx('users/' + key, cur => cur ? undefined : { name, salt, hash, created: Date.now() });
  if (!r.changed) throw new Error('That name is already taken');
  DB.setAuth(key, hash);
  let ref = getRef(); if (ref && ref.toLowerCase() === key) ref = '';
  // The tally is not touched here: the server credits the referrer only once this player has
  // actually opened a chest (see DB.reportReferral), so invites cannot be farmed by signing up.
  if (ref) { const u = await DB.get('users/' + ref.toLowerCase()); if (!u) ref = ''; }
  const p = newPlayer(name, ref ? ref.toLowerCase() : '');
  const starter = grantStarter(p, ref ? 1 : 0);
  await DB.set('players/' + key, p);
  return { key, hash, p, starter };
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
  try {
    const s = JSON.parse(localStorage.getItem('stashwalk_session') || 'null'); if (!s) return false;
    const u = await DB.get('users/' + s.key); if (!u || !(await DB.verify(s.key, s.hash))) return false;
    DB.setAuth(s.key, s.hash);
    const p = normalize((await DB.get('players/' + s.key)) || newPlayer(u.name));
    await boot(s.key, p); armFs(); return true;
  } catch (e) { return false; }
}
async function boot(key, p) {
  KEY = key; P = p;
  try { inviteCount = (await DB.get('invites/' + key)) || 0; } catch (e) { inviteCount = 0; }
  setTimeout(() => refreshInvites(), 1200);
  setTimeout(() => checkFeed(), 2200);
  $('#auth').hidden = true; $('#app').hidden = false;
  $('#dev').hidden = !DEV;
  initMap(); renderHeader(); renderAll(); checkAch(); show('explore');
  startGPS(true);
  if (P.daily.last !== dayKey()) { show('daily'); setTimeout(() => toast('🎁 Your daily reward is ready!', 'gold'), 300); }
}

// ---------------- navigation / rendering ----------------
let view = 'explore';
function show(v) {
  view = v;
  $$('.view').forEach(s => s.hidden = s.id !== 'v-' + v);
  if (v === 'explore') { lastRender = 0; lastRowIds = ''; }
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  renderAll(); window.scrollTo(0, 0);
  if (v === 'explore' && map) setTimeout(() => map.invalidateSize(), 50);
  if (v === 'me') refreshInvites();
}
function renderHeader() {
  $('#hAv').textContent = P.name[0].toUpperCase(); $('#hName').textContent = P.name; $('#hTitle').textContent = P.title;
  $('#hStreak').textContent = '🔥 ' + (streakNow()); $('#hPack').textContent = '🎒 ' + packCount();
  $('#dailyDot').hidden = P.daily.last === dayKey();
}
function streakNow() { return P.daily.last && daysBetween(P.daily.last, dayKey()) <= 1 ? P.daily.streak : 0; }
function renderAll() {
  if (!P) return; renderHeader();
  if (view === 'explore') renderNearby();
  else if (view === 'pack') renderPack();
  else if (view === 'dex') renderDex();
  else if (view === 'daily') renderDaily();
  else if (view === 'craft') renderCraft();
  else if (view === 'me') renderMe();
}

// First thing a new player sees: the items they can start trading with.
function showStarter(ids) {
  const items = ids.map(id => BY_ID[id]).filter(Boolean);
  if (!items.length) return;
  const best = items.reduce((a, b) => (b.r > a.r ? b : a));
  modal(`<div style="text-align:center"><h3>Welcome to Stashwalk</h3>
    <p class="sub">Here's your starting pack. Walk to a chest and swap any of these for what's inside.</p>
    <div class="grid" style="justify-content:center">${items.map(it => tile(it)).join('')}</div>
    <p class="fine" style="margin-top:12px">Everything you ever collect stays on your Shelf, even after you trade it away.</p>
    <button class="btn big" id="okBtn" style="margin-top:12px">Let's go</button></div>`,
    m => { $('#okBtn', m).onclick = closeModal; setTimeout(() => { FX.sfx('reveal', best.r); FX.confetti(['#ffd98a', '#f2b84b', '#ffffff'], 40); }, 250); });
}

// ---- pack ----
function renderPack() {
  const ids = Object.keys(P.inv).map(id => BY_ID[id]).filter(Boolean).sort((a, b) => b.r - a.r || a.n.localeCompare(b.n));
  $('#packNote').textContent = ids.length ? 'Tap an item for details. Trade at chests – everything you have ever owned stays on your Shelf.' : '';
  $('#packGrid').innerHTML = ids.length ? ids.map(it => tile(it, { count: P.inv[it.id] })).join('')
    : '<div class="empty" style="grid-column:1/-1">Your pack is empty. Claim today\'s login reward on the Daily tab to get your first item.</div>';
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
      if (nr) lines.push(`nearest: ${nr.name} - ${fmtDist(nr.d)}`);
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
let dexFilter = 'all';
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
    '<div class="empty" style="grid-column:1/-1">Nothing here yet.</div>';
}

// ---- daily ----
const TIERS = [0,0,1,0,1,0,2, 0,1,1,0,1,0,3, 1,0,2,1,0,1,3, 1,1,2,1,2,1,4];
const TIER_ICON = ['🎁', '🎁', '💙', '💜', '🌟'];
function renderDaily() {
  const n = P.daily.n, claimed = P.daily.last === dayKey(), cycleDay = (n % 28) + 1, cycle = Math.floor(n / 28) + 1;
  let h = `<div class="claim"><div style="font-size:13px;color:var(--mut)">Cycle ${cycle} · Streak 🔥 ${streakNow()}</div>`;
  if (claimed) h += `<h3 style="margin:6px 0">Come back tomorrow!</h3><p class="fine" style="margin:0">Next up: Day ${cycleDay} – ${RAR[TIERS[cycleDay - 1]].n} reward.</p>`;
  else h += `<h3 style="margin:6px 0">Day ${cycleDay} reward is ready</h3><p class="fine">${RAR[TIERS[cycleDay - 1]].n} item inside</p><button class="btn big" id="claimBtn">Claim reward</button>`;
  h += '</div><div class="cal">';
  for (let d = 1; d <= 28; d++) {
    const t = TIERS[d - 1], done = d < cycleDay || (d === cycleDay && claimed && false), now = d === cycleDay && !claimed;
    h += `<div class="day t${t}${d < cycleDay ? ' done' : ''}${now ? ' now' : ''}"><b>Day ${d}</b><span>${TIER_ICON[t]}</span><small style="color:${RAR[t].c}">${t >= 2 ? RAR[t].n : ''}</small></div>`;
  }
  h += `</div><p class="fine pad">Missing a day never resets your progress – just claim the next reward when you're back. Days 7, 14, 21 and 28 are the big ones.</p>`;
  $('#dailyBox').innerHTML = h;
  const b = $('#claimBtn'); if (b) b.onclick = claimDaily;
}
function claimDaily() {
  const today = dayKey(); if (P.daily.last === today) return;
  const day = (P.daily.n % 28) + 1, it = rollItem(Math.random, 1, TIERS[day - 1]);
  P.daily.streak = P.daily.last && daysBetween(P.daily.last, today) === 1 ? P.daily.streak + 1 : 1;
  P.daily.max = Math.max(P.daily.max || 0, P.daily.streak); P.daily.n++; P.daily.last = today;
  const isNew = !P.dex[it.id]; addItem(it.id); save(); checkAch(); renderAll();
  FX.sfx('daily');
  modal(`<div style="text-align:center"><p class="sub">Day ${day} reward</p>${revealBox(it)}<h3 style="margin-top:12px">${esc(it.n)}</h3>${badge(it.r)}
    <p class="sub" style="margin-top:10px">${isNew ? '✨ New for your shelf!' : 'Added to your pack.'}</p>
    <button class="btn big" id="okBtn">Nice!</button></div>`, m => { $('#okBtn', m).onclick = closeModal; FX.reveal(it.r, $('.tile.big', m), true); });
}

// ---- me ----
function renderMe() {
  const s = statView(), unlocked = ACH.filter(a => P.ach[a.id]);
  const titles = ['Newcomer'].concat(unlocked.map(a => a.t));
  const link = location.origin + location.pathname.replace(/index\.html$/, '') + '?ref=' + encodeURIComponent(P.name);
  let h = `<div class="card"><b>${esc(P.name)}</b><br><small class="fine">Equipped title</small>
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
    h += `<div class="ach${got ? '' : ' lock'}"><div class="ai">${got ? a.icon : '🔒'}</div><div><b>${esc(a.n)}</b> <small style="display:inline;color:var(--acc2)">${got ? '· title: ' + esc(a.t) : ''}</small>
      <small>${esc(a.d)}${got ? '' : ` (${v}/${a.goal})`}</small>${got ? '' : `<div class="bar"><i style="width:${v / a.goal * 100}%"></i></div>`}</div></div>`;
  });
  h += `</div><div class="card"><b>This build</b>
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
    <label class="tg"><input type="checkbox" id="setGei" ${FX.prefs.geiger ? 'checked' : ''}><span>📡 Proximity ticking near chests</span></label>
    ${FX.fsSupported ? `<label class="tg"><input type="checkbox" id="setFs" ${FX.inFs() ? 'checked' : ''}><span>⛶ Fullscreen (also on login)</span></label>` : ''}</div>
    <div class="card"><b>Your data</b><p class="fine">${DB.remote ? 'Shared world: chests and trades are visible to every player.' : 'Local mode: saved in this browser only. Export a backup file to move devices.'}</p>
    <div class="row2" style="padding:0"><button class="btn sm ghost" id="expBtn">Export save file</button><button class="btn sm ghost" id="impBtn">Import save file</button>
    <button class="btn sm ghost" id="outBtn">Log out</button></div><input type="file" id="impFile" accept="application/json" hidden></div>`;
  $('#meBox').innerHTML = h;
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
  const sf = $('#setFs'); if (sf) sf.onchange = e => { if (e.target.checked) { FX.set('fs', true); FX.enterFs(); } else { FX.set('fs', false); FX.exitFs(); } };
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
    Object.keys(localStorage).filter(k => k.startsWith('sw_osm')).forEach(k => localStorage.removeItem(k));
  } catch (e) {}
  const u = new URL(location.href);
  u.searchParams.set('r', Date.now().toString(36));
  location.replace(u.toString());
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
function initMap() {
  if (map || !window.L) { if (!window.L) $('#map').innerHTML = '<div class="nomap">Map unavailable offline – the chest list below still works.</div>'; return; }
  map = L.map('map', { zoomControl: false }).setView([39.5, -98.35], 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  if (DEV) map.on('click', e => setPos(e.latlng.lat, e.latlng.lng, 2, true));
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
function gpsMsg(t, cls) {
  if (cls === 'bad') FX.geiger(Infinity, 1); const g = $('#gps'); g.className = 'gpspill ' + (cls || ''); $('#gpsText').textContent = t; $('#gpsBtn').hidden = cls === 'ok'; }
function setPos(lat, lon, acc, manual) {
  const first = !pos; pos = { lat, lon, acc: acc || 0 };
  gpsMsg(`${manual ? 'DEV position' : 'GPS'} ±${Math.round(pos.acc * FT)} ft`, 'ok');
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
  if (view === 'explore') renderNearby(); markNear();
}
function markNear() {
  // Distance to the closest chest drives the ticking, so it speeds up as you walk in.
  let best = Infinity;
  chests.forEach(c => { const d = dist(pos, c) - unlockM(c); if (d < best) best = d; });
  FX.geiger(Math.max(0, best), C.GEIGER_FT * 0.3048);
  chests.forEach(c => {
    const d = dist(pos, c);
    if (d <= unlockM(c) && !nearSeen[c.id]) { nearSeen[c.id] = 1; toast('📦 ' + c.name + ' is within reach!', 'gold'); FX.sfx('ping'); FX.vibe(200); }
    if (d > unlockM(c) * 3) delete nearSeen[c.id];
  });
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
  chests = [...found.values()]; refreshChestViews();
  try {                                            // chests other players hid, from the shared database
    const res = await DB.getMany('cells', cellsAround(pos.lat, pos.lon, lastR));
    res.forEach(o => o && Object.keys(o).forEach(id => { if (!BLOCKED.has(id)) found.set(id, Object.assign({ id, src: 'player' }, o[id])); }));
    chests = [...found.values()];
  } catch (e) {}
  loading = false; refreshChestViews();
}
function updateRadiusCircle() {
  if (!map || !window.L || !pos) return;
  if (!radCircle) radCircle = L.circle([pos.lat, pos.lon], { radius: radiusM(), weight: 1.5, dashArray: '6 6', color: '#f2b84b', fillOpacity: 0.03, interactive: false }).addTo(map);
  else radCircle.setLatLng([pos.lat, pos.lon]).setRadius(radiusM());
}
function inRadius() {
  if (!pos) return []; const R = radiusM();
  return chests.map(c => Object.assign({}, c, { d: dist(pos, c) })).filter(c => c.d <= R).sort((a, b) => a.d - b.d);
}
function refreshChestViews() {
  if (view === 'explore') renderNearby();
  if (!map || !window.L) return; markers.forEach(m => m.remove()); markers = [];
  inRadius().slice(0, 200).forEach(c => {
    const ic = L.divIcon({ className: 'cm' + (dist(pos, c) <= unlockM(c) ? ' near' : ''), html: '<span>' + kindInfo(c.kind)[1] + '</span>', iconSize: [30, 30] });
    markers.push(L.marker([c.lat, c.lon], { icon: ic, title: c.name }).addTo(map).on('click', () => {
      const d = dist(pos, c);
      if (d <= unlockM(c)) return openChest(c.id);                       // close enough - just open it
      toast(`${c.name} – ${fmtDist(d)} ${dirName(pos, c)}. Walk closer to open it.`);
      const row = $('[data-open="' + c.id + '"]');
      if (row && row.closest('.chest')) row.closest('.chest').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
  const hb = $('#hereBar'), here = pos ? inRadius().filter(c => c.d <= unlockM(c)) : [];
  hb.hidden = !here.length;
  if (here.length) hb.innerHTML = '<b>📦 ' + esc(here[0].name) + '</b><button class="btn sm" data-open="' + esc(here[0].id) + '">Open chest</button>';
  if (!pos) { el.innerHTML = '<div class="empty">Turn on GPS to see chests around you.</div>'; $('#radInfo').textContent = ''; return; }
  const all = inRadius(), list = all.slice(0, 60), today = dayKey();
  $('#radInfo').textContent = `${all.length} chest${all.length === 1 ? '' : 's'} within ${radiusMi} mi` + (loading ? ' · searching parks…' : '') + (osmErr ? ' · park data unavailable' : '');
  $('#panelTitle').textContent = all.length ? `${all.length} chest${all.length === 1 ? '' : 's'} nearby` : 'Chests nearby';
  if (!list.length) {
    lastRowIds = '';
    // Look past the radius so an empty screen still points somewhere worth walking.
    const nearest = [nearestLoaded(pos.lat, pos.lon)].concat(
      chests.map(c => Object.assign({}, c, { d: dist(pos, c) }))).filter(Boolean).sort((a, b) => a.d - b.d)[0];
    el.innerHTML = '<div class="empty">' + (loading ? 'Searching for parks and campgrounds…' : osmErr ? `Couldn't load park data (${esc(osmErr)}). Tap <b>Refresh chests</b> to try again.` : `No chests within ${radiusMi} mi.`) +
      (nearest ? `<br><br>Nearest chest: <b>${esc(nearest.name)}</b> – ${fmtDist(nearest.d)} away.<br>Slide the radius up to see it, or hide the first chest here!` : '') + '</div>'; return;
  }
  const rowIds = list.map(c => c.id).join(',');
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
    const near = c.d <= unlockM(c), done = P.exch[c.id] === today;
    return `<div class="chest${near ? ' near' : ''}"><div class="ci">${kindInfo(c.kind)[1]}</div><div><b>${esc(c.name)}</b><small>${kindInfo(c.kind)[0]}${done ? ' · ✓ traded today' : ''}</small></div>
      <div class="cd">${near ? "YOU'RE<br>HERE" : fmtDist(c.d) + '<br><small>' + dirName(pos, c) + '</small>'}</div>
      <button class="btn sm" data-open="${esc(c.id)}" ${near ? '' : 'disabled'}>${near ? 'OPEN' : 'Open'}</button></div>`;
  }).join('') + (all.length > list.length ? `<div class="empty">+ ${all.length - list.length} more – lower the radius to focus on the closest.</div>` : '');
}

// ---- opening a chest ----
async function openChest(id) {
  const meta = chests.find(c => c.id === id); if (!meta || !pos) return;
  if (dist(pos, meta) > unlockM(meta)) return toast(`Get within ${Math.round(unlockM(meta) * FT)} ft of the chest first`, 'bad');
  toast('Opening…');
  try {
    const day = utcDay();
    const r = await DB.tx('chests/' + id, cur => !cur ? makeChest(meta, day) : ((cur.day || 0) < day ? refreshChest(cur, meta, day) : undefined));
    P.stats.visited[id] = 1; save(); checkAch(); FX.sfx('open'); FX.vibe(60); showChest(meta, r.value);
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
  } catch (e) { toast('Could not open chest: ' + e.message, 'bad'); }
}
function showChest(meta, chest) {
  const today = dayKey(), done = P.exch[meta.id] === today;
  const slots = Object.keys(chest.items || {}).filter(s => chest.items[s] && BY_ID[chest.items[s].id]).sort();
  if (!slots.length) return toast('That chest looks empty - tap Refresh chests and try again', 'bad');
  let selGet = null, selGive = null;
  const mine = Object.keys(P.inv).map(i => BY_ID[i]).filter(Boolean).sort((a, b) => b.r - a.r);
  modal(`<div class="chestfx" id="chestfx">📦</div><h3 style="text-align:center">${esc(meta.name)}</h3>
    <p class="sub">${done ? 'You already traded here today – you can look, but come back tomorrow to swap.' : 'Pick one item to take, then one of yours to leave behind. One trade per chest per day.'}</p>
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
    $$('#chestGrid .tile', m).forEach((t, i) => { t.style.animationDelay = (550 + i * 110) + 'ms'; });
    setTimeout(() => { const f = $('#chestfx', m); if (f) { f.textContent = '🎁'; const p = FX.centerOf(f); FX.burst(p.x, p.y, ['#ffd98a', '#f2b84b', '#ffffff'], 26); } }, 560);
    if (done) return;
    const swap = $('#swapBtn', m);
    const upd = () => { swap.disabled = !(selGet && selGive); swap.textContent = selGet && selGive ? `Trade ${BY_ID[selGive].n} → ${BY_ID[chest.items[selGet].id].n}` : 'Choose items'; };
    $('#chestGrid', m).onclick = e => { const t = e.target.closest('.tile'); if (!t) return; selGet = t.dataset.slot; $$('#chestGrid .tile', m).forEach(x => x.classList.toggle('sel', x === t)); upd(); };
    $('#giveGrid', m).onclick = e => { const t = e.target.closest('.tile'); if (!t) return; selGive = t.dataset.id; $$('#giveGrid .tile', m).forEach(x => x.classList.toggle('sel', x === t)); upd(); };
    swap.onclick = () => doTrade(meta, selGet, chest.items[selGet].id, selGive);
  });
}
async function doTrade(meta, slot, getId, giveId) {
  if (P.exch[meta.id] === dayKey()) return toast('One trade per chest per day', 'bad');
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
  P.exch[meta.id] = dayKey(); P.stats.ex = (P.stats.ex || 0) + 1; if (BY_ID[giveId].r >= 3) P.stats.gaveRare = (P.stats.gaveRare || 0) + 1;
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
  save(); checkAch(); renderAll(); closeModal();
  toast('\u{1F381} ' + BY_ID[giveId].n + ' left for the next explorer', 'gold');
  FX.sfx('place'); FX.burst(innerWidth / 2, innerHeight / 2, ['#f2b84b', '#ffd98a', '#fff'], 22);
}

// Reporting a chest that should not be in the game.
function flagDialog(meta) {
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
function hideDialog() {
  if (!pos) return toast('Turn on GPS first', 'bad');
  const today = dayKey(); if (P.hideDay !== today) { P.hideDay = today; P.hideN = 0; }
  if (P.hideN >= C.HIDE_PER_DAY) return toast(`You can hide ${C.HIDE_PER_DAY} chests per day`, 'bad');
  const near = chests.find(c => dist(pos, c) < C.MIN_CHEST_GAP_M); if (near) return toast(`Too close to "${near.name}" – walk ${C.MIN_CHEST_GAP_M} m away`, 'bad');
  const mine = Object.keys(P.inv).map(i => BY_ID[i]).filter(Boolean).sort((a, b) => b.r - a.r); if (!mine.length) return toast('You need an item to hide inside', 'bad');
  let give = null;
  modal(`<h3>🫳 Hide a chest here</h3><p class="sub">Public places only (parks, campgrounds, trails). The chest is stocked with a few random items plus the one you leave inside – yours stays until another player swaps it.</p>
    <input id="hName" placeholder="Name this spot (e.g. Pine Loop Campsite 12)" maxlength="40">
    <div class="lbl">Item to leave inside</div><div class="grid" id="hGrid">${mine.map(it => tile(it, { count: P.inv[it.id] })).join('')}</div>
    <div class="trade"><button class="btn ghost" id="cancelBtn">Cancel</button><button class="btn" id="goHide" disabled>Hide it</button></div>`, m => {
    $('#cancelBtn', m).onclick = closeModal; const go = $('#goHide', m), nm = $('#hName', m);
    const upd = () => { go.disabled = !(give && nm.value.trim().length >= 3); };
    nm.oninput = upd; $('#hGrid', m).onclick = e => { const t = e.target.closest('.tile'); if (!t) return; give = t.dataset.id; $$('#hGrid .tile', m).forEach(x => x.classList.toggle('sel', x === t)); upd(); };
    go.onclick = async () => {
      go.disabled = true; const id = 'u_' + Date.now().toString(36) + randHex().slice(0, 4), name = nm.value.trim();
      const meta = { id, name, lat: pos.lat, lon: pos.lon, kind: 'player' }, day = utcDay(), ch = makeChest(meta, day);
      const slot = SLOT_IDS[C.CHEST_SLOTS]; ch.items[slot] = { id: give, by: P.name, at: Date.now() };
      try {
        await DB.set('chests/' + id, ch);
        await DB.set('cells/' + cellKey(pos.lat, pos.lon) + '/' + id, { name, lat: pos.lat, lon: pos.lon, kind: 'player' });
      } catch (e) { go.disabled = false; return toast('Could not hide chest: ' + e.message, 'bad'); }
      removeItem(give); P.stats.hidden = (P.stats.hidden || 0) + 1; P.hideN++; if (BY_ID[give].r >= 3) P.stats.gaveRare = (P.stats.gaveRare || 0) + 1;
      chests.push(Object.assign({ src: 'player' }, meta)); save(); checkAch(); closeModal(); refreshChestViews(); renderAll(); toast('📦 Chest hidden! Other players can find it now.', 'gold'); FX.sfx('place'); FX.burst(innerWidth / 2, innerHeight / 2, ['#f2b84b', '#ffd98a', '#fff'], 30);
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
const SELECTABLE = 'input,textarea,select,.diag,#inviteLink';
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
  trackViewport();
  lockInteractions();
  setTimeout(checkZoom, 2500);
  let mode = 'reg';
  $('#modeNote').textContent = DB.remote ? 'Shared world: you play alongside everyone else.' : 'Local mode: your progress is saved on this device.';
  const ref = getRef(); if (ref) { try { sessionStorage.setItem('sw_ref', ref); } catch (e) {} const i = $('#invited'); i.hidden = false; i.textContent = '🎉 ' + ref + ' invited you – you get a bonus item!'; }
  $('#authTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.t; $$('#authTabs button').forEach(x => x.classList.toggle('on', x === b)); $('#aGo').textContent = mode === 'reg' ? 'Start playing' : 'Log in'; $('#aErr').textContent = ''; };
  $('#authForm').onsubmit = async e => {
    e.preventDefault(); FX.unlock(); if (FX.prefs.fs) FX.enterFs(); const name = $('#aName').value.trim(), pw = $('#aPass').value, btn = $('#aGo'); btn.disabled = true; $('#aErr').textContent = '';
    try {
      const r = await (mode === 'reg' ? register(name, pw) : login(name, pw));
      remember(r.key, r.hash); await boot(r.key, r.p); FX.sfx('welcome');
      if (r.starter && r.starter.length) showStarter(r.starter);
      else if (mode === 'login') toast('Welcome back, ' + r.p.name);
    }
    catch (err) { $('#aErr').textContent = err.message || 'Something went wrong'; } btn.disabled = false;
  };
  document.addEventListener('click', e => {
    const t = e.target.closest('button, .tile, .chest'); if (!t || t.disabled || t.id === 'hSnd') return;
    if (t.closest('#tabs')) FX.sfx('tab'); else if (t.id !== 'claimBtn') FX.sfx('tap');
  }, true);
  const sync = () => {
    $('#hSnd').textContent = FX.prefs.snd ? '🔊' : '🔇'; $('#hFs').textContent = FX.inFs() ? '🗗' : '⛶'; $('#hFs').hidden = !FX.fsSupported;
    const sf = $('#setFs'); if (sf) sf.checked = FX.inFs();
  };
  FX.onChange(sync); sync();
  $('#hSnd').onclick = () => { FX.set('snd', !FX.prefs.snd); FX.sfx('coin'); };
  $('#hFs').onclick = () => FX.toggleFs();
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) show(b.dataset.v); };
  $('#gpsBtn').onclick = () => startGPS();
  $('#locateBtn').onclick = () => { if (pos && map) map.setView([pos.lat, pos.lon], 16); else startGPS(); };
  $('#refreshBtn').onclick = () => { lastLoad = null; try { Object.keys(localStorage).filter(k => k.startsWith('sw_osm')).forEach(k => localStorage.removeItem(k)); } catch (e) {} loadNearby(); };
  $('#hideBtn').onclick = hideDialog;
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
window.__sw = { dist, rollItem, rng, hashStr, makeChest, refreshChest, TIERS, ACH, hashPw, daysBetween };
})();
