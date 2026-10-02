/*!
 * core.js — ロジック。DOM を触らないので node でテストできる。
 *
 * ブラウザでは <script> で読み込むと window.Core になり、
 * node からは require() できる。ここにアプリの中身を書く。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Core = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * 決まった順番で数を出す乱数 (mulberry32)。
   * 同じ seed からは必ず同じ並びになるので、
   * 「同じ状態を作り直せる」「テストで結果を固定できる」。
   */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 配列をその場で混ぜる。rng を渡せば結果を再現できる。 */
  function shuffle(array, rng) {
    const random = rng || Math.random;
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const t = array[i];
      array[i] = array[j];
      array[j] = t;
    }
    return array;
  }

  /** 動作確認用のおまけ。作り始めたら消してよい。 */
  function roll(rng) {
    return 1 + Math.floor((rng || Math.random)() * 6);
  }


  // ---- 草のデータ ----------------------------------------------------
  // 出どころ: ChatGPT との相談 (CLAUDE.md の「このアプリ」)。名前・レア度は仮。

  const RARITIES = ['ノーマル', 'アンコモン', 'レア', 'スーパーレア', '伝説'];

  /** 系統: 同じ草を2つ重ねると、並びの次の草に進化する。 */
  const LINEAGES = [
    { id: 'shiba', name: '芝生', stages: [
      ['chibi_shiba', 'ちび芝生', 0, '小さな草の芽。初めて牧場に生えた草。'],
      ['fusafusa_shiba', 'ふさふさ芝生', 0, '葉が増えて丸くなる。'],
      ['konmori_shiba', 'こんもり芝生', 1, '大きな緑のかたまり。'],
      ['ougon_shiba', '黄金芝生', 2, '金色の穂が生える珍しい芝生。']
    ] },
    { id: 'clover', name: 'クローバー', stages: [
      ['mitsuba', '三つ葉', 0, ''], ['yotsuba', '四つ葉', 1, ''], ['itsuba', '五つ葉', 2, ''], ['kouun_clover', '幸運のクローバー', 2, '']
    ] },
    { id: 'tanpopo', name: 'タンポポ', stages: [
      ['tanpopo_me', '芽', 0, ''], ['tanpopo', 'タンポポ', 1, ''], ['watage', '綿毛', 2, ''], ['kyodai_tanpopo', '巨大タンポポ', 2, '']
    ] },
    { id: 'susuki', name: 'ススキ', stages: [
      ['susuki_me', '芽', 0, ''], ['susuki', 'ススキ', 1, ''], ['ooki_susuki', '大きなススキ', 2, ''], ['ougon_susuki', '黄金のススキ', 2, '']
    ] },
    { id: 'gensou', name: '幻想草', stages: [
      ['hikaru_kusa', '光る草', 2, ''], ['hoshi_kusa', '星の草', 3, ''], ['gekkou_kusa', '月光草', 3, ''], ['niji_kusa', '虹の草', 3, '']
    ] }
  ];

  /** 系統に入らない草 (特殊合成の入口・出口)。 */
  const EXTRAS = [
    ['zassou', '雑草', 0, ''], ['mizube_kusa', '水辺の草', 0, ''],
    ['clover_shiba', 'クローバー芝生', 1, ''], ['watage_daigunsei', '綿毛の大群生', 2, ''], ['ougon_sougen', '黄金の草原', 3, ''],
    ['kouun_hikarigusa', '幸運の光草', 3, ''], ['hotaru_kusa', 'ホタル草', 2, ''], ['uchuu_kusa', '宇宙草', 4, '']
  ];

  /**
   * 特殊合成のレシピ (順不同)。画面写真の「特殊合成レシピ案」そのまま。
   * 「芝生」はちび芝生、「クローバー」は三つ葉、「綿毛」は系統の綿毛、
   * 「タンポポ」はLv.2 のタンポポと読んだ (仮)。
   */
  const RECIPES = [
    ['ちび芝生', '三つ葉', 'クローバー芝生'],
    ['タンポポ', '綿毛', '綿毛の大群生'],
    ['ススキ', '黄金芝生', '黄金の草原'],
    ['四つ葉', '光る草', '幸運の光草'],
    ['水辺の草', 'ススキ', 'ホタル草'],
    ['星の草', '月光草', '宇宙草']
  ];

  /**
   * 牧場の広がり。最初は狭く。
   * 第3牧場の「水辺や岩場」と、幻想の牧場の大きさ・解放する草は仮 (写真は「水辺や岩場などの環境を追加」
   * 「夜・月・星に関係する伝説の草を解放」までしか書いていない)。
   */
  const FIELD_STEPS = [
    { name: '初期牧場', size: 4, unlock: ['ちび芝生', '三つ葉'], env: [] },
    { name: '第2牧場', size: 6, unlock: ['芽', 'タンポポ', 'ススキ'], env: [] },
    { name: '第3牧場', size: 8, unlock: ['水辺の草'], env: ['水辺', '岩場'] },
    { name: '幻想の牧場', size: 8, unlock: ['光る草'], env: ['夜', '月', '星'] }
  ];

  // ---- コイン (値段はすべて仮) ----------------------------------------
  // 草の値段 = レア度の基本 x 段。売るときはその半分。種を買う値段 = 草の値段。
  // 釣り合いはまだ取れていない (CLAUDE.md の「仮置き・未決」)。
  const BASE_PRICE = [10, 30, 100, 300, 1000];
  const LAND_PRICE = [0, 300, 1500, 8000]; // 牧場 step 番目へ広げる値段 (0 番目は最初から)
  const START_COINS = 30;

  // ---- 見た目 (データ) ------------------------------------------------
  // 草の見た目は「層」の並びで決める。描くのは plants.js。草を足すときはここに1行足すだけで、
  // 描画の処理は書き直さなくてよい (新しい種類の層が要るときだけ plants.js に足す)。
  // 画像が届いた草は IMAGES に「id: パス」を足す。画像があればそちらを使い、無ければ層から描く。
  //
  // 層の種類 (位置・大きさは植物の箱に対する割合 0〜1):
  //   blades  細い葉の束        n 本数 / h 高さ / spread 広がり / w 太さ / colors [根元, 先] / rib 葉脈の色
  //   heads   穂先の粒          n / color
  //   clover  クローバー        n 葉の数 / leaflets 小葉の数 / size / colors
  //   sprout  双葉の芽          color
  //   rosette 地面に広がる葉    n / size / colors / toothed ぎざぎざ
  //   flower  タンポポの花      n / h / size / color
  //   puff    綿毛の玉          n / h / size
  //   plume   ススキの穂        n / h / size / color
  //   drops   しずく            n
  //   sparkle 光の粒            n / color / glow 光らせるか
  //   tint    上から色をかける  colors / alpha (虹・星空など)
  //   crystal 透き通らせる      alpha
  // look の glow は、草が光る色。根元の土にも同じ色の照り返しを落とす (光を貼り付けたように見せないため)。
  const LAYER_TYPES = ['blades', 'heads', 'clover', 'sprout', 'rosette', 'flower', 'puff', 'plume', 'drops', 'sparkle', 'tint', 'crystal'];

  const G_YOUNG = ['#4f7a2a', '#a6cf5a'];
  const G_LAWN = ['#355f22', '#8fbf4c'];
  const G_DEEP = ['#264c1a', '#6fa63e'];
  const G_CLOVER = ['#2f6b2c', '#6fae4c'];
  const G_SUSUKI = ['#4d6a34', '#a9b97a'];

  const LOOKS = {
    chibi_shiba: { layers: [{ t: 'blades', n: 12, h: 0.32, spread: 0.3, w: 2.2, colors: G_YOUNG }] },
    fusafusa_shiba: { layers: [{ t: 'blades', n: 34, h: 0.5, spread: 0.55, w: 2.4, colors: G_LAWN }] },
    konmori_shiba: { layers: [{ t: 'blades', n: 80, h: 0.66, spread: 0.85, w: 2.6, colors: G_DEEP, dome: true }] },
    ougon_shiba: { glow: 'rgba(255,210,90,0.55)', layers: [
      { t: 'blades', n: 70, h: 0.68, spread: 0.8, w: 2.6, colors: ['#4a5a1c', '#c9b44a'], dome: true },
      { t: 'heads', n: 11, color: '#e8b830' }, { t: 'sparkle', n: 6, color: '#ffe9a0' }] },

    mitsuba: { layers: [{ t: 'clover', n: 4, leaflets: 3, size: 0.5, colors: G_CLOVER }] },
    yotsuba: { layers: [{ t: 'clover', n: 5, leaflets: 4, size: 0.56, colors: G_CLOVER }] },
    itsuba: { layers: [{ t: 'clover', n: 6, leaflets: 5, size: 0.6, colors: ['#2b6a3a', '#7cc06a'] }] },
    kouun_clover: { glow: 'rgba(190,255,150,0.5)', layers: [
      { t: 'clover', n: 7, leaflets: 4, size: 0.68, colors: ['#2f7a3a', '#9de07a'] }, { t: 'sparkle', n: 8, color: '#fff6c0', glow: true }] },

    tanpopo_me: { layers: [{ t: 'sprout', color: '#7fb04a' }] },
    tanpopo: { layers: [{ t: 'rosette', n: 10, size: 0.62, colors: ['#3a6a26', '#7fae46'], toothed: true },
      { t: 'flower', n: 1, h: 0.5, size: 0.25, color: '#f2c218' }] },
    watage: { layers: [{ t: 'rosette', n: 10, size: 0.62, colors: ['#3a6a26', '#7fae46'], toothed: true },
      { t: 'flower', n: 1, h: 0.42, size: 0.22, color: '#f2c218' }, { t: 'puff', n: 2, h: 0.72, size: 0.22 }] },
    kyodai_tanpopo: { layers: [{ t: 'rosette', n: 13, size: 0.78, colors: ['#335f22', '#86b44c'], toothed: true },
      { t: 'flower', n: 3, h: 0.62, size: 0.27, color: '#f5c010' }, { t: 'puff', n: 2, h: 0.85, size: 0.26 }] },

    susuki_me: { layers: [{ t: 'sprout', color: '#8aa75a' }, { t: 'blades', n: 3, h: 0.3, spread: 0.15, w: 2, colors: G_SUSUKI }] },
    susuki: { layers: [{ t: 'blades', n: 12, h: 0.78, spread: 0.45, w: 3, colors: G_SUSUKI, rib: 'rgba(255,255,240,0.6)' },
      { t: 'plume', n: 2, h: 0.92, size: 0.22, color: '#d9d2bd' }] },
    ooki_susuki: { layers: [{ t: 'blades', n: 20, h: 0.85, spread: 0.6, w: 3.2, colors: G_SUSUKI, rib: 'rgba(255,255,240,0.6)' },
      { t: 'plume', n: 4, h: 0.97, size: 0.26, color: '#e6dfcc' }] },
    ougon_susuki: { glow: 'rgba(255,200,80,0.45)', layers: [
      { t: 'blades', n: 20, h: 0.85, spread: 0.6, w: 3.2, colors: ['#6a5a24', '#d7b85a'], rib: 'rgba(255,240,200,0.7)' },
      { t: 'plume', n: 5, h: 0.97, size: 0.27, color: '#f0c45a' }, { t: 'sparkle', n: 6, color: '#ffe4a0' }] },

    hikaru_kusa: { glow: 'rgba(150,255,170,0.6)', layers: [
      { t: 'blades', n: 26, h: 0.58, spread: 0.6, w: 2.8, colors: ['#1f5a3a', '#6fd99a'], rib: 'rgba(210,255,220,0.95)' }] },
    hoshi_kusa: { glow: 'rgba(170,200,255,0.6)', layers: [
      { t: 'blades', n: 28, h: 0.62, spread: 0.65, w: 2.6, colors: ['#1f3a5a', '#7fa8e0'], rib: 'rgba(230,240,255,0.9)' },
      { t: 'sparkle', n: 14, color: '#ffffff', glow: true }] },
    gekkou_kusa: { glow: 'rgba(120,210,255,0.8)', layers: [
      { t: 'blades', n: 32, h: 0.7, spread: 0.7, w: 2.8, colors: ['#1d4a7a', '#c8f0ff'], rib: 'rgba(255,255,255,0.95)' },
      { t: 'sparkle', n: 8, color: '#e8fbff', glow: true }] },
    niji_kusa: { glow: 'rgba(230,180,255,0.7)', layers: [
      { t: 'blades', n: 30, h: 0.72, spread: 0.7, w: 3, colors: ['#5a6aa0', '#f0f4ff'], rib: 'rgba(255,255,255,0.95)' },
      { t: 'crystal', alpha: 0.8 },
      { t: 'tint', colors: ['#ff6a8a', '#ffd25a', '#7aff9a', '#5ad2ff', '#b07aff'], alpha: 0.45 },
      { t: 'sparkle', n: 10, color: '#ffffff', glow: true }] },

    zassou: { layers: [{ t: 'rosette', n: 9, size: 0.62, colors: ['#3f6a2a', '#8ab456'] },
      { t: 'blades', n: 14, h: 0.55, spread: 0.7, w: 2.8, colors: ['#4a6a2a', '#9ab85a'] }] },
    mizube_kusa: { layers: [{ t: 'blades', n: 16, h: 0.75, spread: 0.4, w: 2.6, colors: ['#22503f', '#6fb39a'], rib: 'rgba(220,255,240,0.5)' },
      { t: 'drops', n: 9 }] },
    clover_shiba: { layers: [{ t: 'blades', n: 30, h: 0.5, spread: 0.7, w: 2.4, colors: G_LAWN },
      { t: 'clover', n: 4, leaflets: 3, size: 0.42, colors: G_CLOVER }] },
    watage_daigunsei: { layers: [{ t: 'rosette', n: 9, size: 0.55, colors: ['#3a6a26', '#7fae46'], toothed: true },
      { t: 'puff', n: 6, h: 0.75, size: 0.2 }] },
    ougon_sougen: { glow: 'rgba(255,205,90,0.55)', layers: [
      { t: 'blades', n: 60, h: 0.7, spread: 0.9, w: 2.6, colors: ['#6a5418', '#e0c25a'], dome: true },
      { t: 'plume', n: 4, h: 0.92, size: 0.22, color: '#f2c45a' }, { t: 'heads', n: 8, color: '#f0c040' },
      { t: 'sparkle', n: 8, color: '#fff0b0' }] },
    kouun_hikarigusa: { glow: 'rgba(170,255,140,0.75)', layers: [
      { t: 'clover', n: 6, leaflets: 4, size: 0.62, colors: ['#2f8a4a', '#c8ffa0'] },
      { t: 'sparkle', n: 12, color: '#fffbd0', glow: true }] },
    hotaru_kusa: { glow: 'rgba(200,255,120,0.5)', layers: [
      { t: 'blades', n: 22, h: 0.72, spread: 0.55, w: 2.6, colors: ['#1d3a26', '#4f8a5a'] },
      { t: 'sparkle', n: 9, color: '#e4ff80', glow: true }] },
    uchuu_kusa: { glow: 'rgba(170,130,255,0.75)', layers: [
      { t: 'blades', n: 30, h: 0.78, spread: 0.7, w: 3, colors: ['#120f3a', '#4a3a9a'], rib: 'rgba(200,190,255,0.8)' },
      { t: 'tint', colors: ['#2a1a6a', '#5a2a9a', '#1a4a8a'], alpha: 0.35 },
      { t: 'sparkle', n: 18, color: '#ffffff', glow: true }] }
  };

  /** 届いた草の絵 (背景を抜いた PNG)。例: chibi_shiba: './img/chibi_shiba.png' */
  const IMAGES = {};

  // id は草ごとに手で決めた固定の文字列。保存データと図鑑の記録はこの id で持つので、
  // 並び順や段を足し替えても変わらないようにする (200種・300種へ増やすときに記録が壊れない)。
  // 名前は重なることがある (芽は2系統)。名前で引くときは findByName (同名は最初の系統が優先)。
  function buildSpecies() {
    const list = [];
    LINEAGES.forEach(function (l) {
      l.stages.forEach(function (s, i) {
        list.push({
          id: s[0], name: s[1], lineage: l.id, level: i + 1,
          rarity: s[2], note: s[3], look: LOOKS[s[0]] || null, image: IMAGES[s[0]] || null,
          next: i + 1 < l.stages.length ? l.stages[i + 1][0] : null
        });
      });
    });
    EXTRAS.forEach(function (s) {
      list.push({ id: s[0], name: s[1], lineage: null, level: 1, rarity: s[2], note: s[3], look: LOOKS[s[0]] || null, image: IMAGES[s[0]] || null, next: null });
    });
    return list;
  }

  const SPECIES = buildSpecies();
  const BY_ID = {};
  SPECIES.forEach(function (s) { BY_ID[s.id] = s; });

  function findByName(name) {
    for (let i = 0; i < SPECIES.length; i++) if (SPECIES[i].name === name) return SPECIES[i];
    return null;
  }

  // 芽 は 2 系統ある。レシピの相手は、名前から一意に引ける草だけを使っている。
  const RECIPE_MAP = {};
  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  RECIPES.forEach(function (r) {
    RECIPE_MAP[pairKey(findByName(r[0]).id, findByName(r[1]).id)] = findByName(r[2]).id;
  });

  /**
   * 草 a と b を重ねたときの結果。
   * 同じ草なら次の段、レシピの組なら特殊合成、どちらでもなければ null (合成できない)。
   * 戻り値: { id, special } か null。
   */
  function merge(a, b) {
    if (!BY_ID[a] || !BY_ID[b]) return null;
    if (a === b) {
      const next = BY_ID[a].next;
      return next ? { id: next, special: false } : null;
    }
    const r = RECIPE_MAP[pairKey(a, b)];
    return r ? { id: r, special: true } : null;
  }

  // ---- 牧場と図鑑 ----------------------------------------------------

  function createGame() {
    return {
      step: 0, cells: new Array(FIELD_STEPS[0].size * FIELD_STEPS[0].size).fill(null),
      coins: START_COINS, discovered: {}, recipesFound: {}
    };
  }

  function fieldSize(game) { return FIELD_STEPS[game.step].size; }

  function unlockedSpecies(game) {
    const names = [];
    for (let i = 0; i <= game.step; i++) FIELD_STEPS[i].unlock.forEach(function (n) { names.push(n); });
    const ids = [];
    names.forEach(function (n) {
      // 芽 は 2 系統あるので、名前に合う草をすべて出す
      SPECIES.forEach(function (s) { if (s.name === n && ids.indexOf(s.id) < 0) ids.push(s.id); });
    });
    return ids;
  }

  function discover(game, id) {
    if (game.discovered[id]) return false;
    game.discovered[id] = true;
    return true;
  }

  /** 空きマスに草を置く。置けたら true。図鑑にも載る。 */
  function place(game, index, id) {
    if (!BY_ID[id] || index < 0 || index >= game.cells.length || game.cells[index] !== null) return false;
    game.cells[index] = id;
    discover(game, id);
    return true;
  }

  /**
   * from のマスの草を to のマスの草に重ねる。
   * 合成できれば to に結果を置き、from を空にして { id, special, newlyFound } を返す。
   * できなければ null (何も変えない)。
   */
  function drop(game, from, to) {
    if (from === to) return null;
    const a = game.cells[from];
    const b = game.cells[to];
    if (a == null || b == null) return null;
    const r = merge(a, b);
    if (!r) return null;
    game.cells[from] = null;
    game.cells[to] = r.id;
    const newlyFound = discover(game, r.id);
    if (r.special) game.recipesFound[pairKey(a, b)] = r.id;
    return { id: r.id, special: r.special, newlyFound: newlyFound };
  }

  function price(id) { return BASE_PRICE[BY_ID[id].rarity] * BY_ID[id].level; }
  function sellPrice(id) { return Math.floor(price(id) / 2); }

  /** マスの草を売ってコインにする。図鑑の発見記録は消えない。売った額を返す (売れなければ null)。 */
  function sell(game, index) {
    const id = game.cells[index];
    if (id == null) return null;
    game.cells[index] = null;
    const gain = sellPrice(id);
    game.coins += gain;
    return gain;
  }

  /** 種を買って空きマスに置く。置けたら true。コイン不足・未解放・満杯なら何も変えない。 */
  function buySeed(game, id, index) {
    if (unlockedSpecies(game).indexOf(id) < 0) return false;
    if (game.coins < price(id)) return false;
    if (!place(game, index, id)) return false;
    game.coins -= price(id);
    return true;
  }

  /** 次の牧場へ広げる。いまのマスの並びはそのまま、新しい空きが増える。広げたら true。 */
  function expand(game) {
    const next = game.step + 1;
    if (next >= FIELD_STEPS.length || game.coins < LAND_PRICE[next]) return false;
    const oldSize = fieldSize(game);
    const size = FIELD_STEPS[next].size;
    const cells = new Array(size * size).fill(null);
    for (let i = 0; i < game.cells.length; i++) {
      cells[Math.floor(i / oldSize) * size + (i % oldSize)] = game.cells[i];
    }
    game.coins -= LAND_PRICE[next];
    game.step = next;
    game.cells = cells;
    return true;
  }

  /** 草を空きマスへ動かす。動かせたら true。 */
  function move(game, from, to) {
    if (from === to || game.cells[from] == null || to < 0 || to >= game.cells.length || game.cells[to] !== null) return false;
    game.cells[to] = game.cells[from];
    game.cells[from] = null;
    return true;
  }

  /**
   * 種をまく (試作品では無料)。解放済みの Lv.1 の草を、空きマスのどこかに1つ生やす。
   * 生えたマスの番号を返す。空きが無ければ -1。rng を渡せば結果を再現できる。
   */
  function plant(game, rng) {
    const random = rng || Math.random;
    const empty = [];
    game.cells.forEach(function (c, i) { if (c === null) empty.push(i); });
    if (!empty.length) return -1;
    const seeds = unlockedSpecies(game).filter(function (id) { return BY_ID[id].level === 1; });
    const index = empty[Math.floor(random() * empty.length)];
    place(game, index, seeds[Math.floor(random() * seeds.length)]);
    return index;
  }

  /** 図鑑の番号 (No.001 から)。並びは SPECIES の順。 */
  function number(id) { return SPECIES.indexOf(BY_ID[id]) + 1; }

  function speciesOf(id) { return BY_ID[id] || null; }

  /**
   * 未発見の草に出すヒント。答えそのものは出さない。
   * 系統の草は、ひとつ前の段を見つけていれば「それを2つ重ねる」と分かる。
   */
  function hint(game, id) {
    const s = BY_ID[id];
    if (s.lineage) {
      if (s.level === 1) return '牧場に種をまくと生えてくるかも。';
      const prev = SPECIES.filter(function (p) { return p.next === id; })[0];
      return game.discovered[prev.id] ? prev.name + 'を2つ重ねてみよう。' : '同じ草を重ねて育てた先にある。';
    }
    for (let i = 0; i < RECIPES.length; i++) {
      if (RECIPES[i][2] === s.name) return '異なる草を組み合わせよう。';
    }
    return 'まだ見つけ方が分からない。';
  }

  // ---- 保存 ----------------------------------------------------------

  /** 保存用の文字列にする。 */
  function save(game) {
    return JSON.stringify({ v: 1, step: game.step, cells: game.cells, coins: game.coins,
      discovered: Object.keys(game.discovered), recipesFound: game.recipesFound });
  }

  /** 保存した文字列から戻す。壊れていたり、知らない草が入っていたら、そこだけ捨てる。 */
  function load(text) {
    const game = createGame();
    let d;
    try { d = JSON.parse(text); } catch (e) { return game; }
    if (!d || d.v !== 1) return game;
    if (Number.isInteger(d.step) && d.step >= 0 && d.step < FIELD_STEPS.length) game.step = d.step;
    const n = FIELD_STEPS[game.step].size * FIELD_STEPS[game.step].size;
    game.cells = new Array(n).fill(null);
    if (Array.isArray(d.cells)) {
      for (let i = 0; i < n && i < d.cells.length; i++) if (BY_ID[d.cells[i]]) game.cells[i] = d.cells[i];
    }
    if (typeof d.coins === 'number' && d.coins >= 0) game.coins = Math.floor(d.coins);
    (Array.isArray(d.discovered) ? d.discovered : []).forEach(function (id) { if (BY_ID[id]) game.discovered[id] = true; });
    if (d.recipesFound && typeof d.recipesFound === 'object') {
      Object.keys(d.recipesFound).forEach(function (k) {
        if (BY_ID[d.recipesFound[k]]) game.recipesFound[k] = d.recipesFound[k];
      });
    }
    return game;
  }

  /** 図鑑の進み具合。 */
  function collection(game) {
    const found = SPECIES.filter(function (s) { return game.discovered[s.id]; }).length;
    return { found: found, total: SPECIES.length };
  }

  return {
    RARITIES: RARITIES, LAYER_TYPES: LAYER_TYPES, LINEAGES: LINEAGES, SPECIES: SPECIES, RECIPES: RECIPES, FIELD_STEPS: FIELD_STEPS,
    findByName: findByName, merge: merge, createGame: createGame, fieldSize: fieldSize,
    unlockedSpecies: unlockedSpecies, price: price, sellPrice: sellPrice, sell: sell, buySeed: buySeed, expand: expand, LAND_PRICE: LAND_PRICE, place: place, drop: drop, collection: collection,
    move: move, plant: plant, number: number, speciesOf: speciesOf, hint: hint, save: save, load: load, RARITY_NAMES: RARITIES,
    mulberry32: mulberry32,
    shuffle: shuffle,
    roll: roll
  };
});
