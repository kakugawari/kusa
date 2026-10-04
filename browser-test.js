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
    // 対象は iPhone 16 Plus だけ (CLAUDE.md の決めごと)。ホーム画面から開いたときの画面 430x932 で見る。
    // playwright が名前を知らなくても動くように、大きさは自分で決める
    const PHONE = { ...(devices['iPhone 16 Plus'] || devices['iPhone 15 Plus'] || devices['iPhone 13']), viewport: { width: 430, height: 932 } };
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
      const msg = document.getElementById('message').getBoundingClientRect();
      const bar = document.getElementById('actions').getBoundingClientRect();
      const out = { plantBottom: r.bottom, boardBottom: msg.bottom, msgTop: bar.top, h: innerHeight };
      app.style.padding = '';
      return out;
    });
    ok(safe.plantBottom <= safe.h - 34, `安全域を入れても「種をまく」が画面に収まる (下端 ${Math.round(safe.plantBottom)} / ${safe.h - 34})`);
    ok(safe.boardBottom <= safe.msgTop, `案内の札が、下の木の板に重ならない (${Math.round(safe.boardBottom)} <= ${Math.round(safe.msgTop)})`);

    // Safari で開くと 100vh はツールバーを隠した高さ (932) で、見えているのは 739 ほど。
    // 画面を 100vh で作っていたときは、下の板が見えない所 (928) まではみ出した。932 の根っこを差し込んで確かめる
    {
      const ctx2 = await browser.newContext({ ...PHONE, viewport: { width: 430, height: 739 } });
      const sp = await ctx2.newPage();
      await sp.goto(URL);
      await sp.waitForFunction(() => window.__app);
      await sp.addStyleTag({ content: 'html, body { height: 932px !important; }' });
      await sp.waitForTimeout(150);
      const r = await sp.evaluate(() => ({ bar: document.getElementById('actions').getBoundingClientRect().bottom, h: innerHeight }));
      ok(r.bar <= r.h, `Safari のツールバーが出ていても、下の板が見えている所に収まる (下端 ${Math.round(r.bar)} / ${r.h})`);
      await ctx2.close();
    }

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
      const board = document.getElementById('board').getBoundingClientRect();
      const bar = document.getElementById('actions').getBoundingClientRect();
      const top = document.getElementById('topbar').getBoundingClientRect();
      const field = getComputedStyle(document.getElementById('field'));
      return { left: board.left, right: board.right, top: board.top, bottom: board.bottom, barTop: bar.top, topBottom: top.bottom,
        h: innerHeight, bg: field.backgroundImage, filters: [field.filter] };
    });
    ok(layout.left >= 0 && layout.right <= 430, `牧場が画面の幅に収まる (${Math.round(layout.left)}〜${Math.round(layout.right)})`);
    ok(layout.bottom <= layout.barTop && layout.top >= layout.topBottom, `牧場が上の札と下の木の板のあいだに収まる (${Math.round(layout.top)}〜${Math.round(layout.bottom)})`);
    ok((layout.bottom - layout.top) / layout.h >= 0.7, `牧場が画面の中で大きい (高さ ${Math.round(layout.bottom - layout.top)}px / 画面 ${layout.h}px)`);
    ok(/ground-dim\.webp/.test(layout.bg), "地面の写真 (しずめた版) を背景に敷いている");
    // 画面全体の層に filter をかけると、合成の演出のたびに塗り直されて遅い端末で重くなった (ぼかしは canvas に焼き込む)
    ok(layout.filters.every((f) => f === 'none'), `背景に filter を使っていない (${layout.filters.join(' / ')})`);
    // 草を植えたマスには耕した土を敷く (まわりの地面の草と見分ける)。空いたマスには敷かない
    await setup({ 0: chibi });
    const tl = await phone.evaluate(() => [0, 1].map((i) => getComputedStyle(document.querySelectorAll('#board .ground')[i]).backgroundImage.slice(0, 15)));
    ok(tl[0].startsWith('url(') && tl[1] === 'none', `植えたマスにだけ耕した土がある (${tl.join(' / ')})`);
    // 数字は札の絵に描かれていない (消してある) ので、上に書いた数字が見えていること
    const nums = await phone.evaluate(() => [document.getElementById('bookCount').textContent, document.getElementById('coins').textContent]);
    ok(/^\d+ \/ \d+$/.test(nums[0]) && /^\d+$/.test(nums[1]), `図鑑とコインの数字が札に出ている (${nums.join(' / ')})`);

    section('草むらと目印');
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
    ok(await phone.evaluate(() => !document.querySelector('#board .plant')), '草はマスの中ではなく、草の層に置いている');

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

    // ------------------------------------------------ 拡大させない / 背景がしずんでいる
    section('拡大させない・背景');
    const zctx = await browser.newContext({ ...PHONE });
    const zp = await zctx.newPage();
    await zp.goto(URL);
    await zp.waitForFunction(() => window.__app);
    const zoom = await zp.evaluate(() => ({
      viewport: document.querySelector('meta[name="viewport"]').content,
      touch: ['#btnPlant', '#btnSell', '#btnBook', '#stage', '#actions'].map((q) => [q, getComputedStyle(document.querySelector(q)).touchAction]),
      field: getComputedStyle(document.getElementById('field')).backgroundImage
    }));
    ok(/user-scalable=no/.test(zoom.viewport) && /maximum-scale=1/.test(zoom.viewport), `viewport で拡大を止めている (${zoom.viewport})`);
    for (const [q, t] of zoom.touch) ok(t === 'manipulation' || t === 'none', `${q} の touch-action が ${t} (ダブルタップ拡大が起きない)`);
    // iOS はピンチ拡大を viewport で止められない。gesturestart を止めている
    const gesture = await zp.evaluate(() => { const e = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(e); return e.defaultPrevented; });
    ok(gesture, 'gesturestart (ピンチ拡大) を止めている');
    // 連打しても、押した回数ぶん反応する (touchend を止めて click を消していない)
    // 新種の発見は札が出て操作を止める (仕様)。連打だけを見たいので、先に全種を発見済みにする
    await zp.evaluate(() => {
      const g = window.Core.createGame();
      for (const sp of window.Core.SPECIES) g.discovered[sp.id] = true;
      window.__app.setGame(g);
    });
    const before = await zp.evaluate(() => window.__app.game().cells.filter(Boolean).length);
    for (let i = 0; i < 5; i++) await zp.locator('#btnPlant').click({ delay: 10 });
    const after = await zp.evaluate(() => window.__app.game().cells.filter(Boolean).length);
    ok(after - before === 5, `「種をまく」を速く5回押すと5つ生える (${before} → ${after})`);
    // 背景は、植えた草より彩度が低くて暗い (草と混ざらない)
    ok(/ground-dim\.webp/.test(zoom.field), `牧場の背景はしずめた版 (${zoom.field.slice(-40)})`);
    await zctx.close();

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
      // iOS は透けた所を黒く塗るので、アイコンは隅まで不透明
      const minAlpha = await desk.evaluate(async (src) => {
        const im = new Image(); im.src = src; await im.decode();
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const x = c.getContext('2d'); x.drawImage(im, 0, 0);
        const a = x.getImageData(0, 0, c.width, c.height).data;
        let m = 255; for (let i = 3; i < a.length; i += 4) m = Math.min(m, a[i]);
        return m;
      }, apple);
      ok(minAlpha === 255, `ホーム画面用アイコンに透けた所が無い (いちばん薄い所 ${minAlpha})`);
      const manifest = await desk.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href'));
      if (manifest) {
        const m = await (await desk.request.get(URL + manifest.replace('./', ''))).json();
        for (const icon of m.icons) {
          ok((await desk.request.get(URL + icon.src.replace('./', ''))).ok(), `manifest のアイコン ${icon.src} が配信される`);
        }
      }
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
