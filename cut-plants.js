/*
 * cut-plants.js — 届いた草の画像 (1枚に何本も並んだシート) を、1本ずつの絵に切り出す道具。
 *
 *   node cut-plants.js            (要 playwright。npm start とは別に、自分でサーバーを立てる)
 *
 * やること:
 *   1. 背景を抜く: 背景の色 (四隅の真ん中の値) からの距離で抜く。60 以下は背景、110 以上は絵。
 *      半透明のふちは、混ざった背景の色を引いて元の色に戻す (C = (P − (1 − a)·B) / a)。
 *      「マゼンタらしさ」で抜くと、紫や桃色の花まで抜けて穴だらけになる (CLAUDE.md の落とし穴)
 *   2. つながった塊ごとに分け、塊の重心がどのマスにあるかで、どの草の絵かを決める
 *      (葉がとなりのマスへはみ出していても切れない)
 *   3. 根元 (いちばん下の画素) を、縦長 4:5 の箱の下から 6% (94%) にそろえて書き出す
 *   4. RECIPES に従って、草ごとの絵を作る (そのまま使う / 色を変える / 光らせる / 組み合わせる)
 *
 * 出力: img/cells/  シートのマスごとの切り出し (確認用)
 *       img/plants/ 草ごとの絵 (looks.js の IMAGES が指す)
 *       img/cells/contact.png  切り出しを並べた見本 (目で確かめる)
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const PORT = 8139;
const OUT_W = 360;   // 絵の箱 (縦長 4:5)。plants.js の W:H と同じ比
const OUT_H = 450;
const BASE = 0.94;   // 根元の高さ (箱の上から)

/** 届いたシート。cols x rows のマスに1本ずつ並んでいる */
const SHEETS = {
  s1: { file: 'img/source/plants-sheet-01.png', cols: 5, rows: 4 },
  s2: { file: 'img/source/plants-sheet-02.png', cols: 5, rows: 4 }
};

/**
 * 草ごとの絵の作り方。cell は [シート, 段 (1〜), 列 (1〜)]。
 *   filter: canvas の filter (色を変える)   glow: まわりににじませる光の色
 *   clean:  背景の色かぶりを除く強さ (0〜1。白い穂が桃色にかぶった草に)
 *   dots:   光の粒 { n, color }            add: 重ねる別の絵 (組み合わせ) [cell, 横のずれ, 大きさ]
 * 仮のものには note を書く (届いたら差し替える)
 */
const RECIPES = {
  chibi_shiba: { cell: ['s1', 4, 2] },
  fusafusa_shiba: { cell: ['s1', 1, 1] },
  konmori_shiba: { cell: ['s1', 1, 2] },
  ougon_shiba: { clean: 0.9, filter: 'hue-rotate(12deg) saturate(0.95)', cell: ['s2', 2, 3], glow: 'rgba(255,205,90,0.35)' },
  mitsuba: { cell: ['s2', 1, 3] },
  yotsuba: { cell: ['s2', 1, 4] },
  itsuba: { cell: ['s2', 1, 5] },
  kouun_clover: { cell: ['s2', 3, 2] },
  tanpopo: { cell: ['s1', 2, 2] },
  watage: { cell: ['s1', 2, 3] },
  kyodai_tanpopo: { cell: ['s2', 3, 4] },
  susuki: { clean: 0.9, cell: ['s2', 2, 1] },
  ooki_susuki: { clean: 0.9, cell: ['s2', 2, 2] },
  ougon_susuki: { clean: 0.9, filter: 'hue-rotate(12deg) saturate(0.95)', cell: ['s2', 2, 4], glow: 'rgba(255,200,80,0.35)' },
  hikaru_kusa: { cell: ['s1', 4, 5], filter: 'hue-rotate(-75deg) saturate(0.9) brightness(1.05)', glow: 'rgba(150,255,170,0.55)', note: '仮: 色を変えて作った' },
  hoshi_kusa: { cell: ['s2', 4, 2] },
  gekkou_kusa: { cell: ['s2', 4, 3] },
  niji_kusa: { cell: ['s2', 4, 4] },
  zassou: { cell: ['s1', 4, 3] },
  mizube_kusa: { clean: 0.9, cell: ['s2', 2, 5] },
  clover_shiba: { cell: ['s2', 3, 1] },
  watage_daigunsei: { cell: ['s1', 2, 3], add: [[['s1', 2, 3], -0.2, 0.8], [['s1', 2, 3], 0.22, 0.85]] },
  ougon_sougen: { clean: 0.9, filter: 'hue-rotate(12deg) saturate(0.95)', cell: ['s2', 3, 5], glow: 'rgba(255,205,90,0.4)' },
  kouun_hikarigusa: { cell: ['s2', 3, 2], filter: 'saturate(1.25) brightness(1.15)', glow: 'rgba(170,255,140,0.75)', dots: { n: 12, color: '#fffbd0' }, note: '仮: 幸運のクローバーを光らせて作った' },
  hotaru_kusa: { cell: ['s2', 4, 1] },
  tanpopo_me: { cell: ['s2', 1, 1] },
  susuki_me: { clean: 0.9, cell: ['s2', 1, 2] },
  hakobe: { cell: ['s1', 4, 1] },
  hinagiku: { cell: ['s1', 3, 1] },
  sumire: { cell: ['s1', 4, 4] },
  wasurenagusa: { cell: ['s1', 3, 4] },
  hotokenoza: { cell: ['s1', 3, 2] },
  oobako: { cell: ['s1', 3, 3] },
  gishigishi: { cell: ['s1', 3, 5] },
  uchuu_kusa: { cell: ['s2', 4, 5] }
};

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200).end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

/** ブラウザの中で動く部分。シートを切り出し、マスごとの絵 (data URL) を返す */
function cutSheetInPage(sheet) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, W, H);
      const px = d.data;
      // 背景の色: 四隅の 12x12 の真ん中の値
      const samples = [];
      for (const [cx, cy] of [[0, 0], [W - 12, 0], [0, H - 12], [W - 12, H - 12]]) {
        for (let yy = 0; yy < 12; yy++) for (let xx = 0; xx < 12; xx++) {
          const p = ((cy + yy) * W + cx + xx) * 4;
          samples.push([px[p], px[p + 1], px[p + 2]]);
        }
      }
      const med = (k) => samples.map((s) => s[k]).sort((a, b) => a - b)[samples.length >> 1];
      const B = [med(0), med(1), med(2)];
      const LO = 60, HI = 110;
      const alpha = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) {
        const p = i * 4;
        const dr = px[p] - B[0], dg = px[p + 1] - B[1], db = px[p + 2] - B[2];
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        const a = dist <= LO ? 0 : dist >= HI ? 1 : (dist - LO) / (HI - LO);
        alpha[i] = a;
        if (a > 0 && a < 1) {
          // 混ざった背景の色を引いて、元の色に戻す
          for (let k = 0; k < 3; k++) px[p + k] = Math.max(0, Math.min(255, (px[p + k] - (1 - a) * B[k]) / a));
        }
        px[p + 3] = Math.round(a * 255);
      }
      // ふちから 2px 以内に残る背景の色かぶり (赤と青が緑より強い分) を除く。
      // 細い穂や綿毛は全体がふちなので、半透明の所だけでは足りない。
      // 花の内側 (ふちから離れた所) には触らないので、紫や桃色の花はそのまま残る
      let edge = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) if (alpha[i] < 0.5) edge[i] = 1;
      for (let pass = 0; pass < 2; pass++) {
        const next = edge.slice();
        for (let i = 0; i < W * H; i++) {
          if (edge[i]) continue;
          if ((i % W > 0 && edge[i - 1]) || (i % W < W - 1 && edge[i + 1]) || (i >= W && edge[i - W]) || (i < W * (H - 1) && edge[i + W])) next[i] = 1;
        }
        edge = next;
      }
      for (let i = 0; i < W * H; i++) {
        if (!edge[i] || alpha[i] === 0) continue;
        const p = i * 4;
        const m = Math.min(px[p], px[p + 2]) - px[p + 1];
        if (m > 0) { px[p] -= m * 0.75; px[p + 2] -= m * 0.75; }
      }
      // つながった塊に分ける (半分より濃い画素で)
      const label = new Int32Array(W * H).fill(-1);
      const comps = [];
      const stack = [];
      for (let i = 0; i < W * H; i++) {
        if (alpha[i] < 0.5 || label[i] >= 0) continue;
        const id = comps.length;
        let n = 0, sx = 0, sy = 0;
        stack.push(i); label[i] = id;
        while (stack.length) {
          const j = stack.pop();
          const jx = j % W, jy = (j / W) | 0;
          n++; sx += jx; sy += jy;
          const nb = [j - 1, j + 1, j - W, j + W];
          for (let q = 0; q < 4; q++) {
            const k = nb[q];
            if (k < 0 || k >= W * H) continue;
            if ((q === 0 && jx === 0) || (q === 1 && jx === W - 1)) continue;
            if (alpha[k] >= 0.5 && label[k] < 0) { label[k] = id; stack.push(k); }
          }
        }
        comps.push({ n: n, cx: sx / n, cy: sy / n });
      }
      // 塊の重心がどのマスにあるか
      const cw = W / sheet.cols, ch = H / sheet.rows;
      const cellOf = comps.map((cp) => cp.n < 12 ? -1 : Math.min(sheet.rows - 1, Math.floor(cp.cy / ch)) * sheet.cols + Math.min(sheet.cols - 1, Math.floor(cp.cx / cw)));
      // 半透明のふち (0 < a < 0.5) は、となりの塊のマスに入れる
      const owner = new Int32Array(W * H).fill(-1);
      for (let i = 0; i < W * H; i++) if (label[i] >= 0) owner[i] = cellOf[label[i]];
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < W * H; i++) {
          if (owner[i] >= 0 || alpha[i] === 0) continue;
          const k = [i - 1, i + 1, i - W, i + W].find((t) => t >= 0 && t < W * H && owner[t] >= 0);
          if (k !== undefined) owner[i] = owner[k];
        }
      }
      x.putImageData(d, 0, 0);
      const out = {};
      for (let cell = 0; cell < sheet.cols * sheet.rows; cell++) {
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (let i = 0; i < W * H; i++) {
          if (owner[i] !== cell || alpha[i] < 0.05) continue;
          const ix = i % W, iy = (i / W) | 0;
          if (ix < x0) x0 = ix; if (ix > x1) x1 = ix; if (iy < y0) y0 = iy; if (iy > y1) y1 = iy;
        }
        if (x1 < 0) continue;
        // そのマスの画素だけを写した絵
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        const one = document.createElement('canvas');
        one.width = bw; one.height = bh;
        const ox = one.getContext('2d');
        const od = ox.createImageData(bw, bh);
        for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
          const i = (y0 + yy) * W + x0 + xx;
          if (owner[i] !== cell) continue;
          const p = i * 4, q = (yy * bw + xx) * 4;
          od.data[q] = px[p]; od.data[q + 1] = px[p + 1]; od.data[q + 2] = px[p + 2]; od.data[q + 3] = px[p + 3];
        }
        ox.putImageData(od, 0, 0);
        out[(Math.floor(cell / sheet.cols) + 1) + '-' + (cell % sheet.cols + 1)] = one.toDataURL('image/png');
      }
      resolve({ cells: out, background: B });
    };
    img.src = sheet.url;
  });
}

/** ブラウザの中で動く部分。切り出した絵から、草ごとの絵を作る */
function buildInPage(args) {
  const { cells, recipes, OUT_W, OUT_H, BASE } = args;
  const load = (src) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = src; });
  const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const PAD = 0.86; // 光をにじませる余白
  /**
   * 絵全体の背景の色かぶりを除く (赤と青が緑より強いぶんを k の割合で引く)。
   * 白いはずの穂が桃色にかぶった草だけに使う。紫や桃色の花の草に使うと花の色まで抜ける
   */
  const clean = (im, k) => {
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const m = Math.min(p[i], p[i + 2]) - p[i + 1];
      if (m > 0) { p[i] -= m * k; p[i + 2] -= m * k; }
    }
    x.putImageData(d, 0, 0);
    return c;
  };
  return (async () => {
    const out = {};
    const contact = [];
    for (const [id, r] of Object.entries(recipes)) {
      const c = document.createElement('canvas');
      c.width = OUT_W; c.height = OUT_H;
      const x = c.getContext('2d');
      const layers = [[r.cell, 0, 1, r.filter]].concat(r.add || []);
      // いちばん大きい絵に合わせて、全体の大きさを決める
      let ims = await Promise.all(layers.map((l) => load(cells[l[0][0] + ':' + l[0][1] + '-' + l[0][2]])));
      if (r.clean) ims = ims.map((im) => clean(im, r.clean));
      const base = ims[0];
      // 組み合わせは横に広がるので、全体が箱に収まるように縮める
      const fit = Math.min((OUT_W * PAD) / base.width, (OUT_H * (BASE - 0.05) * PAD) / base.height);
      const s = r.add ? fit * Math.min(1, 1 / (1 + Math.max(...r.add.map((l) => Math.abs(l[1]) * 2)))) * 1.15 : fit;
      // 組み合わせは奥 (add の後ろの物) から描く。主役は最後に手前へ
      const order = layers.map((l, i) => i).reverse();
      for (const i of order) {
        const [, dx, k, filter] = layers[i];
        const im = ims[i];
        const w = im.width * s * k, h = im.height * s * k;
        x.filter = filter || 'none';
        x.drawImage(im, OUT_W / 2 - w / 2 + dx * OUT_W, OUT_H * BASE - h + (i ? 6 : 0), w, h);
        x.filter = 'none';
      }
      if (r.dots) {
        const rand = rng(id.length * 7919 + id.charCodeAt(0));
        for (let n = 0; n < r.dots.n; n++) {
          const px = OUT_W * (0.18 + rand() * 0.64), py = OUT_H * (0.18 + rand() * 0.55);
          const rr = r.dots.drop ? 2.5 + rand() * 2.5 : 1.5 + rand() * 2.2;
          x.save();
          x.shadowColor = r.dots.color; x.shadowBlur = r.dots.drop ? 0 : 10;
          x.fillStyle = r.dots.color;
          x.beginPath(); x.arc(px, py, rr, 0, Math.PI * 2); x.fill();
          x.restore();
        }
      }
      let final = c;
      if (r.glow) {
        final = document.createElement('canvas');
        final.width = OUT_W; final.height = OUT_H;
        const g = final.getContext('2d');
        g.shadowColor = r.glow; g.shadowBlur = 26; g.drawImage(c, 0, 0);
        g.shadowBlur = 9; g.drawImage(c, 0, 0);
        g.shadowBlur = 0; g.drawImage(c, 0, 0);
      }
      out[id] = final.toDataURL('image/webp', 0.9);
      contact.push([id, final]);
    }
    // 見本: 全部を土色の上に並べる
    const cols = 7, tw = 150, th = 188;
    const sheet = document.createElement('canvas');
    sheet.width = cols * tw; sheet.height = Math.ceil(contact.length / cols) * (th + 18);
    const sx = sheet.getContext('2d');
    sx.fillStyle = '#5a4128'; sx.fillRect(0, 0, sheet.width, sheet.height);
    contact.forEach(([id, cv], i) => {
      const cx = (i % cols) * tw, cy = Math.floor(i / cols) * (th + 18);
      sx.drawImage(cv, cx, cy, tw, th);
      sx.fillStyle = '#fff'; sx.font = '12px sans-serif'; sx.fillText(id, cx + 4, cy + th + 13);
    });
    out.__contact = sheet.toDataURL('image/png');
    return out;
  })();
}

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { console.error('playwright が必要です: npm i -D playwright'); process.exit(1); }
  const server = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/index.html`).catch(() => {});
  fs.mkdirSync(path.join(ROOT, 'img/cells'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'img/plants'), { recursive: true });
  const cells = {};
  for (const [key, sh] of Object.entries(SHEETS)) {
    const res = await page.evaluate(cutSheetInPage, { url: `http://localhost:${PORT}/${sh.file}`, cols: sh.cols, rows: sh.rows });
    console.log(`${sh.file}: 背景の色 rgb(${res.background.join(',')}) / ${Object.keys(res.cells).length} 本`);
    for (const [cell, data] of Object.entries(res.cells)) {
      cells[key + ':' + cell] = data;
      fs.writeFileSync(path.join(ROOT, 'img/cells', key + '-' + cell + '.png'), Buffer.from(data.split(',')[1], 'base64'));
    }
  }
  const built = await page.evaluate(buildInPage, { cells: cells, recipes: RECIPES, OUT_W: OUT_W, OUT_H: OUT_H, BASE: BASE });
  for (const [id, data] of Object.entries(built)) {
    if (id === '__contact') continue;
    fs.writeFileSync(path.join(ROOT, 'img/plants', id + '.webp'), Buffer.from(data.split(',')[1], 'base64'));
  }
  fs.writeFileSync(path.join(ROOT, 'img/cells/contact.png'), Buffer.from(built.__contact.split(',')[1], 'base64'));
  console.log(`草の絵 ${Object.keys(built).length - 1} 枚を img/plants/ に書き出した。見本: img/cells/contact.png`);
  await browser.close();
  server.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
