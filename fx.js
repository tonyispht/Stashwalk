// Sound effects (synthesized with WebAudio - no audio files), particle/flash effects, and fullscreen helpers.
window.FX = (function () {
  const RAR = window.RARITIES || [];
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const get = (k, d) => { try { const v = localStorage.getItem('sw_' + k); return v === null ? d : v === '1'; } catch (e) { return d; } };
  const prefs = { snd: get('snd', true), fx: get('fx', !reduce), fs: get('fs', true) };
  function set(k, v) { prefs[k] = !!v; try { localStorage.setItem('sw_' + k, v ? '1' : '0'); } catch (e) {} listeners.forEach(f => f()); }
  const listeners = [];

  // ---------------- audio ----------------
  let ac = null, master = null;
  function unlock() {
    if (!ac) {
      const A = window.AudioContext || window.webkitAudioContext; if (!A) return null;
      ac = new A(); master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, t, dur, type, vol, to) {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, vol, f0, f1) {
    const n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = ac.createBufferSource(); s.buffer = buf;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  }
  const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, D6: 1174.7, E6: 1318.5, G6: 1568, C7: 2093, B5: 987.77 };
  const PENT = [N.C5, N.D5, N.E5, N.G5, N.A5, N.C6, N.D6, N.E6, N.G6];
  const SFX = {
    tap(t) { tone(560, t, 0.05, 'triangle', 0.07); },
    tab(t) { tone(420, t, 0.05, 'triangle', 0.07); tone(630, t + 0.045, 0.06, 'triangle', 0.06); },
    error(t) { tone(190, t, 0.22, 'sawtooth', 0.09, 110); },
    ping(t) { tone(880, t, 0.14, 'sine', 0.12); tone(1320, t + 0.12, 0.22, 'sine', 0.1); },
    place(t) { tone(130, t, 0.18, 'sine', 0.22, 70); noise(t, 0.2, 0.05, 900, 300); },
    open(t) {                               // wooden creak + sparkle
      noise(t, 0.55, 0.12, 180, 620); tone(95, t, 0.5, 'sawtooth', 0.05, 150);
      [1175, 1568, 1976, 2349].forEach((f, i) => tone(f, t + 0.45 + i * 0.07, 0.25, 'sine', 0.06));
    },
    coin(t) { tone(988, t, 0.09, 'square', 0.06); tone(1319, t + 0.08, 0.3, 'square', 0.06); tone(1976, t + 0.08, 0.25, 'sine', 0.05); },
    welcome(t) { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, t + i * 0.09, 0.3, 'triangle', 0.1)); },
    daily(t) { [N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => tone(f, t + i * 0.1, 0.35, 'triangle', 0.11)); tone(N.C6, t + 0.55, 0.9, 'sine', 0.07); },
    ach(t) { [N.E5, N.G5, N.B5, N.E6].forEach((f, i) => tone(f, t + i * 0.08, 0.4, 'sine', 0.1)); tone(N.E6 * 1.5, t + 0.35, 0.5, 'sine', 0.05); },
    reveal(t, r) {                          // gets richer with rarity
      const n = 3 + r * 1.5 | 0;
      for (let i = 0; i < n; i++) tone(PENT[Math.min(i * (r >= 3 ? 1 : 1) + r, PENT.length - 1)], t + i * 0.075, 0.28 + r * 0.06, r > 2 ? 'triangle' : 'sine', 0.1);
      if (r >= 2) tone(N.C6, t + n * 0.075, 0.7, 'sine', 0.08);
      if (r >= 3) { noise(t, 0.7, 0.07, 500, 5000); [N.C5, N.E5, N.G5].forEach(f => tone(f, t + n * 0.075, 1.2, 'sine', 0.06)); }
      if (r >= 4) { noise(t + 0.2, 1.2, 0.08, 800, 7000); [N.C6, N.E6, N.G6, N.C7].forEach((f, i) => tone(f, t + 0.5 + i * 0.1, 1.1, 'triangle', 0.07)); }
    }
  };
  function sfx(name, arg) {
    if (!prefs.snd) return; try { if (!unlock() || !SFX[name]) return; SFX[name](ac.currentTime + 0.01, arg); } catch (e) {}
  }
  const vibe = p => { if (prefs.fx) try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

  // ---------------- visual effects ----------------
  let cv, g2, parts = [], raf = 0, W = 0, H = 0, dpr = 1;
  function ensureCanvas() {
    if (cv) return true; cv = document.getElementById('fx'); if (!cv) return false; g2 = cv.getContext('2d');
    const rs = () => { dpr = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; g2.setTransform(dpr, 0, 0, dpr, 0, 0); };
    rs(); addEventListener('resize', rs); return true;
  }
  function loop() {
    g2.clearRect(0, 0, W, H);
    parts = parts.filter(p => p.life > 0);
    parts.forEach(p => {
      p.life--; p.vy += p.g; p.vx *= p.drag; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      const a = Math.max(0, Math.min(1, p.life / 25)); g2.globalAlpha = a; g2.fillStyle = p.c;
      g2.save(); g2.translate(p.x, p.y); g2.rotate(p.rot);
      if (p.shape === 'star') { g2.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? p.s * 0.4 : p.s; g2.lineTo(Math.cos(i * Math.PI / 4) * r, Math.sin(i * Math.PI / 4) * r); } g2.closePath(); g2.fill(); }
      else if (p.shape === 'conf') g2.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      else { g2.beginPath(); g2.arc(0, 0, p.s / 2, 0, 7); g2.fill(); }
      g2.restore();
    });
    g2.globalAlpha = 1;
    if (parts.length) raf = requestAnimationFrame(loop); else { raf = 0; g2.clearRect(0, 0, W, H); }
  }
  function add(p) { parts.push(p); if (parts.length > 700) parts.splice(0, parts.length - 700); if (!raf) raf = requestAnimationFrame(loop); }
  function burst(x, y, colors, n) {
    if (!prefs.fx || !ensureCanvas()) return; colors = [].concat(colors);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, sp = 2 + Math.random() * 6;
      add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, g: 0.13, drag: 0.985, life: 45 + Math.random() * 40, s: 5 + Math.random() * 9,
            c: colors[i % colors.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, shape: Math.random() < 0.5 ? 'star' : 'dot' });
    }
  }
  function confetti(colors, n) {
    if (!prefs.fx || !ensureCanvas()) return; colors = [].concat(colors);
    for (let i = 0; i < (n || 70); i++) add({ x: Math.random() * W, y: -10 - Math.random() * 120, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 3, g: 0.07, drag: 0.995,
      life: 110 + Math.random() * 70, s: 8 + Math.random() * 8, c: colors[i % colors.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, shape: 'conf' });
  }
  function flash(color) {
    if (!prefs.fx) return; const d = document.createElement('div'); d.className = 'flash'; d.style.background = 'radial-gradient(circle at 50% 45%,' + color + 'cc,transparent 70%)';
    document.body.appendChild(d); setTimeout(() => d.remove(), 700);
  }
  function centerOf(el) { if (!el) return { x: innerWidth / 2, y: innerHeight / 2 }; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  // Big "you got an item" moment, scaled by rarity (0-4).
  function reveal(r, el, silent) {
    if (!silent) sfx('reveal', r); const c = RAR[r] ? RAR[r].c : '#fff', p = centerOf(el);
    setTimeout(() => {
      burst(p.x, p.y, [c, '#ffffff', '#ffd98a'], 16 + r * 14);
      if (r >= 2) confetti([c, '#ffffff', '#ffd98a'], 30 + r * 20);
      if (r >= 3) flash(c);
      if (r >= 4) { setTimeout(() => burst(p.x, p.y, [c, '#fff'], 50), 250); setTimeout(() => burst(p.x, p.y, [c, '#ffd98a'], 50), 500); }
    }, 120);
    vibe(r >= 3 ? [40, 40, 90] : 30);
  }

  // ---------------- fullscreen ----------------
  const de = document.documentElement;
  const fsSupported = !!(de.requestFullscreen || de.webkitRequestFullscreen);
  const inFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function enterFs() { if (!fsSupported || inFs()) return; try { const p = (de.requestFullscreen || de.webkitRequestFullscreen).call(de, { navigationUI: 'hide' }); p && p.catch && p.catch(() => {}); } catch (e) {} }
  function exitFs() { if (!inFs()) return; try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {} }
  function toggleFs() { if (inFs()) { set('fs', false); exitFs(); } else { set('fs', true); enterFs(); } }
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(e => document.addEventListener(e, () => listeners.forEach(f => f())));

  return { prefs, set, sfx, unlock, burst, confetti, flash, reveal, vibe, centerOf, fsSupported, inFs, enterFs, exitFs, toggleFs, onChange: f => listeners.push(f) };
})();
