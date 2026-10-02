/*
 * cut-ui.js — 届いたボタンのシート (背景マゼンタ) から、画面の部品を切り出す道具。
 *
 *   node cut-ui.js   (要 playwright)
 *
 * やること:
 *   1. 背景を色の距離で抜く (cut-plants.js と同じ。60 以下は透明、110 以上は絵)
 *   2. PARTS の四角の中で、絵のある範囲だけを切り出す
 *   3. 描かれている数字 (図鑑の数・コイン) は遊ぶと変わるので消す (erase)。
 *      消す所は、その行の左右の色をなめらかにつないで埋める (地のグラデーションを残すため)
 * 出力: img/ui/<名前>.webp と、確かめる見本 img/cells/ui-contact.png
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = __dirname;
const PORT = 8141;
const SHEET = 'img/source/ui-sheet-01.png';

/**
 * 部品。rect はシートの中の [x0, y0, x1, y1] (その中で絵のある範囲を切り出す)。
 * erase は消す四角 [x0, y0, x1, y1, 左の色を取る x, 右の色を取る x] (シートの座標)
 */
const PARTS = {
  title: { rect: [40, 150, 640, 410] },
  book: { rect: [660, 190, 1160, 390], erase: [[903, 246, 1097, 306, 900, 1102], [783, 305, 1066, 336, 780, 1072]] },
  coin: { rect: [1165, 180, 1490, 390], erase: [[1304, 254, 1386, 324, 1300, 1300]] },
  bar: { rect: [40, 480, 1500, 830] }
};

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200).end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

function cutInPage(args) {
  const { url, parts } = args;
  return (async () => {
    const im = new Image();
    im.src = url;
    await im.decode();
    const W = im.width, H = im.height;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, W, H);
    const px = d.data;
    // 消す: 行ごとに左右の色をつなぐ (背景を抜く前に。消した所が透けないように)
    Object.values(parts).forEach((part) => (part.erase || []).forEach(([x0, y0, x1, y1, lx, rx]) => {
      for (let y = y0; y <= y1; y++) {
        const L = (y * W + lx) * 4, R = (y * W + rx) * 4;
        for (let xx = x0; xx <= x1; xx++) {
          const t = rx === lx ? 0 : (xx - x0) / (x1 - x0);
          const p = (y * W + xx) * 4;
          // ふち 10px は元の色へなめらかに戻す (埋めた所と元の地のあいだに段を作らない)
          const f = Math.min(1, Math.min(xx - x0, x1 - xx, y - y0, y1 - y) / 10);
          for (let k = 0; k < 3; k++) px[p + k] = px[p + k] * (1 - f) + (px[L + k] * (1 - t) + px[R + k] * t) * f;
        }
      }
    }));
    // 背景の色: 四隅の真ん中の値
    const s = [];
    for (const [cx, cy] of [[0, 0], [W - 10, 0], [0, H - 10], [W - 10, H - 10]]) for (let yy = 0; yy < 10; yy++) for (let xx = 0; xx < 10; xx++) { const p = ((cy + yy) * W + cx + xx) * 4; s.push([px[p], px[p + 1], px[p + 2]]); }
    const B = [0, 1, 2].map((k) => s.map((v) => v[k]).sort((a, b) => a - b)[s.length >> 1]);
    const alpha = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const p = i * 4;
      const dist = Math.hypot(px[p] - B[0], px[p + 1] - B[1], px[p + 2] - B[2]);
      const a = dist <= 60 ? 0 : dist >= 110 ? 1 : (dist - 60) / 50;
      alpha[i] = a;
      if (a > 0 && a < 1) for (let k = 0; k < 3; k++) px[p + k] = Math.max(0, Math.min(255, (px[p + k] - (1 - a) * B[k]) / a));
      px[p + 3] = Math.round(a * 255);
    }
    // ふち 2px に残るマゼンタのかぶりを除く
    let edge = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (alpha[i] < 0.5) edge[i] = 1;
    for (let pass = 0; pass < 2; pass++) {
      const next = edge.slice();
      for (let i = W; i < W * (H - 1); i++) if (!edge[i] && (edge[i - 1] || edge[i + 1] || edge[i - W] || edge[i + W])) next[i] = 1;
      edge = next;
    }
    for (let i = 0; i < W * H; i++) {
      // 部品の下の影 (半透明) はマゼンタに染まっているので、ふちだけでなく半透明の所はすべて除く
      if ((!edge[i] && alpha[i] > 0.9) || alpha[i] === 0) continue;
      const p = i * 4, m = Math.min(px[p], px[p + 2]) - px[p + 1];
      if (m > 0) { px[p] -= m * 0.8; px[p + 2] -= m * 0.8; }
    }
    x.putImageData(d, 0, 0);
    const out = {};
    for (const [name, part] of Object.entries(parts)) {
      const [rx0, ry0, rx1, ry1] = part.rect;
      let a0 = W, b0 = H, a1 = -1, b1 = -1;
      for (let y = ry0; y < ry1; y++) for (let xx = rx0; xx < rx1; xx++) if (alpha[y * W + xx] > 0.05) { a0 = Math.min(a0, xx); b0 = Math.min(b0, y); a1 = Math.max(a1, xx); b1 = Math.max(b1, y); }
      const o = document.createElement('canvas');
      o.width = a1 - a0 + 1; o.height = b1 - b0 + 1;
      o.getContext('2d').drawImage(c, a0, b0, o.width, o.height, 0, 0, o.width, o.height);
      out[name] = { data: o.toDataURL('image/webp', 0.92), box: [a0, b0, a1 + 1, b1 + 1] };
    }
    // 見本: 濃い地の上に並べる
    const sheet = document.createElement('canvas');
    sheet.width = 1500; sheet.height = 640;
    const sx = sheet.getContext('2d');
    sx.fillStyle = '#3d3020'; sx.fillRect(0, 0, 1500, 640);
    let yy = 10, xx = 10;
    for (const [name, v] of Object.entries(out)) {
      const i2 = new Image(); i2.src = v.data; await i2.decode();
      if (xx + i2.width > 1490) { xx = 10; yy += 230; }
      sx.drawImage(i2, xx, yy); xx += i2.width + 20;
    }
    out.__contact = sheet.toDataURL('image/png');
    return out;
  })();
}

async function main() {
  const { chromium } = require('playwright');
  const server = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/index.html`).catch(() => {});
  const out = await page.evaluate(cutInPage, { url: `http://localhost:${PORT}/${SHEET}`, parts: PARTS });
  fs.mkdirSync(path.join(ROOT, 'img/ui'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'img/cells'), { recursive: true });
  for (const [name, v] of Object.entries(out)) {
    if (name === '__contact') continue;
    fs.writeFileSync(path.join(ROOT, 'img/ui', name + '.webp'), Buffer.from(v.data.split(',')[1], 'base64'));
    console.log(name, 'シートの', v.box.join(','), '→ 幅', v.box[2] - v.box[0], '高さ', v.box[3] - v.box[1]);
  }
  fs.writeFileSync(path.join(ROOT, 'img/cells/ui-contact.png'), Buffer.from(out.__contact.split(',')[1], 'base64'));
  await browser.close();
  server.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
