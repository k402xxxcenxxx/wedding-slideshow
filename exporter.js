// 在瀏覽器內把 timeline 輸出成 mp4: Canvas 逐格重畫(和預覽同一套規則) + WebCodecs 編碼 + 自己封裝 mp4。
// 影片分成每 20 秒一段存成暫存檔(使用者資料夾/_slideshow/export/_seg), 中斷後可接續; 時間軸改動時只會重做受影響的段落。
(function (g) {
'use strict';
const W = 1920, H = 1080, SEG_SEC = 20, AUDIO_SR = 48000;
const {geom, compile} = PlayerLib;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = x => x * x * (3 - 2 * x);
const mc = new MessageChannel();
const yieldNow = () => new Promise(r => { mc.port1.onmessage = () => r(); mc.port2.postMessage(0); }); // 背景分頁也不會被節流
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = s => { let c = -1; const b = new TextEncoder().encode(s); for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return ((c ^ -1) >>> 0).toString(16).padStart(8, '0'); };
const b64 = u => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// ================= 畫面 =================
function Renderer(o) {
  const sc = o.scale, cw = Math.round(W * sc), ch = Math.round(H * sc), TL = o.TL, FR = TL.frames, fade = TL.fade;
  const cv = new OffscreenCanvas(cw, ch), ctx = cv.getContext('2d');
  const gv = new OffscreenCanvas(cw, ch), gx = gv.getContext('2d');
  const bgc = new OffscreenCanvas(cw, ch), bx = bgc.getContext('2d');
  bx.setTransform(sc * 960 * Math.SQRT2, 0, 0, sc * 648 * Math.SQRT2, 960 * sc, 432 * sc);
  const gr = bx.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, '#f2efea'); gr.addColorStop(1, '#e3ded6');
  bx.fillStyle = gr; bx.fillRect(-5, -5, 10, 10);
  const layers = new Map(), outAt = k => k + 1 < FR.length ? FR[k + 1].a : TL.E;
  const CAPF = `${34 * sc}px "Cormorant Garamond", Georgia, serif`;

  async function load(k) {
    const f = FR[k], L = {photos: [], bg: null, text: null};
    if (f.t == 'title') return L;
    const {r, x0, xe} = geom(f);
    for (const [i, it] of (f.it || []).entries()) {
      if (!it) continue;
      const blob = await o.loadPhoto(it[0]), big = await createImageBitmap(blob, {resizeWidth: Math.round(r[i].w * 1.035 * sc), resizeHeight: Math.round(r[i].h * 1.035 * sc), resizeQuality: 'high'});
      L.photos.push({bmp: big, r: r[i], i});
      if (f.t == 'p1') { // 單張直幅: 同一張照片模糊放大當背景(CSS: inset -8%, blur 50px saturate .8 brightness 1.1, 再蓋 50% 白紗)
        const sm = await createImageBitmap(blob, {resizeWidth: 480, resizeHeight: Math.round(480 * it[2] / it[1]), resizeQuality: 'medium'});
        const c = new OffscreenCanvas(cw, ch), x = c.getContext('2d'), ew = W * 1.16, eh = H * 1.16, ar = sm.width / sm.height;
        let sw = sm.width, sh = sm.height, sx = 0, sy = 0;
        if (ar > ew / eh) { sw = sh * ew / eh; sx = (sm.width - sw) / 2; } else { sh = sw * eh / ew; sy = (sm.height - sh) / 2; }
        x.filter = `blur(${50 * sc}px) saturate(.8) brightness(1.1)`;
        x.drawImage(sm, sx, sy, sw, sh, -W * .08 * sc, -H * .08 * sc, ew * sc, eh * sc); sm.close(); L.bg = c;
      }
    }
    if (f.x && f.x[0]) L.text = layoutText(f, x0, xe);
    return L;
  }
  function layoutText(f, x0, xe) {
    const txt = f.x[0], side = f.x[2] || 0;
    gx.save();
    let res;
    if (f.t == 'l') {
      gx.font = CAPF; const m = gx.measureText('M');
      res = {kind: 'cap', lines: [[txt.toUpperCase(), (17 + W) / 2, 46 + m.fontBoundingBoxAscent / sc]], font: CAPF, color: '#8b7f70'};
    } else {
      const font = `${84 * sc}px "Great Vibes", cursive`; gx.font = font;
      const l = side ? 0 : xe, w = side ? x0 : W - xe, maxw = (w - 100) * sc, lines = []; let cur = '';
      for (const word of txt.split(/\s+/)) { const t2 = cur ? cur + ' ' + word : word; if (cur && gx.measureText(t2).width > maxw) { lines.push(cur); cur = word; } else cur = t2; }
      lines.push(cur);
      const m = gx.measureText('M'), asc = m.fontBoundingBoxAscent / sc, desc = m.fontBoundingBoxDescent / sc, lh = 84 * 1.1, top = (H - lines.length * lh) / 2;
      res = {kind: 'scr', lines: lines.map((s, i) => [s, l + w / 2, top + i * lh + (lh - asc - desc) / 2 + asc]), font, color: '#b8a272'};
    }
    gx.restore(); return res;
  }
  function drawText(c, tx, alpha) {
    c.save(); c.globalAlpha = alpha; c.font = tx.font; c.fillStyle = tx.color; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.letterSpacing = tx.kind == 'cap' ? `${17 * sc}px` : '0px';
    for (const [s, x, y] of tx.lines) c.fillText(s, x * sc, y * sc);
    c.restore();
  }
  function drawGroup(c, k, T) {
    const f = FR[k], a = f.a, L = layers.get(k).v;
    if (f.t == 'title') {
      const ko = ease(clamp((T - a) / fade)), wv = .5 - .5 * Math.cos(T * 2 * Math.PI / 3);
      const f1 = `${40 * sc}px "Cormorant Garamond", Georgia, serif`;
      c.save(); c.textAlign = 'center'; c.fillStyle = '#8b7f70';
      c.font = f1; const m1 = c.measureText('✦'), h1 = (m1.fontBoundingBoxAscent + m1.fontBoundingBoxDescent) / sc;
      c.font = CAPF; const m2 = c.measureText('M'), h2 = (m2.fontBoundingBoxAscent + m2.fontBoundingBoxDescent) / sc;
      const top = (H - (h1 + 40 + h2)) / 2;
      c.globalAlpha = ko * (.25 + .75 * wv); c.font = f1;
      const s = .8 + .35 * wv, cy = top + h1 / 2;
      c.save(); c.translate(960 * sc, cy * sc); c.scale(s, s); c.fillText('✦', 0, (m1.fontBoundingBoxAscent / sc - h1 / 2) * sc); c.restore();
      c.globalAlpha = ko; c.font = CAPF; c.letterSpacing = `${17 * sc}px`;
      c.fillText('WE ARE GETTING MARRIED', 960 * sc, (top + h1 + 40 + m2.fontBoundingBoxAscent / sc) * sc);
      c.restore(); return;
    }
    const o2 = outAt(k), s = 1 + .035 * clamp((T - a) / (o2 + fade - a));
    if (L.bg) {
      const ko = ease(clamp((T - a) / fade));
      c.globalAlpha = ko; c.drawImage(L.bg, 0, 0);
      c.fillStyle = `rgba(246,243,238,${.5 * ko})`; c.globalAlpha = 1; c.fillRect(0, 0, cw, ch);
    }
    for (const {bmp, r, i} of L.photos) {
      const ko = ease(clamp((T - a - i * .35) / fade)); if (ko <= 0) continue;
      const Ws = r.w * s, Hs = r.h * s, X = r.x + r.w / 2 - Ws / 2, Y = r.y + r.h / 2 - Hs / 2;
      c.save(); c.globalAlpha = ko; c.shadowColor = 'rgba(70,55,40,.16)'; c.shadowBlur = 60 * sc; c.shadowOffsetY = 24 * sc * s;
      c.imageSmoothingQuality = 'high'; c.drawImage(bmp, X * sc, Y * sc, Ws * sc, Hs * sc); c.restore();
    }
    if (L.text) drawText(c, L.text, ease(clamp((T - a - .9) / fade)));
  }
  const visible = T => { const ks = []; FR.forEach((f, k) => { if (f.a <= T && T < outAt(k) + fade) ks.push(k); }); return ks; };
  const ensure = k => { if (!layers.has(k)) { const e = {v: null}; e.p = load(k).then(v => (e.v = v)); layers.set(k, e); } return layers.get(k).p; };
  return {
    canvas: cv, width: cw, height: ch,
    async prepare(T) { // 載入這一刻要畫的頁(含預先載入接下來兩頁)
      const ks = visible(T), last = ks.length ? Math.max(...ks) : 0;
      ensure(last + 1 < FR.length ? last + 1 : last); if (last + 2 < FR.length) ensure(last + 2);
      await Promise.all(ks.map(ensure));
      for (const [k, e] of layers) if (k < Math.min(...ks, last) - 2) { e.v && (e.v.photos.forEach(p => p.bmp.close()), layers.delete(k)); }
    },
    renderAt(T) {
      ctx.globalAlpha = 1; ctx.drawImage(bgc, 0, 0);
      for (const k of visible(T)) {
        const fo = 1 - ease(clamp((T - outAt(k)) / fade));
        if (fo >= .999) drawGroup(ctx, k, T);
        else { gx.clearRect(0, 0, cw, ch); gx.globalAlpha = 1; drawGroup(gx, k, T); ctx.globalAlpha = fo; ctx.drawImage(gv, 0, 0); ctx.globalAlpha = 1; }
      }
      return cv;
    },
  };
}

// ================= MP4 封裝 =================
const te = new TextEncoder();
const cat = (...a) => { let L = 0; for (const x of a) L += x.length; const o = new Uint8Array(L); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const u8 = (...n) => Uint8Array.from(n), u16 = n => u8(n >> 8 & 255, n & 255), u32 = n => u8(n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255);
const u64 = n => cat(u32(Math.floor(n / 4294967296)), u32(n >>> 0));
const box = (t, ...p) => { const b = cat(...p); return cat(u32(8 + b.length), te.encode(t), b); };
const full = (t, v, fl, ...p) => box(t, u8(v, fl >> 16 & 255, fl >> 8 & 255, fl & 255), ...p);
const tbl = (arr, bytes) => { const d = new DataView(new ArrayBuffer(arr.length * bytes)); arr.forEach((v, i) => bytes == 4 ? d.setUint32(i * 4, v) : (d.setUint32(i * 8, Math.floor(v / 4294967296)), d.setUint32(i * 8 + 4, v >>> 0))); return new Uint8Array(d.buffer); };
const runs = arr => { const r = []; for (const v of arr) { if (r.length && r[r.length - 1][1] === v) r[r.length - 1][0]++; else r.push([1, v]); } return r; };
const MATRIX = cat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));

function buildMoov(m) {
  const vdelta = Math.round(90000 / m.fps), vdur = m.vSizes.length * vdelta, aTotal = m.aDurs.reduce((a, b) => a + b, 0);
  const durMs = Math.round(Math.max(vdur / 90000, aTotal / AUDIO_SR) * 1000);
  const stsc = counts => { const e = []; let prev = -1; counts.forEach((c, i) => { if (c !== prev) { e.push(u32(i + 1), u32(c), u32(1)); prev = c; } }); return cat(u32(e.length / 3), ...e); };
  const stbl = (stsd, sttsRuns, stss, counts, sizes, offs) => box('stbl', stsd,
    full('stts', 0, 0, u32(sttsRuns.length), ...sttsRuns.map(([n, d]) => cat(u32(n), u32(d)))),
    ...(stss ? [full('stss', 0, 0, u32(stss.length), tbl(stss, 4))] : []),
    full('stsc', 0, 0, stsc(counts)), full('stsz', 0, 0, u32(0), u32(sizes.length), tbl(sizes, 4)), full('co64', 0, 0, u32(offs.length), tbl(offs, 8)));
  const hdlr = (t, name) => full('hdlr', 0, 0, u32(0), te.encode(t), u32(0), u32(0), u32(0), te.encode(name + '\0'));
  const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
  // 影片
  const avc1 = box('avc1', new Uint8Array(6), u16(1), u16(0), u16(0), new Uint8Array(12), u16(m.W), u16(m.H), u32(0x480000), u32(0x480000), u32(0), u16(1), new Uint8Array(32), u16(0x18), u16(0xFFFF), box('avcC', m.avcC));
  const vtrak = box('trak', full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durMs), new Uint8Array(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(m.W << 16), u32(m.H << 16)),
    box('mdia', full('mdhd', 0, 0, u32(0), u32(0), u32(90000), u32(vdur), u16(0x55c4), u16(0)), hdlr('vide', 'VideoHandler'),
      box('minf', full('vmhd', 0, 1, u16(0), new Uint8Array(6)), dinf, stbl(full('stsd', 0, 0, u32(1), avc1), [[m.vSizes.length, vdelta]], m.vKeys, m.vCounts, m.vSizes, m.vOffs))));
  // 音訊
  let aentry;
  const head = (name, chan = 2) => cat(new Uint8Array(6), u16(1), new Uint8Array(8), u16(chan), u16(16), u16(0), u16(0), u32(AUDIO_SR << 16));
  if (m.aCodec == 'aac') {
    const dcd = cat(u8(0x40, 0x15), u8(0, 0, 0), u32(192000), u32(192000), u8(5, m.asc.length), m.asc);
    const es = cat(u16(0), u8(0), u8(4, dcd.length), dcd, u8(6, 1, 2));
    aentry = box('mp4a', head(), full('esds', 0, 0, u8(3, es.length), es));
  } else {
    const dv = new DataView(m.asc.buffer, m.asc.byteOffset, m.asc.byteLength), pre = m.asc.length >= 12 ? dv.getUint16(10, true) : 312;
    aentry = box('Opus', head(), box('dOps', u8(0, 2), u16(pre), u32(AUDIO_SR), u16(0), u8(0)));
  }
  const atrak = box('trak', full('tkhd', 0, 3, u32(0), u32(0), u32(2), u32(0), u32(durMs), new Uint8Array(8), u16(0), u16(0), u16(0x100), u16(0), MATRIX, u32(0), u32(0)),
    box('mdia', full('mdhd', 0, 0, u32(0), u32(0), u32(AUDIO_SR), u32(aTotal), u16(0x55c4), u16(0)), hdlr('soun', 'SoundHandler'),
      box('minf', full('smhd', 0, 0, u16(0), u16(0)), dinf, stbl(full('stsd', 0, 0, u32(1), aentry), runs(m.aDurs), null, m.aCounts, m.aSizes, m.aOffs))));
  const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durMs), u32(0x10000), u16(0x100), new Uint8Array(10), MATRIX, new Uint8Array(24), u32(3));
  return box('moov', mvhd, vtrak, atrak);
}

// ================= 檔案存取(資料夾控制代碼) =================
function FsIo(root) {
  const split = p => { const a = p.split('/'); return [a.slice(0, -1), a[a.length - 1]]; };
  async function dir(parts, create) { let d = root; for (const n of parts) d = await d.getDirectoryHandle(n, {create}); return d; }
  return {
    async read(p) { const [d, n] = split(p); return (await (await (await dir(d)).getFileHandle(n)).getFile()); },
    async exists(p) { try { await this.read(p); return true; } catch (e) { return false; } },
    async write(p, parts) { const [d, n] = split(p), w = await (await (await dir(d, true)).getFileHandle(n, {create: true})).createWritable(); for (const x of parts) await w.write(x); await w.close(); },
    async writer(p) { const [d, n] = split(p), w = await (await (await dir(d, true)).getFileHandle(n, {create: true})).createWritable(); return {write: x => w.write(x), close: () => w.close()}; },
    async remove(p) { try { const [d, n] = split(p); await (await dir(d)).removeEntry(n); } catch (e) {} },
    async list(p) { try { const out = []; for await (const [n] of (await dir(p.split('/').filter(Boolean))).entries()) out.push(n); return out; } catch (e) { return []; } },
  };
}

// ================= 輸出流程 =================
const EXP = '_slideshow/export', SEGD = EXP + '/_seg';
function makePlan(cfg, o) {
  const TL = compile(cfg), fps = o.fps, Dsec = o.range ? Math.min(o.range, TL.D) : TL.D, total = Math.ceil(Dsec * fps), segN = fps * SEG_SEC, nseg = Math.ceil(total / segN);
  const outAt = k => k + 1 < TL.frames.length ? TL.frames[k + 1].a : TL.E, sigs = [];
  const base = JSON.stringify([o.w, o.h, o.fps, o.bitrate, o.hw, o.src, TL.fade]);
  for (let s = 0; s < nseg; s++) {
    const t0 = s * segN / fps, t1 = Math.min(total, (s + 1) * segN) / fps, fr = [];
    TL.frames.forEach((f, k) => { if (f.a < t1 + .01 && outAt(k) + TL.fade > t0 - .01) fr.push([k, f.a, f.t, f.it, f.x, outAt(k)]); });
    sigs.push(crc32(base + JSON.stringify(fr) + (s == 0 ? 'title' : '')));
  }
  const tracks = TL.tracks || TL.audio.tracks, asig = crc32(JSON.stringify([tracks.map(k => [k.src, k.ss, k.es, k.start, k.fi, k.fo, k.g]), Dsec, o.abitrate || 192000]));
  return {TL, fps, total, segN, nseg, sigs, asig, Dsec, tracks};
}
async function readHeader(io, p) {
  try { const f = await io.read(p), h = new DataView(await f.slice(0, 4).arrayBuffer()).getUint32(0), j = JSON.parse(await f.slice(4, 4 + h).text()); return {j, f, off: 4 + h}; } catch (e) { return null; }
}
async function inspect(io, cfg, o) {
  const P = makePlan(cfg, o); let done = 0;
  for (let s = 0; s < P.nseg; s++) { const h = await readHeader(io, `${SEGD}/v_${String(s).padStart(4, '0')}.bin`); if (h && h.j.sig === P.sigs[s]) done++; }
  const ah = await readHeader(io, `${SEGD}/audio.bin`);
  return {nseg: P.nseg, done, audio: !!(ah && ah.j.sig === P.asig), P};
}

async function encodeAudio(P, io, o, ui, abort) {
  const cands = o.aac === false ? ['opus'] : ['mp4a.40.2', 'opus'];
  let codec = null;
  for (const c of cands) { try { if ((await AudioEncoder.isConfigSupported({codec: c, sampleRate: AUDIO_SR, numberOfChannels: 2, bitrate: 192000})).supported) { codec = c; break; } } catch (e) {} }
  if (!codec) throw new Error('這個瀏覽器不支援音訊編碼(AAC/Opus)');
  if (codec == 'opus') ui.log('⚠ 這個瀏覽器沒有 AAC 編碼, 改用 Opus 音訊(部分播放器如 Windows 媒體播放器可能無法播放)');
  const chunks = []; let asc = null, err = null;
  const enc = new AudioEncoder({output: (c, meta) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push({b, d: Math.round(c.duration * AUDIO_SR / 1e6)}); if (meta && meta.decoderConfig && meta.decoderConfig.description) asc = new Uint8Array(meta.decoderConfig.description); }, error: e => (err = e)});
  enc.configure({codec, sampleRate: AUDIO_SR, numberOfChannels: 2, bitrate: 192000});
  const tracks = P.tracks, WIN = 10, bufs = new Map();
  const decode = async k => { if (!bufs.has(k.src)) { const ab = await (await io.read(k.src)).arrayBuffer(); bufs.set(k.src, await new OfflineAudioContext(2, 1, AUDIO_SR).decodeAudioData(ab)); } return bufs.get(k.src); };
  const envAt = (k, t) => k.g > 0 ? Math.min(1, k.g) * clamp(Math.min(k.fi > 0 ? (t - k.start) / k.fi : 1, k.fo > 0 ? (k.end - t) / k.fo : 1)) : 0;
  for (let w0 = 0; w0 < P.Dsec; w0 += WIN) {
    if (abort()) return null;
    const w1 = Math.min(P.Dsec, w0 + WIN), n = Math.round((w1 - w0) * AUDIO_SR), ctx = new OfflineAudioContext(2, n, AUDIO_SR);
    for (const k of tracks) {
      if (k.end <= w0 || k.start >= w1) { if (k.end <= w0) bufs.delete(k.src); continue; }
      const src = ctx.createBufferSource(), gn = ctx.createGain(); src.buffer = await decode(k); src.connect(gn).connect(ctx.destination);
      const a = Math.max(k.start, w0), b = Math.min(k.end, w1);
      gn.gain.setValueAtTime(envAt(k, a), a - w0);
      for (const bp of [k.start + k.fi, k.end - k.fo]) if (bp > a && bp < b) gn.gain.linearRampToValueAtTime(envAt(k, bp), bp - w0);
      gn.gain.linearRampToValueAtTime(envAt(k, b), b - w0);
      src.start(a - w0, k.ss + (a - k.start), b - a);
    }
    const out = await ctx.startRendering(), data = new Float32Array(n * 2);
    data.set(out.getChannelData(0), 0); data.set(out.getChannelData(1), n);
    const ad = new AudioData({format: 'f32-planar', sampleRate: AUDIO_SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(w0 * 1e6), data});
    enc.encode(ad); ad.close();
    ui.progress(0.04 * (w1 / P.Dsec), `處理音樂 ${Math.round(w1)} / ${Math.round(P.Dsec)} 秒`);
    await yieldNow(); if (err) throw err;
  }
  await enc.flush(); enc.close(); if (err) throw err;
  const hdr = te.encode(JSON.stringify({sig: P.asig, codec: codec == 'opus' ? 'opus' : 'aac', asc: b64(asc), sizes: chunks.map(c => c.b.length), durs: chunks.map(c => c.d)}));
  await io.write(`${SEGD}/audio.bin`, [u32(hdr.length), hdr, ...chunks.map(c => c.b)]);
  return true;
}

async function encodeSegment(P, s, io, o, ui, abort, R) {
  const n0 = s * P.segN, n1 = Math.min(P.total, n0 + P.segN), fps = P.fps, out = [];
  let desc = null, err = null;
  const codec = o.h > 1080 ? 'avc1.640032' : 'avc1.64002A';
  const cfgE = {codec, width: R.width, height: R.height, bitrate: o.bitrate, framerate: fps, avc: {format: 'avc'}, latencyMode: 'quality', hardwareAcceleration: o.hw};
  let sup = await VideoEncoder.isConfigSupported(cfgE); if (!sup.supported) { cfgE.hardwareAcceleration = 'no-preference'; sup = await VideoEncoder.isConfigSupported(cfgE); }
  if (!sup.supported) throw new Error('這個瀏覽器不支援此解析度/幀率的 H.264 編碼');
  const enc = new VideoEncoder({output: (c, meta) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); out.push({key: c.type == 'key', b}); if (meta && meta.decoderConfig && meta.decoderConfig.description) desc = new Uint8Array(meta.decoderConfig.description); }, error: e => (err = e)});
  enc.configure(cfgE);
  for (let n = n0; n < n1; n++) {
    if (abort()) { enc.close(); return false; }
    const T = n / fps; await R.prepare(T); const cvs = R.renderAt(T);
    const vf = new VideoFrame(cvs, {timestamp: Math.round((n - n0) * 1e6 / fps), duration: Math.round(1e6 / fps)});
    enc.encode(vf, {keyFrame: n === n0}); vf.close();
    while (enc.encodeQueueSize > 8) await new Promise(r => enc.addEventListener('dequeue', r, {once: true}));
    if (err) throw err;
    if ((n - n0) % 12 == 0) { ui.progress(null, null, n + 1); await yieldNow(); }
  }
  await enc.flush(); enc.close(); if (err) throw err;
  const hdr = te.encode(JSON.stringify({sig: P.sigs[s], n: out.length, keys: out.map(c => c.key ? 1 : 0), sizes: out.map(c => c.b.length), avcC: desc ? b64(desc) : null}));
  await io.write(`${SEGD}/v_${String(s).padStart(4, '0')}.bin`, [u32(hdr.length), hdr, ...out.map(c => c.b)]);
  return true;
}

async function mux(P, io, o, ui, outName) {
  const ah = await readHeader(io, `${SEGD}/audio.bin`);
  const aSizes = ah.j.sizes, aDurs = ah.j.durs, asc = unb64(ah.j.asc);
  let avcC = null; const segs = [];
  for (let s = 0; s < P.nseg; s++) { const h = await readHeader(io, `${SEGD}/v_${String(s).padStart(4, '0')}.bin`); if (!h || h.j.sig !== P.sigs[s]) throw new Error('暫存段落不完整: ' + s); segs.push(h); avcC = avcC || (h.j.avcC && unb64(h.j.avcC)); }
  // 每一段: 影片 chunk 之後接這一段時間內的音訊 chunk(交錯, 播放器 seek 比較快)
  const aBySeg = Array.from({length: P.nseg}, () => []); let at = 0;
  aSizes.forEach((sz, i) => { const s = Math.min(P.nseg - 1, Math.floor(at / AUDIO_SR / SEG_SEC)); aBySeg[s].push(i); at += aDurs[i]; });
  const vSizes = [], vKeys = [], vCounts = [], vOffs = [], aOffs = [], aCounts = [], aSizesOrdered = [], aDursOrdered = [];
  let pos = 16 + 0; const ftyp = box('ftyp', te.encode('isom'), u32(512), te.encode('isomiso2avc1mp41')); pos += ftyp.length;
  const aStart = []; { let p = 0; aSizes.forEach(s => { aStart.push(p); p += s; }); }
  let payload = 0;
  for (let s = 0; s < P.nseg; s++) {
    const j = segs[s].j; vOffs.push(pos + payload); vCounts.push(j.n); j.sizes.forEach((sz, i) => { vSizes.push(sz); if (j.keys[i]) vKeys.push(vSizes.length); payload += sz; });
    if (aBySeg[s].length) { aOffs.push(pos + payload); aCounts.push(aBySeg[s].length); for (const i of aBySeg[s]) { aSizesOrdered.push(aSizes[i]); aDursOrdered.push(aDurs[i]); payload += aSizes[i]; } }
  }
  const moov = buildMoov({W: o.w, H: o.h, fps: P.fps, avcC, vSizes, vKeys, vCounts, vOffs, aCodec: ah.j.codec, asc, aSizes: aSizesOrdered, aDurs: aDursOrdered, aCounts, aOffs});
  const w = await io.writer(`${EXP}/${outName}`);
  await w.write(ftyp); await w.write(cat(u32(1), te.encode('mdat'), u64(16 + payload)));
  const af = await io.read(`${SEGD}/audio.bin`), abase = 4 + new DataView(await af.slice(0, 4).arrayBuffer()).getUint32(0);
  for (let s = 0; s < P.nseg; s++) {
    await w.write(await segs[s].f.slice(segs[s].off).arrayBuffer());
    for (const i of aBySeg[s]) await w.write(await af.slice(abase + aStart[i], abase + aStart[i] + aSizes[i]).arrayBuffer());
    ui.progress(0.96 + 0.04 * (s + 1) / P.nseg, '封裝 mp4');
  }
  await w.write(moov); await w.close();
  return {size: 16 + payload + ftyp.length + moov.length};
}

async function run(cfg, io, o, ui, abort) {
  const P = makePlan(cfg, o);
  await Promise.all([document.fonts.load('84px "Great Vibes"'), document.fonts.load('34px "Cormorant Garamond"')]).catch(() => 0);
  const ai = await readHeader(io, `${SEGD}/audio.bin`);
  if (!(ai && ai.j.sig === P.asig)) { ui.log('處理音樂…'); const ok = await encodeAudio(P, io, o, ui, abort); if (!ok) return {aborted: true}; }
  const sc = o.w / W;
  const loadPhoto = f => io.read(f);
  const R = Renderer({TL: P.TL, scale: sc, loadPhoto});
  const t0 = performance.now(); let doneFrames = 0, todo = 0;
  const valid = [];
  for (let s = 0; s < P.nseg; s++) { const h = await readHeader(io, `${SEGD}/v_${String(s).padStart(4, '0')}.bin`); valid[s] = !!(h && h.j.sig === P.sigs[s]); if (!valid[s]) todo += Math.min(P.total, (s + 1) * P.segN) - s * P.segN; }
  let curBase = 0;
  const upd = (n) => { // n: 目前這段已完成的格數
    const fin = doneFrames + (n - curBase), el = (performance.now() - t0) / 1000, fpsNow = fin / Math.max(el, .1);
    ui.progress(0.04 + 0.92 * (todo ? fin / todo : 1), `${fin} / ${todo} 格 · ${fpsNow.toFixed(1)} 格/秒 · 剩餘約 ${Math.max(0, Math.round((todo - fin) / Math.max(fpsNow, .1) / 60))} 分鐘`);
  };
  const ui2 = {log: ui.log, progress: (p, t, n) => { if (n != null) upd(n); else ui.progress(p, t); }};
  for (let s = 0; s < P.nseg; s++) {
    if (valid[s]) { ui.segment(s, P.nseg, true); continue; }
    curBase = s * P.segN;
    ui.segment(s, P.nseg, false);
    const ok = await encodeSegment(P, s, io, o, ui2, abort, R);
    if (!ok) return {aborted: true};
    doneFrames += Math.min(P.total, (s + 1) * P.segN) - s * P.segN;
  }
  ui.log('封裝 mp4…');
  const name = o.range ? 'wedding_test.mp4' : 'wedding.mp4', r = await mux(P, io, o, ui, name);
  return {name, size: r.size, seconds: (performance.now() - t0) / 1000};
}

g.Exporter = {run, inspect, FsIo, Renderer, makePlan, buildMoov, crc32, _internals: {box, cat, yieldNow}};
})(window);
