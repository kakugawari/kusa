/*
 * ブラウザで実際に動かして確かめるテスト。
 *
 *   npm i -D playwright && npm run test:ui
 *
 * 画面まわりの不具合は node のテストでは捕まらない。ここでは本物の
 * ブラウザを立ち上げ、指の操作をそのまま再現して確かめる。
 *
 * ★ アプリを作ったら「ここにアプリごとの確認を足す」に書き足すこと。
 *   直した不具合には、かならず見張り役をここに置く。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const PORT = Number(process.env.PORT || 8123);
const URL = `http://localhost:${PORT}/`;
const ROOT = __dirname;
const CHROMIUM = process.env.CHROMIUM_PATH;   // 手元の Chromium を使いたいとき

let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + message);
  } else {
    failed++;
    console.log('  \x1b[31m✗ FAIL\x1b[0m ' + message);
  }
}

function skip(message) {
  console.log('  \x1b[90m- とばした: ' + message + '\x1b[0m');
}

function section(name) {
  console.log('\n' + name);
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http.get(URL, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - started > 10000) reject(new Error('サーバーが起動しない'));
          else setTimeout(tick, 100);
        });
    };
    tick();
  });
}

/**
 * 何かした直後に、その要素が本来の場所からどれだけずれるかを
 * 1 フレームずつ測る。「置いた瞬間に一瞬とぶ」たぐいの不具合はこれで見つかる。
 *
 * @returns {Promise<number>} 最大のずれ (px)
 */
function measureJump(page, selector, act) {
  return page.evaluate(async ({ sel, code }) => {
    const before = document.querySelector(sel).getBoundingClientRect();
    // eslint-disable-next-line no-new-func
    new Function(code)();
    let worst = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const el = document.querySelector(sel);
      if (!el) { worst = Infinity; break; }
      const now = el.getBoundingClientRect();
      worst = Math.max(worst, Math.abs(now.left - before.left), Math.abs(now.top - before.top));
    }
    return Math.round(worst);
  }, { sel: selector, code: act });
}

async function run() {
  let chromium;
  let devices;
  try {
    ({ chromium, devices } = require('playwright'));
  } catch (e) {
    console.error('playwright が必要です:  npm i -D playwright');
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(PORT)], {
    stdio: 'ignore'
  });
  await waitForServer();

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  try {
    // ------------------------------------------------ スマホで開く
    // 対象は iPhone 16 Plus だけ (CLAUDE.md の決めごと)。playwright が名前を知らなければ同じ大きさで代える。
    const PHONE = devices['iPhone 16 Plus'] || devices['iPhone 15 Plus'] ||
      { ...devices['iPhone 13'], viewport: { width: 430, height: 932 } };
    section('スマホで開く (' + PHONE.viewport.width + 'x' + PHONE.viewport.height + ')');
    const context = await browser.newContext({ ...PHONE });
    const phone = await context.newPage();
    phone.on('pageerror', (e) => errors.push('スマホ: ' + e.message));
    // 外部の書体 (Google Fonts) が読めない環境もある。読めなくても端末の書体で出るので、その失敗だけは数えない
    const fontHost = /fonts\.(googleapis|gstatic)\.com/;
    phone.on('requestfailed', () => {});
    phone.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (fontHost.test((m.location() && m.location().url) || '')) return;
      errors.push('スマホ: ' + m.text());
    });
    await phone.goto(URL);
    await phone.waitForFunction(() => window.__app);
    ok(true, 'ページが開いて、画面のしくみが立ち上がる');

    const fit = await phone.evaluate(() => ({
      wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      title: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : ''
    }));
    ok(fit.wide <= 1, 'スマホ幅で横スクロールが出ない');
    ok(fit.title.length > 0, `見出しが出ている (${fit.title})`);

    // 手もとのブラウザは安全域が 0。実機の上59・下34 を差し込んで、下のボタンが画面に収まるか測る
    const safe = await phone.evaluate(() => {
      const app = document.getElementById('app');
      app.style.padding = '59px 0 34px';
      const r = document.getElementById('btnPlant').getBoundingClientRect();
      const board = document.getElementById('diorama').getBoundingClientRect();
      const msg = document.getElementById('message').getBoundingClientRect();
      const out = { plantBottom: r.bottom, boardBottom: board.bottom + 14, msgTop: msg.top, h: innerHeight };
      app.style.padding = '';
      return out;
    });
    ok(safe.plantBottom <= safe.h - 34, `安全域を入れても「種をまく」が画面に収まる (下端 ${Math.round(safe.plantBottom)} / ${safe.h - 34})`);
    ok(safe.boardBottom <= safe.msgTop, `牧場の台の厚みが、下の案内に重ならない (${Math.round(safe.boardBottom)} <= ${Math.round(safe.msgTop)})`);

    // ------------------------------------------------ kusa の操作
    const ID = (name) => phone.evaluate((n) => window.Core.findByName(n).id, name);
    const chibi = await ID('ちび芝生');
    const fusa = await ID('ふさふさ芝生');
    const mitsu = await ID('三つ葉');

    /** 草を並べた状態から始める。cells は { マス: id }。 */
    async function setup(cells) {
      await phone.evaluate((cs) => {
        const g = window.Core.createGame();
        Object.keys(cs).forEach((i) => window.Core.place(g, Number(i), cs[i]));
        window.__app.setGame(g);
      }, cells);
    }
    async function center(sel) {
      const r = await phone.locator(sel).boundingBox();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    const cellSel = (i) => `#board .cell:nth-child(${i + 1}) .ground`; // マスの根元 (土の面)
    /** マスを指で押す。草の絵が上に重なっているので、要素ではなく画面の位置 (根元) を押す */
    async function tap(i) {
      const p = await center(cellSel(i));
      await phone.mouse.click(p.x, p.y);
    }
    async function idle() { await phone.waitForFunction(() => !window.__app.busy()); }
    async function closeDiscover() {
      if (await phone.locator('#discover').isVisible()) {
        await phone.waitForTimeout(300);
        await phone.locator('#discover').click();
        await phone.waitForFunction(() => document.getElementById('discover').hidden);
      }
      await idle();
    }
    /** 指で運ぶ。via を通ってから離す (盤の外を通る道すじも試せる)。 */
    async function drag(fromSel, toSel, via) {
      const a = await center(fromSel);
      const b = await center(toSel);
      await phone.mouse.move(a.x, a.y);
      await phone.mouse.down();
      if (via) await phone.mouse.move(via.x, via.y, { steps: 6 });
      await phone.mouse.move(b.x, b.y, { steps: 8 });
      await phone.mouse.up();
    }

    const total0 = await phone.evaluate(() => window.Core.SPECIES.length);

    section('種をまく');
    await phone.evaluate(() => { localStorage.clear(); window.__app.setGame(window.Core.createGame()); });
    await phone.locator('#btnPlant').click();
    await phone.locator('#discover').waitFor({ state: 'visible' });
    const planted = await phone.evaluate(() => window.__app.game().cells.filter(Boolean).length);
    ok(planted === 1, `押すと草が1つ生える (${planted})`);
    ok(await phone.locator('#discover').isVisible(), '初めての草なら「発見！」が出る');
    await closeDiscover();
    ok((await phone.locator('#bookCount').textContent()).startsWith('1 /'), '図鑑の数が 1 になる');

    section('ドラッグで合成');
    await setup({ 0: chibi, 5: chibi });
    const boardBefore = await phone.locator('#board').boundingBox();
    // 盤の外 (上の帯) を通ってから重ねる。指が外へ出ても見失わないこと
    await drag(cellSel(0), cellSel(5), { x: 215, y: 30 });
    await phone.locator('#discover').waitFor({ state: 'visible' });
    let g = await phone.evaluate(() => window.__app.game().cells.slice());
    ok(g[0] === null && g[5] === fusa, `ちび芝生を重ねると、ふさふさ芝生になる (${g[5]})`);
    ok((await phone.locator('#discoverName').textContent()) === 'ふさふさ芝生', '発見の演出に新しい草の名前が出る');
    await closeDiscover();
    const boardAfter = await phone.locator('#board').boundingBox();
    ok(Math.abs(boardAfter.y - boardBefore.y) < 1, '合成のあとも牧場の位置が変わらない');
    ok(await phone.locator('.ghost').count() === 0, '指についてきた草が残らない');

    await setup({ 0: chibi, 3: chibi });
    await drag(cellSel(0), cellSel(7));
    await idle();
    g = await phone.evaluate(() => window.__app.game().cells.slice());
    ok(g[0] === null && g[7] === chibi && g[3] === chibi, '空きマスへ運ぶと、そこへ動く');

    await setup({ 0: chibi, 1: fusa });
    await drag(cellSel(0), cellSel(1));
    await idle();
    g = await phone.evaluate(() => window.__app.game().cells.slice());
    ok(g[0] === chibi && g[1] === fusa, '合成できない組を重ねても、何も変わらない');
    ok((await phone.locator('#message').textContent()).includes('何も起きなかった'), 'そのことを知らせる');

    section('タップで合成');
    await setup({ 2: chibi, 9: chibi });
    await tap(2);
    ok(await phone.evaluate(() => window.__app.selected()) === 2, '1回目のタップで選ぶ');
    await tap(9);
    await phone.locator('#discover').waitFor({ state: 'visible' });
    g = await phone.evaluate(() => window.__app.game().cells.slice());
    ok(g[2] === null && g[9] === fusa, '2回目のタップで重なる');
    await closeDiscover();

    section('特殊合成');
    await setup({ 0: chibi, 1: mitsu });
    await drag(cellSel(0), cellSel(1));
    await phone.locator('#discover').waitFor({ state: 'visible' });
    ok((await phone.locator('#discoverKicker').textContent()).includes('特殊合成'), '異種の組では「特殊合成で発見！」が出る');
    await closeDiscover();

    section('売る');
    await setup({ 4: fusa });
    const coins0 = await phone.evaluate(() => window.__app.game().coins);
    await drag(cellSel(4), '#btnSell');
    await idle();
    const sold = await phone.evaluate(() => ({ coins: window.__app.game().coins, cell: window.__app.game().cells[4], found: window.__app.game().discovered }));
    ok(sold.cell === null && sold.coins > coins0, `「売る」へ運ぶとコインになる (${coins0} → ${sold.coins})`);
    ok(sold.found[fusa] === true, '売っても図鑑の発見記録は消えない');
    await setup({ 6: chibi });
    await tap(6);
    await phone.locator('#btnSell').click();
    await idle();
    ok(await phone.evaluate(() => window.__app.game().cells[6]) === null, '選んでから「売る」を押しても売れる');

    section('図鑑');
    await setup({ 0: chibi });
    await phone.locator('#btnBook').click();
    ok(await phone.locator('#book').isVisible(), '図鑑が開く');
    const total = await phone.evaluate(() => window.Core.SPECIES.length);
    ok(await phone.locator('#bookList .entry').count() === total, `全種が並ぶ (${total})`);
    const first = await phone.locator('#bookList .entry').first().textContent();
    ok(first.includes('No.001') && first.includes('ちび芝生') && first.includes('発見済み'), '発見した草は名前と「発見済み」');
    const unknown = await phone.locator('#bookList .entry.unknown').first().textContent();
    ok(unknown.includes('???') && unknown.includes('ヒント'), '未発見の草は ??? とヒント');
    await phone.locator('.tab[data-group="rarity"]').click();
    ok((await phone.locator('#bookList .group-title').first().textContent()) === 'ノーマル', 'レア度別に切り替わる');
    await phone.locator(`#bookList .entry[data-id="${chibi}"]`).click();
    ok(await phone.locator('#zoom').isVisible(), '発見した草を押すと拡大表示');
    await phone.locator('#btnZoomClose').click();
    await phone.locator('#btnBookClose').click();
    ok(!(await phone.locator('#book').isVisible()), '図鑑を閉じられる');

    section('ジオラマと草の絵');
    // 背の高い草で盤を埋めた、いちばん重なりの多い状態で見る
    const tall = await phone.evaluate(() => ['ススキ', '月光草', '巨大タンポポ', '黄金のススキ'].map((n) => window.Core.findByName(n).id));
    await setup(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, tall[i % 4]])));
    await phone.waitForTimeout(150);
    const look = await phone.evaluate(() => {
      const imgs = [...document.querySelectorAll('#plants .plant')];
      return {
        count: imgs.length,
        allImg: imgs.every((i) => i.tagName === 'IMG' && i.complete && i.naturalWidth > 0),
        textOnly: document.querySelectorAll('.placeholder, .ph-name').length
      };
    });
    ok(look.count === 16 && look.allImg, `草はどれも植物の絵 (img) で出る (${look.count} 枚)`);
    ok(look.textOnly === 0, '文字だけの四角い表示が無い');

    // 帯のボタンは、奥の草が上へはみ出しても押せる (草の絵の箱がふさいでいた)
    const bars = await phone.evaluate(() => ['#btnBook', '#btnPlant', '#btnSell'].map((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && hit.closest(sel) ? null : sel;
    }).filter(Boolean));
    ok(bars.length === 0, '背の高い草を植えても、上と下のボタンが押せる' + (bars.length ? ' (ふさがれた: ' + bars.join(',') + ')' : ''));

    // どのマスも、根元の土を押せばそのマスが選ばれる (手前の草が奥のマスに重なって見えても)
    const wrong = [];
    for (let i = 0; i < 16; i++) {
      const p = await phone.evaluate((k) => {
        const r = document.querySelectorAll('#board .ground')[k].getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height * 0.75 };
      }, i);
      await phone.mouse.click(p.x, p.y);
      const sel = await phone.evaluate(() => window.__app.selected());
      if (sel !== i) wrong.push(i + '→' + sel);
      await phone.evaluate(() => window.__app.setGame(window.__app.game())); // 選んだのを解く (押し直すと重ねる操作になる)
    }
    ok(wrong.length === 0, '16 マスどれも、根元を押すとそのマスが選ばれる' + (wrong.length ? ' (' + wrong.join(' ') + ')' : ''));

    // 手前の草の、葉の無いすき間を押すと、奥のマスへ通る
    const through = await phone.evaluate(() => {
      const ground = document.querySelectorAll('#board .ground')[1].getBoundingClientRect();
      // 奥のマス (1) の根元の少し上を、手前の草 (5) の絵の箱が覆っているかを探す
      const front = document.querySelectorAll('#plants .plant')[5].getBoundingClientRect();
      return { covered: ground.bottom > front.top, x: ground.left + ground.width / 2, y: ground.top + ground.height * 0.75 };
    });
    ok(through.covered, '手前の草の絵の箱が、奥のマスの根元に重なっている (見張りの前提)');

    // 手前の草の葉の上 (根元ではない所) を押すと、手前の草が選ばれる
    const leafHit = await phone.evaluate(() => {
      const img = document.querySelectorAll('#plants .plant')[5];
      const r = img.getBoundingClientRect();
      const cell = document.querySelectorAll('#board .cell')[5].getBoundingClientRect();
      // 草の真ん中の縦の線をたどり、根元より上で、そのマスの上半分にある点を探す
      const s = window.Core.speciesOf(window.__app.game().cells[5]);
      for (let y = cell.top + 4; y < cell.top + cell.height * 0.5; y += 3) {
        const v = (y - r.top) / r.height;
        if (window.KusaArt.opaqueAt(s, 0.5, v)) return { x: r.left + r.width / 2, y: y };
      }
      return null;
    });
    if (leafHit) {
      await phone.mouse.click(leafHit.x, leafHit.y);
      ok(await phone.evaluate(() => window.__app.selected()) === 5, '草の葉を押すと、その草が選ばれる');
      await phone.evaluate(() => window.__app.setGame(window.__app.game()));
    } else {
      ok(false, '草の葉を押すと、その草が選ばれる (葉のある点が見つからない)');
    }

    // 光が絵の端で四角く切れない: どの草も、絵のふち 2px は透明
    const edges = await phone.evaluate(() => window.Core.SPECIES.filter((s) => {
      const c = window.KusaArt.drawPlant(s);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let worst = 0;
      for (let y = 0; y < c.height; y++) {
        for (const x of [0, 1, c.width - 2, c.width - 1]) worst = Math.max(worst, d[(y * c.width + x) * 4 + 3]);
      }
      for (let x = 0; x < c.width; x++) {
        for (const y of [0, 1]) worst = Math.max(worst, d[(y * c.width + x) * 4 + 3]);
      }
      return worst > 24;
    }).map((s) => s.name));
    ok(edges.length === 0, 'どの草の絵も、左右と上のふちで切れていない' + (edges.length ? ' (' + edges.join(',') + ')' : ''));

    const distinct = await phone.evaluate(() => new Set(window.Core.SPECIES.map((s) => window.KusaArt.url(s))).size);
    ok(distinct === total0, `草ごとに違う絵になっている (${distinct} / ${total0})`);

    const layout = await phone.evaluate(() => {
      const soil = document.getElementById('soil').getBoundingClientRect();
      const front = document.querySelector('.slab-front').getBoundingClientRect();
      const msg = document.getElementById('message').getBoundingClientRect();
      const plants = [...document.querySelectorAll('#plants .plant')].map((e) => e.getBoundingClientRect());
      return { left: soil.left, right: soil.right, frontBottom: front.bottom, msgTop: msg.top,
        boardH: soil.height, plantW: Math.max(...plants.map((p) => p.width)) };
    });
    ok(layout.left >= 0 && layout.right <= 430, `台が画面の幅に収まる (${Math.round(layout.left)}〜${Math.round(layout.right)})`);
    ok(layout.frontBottom <= layout.msgTop, `台の切り口が下の案内に重ならない (${Math.round(layout.frontBottom)} <= ${Math.round(layout.msgTop)})`);
    // 台の下の影に filter: blur を使うと、合成の演出のたびに塗り直されて遅い端末で 30fps に落ちた
    const blur = await phone.evaluate(() => getComputedStyle(document.getElementById('slab'), '::before').filter);
    ok(blur === 'none', `台の影にぼかしの filter を使っていない (${blur})`);
    ok(layout.boardH >= 480, `牧場が画面の中で大きい (土の高さ ${Math.round(layout.boardH)}px)`);

    section('草むらと目印');
    // 飾りの草や苔は、合成用の草の根元 (各マス) に置かない。合成する草と見まちがえないため
    const decor = await phone.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 760; c.height = 1360;
      window.KusaArt.soil(c, 7, { cols: 4, rows: 4, baseY: 0.78 });
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const cw = c.width / 4, ch = c.height / 4;
      let inBase = 0, all = 0;
      for (let y = 0; y < c.height; y += 2) {
        for (let x = 0; x < c.width; x += 2) {
          const p = (y * c.width + x) * 4;
          const green = d[p + 1] > d[p] + 8 && d[p + 1] > d[p + 2] + 20; // 苔・草の緑 (土は赤みが勝つ)
          if (!green) continue;
          all++;
          const col = Math.floor(x / cw), row = Math.floor(y / ch);
          const ex = (x - (col + 0.5) * cw) / (cw * 0.42), ey = (y - (row + 0.78) * ch) / (ch * 0.26);
          if (ex * ex + ey * ey < 1) inBase++;
        }
      }
      return { inBase, all };
    });
    ok(decor.all > 200, `土の上に飾りの苔や小さな草がある (緑の点 ${decor.all})`);
    ok(decor.inBase === 0, `飾りの苔や草が、合成用の草の根元に置かれていない (${decor.inBase})`);

    // 選ぶと、重ねられる相手 (同じ草) のマスが光る。まだ見つけていない特殊合成の相手は光らない
    await setup({ 0: chibi, 9: chibi, 6: mitsu, 3: fusa });
    await phone.evaluate(() => { window.__app.game().recipesFound = {}; });
    const g0 = await phone.evaluate(() => { const r = document.querySelectorAll('#board .ground')[0].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.6 }; });
    await phone.mouse.click(g0.x, g0.y);
    await phone.waitForTimeout(250); // 輪はふわっと出る (0.15 秒)
    const marks = await phone.evaluate(() => [...document.querySelectorAll('#board .cell')].map((c, i) => (c.classList.contains('hint') ? i : -1)).filter((i) => i >= 0));
    ok(marks.length === 1 && marks[0] === 9, `同じ草のマスだけが光る (${marks.join(',')})`);
    const selRing = await phone.evaluate(() => getComputedStyle(document.querySelectorAll('#board .mark')[0]).opacity);
    ok(selRing === '1', '選んだ草のまわりに輪が出る');
    await phone.evaluate(() => window.__app.setGame(window.__app.game()));

    // 背の高い草ほど、影が長い
    await setup({ 0: chibi, 1: tall[0] });
    const hs = await phone.evaluate(() => [0, 1].map((i) => document.querySelectorAll('#board .ground')[i]).map((g) => getComputedStyle(g, '::before').width).map(parseFloat));
    ok(hs[1] > hs[0] * 1.1, `背の高い草ほど影が長い (${Math.round(hs[0])} → ${Math.round(hs[1])}px)`);

    section('奥の列の草が見えている');
    // 3D の台の中で草を動かすと、奥の列の草が土の後ろに回って消えた。
    // 奥の列の草を、出した画面と隠した画面で撮り比べ、画素が変わる (= 見えている) ことを確かめる
    await setup({ 0: chibi, 1: fusa, 2: mitsu, 3: fusa, 5: fusa, 9: chibi });
    await phone.waitForTimeout(300);
    const backVisible = [];
    for (const k of [0, 1, 2, 3]) {
      const box = await phone.evaluate((i) => { const r = document.querySelectorAll('#plants .sprite')[i].getBoundingClientRect(); return { x: r.left, y: r.top + r.height * 0.45, width: r.width, height: r.height * 0.5 }; }, k);
      const shown = await phone.screenshot({ clip: box });
      await phone.evaluate((i) => { document.querySelectorAll('#plants .sprite')[i].style.visibility = 'hidden'; }, k);
      const hidden = await phone.screenshot({ clip: box });
      await phone.evaluate((i) => { document.querySelectorAll('#plants .sprite')[i].style.visibility = ''; }, k);
      const diff = await phone.evaluate(async ([a, b]) => {
        const load = async (s) => { const im = new Image(); im.src = 'data:image/png;base64,' + s; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
        const p = await load(a), q = await load(b);
        let n = 0;
        for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 30) n++;
        return n / (p.length / 4);
      }, [shown.toString('base64'), hidden.toString('base64')]);
      backVisible.push(Math.round(diff * 100));
    }
    ok(backVisible.every((d) => d >= 2), `奥の列の草が、どれも画面に写っている (草が占める割合 ${backVisible.join(' / ')} %)`);
    ok(await phone.evaluate(() => !document.querySelector('#slab .plant')), '草は 3D の台の中に置いていない');

    section('合成の演出');
    await setup({ 4: chibi, 8: mitsu });
    await drag(cellSel(4), cellSel(8));
    await phone.waitForSelector('.halo', { timeout: 2000 }).then(() => ok(true, '特殊合成では、根元から光が広がる'), () => ok(false, '特殊合成では、根元から光が広がる'));
    await phone.locator('#discover').waitFor({ state: 'visible' });
    await closeDiscover();
    const left = await phone.evaluate(() => ({
      fx: document.querySelectorAll('.leaf, .dirt, .mote, .halo, .ghost').length,
      shown: getComputedStyle(document.querySelectorAll('#plants .plant')[0] || document.body).opacity,
      plantOpacity: [...document.querySelectorAll('#plants .plant')].map((p) => getComputedStyle(p).opacity)
    }));
    ok(left.fx === 0, `演出が終わると、葉・土・光の粒が残らない (${left.fx})`);
    ok(left.plantOpacity.length === 1 && left.plantOpacity[0] === '1', '生えた草が見えている (隠したままにならない)');

    section('保存');
    await setup({ 0: fusa, 15: mitsu });
    await phone.evaluate(() => window.__app.saveNow());
    await phone.reload();
    await phone.waitForFunction(() => window.__app);
    g = await phone.evaluate(() => window.__app.game().cells.slice());
    ok(g[0] === fusa && g[15] === mitsu, '開き直しても牧場が残る');

    // ------------------------------------------------ 明るい画面・暗い画面
    section('明るい画面と暗い画面');
    for (const scheme of ['light', 'dark']) {
      const themed = await browser.newContext({ ...PHONE, colorScheme: scheme });
      const page = await themed.newPage();
      page.on('pageerror', (e) => errors.push(scheme + ': ' + e.message));
      await page.goto(URL);
      await page.waitForFunction(() => window.__app);
      const colors = await page.evaluate(() => ({
        bg: getComputedStyle(document.body).backgroundColor,
        fg: getComputedStyle(document.body).color
      }));
      ok(colors.bg !== colors.fg, `${scheme}: 文字と背景の色が違う (${colors.bg} / ${colors.fg})`);
      await themed.close();
    }

    // ------------------------------------------------ アイコン (用意していれば)
    section('アイコン');
    const desk = await browser.newPage();
    await desk.goto(URL);
    const apple = await desk.evaluate(() =>
      document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'));
    if (!apple) {
      skip('ホーム画面用のアイコンはまだ無い (PWA にするときに用意する)');
    } else {
      // iOS は SVG のアイコンを使えない
      ok(apple.endsWith('.png'), `ホーム画面用アイコンが PNG (${apple})`);
      const res = await desk.request.get(URL + apple.replace('./', ''));
      ok(res.ok(), `${apple} が配信される`);
    }

    // ------------------------------------------------ 更新とオフライン (sw.js があれば)
    section('更新とオフライン');
    if (!fs.existsSync(path.join(ROOT, 'sw.js'))) {
      skip('サービスワーカーはまだ無い (オフライン対応するときに用意する)');
    } else {
      const swCtx = await browser.newContext();
      const swPage = await swCtx.newPage();
      await swPage.goto(URL);
      await swPage.waitForFunction(() => window.__app);
      ok(await swPage.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active).catch(() => false)),
        'サービスワーカーが動く');
      await swPage.waitForTimeout(800);

      // 直したものが 1 回のリロードで出るか (キャッシュ優先だと古い画面が出る)
      const indexPath = path.join(ROOT, 'index.html');
      const original = fs.readFileSync(indexPath, 'utf8');
      const marker = original.match(/<h1[^>]*>([^<]*)<\/h1>/);
      fs.writeFileSync(indexPath, original.replace(marker[1], 'こうしんかくにん'));
      await swPage.reload();
      await swPage.waitForTimeout(400);
      const title = await swPage.textContent('h1');
      fs.writeFileSync(indexPath, original);
      ok(title.trim() === 'こうしんかくにん', `直したものが 1 回のリロードで出る (${title.trim()})`);

      await swPage.reload();
      await swPage.waitForTimeout(500);
      await swCtx.setOffline(true);
      await swPage.reload().catch(() => {});
      await swPage.waitForTimeout(400);
      ok(await swPage.evaluate(() => !!window.__app).catch(() => false),
        'ネットにつながらなくても開ける');
      await swCtx.setOffline(false);
    }

    section('エラー');
    ok(errors.length === 0, errors.length ? '画面のエラー: ' + errors.join(' / ') : 'JS エラーなし');
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} 件合格 / ${failed} 件失敗`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
