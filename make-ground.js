/*
 * make-ground.js — 植えた草が背景に埋もれないよう、地面の写真を一段しずめた版を作る道具 (node make-ground.js、要 playwright)。
 * 元の写真 (img/ground.webp) は残し、img/ground-dim.webp に書き出す:
 *   彩度を落とす (背景の緑が草の緑と混ざらない) / 暗くする / ほんの少しぼかす (植えた草だけがくっきり見える)
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = __dirname;
const PORT = 8144;
const SAT = 0.6, DARK = 0.78, BLUR = 1.4;

function inPage(args) {
  const { sat, dark, blur } = args;
  return (async () => {
    const im = new Image(); im.src = '/img/ground.webp'; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d');
    x.filter = `blur(${blur}px)`; x.drawImage(im, 0, 0); x.filter = 'none';
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const g = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
      for (let k = 0; k < 3; k++) p[i + k] = (g + (p[i + k] - g) * sat) * dark;
    }
    x.putImageData(d, 0, 0);
    return { data: c.toDataURL('image/webp', 0.9), w: c.width, h: c.height };
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
  const out = await p.evaluate(inPage, { sat: SAT, dark: DARK, blur: BLUR });
  fs.writeFileSync(path.join(ROOT, 'img/ground-dim.webp'), Buffer.from(out.data.split(',')[1], 'base64'));
  console.log('img/ground-dim.webp', out.w + 'x' + out.h);
  await b.close(); server.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
