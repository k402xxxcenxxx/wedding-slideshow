// 開啟流程: 使用者選資料夾 → 掃描照片/音樂(分析結果與縮圖快取在 資料夾/_slideshow/) → 讀取或自動產生時間軸 → 載入編輯器。
// 取代原本的 build_timeline.py(ffmpeg 分析)與 photos.js / music.js / timeline.js。全部在瀏覽器內完成, 檔案不會上傳。
(function (g) {
'use strict';
const DIR = '_slideshow', LIB = DIR + '/library.json', TLP = DIR + '/timeline.json', THUMB = DIR + '/thumbs/';
const IMG = /\.(jpe?g|png|webp)$/i, AUD = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
// 自動排版參數(和 build_timeline.py 相同)
const SEC = 3.6, FADE = 1.4, TITLE = 4.0, XF = 3.0, FADE_IN = 1.5, FADE_OUT = 3.0, SILENCE_DB = -50, STRIDE = 3, SCENE_GAP = 15 * 60;
const SCR = ['Our Wedding', 'Happy Ever After', 'Two hearts, one soul', 'Forever begins today'];
const CAP = ['We are getting married', 'Thank you for being here', 'Love · Laughter · Happily ever after'];
const PORTRAIT_CYCLE = ['p3', 'p2', 'p1', 'p2'];
const $ = id => document.getElementById(id);
const msg = (t, err) => { $('smsg').textContent = t; $('smsg').classList.toggle('err', !!err); };
const bar = p => { $('sprog').style.display = p == null ? 'none' : 'block'; $('sfill').style.width = (p || 0) * 100 + '%'; };
const r3 = x => Math.round(x * 1000) / 1000;
const byName = (a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'});
const kv = (m, k, v) => new Promise((res, rej) => { const q = indexedDB.open('wedding-editor', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onerror = () => rej(q.error);
  q.onsuccess = () => { const t = q.result.transaction('kv', m == 'get' ? 'readonly' : 'readwrite'), st = t.objectStore('kv'), r = m == 'get' ? st.get(k) : st.put(v, k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }; });

// ---------- 掃描 ----------
async function walk(dir, pre, out) {
  for await (const [n, h] of dir.entries()) {
    if (n[0] == '.' || n[0] == '_') continue; // 略過 _slideshow 等工具資料夾與隱藏檔
    if (h.kind == 'directory') await walk(h, pre + n + '/', out);
    else if (IMG.test(n) || AUD.test(n)) out.push([pre + n, await h.getFile()]);
  }
  return out;
}
const sigOf = f => f.size + ':' + f.lastModified;
const thumbPath = rel => THUMB + rel.replace(/\//g, '__') + '.jpg';

async function analyzePhoto(file) {
  const bmp = await createImageBitmap(file); // 預設會套用 EXIF 旋轉, 和 <img> 顯示一致
  const w = bmp.width, h = bmp.height, s = Math.min(1, 360 / Math.max(w, h)), c = new OffscreenCanvas(Math.round(w * s), Math.round(h * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  // shortcut: 取檔頭第一個 EXIF 日期字串當拍攝時間(相機原檔通常就是拍攝時間), 只用來分場景; 不準時所有照片會在同一場景
  const head = new TextDecoder('latin1').decode(await file.slice(0, 65536).arrayBuffer());
  const m = /(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(head);
  const time = m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 : 0;
  return {meta: {w, h, time}, thumb: await c.convertToBlob({type: 'image/jpeg', quality: .8})};
}

function loudnessOf(chs, sr) { // ITU-R BS.1770 integrated loudness(輸入需已 K-weighting)
  const step = Math.round(sr * .1), n = chs[0].length, ms = [];
  for (let i = 0; i + step <= n; i += step) { let s = 0; for (const c of chs) for (let k = i; k < i + step; k++) s += c[k] * c[k]; ms.push(s / step); }
  const L = z => -0.691 + 10 * Math.log10(z), blocks = [];
  for (let i = 0; i + 4 <= ms.length; i++) blocks.push((ms[i] + ms[i + 1] + ms[i + 2] + ms[i + 3]) / 4);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const g1 = blocks.filter(z => L(z) > -70); if (!g1.length) return -70;
  const rel = L(mean(g1)) - 10, g2 = g1.filter(z => L(z) > rel);
  return L(mean(g2.length ? g2 : g1));
}
async function analyzeAudio(file) {
  const buf = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await file.arrayBuffer());
  const sr = buf.sampleRate, n = buf.length, dur = buf.duration, chs = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i));
  // 頭尾靜音(低於 SILENCE_DB 且超過 0.3 秒)剪掉, 同 ffmpeg silencedetect=d=0.3
  const win = Math.round(sr * .05), nw = Math.floor(n / win), thr = 10 ** (SILENCE_DB / 10);
  const loud = i => { let s = 0; for (const c of chs) for (let k = i * win; k < (i + 1) * win; k++) s += c[k] * c[k]; return s / (win * chs.length) > thr; };
  let a = 0; while (a < nw && !loud(a)) a++;
  let b = nw; while (b > a && !loud(b - 1)) b--;
  const ss = a * .05 >= .3 ? Math.max(0, a * .05 - .05) : 0, es = dur - b * .05 >= .3 ? Math.min(dur, b * .05 + .1) : dur;
  // K-weighting 濾波後算 LUFS, 用來把每首歌音量對齊
  const ctx = new OfflineAudioContext(chs.length, n, sr), src = ctx.createBufferSource(), hs = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
  hs.type = 'highshelf'; hs.frequency.value = 1681.97; hs.gain.value = 4;
  hp.type = 'highpass'; hp.frequency.value = 38.13; hp.Q.value = 20 * Math.log10(.5); // Web Audio 的 highpass Q 以 dB 表示
  src.buffer = buf; src.connect(hs).connect(hp).connect(ctx.destination); src.start();
  const kb = await ctx.startRendering();
  const lufs = loudnessOf([...Array(kb.numberOfChannels)].map((_, i) => kb.getChannelData(i)), sr);
  return {dur, ss, es, lufs: Math.round(lufs * 100) / 100};
}

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({length: n}, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

async function scan(io, root) {
  msg('讀取資料夾…'); bar(0);
  const files = await walk(root, '', []), lib = await io.read(LIB).then(f => f.text()).then(JSON.parse).catch(() => ({photos: {}, music: {}}));
  const imgs = files.filter(([n]) => IMG.test(n)).sort((a, b) => byName(a[0], b[0])), auds = files.filter(([n]) => AUD.test(n)).sort((a, b) => byName(a[0], b[0]));
  if (!imgs.length) throw new Error('這個資料夾（含子資料夾）裡找不到照片（jpg / png / webp）。');
  const out = {photos: {}, music: {}}, thumbs = new Map(), total = imgs.length + auds.length * 8; let done = 0, fails = [];
  const tick = t => { msg(t); bar(done / total); };
  await pool(imgs, 3, async ([rel, file]) => {
    const c = lib.photos[rel];
    let th = c && c.sig == sigOf(file) && await io.read(thumbPath(rel)).catch(() => null);
    if (th) out.photos[rel] = c;
    else {
      try { const r = await analyzePhoto(file); out.photos[rel] = {sig: sigOf(file), ...r.meta}; await io.write(thumbPath(rel), [r.thumb]); th = r.thumb; }
      catch (e) { fails.push(rel); }
    }
    if (th) thumbs.set(rel, th);
    done++; tick(`整理照片 ${done} / ${imgs.length}`);
  });
  for (const [rel, file] of auds) {
    const c = lib.music[rel];
    tick(`分析音樂：${rel}`);
    if (c && c.sig == sigOf(file)) out.music[rel] = c;
    else { try { out.music[rel] = {sig: sigOf(file), ...await analyzeAudio(file)}; } catch (e) { fails.push(rel); } }
    done += 8; bar(done / total);
  }
  await io.write(LIB, [JSON.stringify(out)]);
  return {files: new Map(files), lib: out, thumbs, fails};
}

// ---------- 自動排版(由 build_timeline.py 移植) ----------
function oneRound(scenes, st) {
  const out = [];
  for (const ps0 of scenes) {
    const ps = []; for (let off = 0; off < STRIDE; off++) for (let i = off; i < ps0.length; i += STRIDE) ps.push(ps0[i]); // 錯開取用, 避免連拍並排
    const P = ps.filter(p => p.o == 'p'), L = ps.filter(p => p.o == 'l');
    while (P.length || L.length) {
      const k = st.k++; let t;
      if (L.length && (!P.length || k % 4 == 3)) { const turn = st.lt++; t = turn % 3 == 1 && P.length ? 'pl' : turn % 3 == 2 && L.length >= 2 ? 'll' : 'l'; }
      else { t = PORTRAIT_CYCLE[st.pi++ % 4]; if (t == 'p3' && P.length < 3) t = 'p2'; if (t == 'p2' && P.length < 2) t = 'p1'; }
      out.push([t, [...PlayerLib.KIND[t]].map(c => (c == 'p' ? P : L).shift())]);
    }
  }
  return out;
}
function autoTimeline(photos, music) {
  const target = Math.min(...music.tracks.map(m => m.lufs));
  const tracks = music.tracks.map(m => ({name: m.name, src: m.src, dur: m.dur, ss: m.ss, es: m.es, xf: XF, g: +Math.min(1, 10 ** ((target - m.lufs) / 20)).toFixed(4)}));
  const by = new Map(); photos.forEach(p => { if (!by.has(p.s)) by.set(p.s, []); by.get(p.s).push(p); });
  const scenes = [...by.keys()].sort((a, b) => a - b).map(k => by.get(k));
  const D = tracks.length ? PlayerLib.compile({fade: FADE, fadeIn: FADE_IN, fadeOut: FADE_OUT, frames: [], audio: {tracks}}).D
    : TITLE + FADE + oneRound(scenes, {k: 0, lt: 0, pi: 0}).length * SEC; // 沒有音樂: 每組照片放一次
  const E = D - FADE, n = Math.max(1, Math.round((E - TITLE) / SEC)), dur = Math.max(1, (E - TITLE) / n);
  const st = {k: 0, lt: 0, pi: 0}, seq = [];
  while (seq.length < n) seq.push(...oneRound(scenes, st)); // 照片不夠填滿就從頭再輪一圈
  const frames = [{d: TITLE, t: 'title'}]; let si = 0, ci = 0;
  seq.slice(0, n).forEach(([t, items], i) => {
    const f = {d: r3(dur), t, it: items.map(p => [p.f, p.w, p.h])};
    if ((i + 1) % 3 == 0 && t == 'p1') { f.x = [SCR[si % SCR.length], 'scr', si % 2]; si++; }
    else if ((i + 1) % 3 == 0 && t == 'l') { f.x = [CAP[ci % CAP.length], 'cap']; ci++; }
    frames.push(f);
  });
  return {fade: FADE, fadeIn: FADE_IN, fadeOut: FADE_OUT, frames, audio: {tracks}};
}

// 時間軸裡的照片/歌曲對應到這個資料夾: 先比完整路徑, 再比檔名(舊版 timeline.js 的路徑不同); 都對不到的清空並計數
function fixPaths(tl, photos, music) {
  const P = new Map(photos.map(p => [p.f, p])), M = new Set(music.tracks.map(m => m.src)), bn = s => s.split('/').pop().toLowerCase();
  const byP = new Map(photos.map(p => [bn(p.f), p.f])), byM = new Map(music.tracks.map(m => [bn(m.src), m.src]));
  const miss = {photos: new Set(), music: []};
  tl.frames.forEach(f => f.it && (f.it = f.it.map(x => {
    if (!x) return null;
    const p = P.get(x[0]) || P.get(byP.get(bn(x[0])));
    if (!p) miss.photos.add(x[0]);
    return p ? [p.f, p.w, p.h] : null;
  })));
  tl.audio.tracks = tl.audio.tracks.filter(k => {
    const s = M.has(k.src) ? k.src : byM.get(bn(k.src));
    if (!s) miss.music.push(k.name || k.src);
    return s && (k.src = s);
  });
  return {tl, miss: {photos: [...miss.photos], music: miss.music}};
}
function parseTimeline(text) { // 接受 timeline.json 或舊版 timeline.js(window.TL = {...};)
  const tl = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  if (!Array.isArray(tl.frames) || !tl.audio || !Array.isArray(tl.audio.tracks)) throw new Error('不是時間軸檔案');
  return tl;
}

// ---------- 開啟 ----------
async function open(root) {
  $('spick').disabled = $('sresume').disabled = true;
  try {
    const io = Exporter.FsIo(root), S = await scan(io, root);
    const photos = []; let s = 0, last = null;
    for (const [rel, m] of Object.entries(S.lib.photos).sort((a, b) => byName(a[0], b[0]))) {
      if (last && m.time && last.time && Math.abs(m.time - last.time) > SCENE_GAP) s++; // 拍攝時間相隔太久 = 新場景
      photos.push({f: rel, w: m.w, h: m.h, o: m.w > m.h ? 'l' : 'p', s}); last = m;
    }
    const mt = Object.entries(S.lib.music).map(([rel, m]) => ({name: rel.split('/').pop().replace(/\.[^.]+$/, ''), src: rel, dur: r3(m.dur), ss: r3(m.ss), es: r3(m.es), lufs: m.lufs}));
    const music = {target: mt.length ? Math.min(...mt.map(m => m.lufs)) : -16, tracks: mt};
    let tl = await io.read(TLP).then(f => f.text()).then(JSON.parse).catch(() => null);
    tl = tl ? fixPaths(tl, photos, music).tl : autoTimeline(photos, music);
    const urls = new Map(), tUrls = new Map(), url = (m, k, b) => m.get(k) || (m.set(k, URL.createObjectURL(b)), m.get(k));
    Object.assign(g, {
      ROOT: root, IO: io, TL_PATH: TLP, PHOTOS: photos, MUSIC: music, TL: tl,
      fileUrl: f => S.files.has(f) ? url(urls, f, S.files.get(f)) : '',
      thumbUrl: f => S.thumbs.has(f) ? url(tUrls, f, S.thumbs.get(f)) : g.fileUrl(f),
    });
    if (S.fails.length) alert('以下檔案無法讀取，已略過：\n' + S.fails.join('\n'));
    bar(null); msg('');
    const sc = document.createElement('script'); sc.src = 'editor.js';
    sc.onload = () => $('start').remove(); document.body.append(sc);
  } catch (e) {
    console.error(e); bar(null); msg('開啟失敗：' + e.message, true);
    $('spick').disabled = $('sresume').disabled = false;
  }
}

if (!g.showDirectoryPicker || !g.VideoEncoder || !g.OffscreenCanvas) {
  msg('這個瀏覽器不支援讀寫本機資料夾或影片編碼，請改用電腦版 Chrome 或 Edge。', true); $('spick').disabled = true;
} else {
  $('spick').onclick = async () => {
    let h; try { h = await showDirectoryPicker({id: 'slideshow', mode: 'readwrite'}); } catch (e) { if (e.name != 'AbortError') msg(e.message, true); return; }
    kv('put', 'root', h).catch(() => 0); open(h);
  };
  kv('get', 'root').then(h => {
    if (!h) return;
    const b = $('sresume'); b.textContent = '繼續上次：' + h.name; b.style.display = '';
    b.onclick = async () => { if ((await h.requestPermission({mode: 'readwrite'})) == 'granted') open(h); };
  }).catch(() => 0);
}
g.SlideshowLib = {open, autoTimeline, oneRound, loudnessOf, analyzeAudio, fixPaths, parseTimeline};
})(window);
