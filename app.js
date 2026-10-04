/*!
 * app.js — 画面まわり。操作と描画はここに書く。
 *
 * 操作は2通り (初期リリース仕様):
 *   ドラッグ: 草を指で運んで、別の草に重ねる / 空きマスへ動かす / 「売る」へ落とす
 *   タップ:   草を選んでから、重ねたい草・空きマス・「売る」をタップする
 */
(function () {
  'use strict';

  const C = window.Core;
  const SAVE_KEY = 'kusa.save.v1';
  const VERSION = '2026-10-04e'; // 直したら上げる。実機で「届いているか」を確かめるため、図鑑のいちばん下に出す

  const $ = (id) => document.getElementById(id);
  const els = {
    board: $('board'), plants: $('plants'), stage: $('stage'), message: $('message'), coins: $('coins'), bookCount: $('bookCount'), bookMeter: $('bookMeter'),
    btnPlant: $('btnPlant'), btnSell: $('btnSell'), btnBook: $('btnBook'),
    discover: $('discover'), discoverArt: $('discoverArt'), discoverNo: $('discoverNo'), discoverUnlock: $('discoverUnlock'),
    discoverName: $('discoverName'), discoverRarity: $('discoverRarity'), discoverKicker: $('discoverKicker'),
    book: $('book'), bookList: $('bookList'), bookCount2: $('bookCount2'), btnBookClose: $('btnBookClose'),
    zoom: $('zoom'), zoomArt: $('zoomArt'), zoomNo: $('zoomNo'), zoomName: $('zoomName'),
    zoomRarity: $('zoomRarity'), zoomNote: $('zoomNote'), zoomRecipe: $('zoomRecipe'), btnZoomClose: $('btnZoomClose')
  };

  let game = loadGame();
  let knownSeeds = new Set(C.unlockedSpecies(game)); // 種として出る草。増えたら発見の札で知らせる
  let selected = -1;      // タップで選んでいるマス
  let busy = false;       // 演出の最中は操作を受けない
  let group = 'lineage';  // 図鑑の並べ方
  const shown = [];       // マスごとに、いま描いている草の id (変わったマスだけ描き直す)
  const sprites = [];     // マスごとの草の絵 (#plants の層に置く)

  // ---- 保存 (まとめて書く。操作ごとに同期で書かない) ----
  let saveTimer = 0;
  function loadGame() {
    try {
      const text = localStorage.getItem(SAVE_KEY);
      if (text) return C.load(text);
    } catch (e) { /* 読めなければ最初から */ }
    return C.createGame();
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(SAVE_KEY, C.save(game)); } catch (e) { /* 書けなくても遊べる */ }
  }

  // ---- 絵 ----
  // 草の絵は plants.js が core.js の見た目データから描く (届いた画像があればそれを使う)。

  function plantImg(id, cls) {
    const s = C.speciesOf(id);
    const img = document.createElement('img');
    img.className = cls || '';
    img.src = window.KusaArt.url(s);
    img.alt = s.name;
    img.draggable = false;
    return img;
  }

  /** 図鑑や発見の札に草の絵を入れる。 */
  function drawArt(el, id) {
    el.textContent = '';
    el.appendChild(plantImg(id));
  }

  // ---- 牧場 ----
  function buildBoard() {
    els.board.style.setProperty('--tilled', 'url(' + window.KusaArt.tilled() + ')');
    const size = C.fieldSize(game);
    els.board.style.gridTemplateColumns = 'repeat(' + size + ', 1fr)';
    els.board.style.gridTemplateRows = 'repeat(' + size + ', 1fr)';
    els.board.textContent = '';
    els.plants.textContent = '';
    shown.length = 0;
    sprites.length = 0;
    for (let i = 0; i < size * size; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.index = String(i);
      cell.setAttribute('role', 'gridcell');
      // マスごとに少しずらす (畑のマス目に見えないように)。決まった値なので、開き直しても同じ並び
      cell.style.setProperty('--jx', (((i * 37) % 11) - 5) * 2 + 'px');
      cell.style.setProperty('--jy', (((i * 53) % 9) - 4) * 3 + 'px');
      const ground = document.createElement('div');
      ground.className = 'ground';
      cell.appendChild(ground);
      const mark = document.createElement('div');
      mark.className = 'mark';
      cell.appendChild(mark);
      els.board.appendChild(cell);
      shown.push(undefined);
      sprites.push(null);
    }
  }

  function cellEl(i) { return els.board.children[i]; }
  function spriteEl(i) { return sprites[i] || null; }
  function plantEl(i) { const sp = sprites[i]; return sp ? sp.firstChild : null; }
  function groundEl(i) { return cellEl(i).querySelector('.ground'); }

  function renderCell(i) {
    const id = game.cells[i];
    if (shown[i] === id) return;
    shown[i] = id;
    const cell = cellEl(i);
    if (sprites[i]) { sprites[i].remove(); sprites[i] = null; }
    cell.classList.toggle('has', !!id);
    cell.classList.remove('glows');
    cell.removeAttribute('aria-label');
    if (!id) return;
    const s = C.speciesOf(id);
    cell.style.setProperty('--h', window.KusaArt.heightOf(s).toFixed(2));
    const glow = window.KusaArt.glow(s);
    if (glow) { cell.classList.add('glows'); cell.style.setProperty('--glow', glow); }
    // そよぎ方を草ごとに少しずつ変える (そろうと作り物に見える)。背の高い草ほど大きく揺れる
    const h = window.KusaArt.heightOf(s);
    cell.style.setProperty('--sway-d', (4.2 + ((i * 7) % 5) * 0.55).toFixed(2) + 's');
    cell.style.setProperty('--sway-delay', (-((i * 13) % 9) * 0.6).toFixed(2) + 's');
    cell.style.setProperty('--sway-a', (0.6 + h * 1.4).toFixed(2));
    // 草は 3D の台の中に置かず、画面の平らな層 (#plants) に置く。
    // 3D の中で動く物があると、ブラウザが重なりの順番を取り違え、奥の列の草が土の後ろに消えたため
    const sp = document.createElement('div');
    sp.className = 'sprite';
    sp.dataset.index = String(i);
    sp.style.setProperty('--sway-d', cell.style.getPropertyValue('--sway-d'));
    sp.style.setProperty('--sway-delay', cell.style.getPropertyValue('--sway-delay'));
    sp.style.setProperty('--sway-a', cell.style.getPropertyValue('--sway-a'));
    const img = plantImg(id, 'plant');
    img.dataset.index = String(i);
    sp.appendChild(img);
    els.plants.appendChild(sp);
    sprites[i] = sp;
    placeSprite(i);
    cell.setAttribute('aria-label', s.name);
  }

  /**
   * 草を、そのマスの根元が画面に見えている所へ置く。大きさは、その奥行きでのマスの幅に合わせる
   * (奥の列ほど小さく見える)。手前の列ほど上に重ねる。
   */
  function placeSprite(i) {
    const sp = sprites[i];
    if (!sp) return;
    const g = groundEl(i).getBoundingClientRect();
    const L = layerRect || (layerRect = els.plants.getBoundingClientRect());
    const cellW = g.width / 0.92;          // .ground はマスの幅の 92%
    const size = C.fieldSize(game);
    const row = Math.floor(i / size);
    const depth = 0.88 + 0.12 * (row / Math.max(1, size - 1)); // 奥 (上) の列ほど少し小さく
    const w = cellW * 1.55 * depth * window.KusaArt.sizeOf(C.speciesOf(game.cells[i])); // 草ごとの大きさ (looks.js)
    const h = w * (window.KusaArt.H / window.KusaArt.W);
    const baseX = g.left + g.width / 2 - L.left;
    // 絵のいちばん下は細い根。見た目の株元が輪や影の中に収まるよう、根を輪の中心より少し手前に置く
    const baseY = g.top + g.height * 0.66 - L.top;
    sp.style.width = w.toFixed(1) + 'px';
    sp.style.height = h.toFixed(1) + 'px';
    sp.style.left = (baseX - w / 2).toFixed(1) + 'px';
    sp.style.top = (baseY - h * 0.94).toFixed(1) + 'px'; // 絵の根元は下端から 6% 上
    sp.style.zIndex = String(10 + Math.floor(i / C.fieldSize(game)));
  }

  let layerRect = null;
  function placeAll() {
    layerRect = null;
    for (let i = 0; i < sprites.length; i++) placeSprite(i);
  }

  function render() {
    for (let i = 0; i < game.cells.length; i++) renderCell(i);
    const hints = hintsFor(press && press.dragging ? press.index : selected);
    for (let i = 0; i < game.cells.length; i++) {
      cellEl(i).classList.toggle('selected', i === selected);
      cellEl(i).classList.toggle('hint', hints.indexOf(i) >= 0);
      if (sprites[i]) sprites[i].classList.toggle('selected', i === selected);
    }
    const c = C.collection(game);
    els.bookCount.textContent = c.found + ' / ' + c.total;
    els.bookMeter.style.width = (100 * c.found / c.total).toFixed(1) + '%';
    els.coins.textContent = String(game.coins);
    els.btnSell.classList.toggle('armed', selected >= 0);
  }

  /**
   * 選んだ草と重ねられる相手のマス。同じ草と、すでに見つけたレシピの相手だけ
   * (見つけていない特殊合成の相手は光らせない。答えを明かさないため)。
   */
  function hintsFor(i) {
    if (i < 0 || game.cells[i] == null) return [];
    const a = game.cells[i];
    const out = [];
    game.cells.forEach((b, j) => {
      if (j === i || b == null) return;
      const r = C.merge(a, b);
      if (!r) return;
      if (r.special && !game.recipesFound[a < b ? a + '|' + b : b + '|' + a]) return;
      out.push(j);
    });
    return out;
  }

  function say(text) { els.message.textContent = text; }

  // ---- 演出 ----
  // 控えめで自然に。動かすのは Web Animations (element.animate) だけ。
  // 位置は left/top で決め、動きは transform だけで付ける (位置決めを上書きしないため)。

  /** 草の根元 (土の上の点) の、画面での位置。 */
  function baseOf(i) {
    const r = groundEl(i).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.5 };
  }

  function spawn(cls, x, y, color) {
    const el = document.createElement('div');
    el.className = cls;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if (color) el.style.background = color;
    document.body.appendChild(el);
    return el;
  }
  function done(anim, el) { return anim.finished.then(() => el.remove(), () => el.remove()); }

  /** 葉が外からふわっと集まる。 */
  function gather(at, colors, count) {
    const runs = [];
    for (let i = 0; i < count; i++) {
      const leaf = spawn('leaf', at.x - 4, at.y - 30, colors[i % colors.length]);
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const d = 46 + Math.random() * 20;
      const far = 'translate(' + Math.cos(a) * d + 'px,' + Math.sin(a) * d * 0.7 + 'px) rotate(' + (a * 57 + 140) + 'deg)';
      runs.push(done(leaf.animate(
        [{ transform: far, opacity: 0 }, { opacity: 0.9, offset: 0.35 }, { transform: 'translate(0,24px) rotate(' + (a * 57) + 'deg) scale(0.6)', opacity: 0 }],
        { duration: 380, easing: 'cubic-bezier(.45,0,.6,1)' }), leaf));
    }
    return Promise.all(runs);
  }

  /** 根元から土の粒が少し跳ねる。 */
  function dirt(at, count) {
    const runs = [];
    for (let i = 0; i < count; i++) {
      const d = spawn('dirt', at.x - 2, at.y - 2, i % 3 ? '#5a4128' : '#7a5a3a');
      const dx = (Math.random() - 0.5) * 50;
      const up = 10 + Math.random() * 16;
      runs.push(done(d.animate(
        [{ transform: 'translate(0,0)', opacity: 1 }, { transform: 'translate(' + dx * 0.6 + 'px,' + -up + 'px)', offset: 0.45 },
          { transform: 'translate(' + dx + 'px,4px)', opacity: 0 }],
        { duration: 420 + Math.random() * 160, easing: 'ease-out' }), d));
    }
    return Promise.all(runs);
  }

  /** 土が少し揺れる。 */
  function shake(i, strong) {
    const d = strong ? 3 : 2;
    const sp = spriteEl(i);
    if (sp) sp.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(' + -d + 'px,0)' }, { transform: 'translate(' + d + 'px,0)' }, { transform: 'translate(0,0)' }], { duration: 220 });
    return cellEl(i).animate(
      [{ transform: 'translate(0,0)' }, { transform: 'translate(' + -d + 'px,1px)' }, { transform: 'translate(' + d + 'px,-1px)' },
        { transform: 'translate(' + (-d / 2) + 'px,0)' }, { transform: 'translate(0,0)' }],
      { duration: 220 }
    ).finished.catch(() => {});
  }

  /** 新しい草が土から生えてくる。 */
  function grow(i, delay) {
    const p = plantEl(i);
    if (!p) return Promise.resolve();
    return p.animate(
      [{ transform: 'scale(0.55, 0.05)', opacity: 0 },
        { transform: 'scale(0.9, 0.7)', opacity: 1, offset: 0.35 },
        { transform: 'scale(1.04, 1.07) rotate(-1.5deg)', offset: 0.7 },
        { transform: 'scale(1, 1) rotate(0.6deg)', offset: 0.88 },
        { transform: 'scale(1, 1) rotate(0)' }],
      { duration: 620, delay: delay || 0, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' }
    ).finished.catch(() => {});
  }

  /** 特殊合成: 根元から柔らかい光が広がり、光の粒がゆっくり昇る。 */
  function shine(at, glow) {
    const halo = spawn('halo', at.x, at.y - 30);
    if (glow) halo.style.setProperty('--glow', glow);
    const runs = [done(halo.animate(
      [{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 0.9, offset: 0.3 }, { transform: 'scale(1.3)', opacity: 0 }],
      { duration: 1100, easing: 'ease-out' }), halo)];
    for (let i = 0; i < 10; i++) {
      const m = spawn('mote', at.x + (Math.random() - 0.5) * 70, at.y - 10 - Math.random() * 30);
      const rise = 40 + Math.random() * 50;
      runs.push(done(m.animate(
        [{ transform: 'translate(0,0) scale(0.4)', opacity: 0 }, { opacity: 1, offset: 0.25 },
          { transform: 'translate(' + (Math.random() - 0.5) * 20 + 'px,' + -rise + 'px) scale(1)', opacity: 0 }],
        { duration: 1000 + Math.random() * 500, delay: Math.random() * 300, easing: 'ease-out' }), m));
    }
    return Promise.all(runs);
  }

  /** 合成の瞬間: 草がふわっと集まり、土が少し揺れ、新しい草が土から生える。 */
  async function mergeEffect(i, r, fromSpecies, toSpecies) {
    const at = baseOf(i);
    const s = C.speciesOf(r.id);
    const p = plantEl(i);
    if (p) p.style.opacity = '0';
    const colors = [window.KusaArt.leafColor(fromSpecies), window.KusaArt.leafColor(toSpecies)];
    await gather(at, colors, r.special ? 12 : 9);
    if (p) p.style.opacity = '';
    const runs = [shake(i, r.special), dirt(at, r.special ? 10 : 7), grow(i)];
    if (r.special) runs.push(shine(at, window.KusaArt.glow(s)));
    await Promise.all(runs);
  }

  /** 草の絵を、画面に固定した写しにする (運ぶ演出・指についてくる草)。 */
  function ghostOf(i) {
    const src = plantEl(i);
    const r = src.getBoundingClientRect();
    const g = src.cloneNode(true);
    g.className = 'ghost';
    g.style.left = r.left + 'px';
    g.style.top = r.top + 'px';
    g.style.width = r.width + 'px';
    g.style.height = r.height + 'px';
    document.body.appendChild(g);
    return { el: g, w: r.width, h: r.height };
  }

  /** 運んできた草を、重ねる先の根元へ吸い込ませる。 */
  function settle(ghost, to) {
    const r = ghost.el.getBoundingClientRect();
    const b = baseOf(to);
    const dx = b.x - (r.left + r.width / 2);
    const dy = b.y - (r.top + r.height * 0.94);
    return done(ghost.el.animate(
      [{ transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0.55)', opacity: 0.2 }],
      { duration: 240, easing: 'cubic-bezier(.5,0,.75,.4)', fill: 'forwards' }), ghost.el);
  }

  function showDiscover(id, special) {
    return new Promise((resolve) => {
      const s = C.speciesOf(id);
      els.discoverArt.className = 'discover-art';
      drawArt(els.discoverArt, id);
      els.discoverKicker.textContent = special ? '特殊合成で発見！' : '発見！';
      els.discoverNo.textContent = 'No.' + pad(C.number(id));
      // 図鑑に載ったことで新しい種が加わったら、札で知らせる
      const nowSeeds = C.unlockedSpecies(game);
      const fresh = nowSeeds.filter((x) => !knownSeeds.has(x));
      knownSeeds = new Set(nowSeeds);
      els.discoverUnlock.hidden = fresh.length === 0;
      els.discoverUnlock.textContent = fresh.length ? '新しい種が加わった：' + fresh.map(C.seedLabel).join('・') : '';
      els.discoverName.textContent = s.name;
      setRarity(els.discoverRarity, s.rarity);
      els.discover.classList.toggle('special', !!special);
      els.discover.hidden = false;
      const im = els.discoverArt.querySelector('img');
      if (im) {
        im.animate([{ transform: 'scale(1.16, 0.05)', opacity: 0 }, { transform: 'scale(1.16, 1.2)', opacity: 1, offset: 0.6 }, { transform: 'scale(1.16)' }],
          { duration: 700, delay: 180, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' });
      }
      els.discover.querySelector('.discover-card').animate(
        [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1.04)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)' }],
        { duration: 320, easing: 'ease-out' }
      );
      const close = () => {
        els.discover.hidden = true;
        els.discover.removeEventListener('pointerup', close);
        resolve();
      };
      // 出た直後の指離れで閉じないよう、少し待ってから受け付ける
      setTimeout(() => els.discover.addEventListener('pointerup', close), 250);
    });
  }

  function setRarity(el, r) {
    el.textContent = C.RARITY_NAMES[r];
    el.className = 'rarity r' + r;
  }

  function pad(n) { return String(n).padStart(3, '0'); }

  // ---- 操作の中身 ----
  async function run(task) {
    if (busy) return;
    busy = true;
    try { await task(); } finally { busy = false; render(); }
  }

  let carried = null; // ドラッグで運んできた草の写し (離した所から、重ねる先へ吸い込ませる)

  /** from の草を to へ (重ねる / 動かす)。viaTap ならまず運ぶ演出をする。 */
  function act(from, to, viaTap) {
    return run(async () => {
      selected = -1;
      if (from === to) return;
      if (game.cells[to] == null) {
        if (carried) { carried.el.remove(); carried = null; }
        if (C.move(game, from, to)) saveSoon();
        render();
        return;
      }
      const a = C.speciesOf(game.cells[from]);
      const b = C.speciesOf(game.cells[to]);
      // 合成できるか先に見る (できないなら運ばずに知らせる)
      if (!C.merge(game.cells[from], game.cells[to])) {
        if (carried) { carried.el.remove(); carried = null; }
        say(a.name + 'と' + b.name + 'では、何も起きなかった。');
        render();
        await Promise.all([shake(to), shake(from)]);
        return;
      }
      const ghost = carried || (viaTap ? ghostOf(from) : null);
      carried = null;
      if (ghost) {
        const src = plantEl(from);
        if (src) src.style.opacity = '0';
        await settle(ghost, to);
      }
      const r = C.drop(game, from, to);
      saveSoon();
      render();
      const s = C.speciesOf(r.id);
      say(r.special ? a.name + ' + ' + b.name + ' → ' + s.name + '！' : s.name + 'に育った！');
      await mergeEffect(to, r, a, b);
      if (r.newlyFound) await showDiscover(r.id, r.special);
    });
  }

  function sellAt(i) {
    return run(async () => {
      selected = -1;
      if (game.cells[i] == null) return;
      const s = C.speciesOf(game.cells[i]);
      const gain = C.sell(game, i);
      saveSoon();
      say(s.name + 'を売った。+' + gain + ' コイン');
      render();
    });
  }

  function plant() {
    // 連打に付いてくる: 生える演出は 1 本ずつ独立しているので、操作は止めない
    // (止めると、演出の 0.62 秒のあいだ押した分が捨てられる)。止めるのは発見の札を出すときだけ
    if (busy) return Promise.resolve();
    selected = -1;
    const before = Object.assign({}, game.discovered);
    const i = C.plant(game);
    if (i < 0) {
      say('牧場がいっぱい。重ねるか、売って場所を空けよう。');
      return Promise.resolve();
    }
    saveSoon();
    render();
    const id = game.cells[i];
    say(id === C.WEED_ID ? '雑草が生えた。重ねられないので、売って片づけよう。' : C.speciesOf(id).name + 'が生えた。');
    const shown = Promise.all([grow(i), dirt(baseOf(i), 5)]);
    if (before[id]) return shown;
    return run(async () => { await shown; await showDiscover(id, false); });
  }

  // ---- 指の操作 ----
  const DRAG_START = 8;   // これより動いたらドラッグ
  const BASE_ZONE = 0.55; // マスの上からこの割合より下は「根元」
  let press = null;     // { index, x, y, id, ghost, dragging, over }

  /** 指が草の葉や花に触れているか (透明なすき間なら false)。 */
  function touchesPlant(img, i, x, y) {
    const s = C.speciesOf(game.cells[i]);
    if (!s) return false;
    const r = img.getBoundingClientRect();
    const nw = img.naturalWidth || window.KusaArt.W;
    const nh = img.naturalHeight || window.KusaArt.H;
    // object-fit: contain / object-position: 下寄せ で置いた絵の、実際に描かれている範囲
    const k = Math.min(r.width / nw, r.height / nh);
    const cw = nw * k;
    const ch = nh * k;
    const left = r.left + (r.width - cw) / 2;
    const top = r.top + (r.height - ch);
    return window.KusaArt.opaqueAt(s, (x - left) / cw, (y - top) / ch);
  }

  /**
   * 指の下にあるのは、どのマスか。
   * 手前の草は奥のマスに重なって見えるので、葉に触れていればその草のマス、
   * すき間なら奥へ通して、その下の土のマスを選ぶ。
   */
  function cellIndexAt(x, y) {
    const stack = document.elementsFromPoint(x, y);
    // 根元のあたり (マスの下寄り) を押したら、上に手前の草の葉がかかっていても、そのマスを選ぶ。
    // 背の高い草が並ぶと奥の草の根元が隠れ、奥の草を選べなくなるため
    for (const el of stack) {
      if (!el.classList.contains('cell') || !els.board.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if ((y - r.top) / r.height > BASE_ZONE) return { kind: 'cell', index: Number(el.dataset.index) };
      break;
    }
    for (const el of stack) {
      if (el.closest('#btnSell')) return { kind: 'sell' };
      if (el.classList.contains('plant') && el.dataset.index !== undefined) {
        const i = Number(el.dataset.index);
        if (touchesPlant(el, i, x, y)) return { kind: 'cell', index: i };
        continue;
      }
      const cell = el.closest('.cell');
      if (!cell || !els.board.contains(cell)) continue;
      return { kind: 'cell', index: Number(cell.dataset.index) };
    }
    return { kind: 'none' };
  }

  function onDown(e) {
    if (busy || press) return;
    const hit = cellIndexAt(e.clientX, e.clientY);
    if (hit.kind !== 'cell') return;
    els.stage.setPointerCapture(e.pointerId); // 指がマスの外へ出ても、離すまで追う
    press = { index: hit.index, x: e.clientX, y: e.clientY, id: e.pointerId, ghost: null, dragging: false, over: null };
  }

  function startDrag() {
    const g = ghostOf(press.index);
    const r = g.el.getBoundingClientRect();
    cellEl(press.index).classList.add('dragging');
    if (spriteEl(press.index)) spriteEl(press.index).classList.add('dragging');
    press.ghost = g;
    press.dragging = true;
    render(); // 重ねられる相手を光らせる
    // つかんだ所が指の下に残るように
    press.dx = press.x - r.left;
    press.dy = press.y - r.top;
  }

  function setOver(target) {
    const key = target.kind === 'cell' ? 'c' + target.index : target.kind;
    if (press.over === key) return;
    els.board.querySelectorAll('.cell.target').forEach((c) => c.classList.remove('target'));
    els.btnSell.classList.remove('armed');
    if (target.kind === 'cell' && target.index !== press.index) cellEl(target.index).classList.add('target');
    if (target.kind === 'sell') els.btnSell.classList.add('armed');
    press.over = key;
  }

  function onMove(e) {
    if (!press || e.pointerId !== press.id) return;
    if (!press.dragging) {
      if (game.cells[press.index] == null) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_START) return;
      selected = -1;
      render();
      startDrag();
    }
    press.ghost.el.style.left = (e.clientX - press.dx) + 'px';
    press.ghost.el.style.top = (e.clientY - press.dy) + 'px';
    setOver(cellIndexAt(e.clientX, e.clientY));
  }

  /** 押していた指を手放す。keepGhost なら、運んできた草の写しを返す (重ねる演出に使う)。 */
  function endPress(keepGhost) {
    const g = press && press.ghost;
    els.board.querySelectorAll('.cell.target').forEach((c) => c.classList.remove('target'));
    document.querySelectorAll('.cell.dragging, .sprite.dragging').forEach((c) => c.classList.remove('dragging'));
    press = null;
    if (g && !keepGhost) { g.el.remove(); return null; }
    return g;
  }

  function onUp(e) {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    if (p.dragging) {
      const target = cellIndexAt(e.clientX, e.clientY);
      const toPlant = target.kind === 'cell' && target.index !== p.index && game.cells[target.index] != null;
      const g = endPress(toPlant);
      if (target.kind === 'sell') sellAt(p.index);
      else if (target.kind === 'cell') { carried = g; act(p.index, target.index, false); }
      else render();
      return;
    }
    endPress();
    tapCell(p.index);
  }

  function onCancel(e) {
    if (!press || e.pointerId !== press.id) return;
    endPress(false);
    render();
  }

  function tapCell(i) {
    if (busy) return;
    const has = game.cells[i] != null;
    if (selected < 0) {
      if (has) { selected = i; say(C.speciesOf(game.cells[i]).name + 'を選んだ。重ねたい草をタップ。'); }
      render();
      return;
    }
    if (selected === i) { selected = -1; render(); return; }
    act(selected, i, true);
  }

  function tapSell() {
    if (busy) return;
    if (selected < 0) { say('売りたい草を選んでから押してね。'); return; }
    sellAt(selected);
  }

  // ---- 図鑑 ----
  function entry(s) {
    const found = !!game.discovered[s.id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'entry' + (found ? '' : ' unknown');
    b.dataset.id = s.id;
    const art = document.createElement('div');
    art.className = 'entry-art';
    if (found) drawArt(art, s.id); else art.textContent = '?';
    const body = document.createElement('div');
    body.className = 'entry-body';
    const title = document.createElement('p');
    title.className = 'entry-title';
    const no = document.createElement('span');
    no.className = 'entry-no';
    no.textContent = 'No.' + pad(C.number(s.id)) + ' ';
    title.appendChild(no);
    title.appendChild(document.createTextNode(found ? s.name : '???'));
    const tags = document.createElement('div');
    tags.className = 'entry-tags';
    const tag = document.createElement('span');
    tag.className = 'tag ' + (found ? 'found' : 'unknown');
    tag.textContent = found ? '発見済み' : '未発見';
    tags.appendChild(tag);
    if (found) {
      const r = document.createElement('span');
      setRarity(r, s.rarity);
      r.classList.add('tag');
      tags.appendChild(r);
    }
    const note = document.createElement('p');
    note.className = 'entry-note';
    note.textContent = found ? (s.note || C.RARITY_NAMES[s.rarity] + 'の草。') : 'ヒント：' + C.hint(game, s.id);
    body.appendChild(title);
    body.appendChild(tags);
    body.appendChild(note);
    b.appendChild(art);
    b.appendChild(body);
    return b;
  }

  function groups() {
    if (group === 'rarity') {
      return C.RARITY_NAMES.map((name, r) => ({ name: name, list: C.SPECIES.filter((s) => s.rarity === r) }));
    }
    const out = C.LINEAGES.map((l) => ({ name: l.name + '系統', list: C.SPECIES.filter((s) => s.lineage === l.id) }));
    out.push({ name: '特殊合成・そのほか', list: C.SPECIES.filter((s) => !s.lineage) });
    return out;
  }

  function renderBook() {
    const c = C.collection(game);
    els.bookCount2.textContent = c.found + ' / ' + c.total + ' 種';
    els.book.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.group === group));
    els.bookList.textContent = '';
    groups().forEach((g) => {
      if (!g.list.length) return;
      const h = document.createElement('h3');
      h.className = 'group-title';
      h.textContent = g.name;
      els.bookList.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'group-grid';
      g.list.forEach((s) => grid.appendChild(entry(s)));
      els.bookList.appendChild(grid);
    });
  }

  function openBook() {
    if (busy) return;
    selected = -1;
    render();
    renderBook();
    els.book.hidden = false;
    els.bookList.scrollTop = 0;
  }

  function recipeText(s) {
    if (s.lineage && s.level > 1) {
      const prev = C.SPECIES.filter((p) => p.next === s.id)[0];
      return prev.name + 'を2つ重ねると育つ。';
    }
    const keys = Object.keys(game.recipesFound).filter((k) => game.recipesFound[k] === s.id);
    if (keys.length) {
      return keys.map((k) => k.split('|').map((id) => C.speciesOf(id).name).join(' + ')).join(' / ') + ' で発見。';
    }
    return s.lineage ? '種をまくと生える。' : '';
  }

  function openZoom(id) {
    const s = C.speciesOf(id);
    els.zoomArt.className = 'zoom-art';
    drawArt(els.zoomArt, id);
    els.zoomNo.textContent = 'No.' + pad(C.number(id));
    els.zoomName.textContent = s.name;
    setRarity(els.zoomRarity, s.rarity);
    els.zoomNote.textContent = s.note;
    els.zoomRecipe.textContent = recipeText(s);
    els.zoom.hidden = false;
  }

  /** 光の中を漂う細かい粒。数は少なく、動きは CSS (transform と opacity) だけ。 */
  function makeAir() {
    const air = document.getElementById('air');
    for (let i = 0; i < 12; i++) {
      const sp = document.createElement('i');
      sp.className = 'speck';
      const r = (n) => ((i * 9301 + n * 49297) % 233280) / 233280; // 決まった並びの乱数
      sp.style.left = (8 + r(1) * 70) + '%';
      sp.style.top = (12 + r(2) * 60) + '%';
      sp.style.setProperty('--d', (11 + r(3) * 9).toFixed(1) + 's');
      sp.style.setProperty('--delay', (-r(4) * 20).toFixed(1) + 's');
      sp.style.setProperty('--dx', (20 + r(5) * 60).toFixed(0) + 'px');
      sp.style.setProperty('--dy', (-60 - r(6) * 80).toFixed(0) + 'px');
      sp.style.setProperty('--o', (0.35 + r(7) * 0.5).toFixed(2));
      const size = 2 + r(8) * 2.5;
      sp.style.width = sp.style.height = size.toFixed(1) + 'px';
      air.appendChild(sp);
    }
  }

  function main() {
    document.getElementById('version').textContent = '版 ' + VERSION + ' / 見えている高さ ' + window.innerHeight;
    window.addEventListener('resize', placeAll);
    // ピンチ拡大を止める (iOS は viewport の user-scalable を無視する)。
    // 連打のダブルタップ拡大は CSS の touch-action: manipulation が止める。
    // touchend を止める手は使わない (2度目のタップの click まで消え、連打で押し損ねる)
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
    // 書体の読み込みなどで台の位置が動いたら、草を置き直す (ずれると草が根元から浮く)
    if (window.ResizeObserver) new ResizeObserver(() => placeAll()).observe(els.stage);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeAll);
    makeAir();
    buildBoard();
    render();

    els.stage.addEventListener('pointerdown', onDown);
    els.stage.addEventListener('pointermove', onMove);
    els.stage.addEventListener('pointerup', onUp);
    els.stage.addEventListener('pointercancel', onCancel);
    els.stage.addEventListener('lostpointercapture', onCancel);
    els.btnPlant.addEventListener('click', plant);
    els.btnSell.addEventListener('click', tapSell);
    els.btnBook.addEventListener('click', openBook);
    els.btnBookClose.addEventListener('click', () => { els.book.hidden = true; });
    els.book.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { group = t.dataset.group; renderBook(); }));
    els.bookList.addEventListener('click', (e) => {
      const b = e.target.closest('.entry');
      if (b && game.discovered[b.dataset.id]) openZoom(b.dataset.id);
    });
    els.btnZoomClose.addEventListener('click', () => { els.zoom.hidden = true; });
    els.zoom.addEventListener('click', (e) => { if (e.target === els.zoom) els.zoom.hidden = true; });
    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

    // 自動テストから中身をのぞくための入口
    window.__app = {
      game: () => game,
      busy: () => busy,
      selected: () => selected,
      setGame: (g) => { game = g; knownSeeds = new Set(C.unlockedSpecies(game)); selected = -1; buildBoard(); render(); },
      saveNow: saveNow,
      SAVE_KEY: SAVE_KEY
    };
  }

  main();
})();
