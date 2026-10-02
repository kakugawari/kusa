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
    phone.on('console', (m) => { if (m.type() === 'error') errors.push('スマホ: ' + m.text()); });
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
    const cellSel = (i) => `#board .cell:nth-child(${i + 1})`;
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
    await phone.locator(cellSel(2)).click();
    ok(await phone.evaluate(() => window.__app.selected()) === 2, '1回目のタップで選ぶ');
    await phone.locator(cellSel(9)).click();
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
    await phone.locator(cellSel(6)).click();
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
