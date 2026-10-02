/*
 * make-icon.js — ホーム画面のアイコンを作る道具 (node make-icon.js、要 playwright)。
 * 手もちの絵だけで組む: 地面の写真 (img/ground.webp) の土の所 + 耕した土 + 四つ葉のクローバー。
 * iOS は角を自分で丸めるので、四角いまま透けない絵にする (透けた所は黒く塗られる)。
 * 出力: icon-180.png (apple-touch-icon) / icon-192.png / icon-512.png
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = __dirname;
const PORT = 8143;

function drawInPage() {
  return (async () => {
    const load = async (src) => { const im = new Image(); im.src = src; await im.decode(); return im; };
    const ground = await load('/img/ground.webp');
    const plant = await load('/img/plants/yotsuba.webp');
    const S = 1024;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const x = c.getContext('2d');
    // 地面: 写真の真ん中あたり、草の少ない土の所を正方形に切り取る
    const gw = ground.width * 0.62;
    x.drawImage(ground, ground.width * 0.2, ground.height * 0.42, gw, gw, 0, 0, S, S);
    // 真ん中に目が行くよう、まわりを沈め、左上から光を入れる
    let g = x.createRadialGradient(S * 0.5, S * 0.56, S * 0.18, S * 0.5, S * 0.52, S * 0.75);
    g.addColorStop(0, 'rgba(20,12,4,0)'); g.addColorStop(1, 'rgba(20,12,4,0.62)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    g = x.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, 'rgba(255,240,200,0.22)'); g.addColorStop(0.5, 'rgba(255,240,200,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    // 耕した土
    const t = await load(window.KusaArt.tilled());
    x.drawImage(t, S * 0.14, S * 0.6, S * 0.72, S * 0.3);
    // 影 (右下へ)
    g = x.createRadialGradient(S * 0.56, S * 0.76, 0, S * 0.56, S * 0.76, S * 0.3);
    g.addColorStop(0, 'rgba(10,5,2,0.55)'); g.addColorStop(1, 'rgba(10,5,2,0)');
    x.fillStyle = g; x.beginPath(); x.ellipse(S * 0.56, S * 0.76, S * 0.3, S * 0.12, 0.1, 0, Math.PI * 2); x.fill();
    // 四つ葉: 根元 (絵の 94%) を耕した土の真ん中に
    const pw = S * 0.74, ph = pw * plant.height / plant.width;
    x.drawImage(plant, S / 2 - pw / 2, S * 0.79 - ph * 0.94, pw, ph);
    const out = {};
    for (const n of [180, 192, 512]) {
      const o = document.createElement('canvas'); o.width = n; o.height = n;
      const ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high'; ox.drawImage(c, 0, 0, n, n);
      out[n] = o.toDataURL('image/png');
    }
    return out;
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
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForFunction(() => window.KusaArt);
  const out = await p.evaluate(drawInPage);
  for (const [n, d] of Object.entries(out)) fs.writeFileSync(path.join(ROOT, 'icon-' + n + '.png'), Buffer.from(d.split(',')[1], 'base64'));
  console.log('icon-180.png / icon-192.png / icon-512.png を書き出した');
  await b.close(); server.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
