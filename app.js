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

  const $ = (id) => document.getElementById(id);
  const els = {
    board: $('board'), message: $('message'), coins: $('coins'), bookCount: $('bookCount'),
    btnPlant: $('btnPlant'), btnSell: $('btnSell'), btnBook: $('btnBook'),
    discover: $('discover'), discoverArt: $('discoverArt'), discoverNo: $('discoverNo'),
    discoverName: $('discoverName'), discoverRarity: $('discoverRarity'), discoverKicker: $('discoverKicker'),
    book: $('book'), bookList: $('bookList'), bookCount2: $('bookCount2'), btnBookClose: $('btnBookClose'),
    zoom: $('zoom'), zoomArt: $('zoomArt'), zoomNo: $('zoomNo'), zoomName: $('zoomName'),
    zoomRarity: $('zoomRarity'), zoomNote: $('zoomNote'), zoomRecipe: $('zoomRecipe'), btnZoomClose: $('btnZoomClose')
  };

  let game = loadGame();
  let selected = -1;      // タップで選んでいるマス
  let busy = false;       // 演出の最中は操作を受けない
  let group = 'lineage';  // 図鑑の並べ方
  const shown = [];       // マスごとに、いま描いている草の id (変わったマスだけ描き直す)

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
    const size = C.fieldSize(game);
    els.board.style.gridTemplateColumns = 'repeat(' + size + ', 1fr)';
    els.board.style.gridTemplateRows = 'repeat(' + size + ', 1fr)';
    els.board.textContent = '';
    shown.length = 0;
    for (let i = 0; i < size * size; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.index = String(i);
      cell.setAttribute('role', 'gridcell');
      const ground = document.createElement('div');
      ground.className = 'ground';
      cell.appendChild(ground);
      els.board.appendChild(cell);
      shown.push(undefined);
    }
  }

  function cellEl(i) { return els.board.children[i]; }
  function plantEl(i) { return cellEl(i).querySelector('.plant'); }
  function groundEl(i) { return cellEl(i).querySelector('.ground'); }

  function renderCell(i) {
    const id = game.cells[i];
    if (shown[i] === id) return;
    shown[i] = id;
    const cell = cellEl(i);
    const old = cell.querySelector('.stand');
    if (old) old.remove();
    cell.classList.toggle('has', !!id);
    cell.classList.remove('glows');
    cell.removeAttribute('aria-label');
    if (!id) return;
    const s = C.speciesOf(id);
    const glow = window.KusaArt.glow(s);
    if (glow) { cell.classList.add('glows'); cell.style.setProperty('--glow', glow); }
    const stand = document.createElement('div');
    stand.className = 'stand';
    stand.appendChild(plantImg(id, 'plant'));
    cell.appendChild(stand);
    cell.setAttribute('aria-label', s.name);
  }

  function render() {
    for (let i = 0; i < game.cells.length; i++) renderCell(i);
    for (let i = 0; i < game.cells.length; i++) cellEl(i).classList.toggle('selected', i === selected);
    const c = C.collection(game);
    els.bookCount.textContent = c.found + ' / ' + c.total;
    els.coins.textContent = String(game.coins);
    els.btnSell.classList.toggle('armed', selected >= 0);
  }

  function say(text) { els.message.textContent = text; }

  // ---- 演出 ----
  // 控えめで自然に。動かすのは Web Animations (element.animate) だけ。
  // 位置は left/top で決め、動きは transform だけで付ける (位置決めを上書きしないため)。

  /** 草の根元 (土の上の点) の、画面での位置。 */
  function baseOf(i) {
    const r = groundEl(i).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.45 };
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
      els.discoverName.textContent = s.name;
      setRarity(els.discoverRarity, s.rarity);
      els.discover.classList.toggle('special', !!special);
      els.discover.hidden = false;
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
    return run(async () => {
      selected = -1;
      const before = Object.assign({}, game.discovered);
      const i = C.plant(game);
      if (i < 0) {
        say('牧場がいっぱい。重ねるか、売って場所を空けよう。');
        return;
      }
      saveSoon();
      render();
      const id = game.cells[i];
      say(C.speciesOf(id).name + 'が生えた。');
      await Promise.all([grow(i), dirt(baseOf(i), 5)]);
      if (!before[id]) await showDiscover(id, false);
    });
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
      const cell = el.closest('.cell');
      if (!cell || !els.board.contains(cell)) continue;
      const i = Number(cell.dataset.index);
      if (el.classList.contains('plant')) {
        if (touchesPlant(el, i, x, y)) return { kind: 'cell', index: i };
        continue;
      }
      return { kind: 'cell', index: i };
    }
    return { kind: 'none' };
  }

  function onDown(e) {
    if (busy || press) return;
    const hit = cellIndexAt(e.clientX, e.clientY);
    if (hit.kind !== 'cell') return;
    els.board.setPointerCapture(e.pointerId); // 指がマスの外へ出ても、離すまで追う
    press = { index: hit.index, x: e.clientX, y: e.clientY, id: e.pointerId, ghost: null, dragging: false, over: null };
  }

  function startDrag() {
    const g = ghostOf(press.index);
    const r = g.el.getBoundingClientRect();
    cellEl(press.index).classList.add('dragging');
    press.ghost = g;
    press.dragging = true;
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
    els.board.querySelectorAll('.cell.dragging').forEach((c) => c.classList.remove('dragging'));
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
    title.textContent = 'No.' + pad(C.number(s.id)) + ' ' + (found ? s.name : '???');
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
      g.list.forEach((s) => els.bookList.appendChild(entry(s)));
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

  function main() {
    window.KusaArt.soil(document.getElementById('soil'), 7); // 土は動かないので1回だけ描く
    buildBoard();
    render();

    els.board.addEventListener('pointerdown', onDown);
    els.board.addEventListener('pointermove', onMove);
    els.board.addEventListener('pointerup', onUp);
    els.board.addEventListener('pointercancel', onCancel);
    els.board.addEventListener('lostpointercapture', onCancel);
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
      setGame: (g) => { game = g; selected = -1; buildBoard(); render(); },
      saveNow: saveNow,
      SAVE_KEY: SAVE_KEY
    };
  }

  main();
})();
