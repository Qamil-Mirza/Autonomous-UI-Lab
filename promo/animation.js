/* GhostLoop promo v5: brand palette, one camera over one world, rigged line-art ghosts.
   A paused GSAP master timeline owns every value; draw() derives the frame from it, so preview, scrub and render agree. */
const $ = s => document.querySelector(s);
const renderMode = new URLSearchParams(location.search).has('render');
if (renderMode) document.documentElement.classList.add('render');
const DUR = 30;
window.FILM_DURATION = DUR;
window.FILM_BEATS = ['drop', 'build', 'testers', 'swarm', 'friction', 'approve', 'retest', 'brand'];
window.REVIEW_FRAMES = [['01-drop', 1.2], ['02-land', 1.74], ['03-uploaded', 2.9], ['04-build', 4.35], ['05-app', 5.4], ['06-testers', 7.4], ['07-swarm', 8.5], ['08-orbit', 10.4], ['09-dive', 11.75], ['10-bonk', 14.25], ['11-careful', 15.75], ['12-loop', 16.3], ['13-pins', 17.15], ['14-panel', 18.45], ['15-approve', 20.1], ['16-apply', 21.45], ['17-retest', 22.45], ['18-success', 24.0], ['19-ring', 25.7], ['20-figure', 26.7], ['21-end', 29.2]];

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, u) => a + (b - a) * u;
const ease = n => gsap.parseEase(n);
function bez(p0, c1, c2, p1, u) {
  const v = 1 - u;
  return [v * v * v * p0[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * p1[0],
          v * v * v * p0[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * p1[1]];
}

// World layout (px). The tested app sits at APP; its buttons and title in world coordinates:
const APP = { x: 340, y: 220, w: 1240, h: 720 };
const W = (lx, ly) => [APP.x + lx, APP.y + ly];
const FREE_BTN = W(202, 593), FREE_BTN_AFTER = W(340, 593), PRO_BTN = W(900, 593), TITLE = W(300, 158), FREE_PRICE = W(230, 380);

const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
window.film = tl;

// ---------------- State the timeline tweens; draw() reads it ----------------
const cam = { x: 960, y: 560, z: 1.18 };
const night = { r: 0 }, lb = { p: 0 }, score = { p: 0 }, dash = { o: 1 };
const KINDS = ['curious', 'hurry', 'careful', 'plain', 'plain', 'curious', 'plain', 'hurry', 'plain', 'careful', 'plain', 'plain'];
const models = KINDS.map((k, i) => ({ i, kind: k, s: 1, sx: 1, sy: 1, r: 0, o: 0, gx: 0, gy: 0, blink: 0, mood: 'happy', orb: 0, dive: 0, fig: 0, arm: 0, z: 20, lift: 0, phase: i * 1.7 + .3, a0: i / 12 * Math.PI * 2 + .4 }));
const tracks = models.map(() => ({ start: [-400, -400], list: [] }));

$('#ghosts').innerHTML = models.map((m, i) => `<div class="ghost" id="g${i}">${ghostSVG(m.kind)}</div>`).join('');
const rigs = models.map((m, i) => {
  const el = $('#g' + i);
  return { el, body: el.querySelector('.body'), face: el.querySelector('.face'), eyes: el.querySelector('.eyes'), mouth: el.querySelector('.mouth'), brows: el.querySelector('.brows'), armL: el.querySelector('.arm-l'), armR: el.querySelector('.arm-r'), last: {} };
});
$('#cursor').innerHTML = pointer();

// Flying zip file (lands in the drop zone).
const zip = document.createElement('div'); zip.className = 'zipicon'; zip.id = 'zipfly'; zip.textContent = 'ZIP'; $('#world').appendChild(zip);
gsap.set(zip, { position: 'absolute', left: 1420, top: -260, width: 110, height: 128, fontSize: 30, borderRadius: 18, zIndex: 50, transformOrigin: '50% 100%', boxShadow: '0 20px 40px #17201d33' });

// Caption band keeps captions legible over busy UI.
const band = document.createElement('div'); band.id = 'band';
Object.assign(band.style, { position: 'absolute', left: 0, right: 0, top: 0, height: '250px', zIndex: 79, pointerEvents: 'none', background: 'linear-gradient(#f7f7f2 0%, #f7f7f2f2 45%, #f7f7f200 100%)', opacity: 0 });
$('#stage').insertBefore(band, $('#captions'));

// Mask that draws the dotted "went back" path progressively.
(() => {
  const svg = $('#paths'), ns = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'defs'), mask = document.createElementNS(ns, 'mask');
  mask.setAttribute('id', 'lbmask'); mask.setAttribute('maskUnits', 'userSpaceOnUse');
  const mp = document.createElementNS(ns, 'path');
  mp.setAttribute('d', $('#loopback').getAttribute('d')); mp.setAttribute('id', 'lbm');
  Object.entries({ fill: 'none', stroke: '#fff', 'stroke-width': 14, 'stroke-linecap': 'round' }).forEach(([k, v]) => mp.setAttribute(k, v));
  mask.appendChild(mp); defs.appendChild(mask); svg.prepend(defs);
  $('#loopback').setAttribute('mask', 'url(#lbmask)');
})();
const lbLen = $('#lbm').getTotalLength();
$('#lbm').style.strokeDasharray = `${lbLen} ${lbLen + 40}`;
gsap.set('#loopback', { opacity: 0 });

// ---------------- Ghost motion helpers ----------------
function place(i, at, p) { const T = tracks[i]; if (!T.list.length && at <= 0) { T.start = p; return; } T.list.push({ at, dur: 0, p0: p, c1: p, c2: p, p1: p, ease: ease('none') }); }
function endOf(i) { const T = tracks[i]; return T.list.length ? T.list[T.list.length - 1].p1 : T.start; }
// Arc to a point. bend > 0 bows the path to the left of travel; c1/c2 override.
function go(i, at, dur, p1, o = {}) {
  const p0 = endOf(i), dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, b = o.bend ?? len * .22;
  const c1 = o.c1 || [p0[0] + dx * .3 + nx * b, p0[1] + dy * .3 + ny * b];
  const c2 = o.c2 || [p0[0] + dx * .7 + nx * b, p0[1] + dy * .7 + ny * b];
  tracks[i].list.push({ at, dur, p0, c1, c2, p1, ease: ease(o.ease || 'power2.inOut') });
}
function trackPos(i, t) {
  const T = tracks[i]; let p = T.start;
  for (const s of T.list) { if (t < s.at) break; const u = s.dur ? clamp((t - s.at) / s.dur) : 1; p = bez(s.p0, s.c1, s.c2, s.p1, s.ease(u)); }
  return p;
}
const ORBIT = { cx: 960, cy: 590, rx: 880, ry: 300 };
function orbitAngle(m, t) { const T = Math.max(0, t - 9.0); return m.a0 + T * (1.05 + .62 * T); }
let FIG = { x: 960, y: 500 };
function posAt(i, t) {
  const m = models[i]; let p = trackPos(i, t);
  if (m.orb > 0) {
    const a = orbitAngle(m, t), k = 1 - m.dive;
    const o = [ORBIT.cx + Math.cos(a) * ORBIT.rx * k, ORBIT.cy - 30 * m.dive + Math.sin(a) * ORBIT.ry * k];
    p = [lerp(p[0], o[0], m.orb), lerp(p[1], o[1], m.orb)];
  }
  if (m.fig > 0 && m.fig < 1) { const th = m.fig * Math.PI * 2; p = [FIG.x + 175 * Math.sin(th), FIG.y + 80 * Math.sin(2 * th)]; }
  return p;
}
function squash(i, at, a = .22, settle = .55) {
  const m = models[i];
  tl.to(m, { sx: 1 + a, sy: 1 - a, duration: .07, ease: 'power2.out' }, at).to(m, { sx: 1, sy: 1, duration: settle, ease: 'elastic.out(1.1,.35)' }, at + .07);
}
function mood(i, at, v) { tl.set(models[i], { mood: v }, at); }

// ---------------- Captions ----------------
const CAPS = [
  ['Drop in *your app.*', .3, 2.75],
  ['We *build* it.', 3.2, 5.45],
  ['Meet your *testers.*', 6.45, 9.0, 'light'],
  ['AI users. *Real browser.*', 9.5, 12.05, 'light'],
  ['See where they *get stuck.*', 13.2, 17.2],
  ['You approve *every fix.*', 17.72, 20.75],
  ['Then we *test it again.*', 21.3, 24.45],
];
$('#captions').innerHTML = CAPS.map(([txt, , , cls], i) => `<div class="caption ${cls || ''}" id="cap${i}">${txt.split(/(\*[^*]+\*)/).filter(Boolean).flatMap(part => {
  const em = part.startsWith('*'); return part.replace(/\*/g, '').trim().split(/\s+/).map(w => `<span class="w"><span>${em ? `<em>${w}</em>` : w}</span></span>`);
}).join('')}</div>`).join('');
CAPS.forEach(([, a, b], i) => {
  const words = `#cap${i} .w>span`;
  tl.set(`#cap${i}`, { autoAlpha: 1 }, a - .01)
    .fromTo(words, { yPercent: 115, rotation: 4 }, { yPercent: 0, rotation: 0, duration: .65, stagger: .055, ease: 'expo.out' }, a)
    .to(words, { yPercent: -115, duration: .32, stagger: .03, ease: 'power2.in' }, b)
    .set(`#cap${i}`, { autoAlpha: 0 }, b + .45);
});
gsap.set('.caption', { autoAlpha: 0 });

// =============================== TIMELINE ===============================
function build() {
  const frame = $('#frame');
  gsap.set(frame, { transformOrigin: '50% 50%' });
  gsap.set('#app .real>*, #app .chrome', { opacity: 0 });
  gsap.set('#fix1,#fix2,#fix3', { opacity: 0 });
  gsap.set('#btn-pro', { border: '1.5px solid rgba(221,226,220,0)' });

  // ---- 0–3: Drop in your app ----
  tl.to(cam, { z: 1.04, duration: 2.9, ease: 'sine.inOut' }, 0)
    .fromTo(frame, { scale: .86, opacity: 0 }, { scale: 1, opacity: 1, duration: .7, ease: 'back.out(1.5)' }, .05)
    .from('#drop-icon', { y: 18, opacity: 0, duration: .5 }, .3)
    .from('#drop-text', { y: 18, opacity: 0, duration: .5 }, .38)
    .to('#drop-icon', { y: -8, duration: .35, ease: 'sine.inOut', yoyo: true, repeat: 1 }, .95);
  // The file arcs in under gravity: x eases out, y eases in.
  tl.to(zip, { left: 905, duration: .78, ease: 'power1.out' }, .9)
    .to(zip, { top: 496, duration: .78, ease: 'power2.in' }, .9)
    .fromTo(zip, { rotation: 28 }, { rotation: -6, duration: .78, ease: 'sine.inOut' }, .9)
    .to(zip, { scaleY: .74, scaleX: 1.22, rotation: 0, duration: .07, ease: 'power2.out' }, 1.68)
    .to(zip, { scaleY: 1, scaleX: 1, duration: .45, ease: 'elastic.out(1.2,.35)' }, 1.75)
    .to(frame, { scaleY: .94, scaleX: 1.035, duration: .08, ease: 'power2.out' }, 1.68)
    .to(frame, { scaleY: 1, scaleX: 1, duration: .7, ease: 'elastic.out(1.2,.32)' }, 1.76)
    .to('#drop-icon,#drop-text', { scale: .85, opacity: 0, duration: .16, ease: 'power2.in' }, 1.7)
    .to(zip, { left: 774, top: 529, width: 54, height: 62, fontSize: 15, borderRadius: 9, boxShadow: '0 0 0 #0000', duration: .42, ease: 'expo.inOut' }, 1.92)
    .fromTo('#chip', { opacity: 0, scale: .92 }, { opacity: 1, scale: 1, duration: .3 }, 2.02)
    .set(zip, { autoAlpha: 0 }, 2.34)
    .to('#ring-fg', { strokeDashoffset: 0, duration: .55, ease: 'power2.inOut' }, 2.12)
    .to('#ring', { scale: .4, opacity: 0, duration: .14 }, 2.7)
    .to('#chip-check', { scale: 1, duration: .45, ease: 'back.out(3)' }, 2.74)
    .to(dash, { o: 0, duration: .3 }, 2.75);

  // ---- 3–6: We build it. The drop zone becomes the app window. ----
  tl.to('#chip', { scale: .9, opacity: 0, duration: .22, ease: 'power2.in' }, 3.0)
    .to(frame, { left: APP.x, top: APP.y, width: APP.w, height: APP.h, borderRadius: 24, duration: .85, ease: 'expo.inOut' }, 3.08)
    .to(cam, { x: 960, y: 580, z: .98, duration: 1.0, ease: 'expo.inOut' }, 3.0)
    .set('#app', { opacity: 1 }, 3.5)
    .fromTo('#app .chrome', { y: -56, opacity: 1 }, { y: 0, opacity: 1, duration: .45, ease: 'expo.out' }, 3.55)
    .to('#skel b', { opacity: 1, duration: .25, stagger: .07 }, 3.62)
    .to('#skel b', { opacity: 0, duration: .25, stagger: .05 }, 4.15)
    .fromTo('#app .brand, #app .steps, #title, #app .sub', { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: .55, stagger: .06, ease: 'expo.out' }, 4.15)
    .fromTo('#card-free, #card-pro', { y: 60, opacity: 0, rotation: 1.5 }, { y: 0, opacity: 1, rotation: 0, duration: .7, stagger: .1, ease: 'expo.out' }, 4.35)
    .fromTo('#btn-free, #btn-pro', { scale: .6, opacity: 0 }, { scale: 1, opacity: 1, duration: .55, stagger: .1, ease: 'back.out(2.4)' }, 4.75)
    .to(cam, { z: 1.03, duration: .9, ease: 'sine.inOut' }, 4.6);

  // ---- 6–9: Meet your testers (ink night) ----
  tl.to(night, { r: 2300, duration: .85, ease: 'power2.inOut' }, 5.65)
    .to(cam, { y: 520, z: .72, duration: 1.15, ease: 'expo.inOut' }, 5.65)
    .to(frame, { boxShadow: '0 40px 120px #000a, 0 0 0 1px #ffffff14', duration: .8 }, 5.8);
  const heroX = [640, 960, 1280];
  heroX.forEach((x, i) => {
    const m = models[i], at = 6.5 + i * .14;
    const y = i === 1 ? 870 : 830;
    place(i, 0, [x, 1450]); tl.set(m, { s: 1.6, o: 1, z: 20 }, 6.3);
    // Shoot up from below frame, overshoot, settle.
    go(i, at, .5, [x, y], { bend: 0, ease: 'back.out(1.5)' });
    tl.to(m, { sx: .8, sy: 1.25, duration: .12, ease: 'power2.out' }, at)
      .to(m, { sx: 1.12, sy: .88, duration: .1, ease: 'power2.out' }, at + .36)
      .to(m, { sx: 1, sy: 1, duration: .6, ease: 'elastic.out(1.1,.35)' }, at + .46);
    tl.fromTo('#nc' + i, { opacity: 0, y: 20, scale: .7 }, { opacity: 1, y: 0, scale: 1, duration: .45, ease: 'back.out(2)' }, at + .45);
  });
  gsap.set('#nc0', { left: 640, top: 918 }); gsap.set('#nc1', { left: 960, top: 958 }); gsap.set('#nc2', { left: 1280, top: 918 });
  // They glance at each other, then at us.
  tl.to(models[0], { gx: 1, duration: .25 }, 7.35).to(models[2], { gx: -1, duration: .25 }, 7.4).to(models[1], { gx: -.8, duration: .2 }, 7.5)
    .to(models[1], { gx: .8, duration: .2 }, 7.85).to([models[0], models[1], models[2]], { gx: 0, duration: .3 }, 8.2);
  mood(1, 7.5, 'wow'); mood(1, 8.0, 'happy');
  const smallPos = [[90, 260], [30, 640], [180, 1020], [1830, 260], [1890, 640], [1740, 1020], [420, 80], [1500, 80], [960, 30]];
  smallPos.forEach((p, k) => {
    const i = k + 3, m = models[i], at = 7.45 + k * .085;
    place(i, 0, p);
    tl.set(m, { s: 0, o: 1, z: 20 }, 6.3).to(m, { s: .95, duration: .5, ease: 'back.out(2.6)' }, at)
      .fromTo(m, { r: k % 2 ? -25 : 25 }, { r: 0, duration: .7, ease: 'elastic.out(1,.4)' }, at);
  });
  tl.to('.namechip', { opacity: 0, scale: .8, y: -10, duration: .25, stagger: .05, ease: 'power2.in' }, 8.55);

  // ---- 9–12: Swarm orbits (in front of and behind the window), then dives in ----
  [0, 1, 2].forEach(i => { squash(i, 8.62, .2, .3); tl.to(models[i], { orb: 1, s: 1.2, duration: 1.0, ease: 'power2.inOut' }, 8.75); });
  for (let i = 3; i < 12; i++) tl.to(models[i], { orb: 1, duration: 1.0, ease: 'power2.inOut' }, 8.8 + (i - 3) * .05);
  tl.to(cam, { z: .66, duration: 2.0, ease: 'sine.inOut' }, 9.0)
    .to(cam, { z: .86, y: 560, duration: 1.3, ease: 'power2.in' }, 11.0);
  for (let i = 0; i < 12; i++) tl.to(models[i], { dive: 1, duration: .8, ease: 'power3.in' }, 10.95 + ((i * 5) % 12) * .075);
  tl.fromTo('#enter-flash', { scale: 1, opacity: 0 }, { scale: 60, opacity: .95, duration: .25, ease: 'power2.out' }, 11.9)
    .to('#enter-flash', { opacity: 0, duration: .6 }, 12.15)
    .fromTo(frame, { scale: 1 }, { scale: 1.025, duration: .12, ease: 'power2.out', yoyo: true, repeat: 1 }, 11.95);

  // ---- 12.3–17.3: See where they get stuck ----
  tl.to(night, { r: 0, duration: .75, ease: 'power2.inOut' }, 12.3)
    .to(frame, { boxShadow: '0 30px 70px #17201d14, 0 0 0 0px #ffffff00', duration: .6 }, 12.3)
    .to(cam, { x: 960, y: 600, z: 1.0, duration: .9, ease: 'expo.inOut' }, 12.3)
    .to(band, { opacity: 1, duration: .4 }, 12.9);
  for (let i = 0; i < 12; i++) tl.set(models[i], { orb: 0, dive: 0, o: i < 3 ? 1 : 0, s: .75, z: 20 }, 12.95);
  // In a hurry: straight to the loud paid-trial button, bonks it.
  place(1, 12.95, [180, 520]);
  go(1, 13.15, .8, [PRO_BTN[0], PRO_BTN[1] - 85], { bend: -140, ease: 'power2.inOut' });
  go(1, 13.98, .1, [PRO_BTN[0], PRO_BTN[1] - 40], { bend: 0, ease: 'power2.in' });
  go(1, 14.08, .45, [PRO_BTN[0] - 40, PRO_BTN[1] - 120], { bend: 20, ease: 'back.out(2)' });
  squash(1, 14.06, .3, .6); mood(1, 14.1, 'angry');
  tl.to('#btn-pro', { scaleY: .9, scaleX: .98, duration: .06, yoyo: true, repeat: 1 }, 14.04)
    .to(models[1], { r: 10, duration: .07, yoyo: true, repeat: 7, ease: 'sine.inOut' }, 14.4)
    .fromTo('#pin-a', { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: .45, ease: 'back.out(3)' }, 14.15);
  // Curious: reads the Free price, then is drawn to the big dark button too.
  place(0, 12.95, [160, 700]);
  go(0, 13.35, .9, [FREE_PRICE[0], FREE_PRICE[1] - 40], { bend: 90 });
  tl.to(models[0], { gx: .6, gy: .8, duration: .25 }, 14.2).to(models[0], { gx: 1, gy: .3, duration: .25 }, 14.55);
  go(0, 14.65, .75, [PRO_BTN[0] + 120, PRO_BTN[1] - 95], { bend: 120 });
  mood(0, 15.35, 'worried'); squash(0, 15.4, .14);
  // Careful: hovers over the quiet Free button, looks around, then goes back to compare.
  place(2, 12.95, [120, 900]);
  go(2, 14.2, 1.1, [FREE_BTN[0] + 10, FREE_BTN[1] - 80], { bend: -80 });
  tl.to(models[2], { gx: -1, duration: .18 }, 15.35).to(models[2], { gx: 1, duration: .18 }, 15.6).to(models[2], { gx: 0, gy: -1, duration: .2 }, 15.82);
  mood(2, 15.35, 'worried');
  tl.fromTo('#pin-b', { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: .45, ease: 'back.out(3)' }, 15.55);
  go(2, 15.95, .55, [600, 395], { c1: [470, 700], c2: [470, 470], ease: 'power1.inOut' });
  go(2, 16.5, .5, [640, 650], { c1: [730, 330], c2: [760, 520], ease: 'power1.inOut' });
  go(2, 17.0, .35, [585, 735], { bend: 0, ease: 'power2.out' });
  tl.set('#loopback', { opacity: 1 }, 15.95).to(lb, { p: 1, duration: 1.4, ease: 'none' }, 15.95)
    .fromTo('#pin-c', { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: .45, ease: 'back.out(3)' }, 16.35);
  // Camera: whip to the paid button, whip to the Free button, then pull back to all three pins.
  tl.to(cam, { x: 1250, y: 760, z: 1.38, duration: .55, ease: 'power3.inOut' }, 13.85)
    .to(cam, { x: 640, y: 640, z: 1.22, duration: .6, ease: 'power3.inOut' }, 15.05)
    .to(cam, { x: 960, y: 600, z: .95, duration: .7, ease: 'power3.inOut' }, 16.65)
    .to('.pin span', { scale: 1.12, duration: .3, yoyo: true, repeat: 1, ease: 'sine.inOut', stagger: .1 }, 16.9);

  // ---- 17.3–21: You approve every fix ----
  const panel = $('#panel');
  const PANEL = { x: 1660, y: 330 };
  gsap.set(panel, { left: PANEL.x, top: PANEL.y });
  const rectOf = el => ({ left: PANEL.x + el.offsetLeft, top: PANEL.y + el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
  const F1 = rectOf($('#fix1')), F2 = rectOf($('#fix2')), F3 = rectOf($('#fix3')), AP = rectOf($('#approve'));
  const pinRect = id => { const el = $(id); return { left: el.offsetLeft, top: el.offsetTop, width: 46, height: 46 }; };
  tl.to(cam, { x: 1300, y: 610, z: .9, duration: .8, ease: 'expo.inOut' }, 17.3)
    .fromTo(panel, { x: 120, opacity: 0 }, { x: 0, opacity: 1, duration: .7, ease: 'expo.out' }, 17.6);
  [0, 1, 2].forEach((i, k) => { go(i, 17.35 + k * .08, .9, [[1790, 1960, 2130][k], 296], { bend: 90 }); tl.set(models[i], { z: 30 }, 17.3); });
  tl.to(models.slice(0, 3), { gx: 0, gy: 1, duration: .3 }, 18.3).to(models.slice(0, 3), { gx: -.4, gy: .9, duration: .3 }, 19.1);
  [0, 1, 2].forEach(i => mood(i, 17.5, 'calm'));
  tl.to('#loopback', { opacity: 0, duration: .3 }, 17.85)
    .to('#pin-a em, #pin-b em, #pin-c em', { opacity: 0, duration: .15 }, 17.95);
  [['#blob1', '#pin-b', F1, '#fix1'], ['#blob2', '#pin-a', F2, '#fix2'], ['#blob3', '#pin-c', F3, '#fix3']].forEach(([b, pin, R, fx], k) => {
    const P = pinRect(pin), at = 18.0 + k * .1;
    tl.set(b, { ...P, borderRadius: 23, backgroundColor: '#ee7375', opacity: 1 }, at)
      .set(pin, { opacity: 0 }, at)
      .to(b, { left: R.left, duration: .7, ease: 'power3.inOut' }, at)
      .to(b, { top: R.top, duration: .7, ease: 'power2.inOut' }, at)
      .to(b, { width: R.width, height: R.height, borderRadius: 18, backgroundColor: '#2b3531', duration: .7, ease: 'expo.inOut' }, at)
      .to(fx, { opacity: 1, duration: .2 }, at + .62)
      .set(b, { opacity: 0 }, at + .8);
  });
  // Cursor arcs in, presses Approve.
  const APC = [AP.left + AP.width / 2, AP.top + AP.height / 2];
  tl.set('#cursor', { left: 2150, top: 1050, opacity: 1 }, 19.0)
    .to('#cursor', { left: APC[0] + 30, duration: .75, ease: 'power2.out' }, 19.0)
    .to('#cursor', { top: APC[1] + 6, duration: .75, ease: 'power3.inOut' }, 19.0)
    .to('#cursor', { scale: .8, duration: .07, yoyo: true, repeat: 1 }, 19.82)
    .set('#ripple', { left: APC[0], top: APC[1] }, 19.85)
    .fromTo('#ripple', { scale: .6, opacity: .9 }, { scale: 5, opacity: 0, duration: .55, ease: 'power2.out', immediateRender: false }, 19.85)
    .to('#approve', { scale: .96, duration: .07, yoyo: true, repeat: 1 }, 19.84)
    .to('#approve', { backgroundColor: '#246d54', duration: .25 }, 19.92)
    .to('#approve .a1', { yPercent: -120, opacity: 0, duration: .25, ease: 'power2.in' }, 19.92)
    .fromTo('#approve .a2', { yPercent: 120, opacity: 0 }, { yPercent: 0, opacity: 1, duration: .35, ease: 'back.out(2)' }, 20.0)
    .to('.fix .ok', { scale: 1, duration: .4, stagger: .1, ease: 'back.out(3)' }, 20.05)
    .to('#cursor', { opacity: 0, duration: .2 }, 20.4);
  [0, 1, 2].forEach(i => { mood(i, 19.95, 'happy'); tl.to(models[i], { lift: -40, arm: 1, duration: .2, ease: 'power2.out', yoyo: true, repeat: 1 }, 20.0 + i * .06); });

  // ---- 20.5–24.5: Fixes fly into the app; retest ----
  const FB = { left: APP.x + 112, top: APP.y + 564, width: 456, height: 58 };
  const PB = { left: APP.x + 672, top: APP.y + 564, width: 456, height: 58 };
  [['#blob1', F1, '#fix1'], ['#blob2', F2, '#fix2']].forEach(([b, R, fx], k) => {
    const at = 20.55 + k * .1;
    tl.set(b, { ...R, borderRadius: 18, backgroundColor: '#2b3531', opacity: 1 }, at)
      .set(fx, { opacity: 0 }, at)
      .to(b, { left: FB.left, duration: .7, ease: 'power3.inOut' }, at)
      .to(b, { top: FB.top, duration: .7, ease: 'power2.inOut' }, at)
      .to(b, { width: FB.width, height: FB.height, borderRadius: 13, backgroundColor: '#17201d', duration: .7, ease: 'expo.inOut' }, at)
      .set(b, { opacity: 0 }, 21.42);
  });
  tl.set('#blob3', { ...F3, borderRadius: 18, backgroundColor: '#2b3531', opacity: 1 }, 20.75)
    .set('#fix3', { opacity: 0 }, 20.75)
    .to('#blob3', { left: PB.left, duration: .7, ease: 'power3.inOut' }, 20.75)
    .to('#blob3', { top: PB.top, duration: .7, ease: 'power2.inOut' }, 20.75)
    .to('#blob3', { width: PB.width, height: PB.height, borderRadius: 13, backgroundColor: '#ffffff', duration: .7, ease: 'expo.inOut' }, 20.75)
    .set('#blob3', { opacity: 0 }, 21.47);
  tl.to(panel, { x: 140, opacity: 0, duration: .5, ease: 'power2.in' }, 20.85)
    .to(cam, { x: 900, y: 640, z: 1.02, duration: .9, ease: 'expo.inOut' }, 20.6)
    .to('#btn-free', { width: 456, backgroundColor: '#17201d', borderColor: '#17201d', color: '#ffffff', boxShadow: '0 8px 20px #17201d33', duration: .35, ease: 'expo.out' }, 21.3)
    .to('#btn-free .roll span', { y: -28, duration: .4, ease: 'back.out(2)' }, 21.32)
    .to('#btn-pro', { backgroundColor: '#ffffff', color: '#17201d', borderColor: 'rgba(221,226,220,1)', boxShadow: '0 0 0 #0000', duration: .35 }, 21.3)
    .to('#btn-pro .roll span', { y: -28, duration: .4, ease: 'back.out(2)' }, 21.47)
    .fromTo('#btn-pro', { scale: 1 }, { scale: 1.04, duration: .12, yoyo: true, repeat: 1, ease: 'power2.out', immediateRender: false }, 21.47)
    .fromTo('#btn-free', { scale: 1 }, { scale: 1.05, duration: .12, yoyo: true, repeat: 1, ease: 'power2.out' }, 21.32)
    .to('#pin-a, #pin-b', { opacity: 0, duration: .01 }, 21.3);
  // Testers glide straight to the now-obvious button, one after another, and press it.
  [0, 1, 2].forEach((i, k) => {
    const at = 21.55 + k * .3;
    go(i, at, .62, [FREE_BTN_AFTER[0] - 60 + k * 60, FREE_BTN_AFTER[1] - 70], { bend: 160, ease: 'power2.inOut' });
    go(i, at + .62, .1, [FREE_BTN_AFTER[0] - 60 + k * 60, FREE_BTN_AFTER[1] - 45], { bend: 0, ease: 'power2.in' });
    squash(i, at + .7, .22, .5);
    tl.to('#btn-free', { scaleY: .92, duration: .06, yoyo: true, repeat: 1 }, at + .7);
    tl.to(models[i], { gx: 0, gy: .6, duration: .2 }, at);
  });
  tl.to(cam, { x: 720, y: 740, z: 1.22, duration: .8, ease: 'power3.inOut' }, 21.45);
  // Through to the next screen.
  tl.to('#app .real', { x: -90, opacity: 0, duration: .35, ease: 'power2.in' }, 22.95)
    .set('#success', { visibility: 'visible' }, 23.05)
    .fromTo('#success', { x: 90, opacity: 0 }, { x: 0, opacity: 1, duration: .5, ease: 'expo.out' }, 23.05)
    .from('#success .tick', { scale: 0, duration: .55, ease: 'back.out(2.6)' }, 23.15)
    .to(cam, { x: 960, y: 640, z: .92, duration: .8, ease: 'power3.inOut' }, 23.0);
  [0, 1, 2].forEach((i, k) => {
    go(i, 23.05 + k * .05, .55, [[770, 960, 1150][k], [350, 315, 350][k]], { bend: -120, ease: 'back.out(1.4)' });
    mood(i, 23.3, k === 1 ? 'wow' : 'happy');
    tl.to(models[i], { arm: 1, duration: .25, ease: 'back.out(2)' }, 23.5 + k * .05)
      .to(models[i], { lift: -26, duration: .22, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 23.6 + k * .08);
  });
  tl.fromTo('#score', { opacity: 0, y: 40, scale: .8 }, { opacity: 1, y: 0, scale: 1, duration: .55, ease: 'back.out(1.8)' }, 23.55)
    .to(score, { p: 1, duration: .7, ease: 'power2.out' }, 23.8);

  // ---- 24.5–30: The window collapses into the loop of the wordmark ----
  const mark = $('#mark'), left = $('#mk-left'), right = $('#mk-right'), oo = $('#mk-oo');
  // Brand "oo": two coral rings overlapping into a loop, sized to the wordmark.
  const FS = 220, D = 132, STROKE = 31, GAP = 100;
  left.innerHTML = [...'ghostl'].map(c => `<span class="ch">${c}</span>`).join('');
  oo.style.width = (D + GAP + 6) + 'px'; oo.textContent = ''; oo.style.margin = '0 4px 0 18px';
  const base = document.createElement('span'); Object.assign(base.style, { display: 'inline-block', width: 0, height: 0 }); mark.appendChild(base);
  const markW = mark.offsetWidth, mascotW = 250, gap = 34;
  const groupW = mascotW + gap + markW, gl = 960 - groupW / 2, markTop = 360;
  gsap.set(mark, { left: gl + mascotW + gap, top: markTop });
  const baseline = base.offsetTop, xCenter = markTop + baseline - FS * .272;
  const r1x = gl + mascotW + gap + oo.offsetLeft + D / 2 + 2;
  FIG = { x: r1x + GAP / 2, y: xCenter };
  gsap.set('#mascot', { left: gl, top: markTop + baseline - 238 });
  gsap.set('#tagline', { top: markTop + 300 });
  gsap.set('#o2', { left: r1x - D / 2, top: xCenter - D / 2, width: D, height: D, borderWidth: STROKE });

  tl.to('#score', { opacity: 0, y: 20, duration: .3, ease: 'power2.in' }, 24.5)
    .to(band, { opacity: 0, duration: .4 }, 24.6);
  [0, 1, 2].forEach((i, k) => { go(i, 24.5 + k * .06, .55, [[700, 980, 1260][k], -260], { bend: 80, ease: 'power2.in' }); mood(i, 24.5, 'happy'); tl.to(models[i], { arm: 0, duration: .2 }, 24.5); });
  tl.to('#app', { opacity: 0, duration: .3 }, 24.75)
    .set(frame, { zIndex: 13 }, 24.9)
    .to(frame, { left: r1x - D / 2, top: xCenter - D / 2, width: D, height: D, borderRadius: D / 2, borderWidth: STROKE, backgroundColor: 'rgba(255,255,255,0)', boxShadow: '0 0 0 0 #0000, 0 0 0 0 #0000', duration: .95, ease: 'expo.inOut' }, 24.9)
    .to(cam, { x: 960, y: xCenter + 60, z: 1.0, duration: 1.0, ease: 'expo.inOut' }, 24.85)
    .set('#o2', { opacity: 1 }, 25.85)
    .to('#o2', { x: GAP, duration: .55, ease: 'back.out(1.8)' }, 25.85)
    .to(frame, { scaleX: 1.08, scaleY: .93, duration: .08, yoyo: true, repeat: 1 }, 25.85)
    .set(mark, { visibility: 'visible' }, 25.95)
    .from('#mk-left .ch', { x: 70, opacity: 0, duration: .55, stagger: { each: .04, from: 'end' }, ease: 'expo.out' }, 25.98)
    .from(right, { x: -70, opacity: 0, duration: .55, ease: 'expo.out' }, 26.08)
    .to(cam, { z: 1.045, duration: 4.0, ease: 'sine.inOut' }, 26.0);
  // Three testers loop through the "oo", then fly off.
  [0, 1, 2].forEach((i, k) => {
    const at = 25.95 + k * .16, end = at + 1.45;
    tl.set(models[i], { s: .46, z: 15 }, 25.2);
    go(i, 25.2 + k * .1, at - (25.2 + k * .1), [FIG.x, FIG.y], { bend: 120, ease: 'power2.out' });
    tl.fromTo(models[i], { fig: 0.0001 }, { fig: .9999, duration: 1.45, ease: 'power1.inOut', immediateRender: false }, at).set(models[i], { fig: 0 }, end);
    place(i, end, [FIG.x, FIG.y]);
    go(i, end + .01, .6, [[2200, 2150, 2250][k], [120, 300, -60][k]], { bend: -100, ease: 'power2.in' });
  });
  tl.fromTo('#mascot', { opacity: 0, y: 80, scale: .6, rotation: -14 }, { opacity: 1, y: 0, scale: 1, rotation: 0, duration: .8, ease: 'back.out(1.7)' }, 27.25)
    .to('#mascot', { y: -12, rotation: 3, duration: .9, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 28.1)
    .fromTo('#tagline', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .7, ease: 'expo.out' }, 27.6);
  tl.set({}, {}, DUR);
}

// =============================== DRAW ===============================
const frameEl = $('#frame'), dashRect = $('#dash-rect'), nightEl = $('#night'), world = $('#world');
function drawGhost(i, t) {
  const m = models[i], R = rigs[i], L = R.last;
  let o = m.o;
  if (o <= 0.001 && L.o === 0) return;
  const p = posAt(i, t), q = posAt(i, t + 1 / 120);
  const vx = (q[0] - p[0]) * 120, vy = (q[1] - p[1]) * 120, speed = Math.hypot(vx, vy);
  let s = m.s, z = m.z;
  if (m.orb > 0) {
    const depth = Math.sin(orbitAngle(m, t));
    s *= lerp(1, .78 + .3 * depth, m.orb);
    if (m.orb > .5) z = (depth < -.05 && m.dive < .08) ? 5 : 20;
    s *= 1 - .86 * m.dive;
    if (m.dive > .86) o *= (1 - m.dive) / .14;
  }
  if (m.fig > 0 && m.fig < 1) z = Math.sin(4 * Math.PI * m.fig) > 0 ? 15 : 9;
  const k = Math.min(.3, speed / 4200), th = Math.atan2(vy, vx);
  const lean = clamp(vx / 70, -16, 16);
  const bob = Math.sin(t * 2.6 + m.phase) * 7 * s + m.lift * s;
  R.el.style.transform = `translate(${p[0].toFixed(1)}px,${(p[1] + bob).toFixed(1)}px) rotate(${th}rad) scale(${1 + k},${1 - .55 * k}) rotate(${-th}rad) rotate(${(m.r + lean).toFixed(2)}deg) scale(${(s * m.sx).toFixed(4)},${(s * m.sy).toFixed(4)})`;
  R.el.style.opacity = o; R.el.style.zIndex = z; L.o = o;
  R.body.setAttribute('d', ghostBody(t, m.phase, 3 + Math.min(9, speed / 160)));
  const gx = clamp(vx / 650, -1, 1) * .8 + m.gx, gy = clamp(vy / 650, -1, 1) * .6 + m.gy;
  R.face.setAttribute('transform', `translate(${(clamp(gx, -1.2, 1.2) * 8).toFixed(2)},${(clamp(gy, -1.2, 1.2) * 6).toFixed(2)})`);
  const auto = ((t * .29 + m.phase * .137) % 1) < .035 ? 1 : 0;
  R.eyes.setAttribute('transform', `translate(0,80) scale(1,${(1 - Math.max(auto, m.blink) * .88).toFixed(3)}) translate(0,-80)`);
  if (L.mood !== m.mood) { R.mouth.setAttribute('d', MOUTHS[m.mood] || MOUTHS.happy); R.brows.setAttribute('d', BROWS[m.mood] || ''); L.mood = m.mood; }
  const wave = Math.sin(t * 9 + m.phase) * 8 * m.arm;
  R.armL.setAttribute('transform', `rotate(${(m.arm * 70 + wave).toFixed(1)} 28 112)`);
  R.armR.setAttribute('transform', `rotate(${(-m.arm * 70 - wave).toFixed(1)} 132 112)`);
}
function draw() {
  const t = tl.time();
  world.style.transform = `translate(${(960 - cam.x * cam.z).toFixed(2)}px,${(540 - cam.y * cam.z).toFixed(2)}px) scale(${cam.z.toFixed(4)})`;
  $('#dots').style.transform = `translate(${((960 - cam.x * cam.z) * .25 % 32).toFixed(1)}px,${((540 - cam.y * cam.z) * .25 % 32).toFixed(1)}px)`;
  nightEl.style.clipPath = `circle(${night.r.toFixed(1)}px at 960px 560px)`;
  const w = frameEl.offsetWidth, h = frameEl.offsetHeight;
  dashRect.setAttribute('x', 3); dashRect.setAttribute('y', 3); dashRect.setAttribute('width', Math.max(0, w - 6)); dashRect.setAttribute('height', Math.max(0, h - 6));
  dashRect.setAttribute('rx', 29); dashRect.style.strokeDashoffset = (-t * 38).toFixed(1); dashRect.style.opacity = dash.o;
  $('#lbm').style.strokeDashoffset = (lbLen * (1 - lb.p)).toFixed(1);
  $('#score .s-b').textContent = Math.round(3 * (1 - score.p));
  for (let i = 0; i < models.length; i++) drawGhost(i, t);
}

// =============================== PLAYBACK ===============================
const audio = $('#audio'), play = $('#play'), seek = $('#seek'), sound = $('#sound');
const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function update() { draw(); const t = tl.time(); seek.value = t; $('#time').textContent = `${fmt(t)} / ${fmt(DUR)}`; if (t >= DUR) { play.textContent = 'Play'; audio.pause(); } }
function fit() { if (!renderMode) $('#stage').style.transform = `scale(${Math.min(innerWidth / 1920, (innerHeight - 70) / 1080)})`; }
addEventListener('resize', fit); fit();
function start() { if (tl.time() >= DUR) tl.time(0); audio.currentTime = tl.time(); audio.muted = !sound.checked; if (sound.checked) audio.play().catch(() => {}); tl.play(); play.textContent = 'Pause'; }
play.onclick = () => { if (tl.paused() || tl.time() >= DUR) start(); else { tl.pause(); audio.pause(); play.textContent = 'Play'; } };
$('#replay').onclick = () => { tl.pause(0); start(); };
seek.oninput = () => { tl.pause(Number(seek.value)); audio.pause(); audio.currentTime = tl.time(); play.textContent = 'Play'; };
sound.onchange = () => { audio.muted = !sound.checked; if (sound.checked && !tl.paused()) { audio.currentTime = tl.time(); audio.play().catch(() => {}); } };
window.seekFilm = t => { tl.pause(Math.min(DUR, Math.max(0, t)), false); update(); };
window.filmReady = Promise.all([document.fonts.ready, ...[...document.images].map(i => i.complete ? Promise.resolve() : new Promise(r => { i.onload = r; i.onerror = r; }))]).then(() => {
  build();
  tl.eventCallback('onUpdate', update);
  tl.pause(0); update();
  return true;
});
