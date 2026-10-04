/*
 * make-ground.js — 地面の写真から、草むら・花・シダを土に置き換えた版を作る道具 (node make-ground.js、要 playwright)。
 *
 * 背景の写真にも草が写っていて、植えた草と混ざって見分けがつかなかった (暗くしてぼかす手は質感が落ちたので捨てた)。
 * そこで写真の質感はそのまま、草の固まっている所だけを、写真自身の土で埋め直す:
 *   1. 葉の緑・紫/青の花・白い花・黄色い花の画素を見つけ、ぼかして「固まり」だけ残す
 *      (土の上の細かい苔は、固まりにならないので残る。落ち葉・小石も残る)
 *   2. 岩 (ROCKS) は守る
 *   3. 固まりを広げてふちをなじませ、土だけの所から切り取った断片で埋める
 *      (周りの色に合う断片を、候補の中から選ぶ。継ぎ目が出にくい)
 * 出力: img/ground-soil.webp。確かめる見本: img/cells/ground-mask.png (赤 = 置き換える所)
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = __dirname;
const PORT = 8144;

/** 守る岩 [中心x, 中心y, 半径x, 半径y] (写真の座標) */
const ROCKS = [[240, 82, 38, 34], [730, 285, 66, 52], [725, 1832, 82, 62]];

/** 色では拾いきれなかった草 (赤い草・細い葉) を、範囲で指定して置き換える [中心x, 中心y, 半径x, 半径y] */
const FORCE = [[797, 890, 78, 104], [92, 1240, 46, 56]];

function inPage(args) {
  const { rocks, force } = args;
  return (async () => {
    const im = new Image(); im.src = '/img/ground.webp'; await im.decode();
    const W = im.width, H = im.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const img = x.getImageData(0, 0, W, H), P = img.data, N = W * H;
    const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

    // 1. 草らしさ
    let s = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = P[i * 4], g = P[i * 4 + 1], b = P[i * 4 + 2], mn = Math.min(r, g, b);
      let v = clamp((g - r - 12) / 25) * (g > b * 1.05 ? 1 : 0);            // 葉の緑
      if (b - g > 14 && r > g * 0.9) v = 1;                                  // 紫の花
      if (b > r + 18 && b > g) v = 1;                                        // 青い花
      if (mn > 178) v = 1;                                                   // 白い花
      if (r > 190 && g > 165 && b < 105) v = 1;                              // 黄色い花
      if (r > 90 && g < r * 0.58) v = 1;                                      // 赤い茎・葉
      s[i] = v;
    }
    // 色で拾えない所は範囲で指定する
    for (const [cx, cy, rx, ry] of force) {
      for (let y = Math.max(0, cy - ry | 0); y < Math.min(H, cy + ry); y++) for (let xx = Math.max(0, cx - rx | 0); xx < Math.min(W, cx + rx); xx++) if (Math.hypot((xx - cx) / rx, (y - cy) / ry) < 1) s[y * W + xx] = 1;
    }
    // 岩は守る
    for (const [cx, cy, rx, ry] of rocks) {
      for (let y = Math.max(0, cy - ry - 6 | 0); y < Math.min(H, cy + ry + 6); y++) for (let xx = Math.max(0, cx - rx - 6 | 0); xx < Math.min(W, cx + rx + 6); xx++) {
        const d = Math.hypot((xx - cx) / rx, (y - cy) / ry);
        if (d < 1.1) s[y * W + xx] *= clamp((d - 0.85) / 0.25);
      }
    }
    // 箱ぼかし (分離できる。半径 r)
    const blur = (src, r) => {
      const tmp = new Float32Array(N), out = new Float32Array(N), k = 2 * r + 1;
      for (let y = 0; y < H; y++) { let a = 0; const o = y * W; for (let xx = -r; xx <= r; xx++) a += src[o + Math.min(W - 1, Math.max(0, xx))]; for (let xx = 0; xx < W; xx++) { tmp[o + xx] = a / k; a += src[o + Math.min(W - 1, xx + r + 1)] - src[o + Math.max(0, xx - r)]; } }
      for (let xx = 0; xx < W; xx++) { let a = 0; for (let y = -r; y <= r; y++) a += tmp[Math.min(H - 1, Math.max(0, y)) * W + xx]; for (let y = 0; y < H; y++) { out[y * W + xx] = a / k; a += tmp[Math.min(H - 1, y + r + 1) * W + xx] - tmp[Math.max(0, y - r) * W + xx]; } }
      return out;
    };
    const smooth = (v, a, b) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
    // 2. 固まりだけ残す (細かい苔は薄まって消える) → 広げてふちをなじませる
    const dense = blur(blur(s, 6), 6);
    const core = new Float32Array(N);
    for (let i = 0; i < N; i++) core[i] = dense[i] > 0.2 ? 1 : 0;
    const M = blur(blur(core, 11), 11);
    for (let i = 0; i < N; i++) M[i] = smooth(M[i], 0.1, 0.55);
    // 土だけの所 (断片を取ってよい所)
    const near = blur(blur(core, 22), 22);

    // 3. 土の断片で埋める。断片は重ねずにそのまま貼る (平均すると質感がぼやける)。
    //    継ぎ目を目立たせないために、(a) 穴の近くの土から取る (色合いが近い)
    //    (b) 貼る前に、すでにある隣の画素 (外側の 8px の枠) とつながりのよい断片を選ぶ
    let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const B = 40, C = 8, WIN = B + 2 * C;
    const orig = new Uint8Array(N);                    // もともと残る所
    for (let i = 0; i < N; i++) orig[i] = M[i] < 0.04 ? 1 : 0;
    const filled = new Uint8Array(N);
    const F = new Uint8ClampedArray(P);
    const isKnown = (i) => orig[i] || filled[i];
    // 断片の候補 (枠ごと切り出す窓の左上): 土だけの所。目立つ落ち葉・明るい石は含めない
    const cand = [];
    for (let t = 0; t < 200000 && cand.length < 6000; t++) {
      const cx = (rnd() * (W - WIN)) | 0, cy = (rnd() * (H - WIN)) | 0;
      let ok = true, odd = 0, sv = 0;
      for (let yy = 0; yy < WIN && ok; yy += 3) for (let xx = 0; xx < WIN; xx += 3) {
        const i = (cy + yy) * W + cx + xx;
        if (M[i] > 0.06) { ok = false; break; }
        sv += s[i];
        const r = P[i * 4], g = P[i * 4 + 1], bl = P[i * 4 + 2];
        if ((r > 150 && g > 100 && bl < 90) || Math.min(r, g, bl) > 130) odd++;
      }
      if (ok && odd <= 4 && sv / 361 < 0.09) cand.push([cx, cy]);
    }
    const used = new Uint16Array(cand.length);
    const order = [];
    for (let by = 0; by < H; by += B) for (let bx = 0; bx < W; bx += B) {
      let m = 0;
      for (let yy = 0; yy < B; yy += 4) for (let xx = 0; xx < B; xx += 4) { const X = bx + xx, Y = by + yy; if (X < W && Y < H && !orig[Y * W + X]) m++; }
      if (m > 0) order.push([bx, by]);
    }
    const done = new Uint8Array(order.length);
    for (let pass = 0; pass < 14; pass++) {
      const score = order.map(([bx, by], k) => {
        if (done[k]) return -1;
        let kn = 0, un = 0;
        for (let yy = -C; yy < B + C; yy += 3) for (let xx = -C; xx < B + C; xx += 3) { const X = bx + xx, Y = by + yy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; if (isKnown(Y * W + X)) kn++; else un++; }
        return un === 0 ? -1 : kn / (kn + un);
      });
      const floor = pass < 13 ? 0.25 : 0;
      const idx = order.map((_, k) => k).filter((k) => score[k] >= floor).sort((a, b) => score[b] - score[a]);
      for (const k of idx) {
        const [bx, by] = order[k];
        // 近い候補だけから選ぶ (遠い土は明るさが違う)
        // 近い候補だけから選ぶ (遠い土は明るさが違う)。足りなければ範囲を広げる
        let near2 = [];
        for (const rad of [380, 520, 700, 1000, 3000]) {
          near2 = [];
          for (let q = 0; q < cand.length; q++) if (Math.hypot(cand[q][0] - bx, cand[q][1] - by) < rad) near2.push(q);
          if (near2.length >= 150) break;
        }
        const tries = [];
        for (let t = 0; t < 200; t++) {
          const q = near2[(rnd() * near2.length) | 0];
          const [sx, sy] = cand[q];
          let e = 0, n = 0;
          for (let yy = 0; yy < WIN; yy += 2) for (let xx = 0; xx < WIN; xx += 2) {
            const X = bx - C + xx, Y = by - C + yy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
            const i = Y * W + X; if (!isKnown(i)) continue;
            const j = ((sy + yy) * W + sx + xx) * 4;
            const dr = F[i * 4] - P[j], dg = F[i * 4 + 1] - P[j + 1], db = F[i * 4 + 2] - P[j + 2];
            e += dr * dr + dg * dg + db * db; n++;
          }
          tries.push([(n ? e / n : rnd() * 1000) * (1 + 0.9 * used[q]), sx, sy, q]);
        }
        tries.sort((u, v) => u[0] - v[0]);
        const [, sx, sy, qq] = tries[(rnd() * 3) | 0];   // 上位から選ぶ。使った断片は選びにくくする (同じ断片が並ばない)
        used[qq]++;
        for (let yy = 0; yy < B; yy++) for (let xx = 0; xx < B; xx++) {
          const X = bx + xx, Y = by + yy; if (X >= W || Y >= H) continue;
          const i = Y * W + X; if (isKnown(i)) continue;
          const j = ((sy + C + yy) * W + sx + C + xx) * 4;
          F[i * 4] = P[j]; F[i * 4 + 1] = P[j + 1]; F[i * 4 + 2] = P[j + 2];
          filled[i] = 1;
        }
        done[k] = 1;
      }
    }
    let unknownLeft = 0; for (let i = 0; i < N; i++) if (!orig[i] && !filled[i] && M[i] > 0.3) unknownLeft++;
    const out = F;
    // 4. なじませる: 元の絵とふちで混ぜる
    const res = x.createImageData(W, H);
    for (let i = 0; i < N; i++) {
      const m = M[i];
      for (let k = 0; k < 3; k++) res.data[i * 4 + k] = P[i * 4 + k] * (1 - m) + out[i * 4 + k] * m;
      res.data[i * 4 + 3] = 255;
    }
    x.putImageData(res, 0, 0);
    // 見本: 置き換える所を赤で
    const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
    const mx = mc.getContext('2d'); mx.drawImage(im, 0, 0);
    const md = mx.getImageData(0, 0, W, H);
    for (let i = 0; i < N; i++) { md.data[i * 4] = md.data[i * 4] * (1 - 0.6 * M[i]) + 255 * 0.6 * M[i]; md.data[i * 4 + 1] *= 1 - 0.6 * M[i]; md.data[i * 4 + 2] *= 1 - 0.6 * M[i]; }
    mx.putImageData(md, 0, 0);
    let covered = 0; for (let i = 0; i < N; i++) if (M[i] > 0.5) covered++;
    return { data: c.toDataURL('image/webp', 0.92), mask: mc.toDataURL('image/png'), w: W, h: H, covered: covered / N, cand: cand.length, unknownLeft };
  })();
}

async function main() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200).end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(PORT, r));
  const { chromium } = require('playwright');
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto(`http://localhost:${PORT}/index.html`).catch(() => {});
  const out = await p.evaluate(inPage, { rocks: ROCKS, force: FORCE });
  fs.mkdirSync(path.join(ROOT, 'img/cells'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'img/ground-soil.webp'), Buffer.from(out.data.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(ROOT, 'img/cells/ground-mask.png'), Buffer.from(out.mask.split(',')[1], 'base64'));
  console.log('img/ground-soil.webp', out.w + 'x' + out.h, '置き換えた割合', (out.covered * 100).toFixed(1) + '%', '断片の候補', out.cand, '埋まらなかった画素', out.unknownLeft);
  await b.close(); server.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
