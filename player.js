// 共用播放核心: 預覽頁與編輯器都用它。畫面與音量只由「設定檔(timeline.js) + 時間 T」決定, 沒有隨機。
// 設定檔格式: {fade, fadeIn, fadeOut, frames:[{d,t,it:[[檔名,寬,高]|null..],x:[文字,'scr'|'cap',左右]}], audio:{tracks:[{name,src,dur,ss,es,xf,g}]}}
// 第一個 frame 是開場卡(t:'title'); 每首歌的 xf = 與上一首重疊(漸弱漸強)的秒數。
(function (g) {
const W = 1920, H = 1080;
const HS = {p1: [960], p2: [880, 880], p3: [740, 740, 740], l: [820], ll: [520, 520], pl: [800, 560]};
const GAP = {p1: 0, p2: 80, p3: 60, l: 0, ll: 70, pl: 90};
const KIND = {p1: 'p', p2: 'pp', p3: 'ppp', l: 'l', ll: 'll', pl: 'pl'}; // 每個版面各格的照片方向
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = x => x * x * (3 - 2 * x);

function geom(f) { // 各格位置(舞台座標 1920x1080); 空格用預設比例
  const hs = HS[f.t], gap = GAP[f.t];
  const ws = [...KIND[f.t]].map((c, i) => {
    const it = f.it && f.it[i], [w, h] = it ? [it[1], it[2]] : c == 'p' ? [2, 3] : [3, 2];
    return hs[i] * w / h;
  });
  let x = (W - ws.reduce((a, b) => a + b) - gap * (ws.length - 1)) / 2;
  const x0 = x, r = ws.map((w, i) => { const o = {x, y: (H - hs[i]) / 2, w, h: hs[i]}; x += w + gap; return o; });
  return {r, x0, xe: x0 + ws[0]};
}

function compile(c) { // 設定檔 -> 帶絕對時間的時間軸
  let t = 0;
  const frames = c.frames.map(f => { const o = Object.assign({}, f, {a: t}); t += f.d; return o; });
  const tr = [];
  c.audio.tracks.forEach((k, i) => {
    const len = k.es - k.ss, xf = i ? clamp(k.xf ?? 3, 0, Math.min(len, tr[i - 1].len)) : 0;
    const start = i ? tr[i - 1].end - xf : 0;
    tr.push(Object.assign({}, k, {len, xf, start, end: start + len}));
  });
  tr.forEach((k, i) => { k.fi = i ? k.xf : c.fadeIn; k.fo = i < tr.length - 1 ? tr[i + 1].xf : c.fadeOut; });
  return {fade: c.fade, E: t, D: Math.max(t + c.fade, tr.length ? tr[tr.length - 1].end : 0), frames, audio: {tracks: tr}};
}

function textCss(f, G) {
  if (f.t == 'l') return 'left:0;right:0;text-align:center;top:46px;padding-left:.5em';
  const [l, w] = f.x[2] ? [0, G.x0] : [G.xe, W - G.xe];
  return `left:${l}px;width:${w}px;top:0;height:${H}px;display:flex;align-items:center;justify-content:center;` +
    'text-align:center;box-sizing:border-box;padding:0 50px;white-space:normal;line-height:1.1;font-size:84px';
}

function mount(f, i) {
  const el = document.createElement('div'), kids = [], imgs = [], m = {el, kids, imgs, sp: null, decode: []};
  el.className = 'f'; el.style.zIndex = i;
  const add = (n, d) => { el.append(n); kids.push([n, d]); };
  if (f.t == 'title') {
    el.innerHTML = '<div class="title"><i class="sp">✦</i><div class="cap">We are getting married</div></div>';
    kids.push([el.firstChild, 0]); m.sp = el.querySelector('.sp');
    return m;
  }
  const G = geom(f), img = file => { const im = new Image(); im.src = g.fileUrl(file); return im; };
  const its = (f.it || []).map((it, k) => it && [it, G.r[k], k]).filter(Boolean);
  if (f.t == 'p1' && its.length) { // 單張直幅: 背景用同一張照片模糊放大
    const bg = img(its[0][0][0]); bg.className = 'bg'; add(bg, 0); m.decode.push(bg);
    const v = document.createElement('div'); v.className = 'veil'; add(v, 0);
  }
  its.forEach(([it, r, k]) => {
    const im = img(it[0]);
    im.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
    add(im, k * .35); imgs.push(im); m.decode.push(im);
  });
  if (f.x && f.x[0]) {
    const d = document.createElement('div'); d.className = f.x[1]; d.textContent = f.x[0];
    d.style.cssText = textCss(f, G); add(d, .9);
  }
  return m;
}
const sigOf = f => f.t + '|' + JSON.stringify(f.it) + '|' + JSON.stringify(f.x);

function Player(stage, opt = {}) {
  let TL, FR = [], T = 0, playing = false, muted = false, last = 0;
  const live = new Map(), auds = new Map(), api = {}, par = stage.parentElement;
  function fit() {
    const w = par.clientWidth, h = par.clientHeight, s = Math.min(w / W, h / H);
    api.scale = s; stage.style.transform = `translate(${(w - W * s) / 2}px,${(h - H * s) / 2}px) scale(${s})`;
  }
  new ResizeObserver(fit).observe(par); fit();
  const outAt = i => i + 1 < FR.length ? FR[i + 1].a : TL.E;
  const frameAt = t => { let i = FR.length - 1; while (i > 0 && FR[i].a > t) i--; return i; };

  function draw() {
    if (!TL) return;
    const i = frameAt(T), want = new Set([i - 1, i, i + 1, i + 2].filter(k => k >= 0 && k < FR.length)); // 後兩頁先載入
    for (const [k, m] of live) if (!want.has(k)) { m.el.remove(); live.delete(k); }
    for (const k of want) {
      const sig = sigOf(FR[k]);
      if (live.get(k)?.sig === sig) continue;
      live.get(k)?.el.remove();
      const m = mount(FR[k], k); m.sig = sig; stage.append(m.el); live.set(k, m);
    }
    for (const [k, m] of live) {
      const a = FR[k].a, o = outAt(k), vis = T >= a && T < o + TL.fade;
      m.el.style.visibility = vis ? 'visible' : 'hidden';
      if (!vis) continue;
      m.el.style.opacity = 1 - ease(clamp((T - o) / TL.fade));
      for (const [n, d] of m.kids) n.style.opacity = ease(clamp((T - a - d) / TL.fade));
      const s = 1 + .035 * clamp((T - a) / (o + TL.fade - a)); // 緩慢推近
      for (const im of m.imgs) im.style.transform = `scale(${s})`;
      if (m.sp) { const w = .5 - .5 * Math.cos(T * 2 * Math.PI / 3); m.sp.style.opacity = .25 + .75 * w; m.sp.style.transform = `scale(${.8 + .35 * w})`; }
    }
  }
  const clamp1 = x => clamp(x);
  function audioSync() { // 每首歌的音量 = 淡入 × 淡出 × 音量校正, 位置跟著 T 對齊
    if (!TL) return;
    for (const k of TL.audio.tracks) {
      const a = k.a, on = playing && T >= k.start && T < k.end;
      if (!on) {
        if (!a.paused) a.pause();
        if (playing && T < k.start && T > k.start - 1.5 && Math.abs(a.currentTime - k.ss) > .2) a.currentTime = k.ss; // 提早定位
        continue;
      }
      const want = k.ss + T - k.start;
      if (a.paused) { a.currentTime = want; a.play().catch(() => 0); }
      else if (Math.abs(a.currentTime - want) > .3) a.currentTime = want;
      a.volume = muted ? 0 : clamp1(Math.min((T - k.start) / Math.max(k.fi, .01), (k.end - T) / Math.max(k.fo, .01))) * Math.min(1, k.g);
    }
  }
  api.setConfig = cfg => {
    for (const a of auds.values()) a.pause();
    TL = api.TL = compile(cfg); FR = TL.frames;
    TL.audio.tracks.forEach(k => {
      if (!auds.has(k.src)) auds.set(k.src, Object.assign(new Audio(g.fileUrl(k.src)), {preload: 'auto'}));
      k.a = auds.get(k.src);
    });
    T = Math.min(T, TL.D - .01); draw();
  };
  api.seek = t => { T = clamp(t, 0, TL.D - .01); draw(); if (!playing) audioSync(); };
  api.play = () => { last = performance.now(); playing = true; };
  api.pause = () => { playing = false; audioSync(); };
  api.toggle = () => playing ? api.pause() : api.play();
  api.mute = () => (muted = !muted);
  api.frameAt = frameAt;
  Object.defineProperties(api, {T: {get: () => T}, playing: {get: () => playing}, muted: {get: () => muted}});
  api.ready = () => Promise.all([...live.values()].flatMap(m => m.decode).map(im => im.decode().catch(() => 0)));
  function tick(now) {
    if (TL) {
      if (playing) {
        T += (now - last) / 1000;
        if (T >= TL.D) { if (opt.loop) T = 0; else { T = TL.D - .01; api.pause(); } }
      }
      last = now; draw(); audioSync();
    }
    opt.onTick && opt.onTick(T);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  return api;
}
g.Player = Player; g.PlayerLib = {geom, compile, KIND, HS, GAP};
})(window);
