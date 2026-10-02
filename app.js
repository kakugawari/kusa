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

  /**
   * 草の絵。届いたらここに「id: パス」で足す (例 chibi_shiba: './img/chibi_shiba.png')。
   * 無い草は仮の四角 (系統の色 + 名前) で出す。草の id は core.js の LINEAGES / EXTRAS にある。
   */
  const IMAGES = {};

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
  function lineageClass(s) { return 'lin-' + (s.lineage || 'x'); }

  /** 草の絵を el の中に入れる。絵が無ければ仮の四角。 */
  function drawArt(el, id) {
    const s = C.speciesOf(id);
    el.textContent = '';
    el.classList.add('rare-' + s.rarity);
    if (IMAGES[id]) {
      const img = document.createElement('img');
      img.src = IMAGES[id];
      img.alt = s.name;
      img.draggable = false;
      el.appendChild(img);
      return;
    }
    const ph = document.createElement('div');
    ph.className = 'placeholder ' + lineageClass(s);
    const lv = document.createElement('span');
    lv.className = 'ph-lv';
    lv.textContent = s.lineage ? 'Lv.' + s.level : '特殊';
    const name = document.createElement('span');
    name.className = 'ph-name';
    name.textContent = s.name;
    ph.appendChild(lv);
    ph.appendChild(name);
    el.appendChild(ph);
  }

  // ---- 牧場 ----
  function buildBoard() {
    const size = C.fieldSize(game);
    els.board.style.gridTemplateColumns = 'repeat(' + size + ', 1fr)';
    els.board.textContent = '';
    shown.length = 0;
    for (let i = 0; i < size * size; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.index = String(i);
      cell.setAttribute('role', 'gridcell');
      els.board.appendChild(cell);
      shown.push(undefined);
    }
  }

  function cellEl(i) { return els.board.children[i]; }
  function grassEl(i) { return cellEl(i).querySelector('.grass'); }

  function renderCell(i) {
    const id = game.cells[i];
    if (shown[i] === id) return;
    shown[i] = id;
    const cell = cellEl(i);
    cell.textContent = '';
    if (!id) return;
    const g = document.createElement('div');
    g.className = 'grass';
    const art = document.createElement('div');
    art.className = 'art';
    drawArt(art, id);
    g.appendChild(art);
    g.setAttribute('aria-label', C.speciesOf(id).name);
    cell.appendChild(g);
  }

  function render() {
    for (let i = 0; i < game.cells.length; i++) renderCell(i);
    for (let i = 0; i < game.cells.length; i++) {
      const g = grassEl(i);
      if (g) g.classList.toggle('selected', i === selected);
    }
    const c = C.collection(game);
    els.bookCount.textContent = c.found + ' / ' + c.total;
    els.coins.textContent = String(game.coins);
    els.btnSell.classList.toggle('armed', selected >= 0);
  }

  function say(text) { els.message.textContent = text; }

  // ---- 演出 ----
  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }

  /** 葉を飛ばす。inward なら外から中心へ集まる、そうでなければ中心から散る。 */
  function leaves(at, inward, count, color) {
    const runs = [];
    for (let i = 0; i < count; i++) {
      const leaf = document.createElement('div');
      leaf.className = 'leaf';
      if (color) leaf.style.background = color;
      leaf.style.left = (at.x - 4) + 'px';
      leaf.style.top = (at.y - 2) + 'px';
      document.body.appendChild(leaf);
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 38 + Math.random() * 22;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      const rot = Math.round(angle * 57);
      const far = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (rot + 120) + 'deg)';
      const near = 'translate(0,0) rotate(' + rot + 'deg)';
      const a = leaf.animate(
        inward
          ? [{ transform: far, opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: near, opacity: 0.9 }]
          : [{ transform: near, opacity: 1 }, { transform: far, opacity: 0 }],
        { duration: inward ? 260 : 420, easing: inward ? 'cubic-bezier(.5,0,.8,.6)' : 'cubic-bezier(.2,.7,.3,1)' }
      );
      runs.push(a.finished.then(() => leaf.remove(), () => leaf.remove()));
    }
    return Promise.all(runs);
  }

  /** 新しい草がポンと生える。 */
  function pop(i, delay) {
    const g = grassEl(i);
    if (!g) return Promise.resolve();
    return g.animate(
      [{ transform: 'scale(0.2)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 300, delay: delay || 0, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'backwards' }
    ).finished.catch(() => {});
  }

  /** 土が少し揺れる。 */
  function shake(i, strong) {
    const d = strong ? 4 : 2.5;
    return cellEl(i).animate(
      [{ transform: 'translate(0,0)' }, { transform: 'translate(' + -d + 'px,1px)' }, { transform: 'translate(' + d + 'px,-1px)' },
        { transform: 'translate(' + (-d / 2) + 'px,0)' }, { transform: 'translate(0,0)' }],
      { duration: 200 }
    ).finished.catch(() => {});
  }

  /** 合成の瞬間: 草がふわっと集まり、土が揺れ、新しい草がポンと生える (7. 最初に作るバージョン)。 */
  async function mergeEffect(i, special) {
    const at = centerOf(cellEl(i));
    const g = grassEl(i);
    if (g) g.style.opacity = '0';
    await leaves(at, true, special ? 12 : 8, special ? '#e8c45a' : null);
    await shake(i, special);
    if (g) g.style.opacity = '';
    await Promise.all([pop(i), leaves(at, false, special ? 14 : 8, special ? '#f0d77a' : null)]);
  }

  /** 選んだ草を、重ねる先まで運ぶ (タップで合成したとき)。 */
  function flyTo(from, to) {
    const src = grassEl(from);
    if (!src) return Promise.resolve();
    const a = centerOf(src);
    const b = centerOf(cellEl(to));
    return src.animate(
      [{ transform: 'translate(0,0)' }, { transform: 'translate(' + (b.x - a.x) + 'px,' + (b.y - a.y) + 'px) scale(0.8)' }],
      { duration: 200, easing: 'ease-in', fill: 'forwards' }
    ).finished.catch(() => {});
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

  /** from の草を to へ (重ねる / 動かす)。viaTap ならまず運ぶ演出をする。 */
  function act(from, to, viaTap) {
    return run(async () => {
      selected = -1;
      if (from === to) return;
      if (game.cells[to] == null) {
        if (C.move(game, from, to)) saveSoon();
        render();
        return;
      }
      const a = C.speciesOf(game.cells[from]);
      const b = C.speciesOf(game.cells[to]);
      // 合成できるか先に見る (できないなら運ばずに知らせる)
      if (!C.merge(game.cells[from], game.cells[to])) {
        say(a.name + 'と' + b.name + 'では、何も起きなかった。');
        render();
        await Promise.all([shake(to), shake(from)]);
        return;
      }
      if (viaTap) await flyTo(from, to);
      const r = C.drop(game, from, to);
      saveSoon();
      render();
      const s = C.speciesOf(r.id);
      say(r.special ? a.name + ' + ' + b.name + ' → ' + s.name + '！' : s.name + 'に育った！');
      await mergeEffect(to, r.special);
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
      await Promise.all([shake(i), pop(i)]);
      if (!before[id]) await showDiscover(id, false);
    });
  }

  // ---- 指の操作 ----
  const DRAG_START = 8; // これより動いたらドラッグ
  let press = null;     // { index, x, y, id, ghost, dragging, over }

  function cellIndexAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return { kind: 'none' };
    if (el.closest('#btnSell')) return { kind: 'sell' };
    const cell = el.closest('.cell');
    return cell ? { kind: 'cell', index: Number(cell.dataset.index) } : { kind: 'none' };
  }

  function onDown(e) {
    if (busy || press) return;
    const cell = e.target.closest('.cell');
    if (!cell) return;
    els.board.setPointerCapture(e.pointerId); // 指がマスの外へ出ても、離すまで追う
    press = { index: Number(cell.dataset.index), x: e.clientX, y: e.clientY, id: e.pointerId, ghost: null, dragging: false, over: null };
  }

  function startDrag() {
    const src = grassEl(press.index);
    const r = src.getBoundingClientRect();
    const ghost = src.cloneNode(true);
    ghost.classList.remove('selected');
    ghost.classList.add('ghost');
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    ghost.style.inset = 'auto';
    document.body.appendChild(ghost);
    src.classList.add('dragging');
    press.ghost = ghost;
    press.dragging = true;
    press.w = r.width;
    press.h = r.height;
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
    press.ghost.style.left = (e.clientX - press.w / 2) + 'px';
    press.ghost.style.top = (e.clientY - press.h / 2) + 'px';
    setOver(cellIndexAt(e.clientX, e.clientY));
  }

  function endPress() {
    if (press && press.ghost) press.ghost.remove();
    els.board.querySelectorAll('.cell.target').forEach((c) => c.classList.remove('target'));
    els.board.querySelectorAll('.grass.dragging').forEach((g) => g.classList.remove('dragging'));
    press = null;
  }

  function onUp(e) {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    if (p.dragging) {
      const target = cellIndexAt(e.clientX, e.clientY);
      endPress();
      if (target.kind === 'sell') sellAt(p.index);
      else if (target.kind === 'cell') act(p.index, target.index, false);
      else render();
      return;
    }
    endPress();
    tapCell(p.index);
  }

  function onCancel(e) {
    if (!press || e.pointerId !== press.id) return;
    endPress();
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
