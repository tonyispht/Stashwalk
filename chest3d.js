// Stashwalk 3D chest: the opening scene, using "Mythical Chest Draft 1" by ArtsGareau (CC-BY-4.0,
// https://sketchfab.com/3d-models/mythical-chest-draft-1-cc3d58d1c409436eb2f1ab1f47f8f0cd).
// Loaded on demand; the game falls back to its 2D opening if this never becomes ready.
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/jsm/GLTFLoader.js';
import { RoomEnvironment } from './vendor/jsm/RoomEnvironment.js';

// per chest level: [wood tint, band/lock tint, glow colour, glow strength]
export const LOOK = [null,
  ['#9a6a3e', '#707680', '#ffd98a', 0], ['#86552e', '#b8c0c8', '#ffe7b0', 0], ['#3f7d55', '#c9964a', '#9dffb8', .05], ['#2f6a8c', '#dfe6ee', '#9fe4ff', .08],
  ['#4a4fb0', '#e8c25a', '#a9b4ff', .12], ['#7a3aa3', '#ffd25e', '#e3a8ff', .18], ['#a3305e', '#ffd25e', '#ffa8cf', .26], ['#2a2433', '#ffcf3a', '#fff0a0', .22]];

let gltf = null, loading = null;
export function preload() {
  if (loading) return loading;
  loading = new GLTFLoader().loadAsync('./models/chest.glb').then(g => {
    gltf = g;
    g.scene.traverse(o => { if (!o.isMesh) return;
      if (/wood/i.test(o.material.name) && o.material.map) o.material.map = grayTex(o.material.map);
      if (/Metal|lock|hinge/i.test(o.material.name)) o.material.map = null; });
    return true;
  });
  return loading;
}
export const ready = () => !!gltf;

function grayTex(tex) {
  const img = tex.image, cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, cv.width, cv.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const y = Math.min(255, (p[i] * .3 + p[i + 1] * .59 + p[i + 2] * .11) * 1.55 + 40); p[i] = p[i + 1] = p[i + 2] = y; }
  g.putImageData(d, 0, 0); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.flipY = tex.flipY; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT; return t;
}
function radialTex(stops) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); stops.forEach(([o, c]) => gr.addColorStop(o, c));
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function raysTex(n) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512; const g = cv.getContext('2d'); g.translate(256, 256);
  for (let i = 0; i < n; i++) { g.rotate(Math.PI * 2 / n); const gr = g.createLinearGradient(0, 0, 0, -256); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.lineTo(-18, -256); g.lineTo(18, -256); g.closePath(); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function beamTex() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const g = cv.getContext('2d');
  const v = g.createLinearGradient(0, 256, 0, 0); v.addColorStop(0, 'rgba(255,255,255,1)'); v.addColorStop(.5, 'rgba(255,255,255,.35)'); v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v; g.fillRect(0, 0, 64, 256);
  const h = g.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = h; g.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Plays the opening in `host` (a full-screen element). Calls onFlash at the moment the lid bursts open.
export function play(host, { lvl = 1, rare = false, lite = false, onFlash } = {}) {
  lvl = Math.max(1, Math.min(8, lvl || 1));
  const [woodC, bandC, glowHex, glowK] = LOOK[lvl], glow = new THREE.Color(rare ? '#ffd98a' : glowHex);
  const W = host.clientWidth || innerWidth, H = host.clientHeight || innerHeight;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !lite, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(lite ? 1.25 : 2, devicePixelRatio || 1)); renderer.setSize(W, H); renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  host.appendChild(renderer.domElement); renderer.domElement.className = 'c3dcanvas';

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer), envRT = pmrem.fromScene(new RoomEnvironment(), .04); scene.environment = envRT.texture; scene.environmentIntensity = .55;
  const cam = new THREE.PerspectiveCamera(34, W / H, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x1a2430, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 6, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(glow, 1.8); rim.position.set(-4, 3, -4); scene.add(rim);
  const inner = new THREE.PointLight(glow, 0, 8, 1.6); scene.add(inner);

  // the chest, recoloured for its level
  const chest = gltf.scene.clone(true);
  chest.traverse(o => { if (!o.isMesh) return; o.material = o.material.clone(); const n = o.material.name;
    if (/Metal|lock|hinge/i.test(n)) { o.material.color.set(bandC); o.material.emissive.set(bandC); o.material.emissiveIntensity = glowK; o.material.metalness = .85; o.material.roughness = .35; }
    else if (/wood/i.test(n)) { o.material.color.set(woodC); o.material.emissive.set(woodC); o.material.emissiveIntensity = glowK * .4; }
    else if (/coins/i.test(n)) { o.material.emissive = new THREE.Color('#ffcf5a'); o.material.emissiveIntensity = 0; o.userData.coin = true; } });
  const holder = new THREE.Group(); holder.add(chest); scene.add(holder);
  const box = new THREE.Box3().setFromObject(chest), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  chest.position.set(-ctr.x, -box.min.y, -ctr.z);
  const S = size.y; inner.position.set(0, S * .55, 0);

  // glowing pad under the chest, rays behind it, a beam of light and sparks
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(S * 3.2, S * 3.2), new THREE.MeshBasicMaterial({ map: radialTex([[0, '#ffffff'], [.25, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]), color: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: .45 }));
  pad.rotation.x = -Math.PI / 2; pad.position.y = .01; scene.add(pad);
  const rays = new THREE.Mesh(new THREE.PlaneGeometry(S * 7, S * 7), new THREE.MeshBasicMaterial({ map: raysTex(lvl >= 6 ? 18 : 14), color: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  rays.position.set(0, S * .7, -S * 1.2); scene.add(rays);
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(S * 1.1, S * 4.5), new THREE.MeshBasicMaterial({ map: beamTex(), color: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, side: THREE.DoubleSide }));
  beam.position.set(0, S * 2.6, 0); scene.add(beam);
  const beam2 = beam.clone(); beam2.material = beam.material.clone(); beam2.rotation.y = Math.PI / 2; scene.add(beam2);
  const NP = lite ? 70 : 160 + lvl * 25, pg = new THREE.BufferGeometry(), pp = new Float32Array(NP * 3), pv = [];
  for (let i = 0; i < NP; i++) { pp.set([0, -100, 0], i * 3); pv.push({ v: new THREE.Vector3(), life: 0, delay: Math.random() * .9 }); }
  pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const sparks = new THREE.Points(pg, new THREE.PointsMaterial({ map: radialTex([[0, '#ffffff'], [.35, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']]), color: glow.clone().lerp(new THREE.Color('#fff6d8'), .4), size: S * .16, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(sparks);

  // the model's own lid animation (1.25 s - 4 s in the clip), played faster
  const mixer = new THREE.AnimationMixer(chest);
  const clip = gltf.animations[0], act = mixer.clipAction(clip); act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; act.paused = true; act.play(); act.time = 1.25; mixer.update(0);
  const OPEN_AT = .95, CLIP_FROM = 1.25, CLIP_HOLD = 2.6, END = lite ? 2.6 : 3.0;   // the clip opens 1.25-2.6 s (with a bounce), then closes - we stop before that
  let t0 = performance.now(), raf = 0, flashed = false, stopped = false, opened = false;
  // frame the whole chest whatever the screen shape: fit its bounding sphere into the narrower side of the view
  const R = size.length() / 2, vf = cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * cam.aspect);
  const fitD = R / Math.sin(Math.min(vf, hf) / 2) / 1.05;           // chest fills most of the narrow side (the sphere is roomier than the chest)
  const dir = new THREE.Vector3(.5, .42, .76).normalize();
  const look = new THREE.Vector3(0, size.y * .42, 0);
  const camTo = look.clone().addScaledVector(dir, fitD), camFrom = look.clone().addScaledVector(dir.clone().add(new THREE.Vector3(.15, .2, 0)).normalize(), fitD * 1.6);
  const ease = k => 1 - Math.pow(1 - k, 3);

  function frame(now) {
    const t = (now - t0) / 1000;
    // camera glide-in and a slow drift
    const k = ease(Math.min(1, t / 1.3)); cam.position.lerpVectors(camFrom, camTo, k);
    const drift = Math.sin(t * .6) * .05; cam.position.x += drift * fitD; cam.lookAt(look);
    // anticipation: the chest rattles and light leaks from the seam
    if (t < OPEN_AT) { const s = Math.max(0, (t - .35) / (OPEN_AT - .35)); holder.rotation.z = Math.sin(t * 42) * .035 * s; holder.position.y = Math.abs(Math.sin(t * 30)) * .02 * S * s; inner.intensity = s * 3; }
    else { holder.rotation.z *= .8; holder.position.y *= .8; }
    // lid opens
    if (t >= OPEN_AT) {
      if (!opened) { opened = true; act.paused = false; }
      act.time = Math.min(CLIP_HOLD, CLIP_FROM + (t - OPEN_AT)); mixer.update(0);
      const burst = Math.min(1, (t - OPEN_AT) / .35);
      inner.intensity = 3 + burst * (14 + lvl * 2) * (1 - Math.max(0, t - END + .6) / .6);
      beam.material.opacity = beam2.material.opacity = Math.min(.85, burst) * (.6 + .25 * Math.sin(t * 9));
      rays.material.opacity = Math.min(.55, burst * .7); rays.userData.spin = (rays.userData.spin || 0) + .004 + lvl * .0008;
      pad.material.opacity = .45 + burst * .5;
      chest.traverse(o => { if (o.userData.coin) o.material.emissiveIntensity = burst * .6; });
      if (!flashed && t >= OPEN_AT + .22) { flashed = true; onFlash && onFlash(); }
      // sparks rise out of the chest
      for (let i = 0; i < NP; i++) { const p = pv[i];
        if (p.life <= 0 && t - OPEN_AT > p.delay) { p.life = .9 + Math.random() * .9; pp[i * 3] = (Math.random() - .5) * S * .9; pp[i * 3 + 1] = S * .55; pp[i * 3 + 2] = (Math.random() - .5) * S * .5;
          p.v.set((Math.random() - .5) * S * 1.2, S * (1.6 + Math.random() * 2.2), (Math.random() - .5) * S * 1.2); p.delay = 99; }
        if (p.life > 0) { p.life -= 1 / 60; p.v.y -= S * .9 / 60; pp[i * 3] += p.v.x / 60; pp[i * 3 + 1] += p.v.y / 60; pp[i * 3 + 2] += p.v.z / 60; if (p.life <= 0) pp[i * 3 + 1] = -100; } }
      pg.attributes.position.needsUpdate = true;
    }
    // rays always face the camera, centred just behind the chest
    rays.position.copy(look).addScaledVector(look.clone().sub(cam.position).normalize(), S * 1.4);
    rays.quaternion.copy(cam.quaternion); rays.rotateZ(rays.userData.spin || 0);
    renderer.render(scene, cam);
    if (!stopped) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  function stop() {
    if (stopped) return; stopped = true; cancelAnimationFrame(raf);
    setTimeout(() => { envRT.dispose(); pmrem.dispose(); renderer.dispose(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map && o.material.map.isCanvasTexture && !/wood/.test(o.material.name || '')) o.material.map.dispose(); o.material.dispose(); } }); renderer.domElement.remove(); }, 400);
  }
  return { stop, duration: END };
}
