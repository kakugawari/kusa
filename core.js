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
      ['ちび芝生', 0, '小さな草の芽。初めて牧場に生えた草。'],
      ['ふさふさ芝生', 0, '葉が増えて丸くなる。'],
      ['こんもり芝生', 1, '大きな緑のかたまり。'],
      ['黄金芝生', 2, '金色の穂が生える珍しい芝生。']
    ] },
    { id: 'clover', name: 'クローバー', stages: [
      ['三つ葉', 0, ''], ['四つ葉', 1, ''], ['五つ葉', 2, ''], ['幸運のクローバー', 2, '']
    ] },
    { id: 'tanpopo', name: 'タンポポ', stages: [
      ['芽', 0, ''], ['タンポポ', 1, ''], ['綿毛', 2, ''], ['巨大タンポポ', 2, '']
    ] },
    { id: 'susuki', name: 'ススキ', stages: [
      ['芽', 0, ''], ['ススキ', 1, ''], ['大きなススキ', 2, ''], ['黄金のススキ', 2, '']
    ] },
    { id: 'gensou', name: '幻想草', stages: [
      ['光る草', 2, ''], ['星の草', 3, ''], ['月光草', 3, ''], ['虹の草', 3, '']
    ] }
  ];

  /** 系統に入らない草 (特殊合成の入口・出口)。 */
  const EXTRAS = [
    ['雑草', 0, ''], ['水辺の草', 0, ''],
    ['クローバー芝生', 1, ''], ['綿毛の大群生', 2, ''], ['黄金の草原', 3, ''],
    ['幸運の光草', 3, ''], ['ホタル草', 2, ''], ['宇宙草', 4, '']
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
  // 草の値段 = レア度の基本 x 段。売るときはその半分。
  // 種を買う値段 = 草の値段 (買った草を重ねて育てるより、買うほうが得にならない)。
  const BASE_PRICE = [10, 30, 100, 300, 1000];
  const LAND_PRICE = [0, 300, 1500, 8000]; // 牧場 step 番目へ広げる値段 (0 番目は最初から)
  const START_COINS = 30;

  // 名前の重複 (芽は2系統) を避けるため、id は「系統:段」にする。
  // 名前で引くときは findByName (同名は最初の系統が優先)。
  function buildSpecies() {
    const list = [];
    LINEAGES.forEach(function (l) {
      l.stages.forEach(function (s, i) {
        list.push({
          id: l.id + ':' + (i + 1), name: s[0], lineage: l.id, level: i + 1,
          rarity: s[1], note: s[2],
          next: i + 1 < l.stages.length ? l.id + ':' + (i + 2) : null
        });
      });
    });
    EXTRAS.forEach(function (s, i) {
      list.push({ id: 'x:' + (i + 1), name: s[0], lineage: null, level: 1, rarity: s[1], note: s[2], next: null });
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

  /** 図鑑の進み具合。 */
  function collection(game) {
    const found = SPECIES.filter(function (s) { return game.discovered[s.id]; }).length;
    return { found: found, total: SPECIES.length };
  }

  return {
    RARITIES: RARITIES, LINEAGES: LINEAGES, SPECIES: SPECIES, RECIPES: RECIPES, FIELD_STEPS: FIELD_STEPS,
    findByName: findByName, merge: merge, createGame: createGame, fieldSize: fieldSize,
    unlockedSpecies: unlockedSpecies, price: price, sellPrice: sellPrice, sell: sell, buySeed: buySeed, expand: expand, LAND_PRICE: LAND_PRICE, place: place, drop: drop, collection: collection,
    mulberry32: mulberry32,
    shuffle: shuffle,
    roll: roll
  };
});
