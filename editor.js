const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const {geom, KIND} = PlayerLib, clamp = (x, a, b) => Math.min(b, Math.max(a, x)), r1 = x => Math.round(x * 10) / 10;
const PH = Object.fromEntries(PHOTOS.map(p => [p.f, p]));
const LAYOUTS = {p1: '直 ×1', p2: '直 ×2', p3: '直 ×3', l: '橫 ×1', ll: '橫 ×2', pl: '直 + 橫'};
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------- 狀態 / 復原 ----------
const hashOf = o => { const s = JSON.stringify(o); let h = s.length; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
const BASE = hashOf(window.TL), DRAFT = 'wedding-tl-draft:' + ROOT.name;
let cfg = JSON.parse(JSON.stringify(window.TL)), sel = {k: 'f', i: 1}, slot = null, pps = 16, dirty = false, draftTimer;
try { const d = JSON.parse(localStorage.getItem(DRAFT)); if (d && d.base === BASE) { cfg = d.cfg; dirty = true; } } catch (e) {}
const hist = [], redo = [];
const snap = () => { hist.push(JSON.stringify(cfg)); if (hist.length > 100) hist.shift(); redo.length = 0; };
const commit = fn => { snap(); fn(); changed(); };
function changed() {
  dirty = true; P.setConfig(cfg); renderAll();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { try { localStorage.setItem(DRAFT, JSON.stringify({base: BASE, cfg})); } catch (e) {} }, 500);
}
function undo(a, b) { if (!a.length) return; b.push(JSON.stringify(cfg)); cfg = JSON.parse(a.pop()); sel = null; slot = null; changed(); }

// ---------- 播放器 ----------
let lastFrame = -1;
const P = Player($('#stage'), {onTick: T => {
  $('#tc').textContent = `${mmss(T)} / ${mmss(P.TL.D)}`;
  $('#ph').style.left = T * pps + 'px';
  $('#bplay').textContent = P.playing ? '⏸ 暫停' : '▶ 播放';
  const fi = P.frameAt(T); if (fi !== lastFrame) { lastFrame = fi; updateOverlay(); }
  if (P.playing) { const sc = $('#tlscroll'), x = T * pps; if (x > sc.scrollLeft + sc.clientWidth - 60 || x < sc.scrollLeft) sc.scrollLeft = x - 120; }
}});

// ---------- 舞台上的格子(拖照片進去 / 點選) ----------
function updateOverlay() {
  const ov = $('#ov'); ov.innerHTML = '';
  if (!sel || sel.k != 'f' || P.frameAt(P.T) != sel.i) return;
  const f = cfg.frames[sel.i]; if (f.t == 'title') return;
  geom(f).r.forEach((r, k) => {
    const d = document.createElement('div'), has = f.it && f.it[k];
    d.className = 'slot' + (has ? '' : ' empty') + (slot === k ? ' sel' : '');
    d.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
    d.innerHTML = (has ? '' : '+') + '<div class="x">✕</div>';
    d.onclick = e => { if (e.target.className == 'x') commit(() => { f.it[k] = null; }); else { slot = k; renderAll(); } };
    dropTarget(d, file => assign(sel.i, k, file));
    ov.append(d);
  });
}
function dropTarget(el, fn) {
  el.ondragover = e => { e.preventDefault(); el.classList.add('over'); };
  el.ondragleave = () => el.classList.remove('over');
  el.ondrop = e => { e.preventDefault(); e.stopPropagation(); el.classList.remove('over'); const f = e.dataTransfer.getData('text/plain'); if (PH[f]) fn(f); };
}
function assign(i, k, file) {
  const f = cfg.frames[i], p = PH[file]; if (f.t == 'title') return;
  commit(() => { f.it = Array.from({length: KIND[f.t].length}, (_, j) => f.it && f.it[j] || null); f.it[k] = [p.f, p.w, p.h]; });
  slot = f.it.findIndex(x => !x); if (slot < 0) slot = null; sel = {k: 'f', i}; renderAll();
}
function setLayout(i, t) {
  commit(() => {
    const f = cfg.frames[i]; f.t = t; f.it = Array.from({length: KIND[t].length}, (_, j) => f.it && f.it[j] || null);
    if (t == 'p1' || t == 'l') { if (f.x) f.x[1] = t == 'p1' ? 'scr' : 'cap'; } else delete f.x;
  }); slot = null; renderAll();
}

// ---------- 右側: 檢視 / 照片庫 / 音樂庫 ----------
function renderInspector() {
  const el = $('#insp'); el.innerHTML = '';
  if (!sel) { el.innerHTML = '<h3>屬性</h3><div style="color:var(--mute)">點時間軸上的片段或歌曲來編輯。<br>把照片庫的照片拖到舞台格子或時間軸片段上即可換照片。</div>'; return; }
  if (sel.k == 'f') {
    const f = cfg.frames[sel.i];
    el.innerHTML = `<h3>第 ${sel.i} 頁${f.t == 'title' ? '（開場卡）' : ''}</h3>`;
    if (f.t != 'title') {
      const lay = document.createElement('div'); lay.className = 'lay';
      for (const t in LAYOUTS) {
        const b = document.createElement('button'), g = geom({t}); b.title = LAYOUTS[t]; if (f.t == t) b.className = 'on';
        b.innerHTML = '<i>' + g.r.map(r => `<b style="left:${r.x / 40}px;top:${r.y / 40}px;width:${r.w / 40}px;height:${r.h / 40}px"></b>`).join('') + '</i>';
        b.onclick = () => setLayout(sel.i, t); lay.append(b);
      }
      el.append(lay);
    }
    const row = (lab, inner) => { const d = document.createElement('div'); d.className = 'row'; d.innerHTML = `<label>${lab}</label>`; d.append(inner); el.append(d); return d; };
    const dur = Object.assign(document.createElement('input'), {type: 'number', min: .5, max: 120, step: .1, value: f.d});
    dur.onchange = () => commit(() => { f.d = clamp(+dur.value || f.d, .5, 120); });
    row('秒數', dur);
    if (f.t == 'p1' || f.t == 'l') {
      const tx = Object.assign(document.createElement('input'), {type: 'text', value: f.x ? f.x[0] : '', placeholder: '（無文字）'});
      tx.onchange = () => commit(() => { if (tx.value.trim()) f.x = [tx.value.trim(), f.t == 'p1' ? 'scr' : 'cap', f.x ? f.x[2] || 0 : sel.i % 2]; else delete f.x; });
      row('文字', tx);
      if (f.t == 'p1' && f.x) {
        const sd = document.createElement('select'); sd.innerHTML = '<option value="0">文字在右</option><option value="1">文字在左</option>'; sd.value = f.x[2] ? 1 : 0;
        sd.onchange = () => commit(() => { f.x[2] = +sd.value; }); row('位置', sd);
      }
    }
  } else {
    const k = cfg.audio.tracks[sel.i], n = cfg.audio.tracks.length;
    el.innerHTML = `<h3>歌曲 ${sel.i + 1}/${n}</h3><div style="margin-bottom:6px;font-weight:600">${k.name}</div>`;
    const num = (lab, key, min, max, step, dis) => {
      const i = Object.assign(document.createElement('input'), {type: 'number', min, max, step, value: k[key], disabled: !!dis});
      i.onchange = () => commit(() => { k[key] = clamp(+i.value, min, max); if (key == 'ss') k.ss = Math.min(k.ss, k.es - 5); if (key == 'es') k.es = Math.max(k.es, k.ss + 5); });
      const d = document.createElement('div'); d.className = 'row'; d.innerHTML = `<label>${lab}</label>`; d.append(i); el.append(d);
    };
    num('起點(秒)', 'ss', 0, k.dur - 5, .1); num('終點(秒)', 'es', 5, k.dur, .1);
    if (sel.i) num('銜接(秒)', 'xf', 0, 20, .1);
    num('音量校正', 'g', 0, 1, .01);
    const rm = document.createElement('button'); rm.textContent = '移出時間軸'; rm.disabled = n < 2;
    rm.onclick = () => commit(() => { cfg.audio.tracks.splice(sel.i, 1); sel = null; });
    el.append(rm);
  }
}
const usage = () => { const c = {}; cfg.frames.forEach(f => (f.it || []).forEach(x => x && (c[x[0]] = (c[x[0]] || 0) + 1))); return c; };
let filt = 'all';
(function buildGrid() {
  const g = $('#grid');
  PHOTOS.forEach(p => {
    const d = document.createElement('div'); d.className = 'ph'; d.dataset.name = p.f; d.draggable = true; d.title = p.f;
    d.innerHTML = `<img loading="lazy" src="${thumbUrl(p.f)}"><em></em>`;
    d.ondragstart = e => e.dataTransfer.setData('text/plain', p.f);
    d.onclick = () => {
      if (!sel || sel.k != 'f' || cfg.frames[sel.i].t == 'title') return;
      const f = cfg.frames[sel.i]; let k = slot; if (k == null) { k = (f.it || []).findIndex(x => !x); if (k < 0) k = (f.it || []).length < KIND[f.t].length ? (f.it || []).length : 0; }
      assign(sel.i, k, p.f);
    };
    g.append(d);
  });
})();
function renderLib() {
  const c = usage();
  $$('#grid .ph').forEach(d => {
    const p = PH[d.dataset.name], n = c[p.f] || 0;
    d.lastChild.textContent = n || ''; d.lastChild.style.display = n ? '' : 'none';
    d.classList.toggle('hide', !(filt == 'all' || (filt == 'u' ? !n : p.o == filt)));
  });
  const ml = $('#mlist'); ml.innerHTML = '';
  const used = new Set(cfg.audio.tracks.map(k => k.src));
  MUSIC.tracks.forEach(m => {
    const d = document.createElement('div'); d.className = 'mi' + (used.has(m.src) ? ' used' : '');
    d.innerHTML = `<span title="${m.name}">${m.name}</span><small>${mmss(m.es - m.ss)}</small>`;
    const b = document.createElement('button'); b.textContent = used.has(m.src) ? '已加入' : '＋ 加入'; b.disabled = used.has(m.src);
    b.onclick = () => commit(() => cfg.audio.tracks.push({name: m.name, src: m.src, dur: m.dur, ss: m.ss, es: m.es, xf: 3, g: +Math.min(1, 10 ** ((MUSIC.target - m.lufs) / 20)).toFixed(4)}));
    d.append(b); ml.append(d);
  });
}
$$('.tabs[data-x],[data-tab]').forEach(b => b.onclick = () => {
  $$('[data-tab]').forEach(x => x.classList.toggle('on', x == b));
  $('#grid').style.display = b.dataset.tab == 'p' ? '' : 'none'; $('#pfilter').style.display = b.dataset.tab == 'p' ? '' : 'none';
  $('#mlist').style.display = b.dataset.tab == 'm' ? '' : 'none';
});
$$('#pfilter [data-f]').forEach(b => b.onclick = () => { filt = b.dataset.f; $$('#pfilter [data-f]').forEach(x => x.classList.toggle('on', x == b)); renderLib(); });

// ---------- 時間軸 ----------
const clipEls = new Map(), laneP = $('#lane-p'), laneM = $('#lane-m');
const sigF = f => f.t + JSON.stringify(f.it) + !!f.x;
function makeSegs(el, f) {
  el.querySelectorAll('.seg,.tag').forEach(x => x.remove());
  const n = f.t == 'title' ? 0 : KIND[f.t].length; let warn = false;
  for (let k = 0; k < n; k++) {
    const s = document.createElement('div'); s.className = 'seg'; s.dataset.s = k;
    const it = f.it && f.it[k];
    if (it) { const im = new Image(); im.draggable = false; im.src = thumbUrl(it[0]); s.append(im); } else warn = true;
    dropTarget(s, file => assign(+el.dataset.i, k, file));
    el.insertBefore(s, el.querySelector('.rz'));
  }
  el.classList.toggle('warn', warn);
  if (f.x) { const t = document.createElement('div'); t.className = 'tag'; t.textContent = 'Aa'; el.append(t); }
}
function renderPhotoLane() {
  const used = new Set();
  P.TL.frames.forEach((tf, i) => {
    const f = cfg.frames[i]; used.add(f);
    let el = clipEls.get(f);
    if (!el) {
      el = document.createElement('div'); el.className = 'clip' + (f.t == 'title' ? ' title' : '');
      el.innerHTML = '<div class="rz"></div>' + (f.t == 'title' ? '開場' : ''); laneP.append(el); clipEls.set(f, el); el._sig = null;
    }
    el.dataset.i = i; el.style.left = tf.a * pps + 'px'; el.style.width = Math.max(6, tf.d * pps - 3) + 'px';
    el.classList.toggle('sel', !!sel && sel.k == 'f' && sel.i == i);
    const sg = sigF(f); if (el._sig !== sg) { el._sig = sg; if (f.t != 'title') makeSegs(el, f); }
    el.querySelectorAll('.seg').forEach(s => s.classList.toggle('sel', !!sel && sel.k == 'f' && sel.i == i && slot === +s.dataset.s));
  });
  for (const [f, el] of clipEls) if (!used.has(f)) { el.remove(); clipEls.delete(f); }
}
const COL = ['#ead9b8', '#d3e2d6', '#e3d3dc', '#d3dbe8'];
function renderMusicLane() {
  laneM.querySelectorAll('.blk,.xf').forEach(x => x.remove());
  P.TL.audio.tracks.forEach((k, i) => {
    const b = document.createElement('div'); b.className = 'blk' + (sel && sel.k == 't' && sel.i == i ? ' sel' : ''); b.dataset.i = i;
    b.style.cssText = `left:${k.start * pps}px;width:${k.len * pps}px;top:${i % 2 ? 68 : 22}px;background:${COL[i % COL.length]}`;
    b.innerHTML = `<div class="h hl"></div>${k.name}<small>${mmss(k.ss)}–${mmss(k.es)} · ${k.len.toFixed(0)}秒</small><div class="h hr"></div>`;
    laneM.append(b);
    if (i) {
      const x = document.createElement('div'); x.className = 'xf'; x.dataset.i = i; x.title = '拖曳調整與上一首的漸弱漸強銜接長度';
      x.style.cssText = `left:${k.start * pps}px;width:${Math.max(34, k.xf * pps)}px;top:46px`; x.textContent = k.xf.toFixed(1) + 's'; laneM.append(x);
    }
  });
}
function renderRuler() {
  const D = P.TL.D, step = [5, 10, 30, 60, 120, 300].find(s => s * pps >= 80) || 600, r = $('#ruler');
  r.innerHTML = ''; $('#tlin').style.width = (D + 20) * pps + 'px';
  for (let t = 0; t <= D; t += step) { const s = document.createElement('span'); s.style.left = t * pps + 'px'; s.textContent = mmss(t); r.append(s); }
}
function renderAll() { renderInspector(); renderPhotoLane(); renderMusicLane(); renderRuler(); renderLib(); updateOverlay(); $('#bundo').disabled = !hist.length; $('#bredo').disabled = !redo.length; $('#bsave').textContent = '儲存' + (dirty ? ' •' : ''); $('#status').textContent = dirty ? '有未儲存的變更' : '已儲存'; }

// ---------- 滑鼠拖曳 ----------
function drag(e, move, end) {
  const x0 = e.clientX, y0 = e.clientY; let moved = false;
  const mv = ev => { if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return; if (!moved) { moved = true; document.body.classList.add('dragging'); } move(ev, ev.clientX - x0); };
  const up = ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); document.body.classList.remove('dragging'); end && end(moved, ev); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); e.preventDefault();
}
const tAt = ev => (ev.clientX - $('#tlin').getBoundingClientRect().left) / pps;
const seekDrag = e => { P.seek(tAt(e)); drag(e, ev => P.seek(tAt(ev))); };
$('#ruler').onpointerdown = seekDrag;

laneP.addEventListener('pointerdown', e => {
  const c = e.target.closest('.clip'); if (!c) return seekDrag(e);
  const i = +c.dataset.i, f = cfg.frames[i], seg = e.target.closest('.seg');
  if (e.target.classList.contains('rz')) { // 拖右緣 = 調整秒數
    const d0 = f.d; let pushed = false;
    return drag(e, (ev, dx) => { if (!pushed) { snap(); pushed = true; } f.d = clamp(r1(d0 + dx / pps), .5, 120); changed(); });
  }
  if (i == 0) { sel = {k: 'f', i}; slot = null; renderAll(); return P.seek(0.5), e.preventDefault(); }
  const bounds = () => P.TL.frames.map(x => x.a).concat(P.TL.E), ins = $('#ins'); let to = i;
  drag(e, ev => { // 拖曳整個片段 = 調換順序
    const t = tAt(ev), bs = bounds(); to = 1; bs.forEach((b, j) => { if (j >= 1 && Math.abs(b - t) < Math.abs(bs[to] - t)) to = j; });
    ins.style.display = 'block'; ins.style.left = bs[to] * pps + 'px';
  }, moved => {
    ins.style.display = 'none';
    if (moved) { if (to != i && to != i + 1) commit(() => { const [x] = cfg.frames.splice(i, 1); cfg.frames.splice(to > i ? to - 1 : to, 0, x); sel = {k: 'f', i: to > i ? to - 1 : to}; }); slot = null; }
    else { sel = {k: 'f', i}; slot = seg ? +seg.dataset.s : null; renderAll(); P.seek(P.TL.frames[i].a + Math.min(f.d - .05, 2.4)); }
  });
});
laneM.addEventListener('pointerdown', e => {
  const x = e.target.closest('.xf'), b = e.target.closest('.blk');
  if (!x && !b) return seekDrag(e);
  const i = +(x || b).dataset.i, k = cfg.audio.tracks[i], tk = P.TL.audio.tracks[i];
  let pushed = false; const once = () => { if (!pushed) { snap(); pushed = true; } };
  if (x) { const x0 = k.xf ?? 3; return drag(e, (ev, dx) => { once(); k.xf = clamp(r1(x0 - dx / pps), 0, Math.min(20, tk.len, P.TL.audio.tracks[i - 1].len)); changed(); }); }
  if (e.target.classList.contains('hl') || e.target.classList.contains('hr')) {
    const left = e.target.classList.contains('hl'), v0 = left ? k.ss : k.es;
    return drag(e, (ev, dx) => { once(); if (left) k.ss = clamp(r1(v0 + dx / pps), 0, k.es - 5); else k.es = clamp(r1(v0 + dx / pps), k.ss + 5, k.dur); sel = {k: 't', i}; changed(); });
  }
  const all = P.TL.audio.tracks; let to = i;
  drag(e, (ev, dx) => { // 拖曳整首 = 調換順序
    b.style.transform = `translateX(${dx}px)`; b.style.zIndex = 9; const t = tAt(ev);
    to = all.filter((o, j) => j != i && o.start + o.len / 2 < t).length;
  }, moved => {
    if (moved) { if (to != i) commit(() => { const [y] = cfg.audio.tracks.splice(i, 1); cfg.audio.tracks.splice(to, 0, y); sel = {k: 't', i: to}; }); else renderAll(); }
    else { sel = {k: 't', i}; renderAll(); }
  });
});

// ---------- 按鈕 / 鍵盤 / 縮放 / 儲存 ----------
$('#bplay').onclick = () => P.toggle();
$('#bfull').onclick = () => $('#pv').requestFullscreen();
$('#bundo').onclick = () => undo(hist, redo); $('#bredo').onclick = () => undo(redo, hist);
function newFrame(f) { commit(() => { const i = sel && sel.k == 'f' ? sel.i + 1 : cfg.frames.length; cfg.frames.splice(i, 0, f); sel = {k: 'f', i}; slot = null; }); }
$('#badd').onclick = () => newFrame({d: 3.6, t: 'p1', it: [null]});
$('#bdup').onclick = () => { if (sel && sel.k == 'f' && sel.i) newFrame(JSON.parse(JSON.stringify(cfg.frames[sel.i]))); };
function delSel() {
  if (!sel) return;
  if (sel.k == 'f' && sel.i) commit(() => { cfg.frames.splice(sel.i, 1); sel = {k: 'f', i: Math.min(sel.i, cfg.frames.length - 1)}; });
  else if (sel.k == 't' && cfg.audio.tracks.length > 1) commit(() => { cfg.audio.tracks.splice(sel.i, 1); sel = null; });
}
$('#bdel').onclick = delSel;
addEventListener('keydown', e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() == 's') { e.preventDefault(); save(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() == 'z' && !typing) { e.preventDefault(); e.shiftKey ? undo(redo, hist) : undo(hist, redo); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() == 'y' && !typing) { e.preventDefault(); undo(redo, hist); }
  else if (typing) return;
  else if (e.key == ' ') { e.preventDefault(); P.toggle(); }
  else if (e.key == 'Delete' || e.key == 'Backspace') delSel();
  else if (e.key == 'ArrowRight') P.seek(P.T + 5);
  else if (e.key == 'ArrowLeft') P.seek(P.T - 5);
});
$('#zoom').value = pps;
function setZoom(v, anchorX) {
  const sc = $('#tlscroll'), t = (sc.scrollLeft + anchorX) / pps; pps = clamp(v, 3, 80); $('#zoom').value = pps;
  renderRuler(); renderPhotoLane(); renderMusicLane(); sc.scrollLeft = t * pps - anchorX;
}
$('#zoom').oninput = e => setZoom(+e.target.value, $('#tlscroll').clientWidth / 2);
$('#tlscroll').addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); setZoom(pps * (e.deltaY < 0 ? 1.15 : .87), e.clientX - $('#tlscroll').getBoundingClientRect().left); }, {passive: false});

function serialize() {
  const j = o => JSON.stringify(o);
  return `{"fade":${cfg.fade},"fadeIn":${cfg.fadeIn},"fadeOut":${cfg.fadeOut},\n"frames":[\n${cfg.frames.map(j).join(',\n')}\n],\n"audio":{"tracks":[\n${cfg.audio.tracks.map(j).join(',\n')}\n]}}\n`;
}
async function save() {
  try {
    await IO.write(TL_PATH, [serialize()]);
    dirty = false; try { localStorage.removeItem(DRAFT); } catch (e) {} renderAll(); $('#status').textContent = '已儲存 ✓';
  } catch (e) { $('#status').textContent = '儲存失敗：' + e.message; }
}
$('#bsave').onclick = save;
$('#bimport').onclick = () => $('#fimport').click();
$('#fimport').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const r = SlideshowLib.fixPaths(SlideshowLib.parseTimeline(await file.text()), PHOTOS, MUSIC);
    commit(() => { cfg = r.tl; sel = null; slot = null; }); // 可以用「復原」回到匯入前
    const miss = [r.miss.photos.length && `${r.miss.photos.length} 張照片（${r.miss.photos.slice(0, 5).join('、')}${r.miss.photos.length > 5 ? '…' : ''}）`,
      r.miss.music.length && `${r.miss.music.length} 首歌（${r.miss.music.join('、')}）`].filter(Boolean);
    alert(miss.length ? `已匯入。這個資料夾裡找不到：\n${miss.join('\n')}\n\n找不到的照片格子會留空，找不到的歌曲已移除。把檔案放進資料夾後重新整理頁面，再匯入一次即可。` : '已匯入，所有照片和歌曲都對應到了。記得按「儲存」。');
  } catch (err) { alert('匯入失敗：' + err.message); }
};
addEventListener('beforeunload', e => { if (dirty) e.preventDefault(); });

P.setConfig(cfg); $('#zoom').value = pps; renderAll(); P.seek(cfg.frames.length > 1 ? P.TL.frames[1].a + 2.4 : 0);
window.__ed = {get cfg() { return cfg; }, P, assign, setLayout};
// ---------- 輸出 mp4 面板 ----------
(() => {
  const $x = id => document.getElementById(id), X = {root: ROOT, io: null, running: false, abort: false, wake: null};
    const opts = () => { const w = +$x('xw').value, [aw, ah] = $x('xar').value.split(':'); return {w, h: Math.round(w * ah / aw / 2) * 2, tag: aw == 16 && ah == 9 ? '' : aw + 'x' + ah, fps: +$x('xfps').value, bitrate: +$x('xbr').value, hw: $x('xhw').value, range: +$x('xrange').value}; };
  const log = t => { const l = $x('xlog'); l.textContent += t + '\n'; l.scrollTop = l.scrollHeight; };
  const prog = (p, t) => { if (p != null) $x('xfill').style.width = Math.round(p * 1000) / 10 + '%'; if (t != null) $x('xtxt').textContent = t; };
  const fmtMB = b => (b / 1048576).toFixed(0) + ' MB';
  async function ensurePerm(ask) {
    if (!X.root) return false;
    let p = await X.root.queryPermission({mode: 'readwrite'});
    if (p != 'granted' && ask) p = await X.root.requestPermission({mode: 'readwrite'});
    return p == 'granted';
  }
  async function refresh() {
    const btn = $x('xgo'), info = $x('xinfo');
    if (X.running) return;
    if (!(await ensurePerm(false))) { info.textContent = '需要重新授權這個資料夾。'; btn.textContent = '授權並開始'; btn.disabled = false; return; }
    try {
      const o = opts(), io = FsIo2(), st = await Exporter.inspect(io, cfg, o), P = st.P, mb = (o.bitrate * P.Dsec / 8 + 192000 * P.Dsec / 8) / 1048576;
      info.innerHTML = `${o.w} × ${o.h} · 長度 ${Math.floor(P.Dsec / 60)} 分 ${Math.round(P.Dsec % 60)} 秒 · ${P.total} 格 · 預估檔案約 ${mb.toFixed(0)} MB<br>` +
        (st.done || st.audio ? `已有暫存：影片 ${st.done}/${st.nseg} 段${st.audio ? '、音樂已處理' : ''}（時間軸或設定有變動的段落會自動重做）` : '尚無暫存，會從頭開始。');
      btn.textContent = st.done == st.nseg && st.audio ? '重新封裝' : st.done || st.audio ? '繼續輸出' : '開始輸出'; btn.disabled = false;
    } catch (e) { info.textContent = '讀取資料夾失敗：' + e.message;btn.disabled = true; }
  }
  const FsIo2 = () => X.io || (X.io = Exporter.FsIo(X.root));
  $x('bexport').onclick = async () => {
    $x('xm').classList.add('on');
    refresh();
  };
  $x('xclose').onclick = () => { if (X.running && !confirm('輸出還在進行中，要中斷並關閉嗎？（已完成的段落會保留，下次可以繼續）')) return; X.abort = true; $x('xm').classList.remove('on'); };
  ['xw', 'xar', 'xfps', 'xbr', 'xhw', 'xrange'].forEach(id => $x(id).onchange = refresh);
  $x('xstop').onclick = () => { X.abort = true; $x('xtxt').textContent = '正在中斷…（會先完成目前這一段）'; };
  $x('xclear').onclick = async () => {
    if (X.running || !confirm('要清除所有輸出暫存嗎？（已輸出完成的 mp4 不會被刪除）')) return;
    const io = FsIo2(); for (const n of await io.list('_slideshow/export/_seg')) await io.remove('_slideshow/export/_seg/' + n);
    prog(0, ''); log('已清除暫存'); refresh();
  };
  $x('xgo').onclick = async () => {
    if (!(await ensurePerm(true))) return refresh();
    X.running = true; X.abort = false; const o = opts(); $x('xlog').textContent = '';
    ['xgo', 'xclear'].forEach(id => $x(id).disabled = true); $x('xstop').style.display = ''; ['xw', 'xar', 'xfps', 'xbr', 'xhw', 'xrange'].forEach(id => $x(id).disabled = true);
    try { X.wake = await navigator.wakeLock.request('screen'); } catch (e) {}
    const snapCfg = JSON.parse(JSON.stringify(cfg));   // 輸出期間以按下當下的內容為準
    try {
      const r = await Exporter.run(snapCfg, FsIo2(), o, {log, progress: prog, segment: (s, n, skip) => log(`第 ${s + 1}/${n} 段${skip ? '（已有暫存，略過）' : ''}`)}, () => X.abort);
      if (r.aborted) { prog(null, '已中斷。按「繼續輸出」會從剩下的段落接續。'); log('已中斷'); }
      else { prog(1, `完成：${ROOT.name}\\_slideshow\\export\\${r.name}（${fmtMB(r.size)}，用時 ${Math.round(r.seconds / 60)} 分鐘）`); log('完成 ✓ ' + r.name); }
    } catch (e) { console.error(e); prog(null, '失敗：' + e.message); log('失敗：' + (e.stack || e.message)); }
    X.running = false; try { X.wake && X.wake.release(); } catch (e) {}
    ['xclear'].forEach(id => $x(id).disabled = false); ['xw', 'xar', 'xfps', 'xbr', 'xhw', 'xrange'].forEach(id => $x(id).disabled = false); $x('xstop').style.display = 'none'; refresh();
  };
  addEventListener('beforeunload', e => { if (X.running) e.preventDefault(); });
})();
