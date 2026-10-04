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
    { id: 'nobana', name: '野の花', stages: [
      ['hakobe', 'ハコベ', 0, '春の七草のひとつ。小さな白い花が星のように咲く。'],
      ['hinagiku', 'ヒナギク', 0, '白い花びらが朝に開き、夕方に閉じる。'],
      ['sumire', 'スミレ', 1, '石垣のすき間にも咲く、すみれ色の花。'],
      ['wasurenagusa', 'ワスレナグサ', 2, '「わたしを忘れないで」の名を持つ、空色の小さな花。']
    ] },
    { id: 'gensou', name: '幻想草', stages: [
      ['hikaru_kusa', '光る草', 2, ''], ['hoshi_kusa', '星の草', 3, ''], ['gekkou_kusa', '月光草', 3, ''], ['niji_kusa', '虹の草', 3, '']
    ] }
  ];

  /** 系統に入らない草 (特殊合成の入口・出口)。 */
  const EXTRAS = [
    ['zassou', '雑草', 0, ''], ['mizube_kusa', '水辺の草', 0, ''],
    ['hotokenoza', 'ホトケノザ', 1, '重なった葉が、仏さまの座る台のように見える。'],
    ['oobako', 'オオバコ', 1, '踏まれるほど強くなる、道ばたの草。'],
    ['gishigishi', 'ギシギシ', 1, '湿った野原にすっと立つ、大きな葉の草。'],
    ['clover_shiba', 'クローバー芝生', 1, ''], ['watage_daigunsei', '綿毛の大群生', 2, ''], ['ougon_sougen', '黄金の草原', 3, ''],
    ['kouun_hikarigusa', '幸運の光草', 3, ''], ['hotaru_kusa', 'ホタル草', 2, ''], ['uchuu_kusa', '宇宙草', 4, '']
  ];

  /**
   * 特殊合成のレシピ (順不同)。[草A, 草B, できる草, 見つける前に出すヒント]。
   * はじめの 6 つは画面写真の「特殊合成レシピ案」そのまま。野草の 3 つはあとから足した。
   * 「芝生」はちび芝生、「クローバー」は三つ葉、「綿毛」は系統の綿毛、
   * 「タンポポ」はLv.2 のタンポポと読んだ (仮)。
   */
  const RECIPES = [
    ['ちび芝生', '三つ葉', 'クローバー芝生', '芝生とクローバーを、いっしょに育ててみよう。'],
    ['タンポポ', '綿毛', '綿毛の大群生', '咲いた花と、飛び立つ前の綿毛を合わせてみよう。'],
    ['ススキ', '黄金芝生', '黄金の草原', '背の高い草と、金色に実った草を合わせてみよう。'],
    ['四つ葉', '光る草', '幸運の光草', '幸運の葉と、光る草を合わせてみよう。'],
    ['水辺の草', 'ススキ', 'ホタル草', '水辺の植物と背の高い草を組み合わせてみよう。'],
    ['星の草', '月光草', '宇宙草', '星の草と月の草を合わせてみよう。'],
    ['三つ葉', 'ハコベ', 'ホトケノザ', '三枚の葉と、小さな白い花を合わせてみよう。'],
    ['ちび芝生', 'ハコベ', 'オオバコ', '芝生の芽と、小さな白い花を合わせてみよう。'],
    ['ふさふさ芝生', 'ヒナギク', 'ギシギシ', '育った芝生と、白い花びらの花を合わせてみよう。']
  ];

  /**
   * 牧場の広がり (マスの数)。最初は狭く。土地を広げる画面はまだ無い。
   * 新しい草の解放は、土地ではなく図鑑の発見で決める (下の SEED_UNLOCKS)。
   * 第3牧場の「水辺や岩場」と、幻想の牧場の大きさは仮。
   */
  const FIELD_STEPS = [
    { name: '初期牧場', size: 4, env: [] },
    { name: '第2牧場', size: 6, env: [] },
    { name: '第3牧場', size: 8, env: ['水辺', '岩場'] },
    { name: '幻想の牧場', size: 8, env: ['夜', '月', '星'] }
  ];

  /**
   * 種として生える草 (Lv.1)。最初から出るもの / 図鑑で「これを見つけたら」増えるもの。
   * 解放は発見の記録から毎回計算する。記録は売っても消えないので、一度開いたら閉じない。
   * 解放の条件は、どれも「系統の同じ段まで育てる」形にそろえてある (hint がそう読んで文にする)。
   */
  const START_SEEDS = ['chibi_shiba', 'mitsuba', 'hakobe'];
  const SEED_UNLOCKS = [
    { id: 'tanpopo_me', need: ['konmori_shiba'] },                         // 芝生を 3 段目まで
    { id: 'susuki_me', need: ['itsuba'] },                                  // クローバーを 3 段目まで
    { id: 'mizube_kusa', need: ['sumire'] },                                // 野の花を 3 段目まで
    { id: 'hikaru_kusa', need: ['ougon_shiba', 'kouun_clover', 'wasurenagusa'] } // 3 系統を最後まで
  ];

  // ---- コイン (値段はすべて仮) ----------------------------------------
  // 草の値段 = レア度の基本 x 段。売るときはその半分。種を買う値段 = 草の値段。
  // 釣り合いはまだ取れていない (CLAUDE.md の「仮置き・未決」)。
  const BASE_PRICE = [10, 30, 100, 300, 1000];
  const LAND_PRICE = [0, 300, 1500, 8000]; // 牧場 step 番目へ広げる値段 (0 番目は最初から)
  const START_COINS = 30;

  // id は草ごとに手で決めた固定の文字列。保存データと図鑑の記録はこの id で持つので、
  // 並び順や段を足し替えても変わらないようにする (200種・300種へ増やすときに記録が壊れない)。
  // 名前は重なることがある (芽は2系統)。名前で引くときは findByName (同名は最初の系統が優先)。
  function buildSpecies() {
    const list = [];
    LINEAGES.forEach(function (l) {
      l.stages.forEach(function (s, i) {
        list.push({
          id: s[0], name: s[1], lineage: l.id, level: i + 1,
          rarity: s[2], note: s[3],
          next: i + 1 < l.stages.length ? l.stages[i + 1][0] : null
        });
      });
    });
    EXTRAS.forEach(function (s) {
      list.push({ id: s[0], name: s[1], lineage: null, level: 1, rarity: s[2], note: s[3], next: null });
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

  /** いま種として出る草 (id の並び)。発見の記録から計算する。 */
  function unlockedSpecies(game) {
    const ids = START_SEEDS.slice();
    SEED_UNLOCKS.forEach(function (u) {
      if (u.need.every(function (n) { return game.discovered[n]; })) ids.push(u.id);
    });
    return ids;
  }

  /** 種の呼び名。芽は 2 系統あるので、系統の名前を付ける (タンポポの芽)。 */
  function seedLabel(id) {
    const s = BY_ID[id];
    if (s.name !== '芽') return s.name;
    return LINEAGES.filter(function (l) { return l.id === s.lineage; })[0].name + 'の芽';
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
   * 未発見の草に出すヒント。答え (その草の名前) は出さない。
   * 手がかりは、いま分かっていることに合わせて具体的になる:
   *   系統の草: ひとつ前を見つけていれば「それを2つ重ねる」。まだなら、いちばん進んだ草から「あと何段階」
   *   最初の草: 種から生えるか、図鑑でどこまで進めると種に加わるか
   *   特殊合成: 材料を1つ見つければ「その草と、もう1種」、両方見つければ組み合わせそのもの
   */
  function hint(game, id) {
    const s = BY_ID[id];
    if (s.lineage && s.level > 1) {
      const chain = SPECIES.filter(function (p) { return p.lineage === s.lineage; });
      const prev = chain[s.level - 2];
      if (game.discovered[prev.id]) return '「' + prev.name + '」を2つ重ねてみよう。';
      // 見つけた中でいちばん進んだ草 (何も無ければ、系統の最初の草) から、あと何段階か
      let best = chain[0];
      chain.forEach(function (p) { if (p.level < s.level && game.discovered[p.id]) best = p; });
      return '「' + best.name + '」から、あと' + (s.level - best.level) + '段階育てた先にいる。';
    }
    if (START_SEEDS.indexOf(id) >= 0) return '種をまくと生えてくる。';
    const rule = SEED_UNLOCKS.filter(function (u) { return u.id === id; })[0];
    if (rule) {
      if (unlockedSpecies(game).indexOf(id) >= 0) return '種をまくと生えてくる。';
      const needs = rule.need.map(function (n) { return BY_ID[n]; });
      const done = needs.filter(function (n) { return game.discovered[n.id]; }).length;
      const lineageName = function (n) { return LINEAGES.filter(function (l) { return l.id === n.lineage; })[0].name; };
      const sameLevel = needs.every(function (n) { return n.level === needs[0].level; });
      const what = sameLevel
        ? needs.map(lineageName).join('・') + 'の系統を' + needs[0].level + '段目まで育てる'
        : needs.map(function (n) { return '「' + n.name + '」'; }).join('') + 'を見つける';
      return what + 'と、種に加わる' + (needs.length > 1 ? '（' + done + '/' + needs.length + '）' : '') + '。';
    }
    for (let i = 0; i < RECIPES.length; i++) {
      if (RECIPES[i][2] !== s.name) continue;
      const a = findByName(RECIPES[i][0]), b = findByName(RECIPES[i][1]);
      const have = [a, b].filter(function (m) { return game.discovered[m.id]; });
      if (have.length === 2) return '「' + a.name + '」と「' + b.name + '」を重ねてみよう。';
      if (have.length === 1) return '「' + have[0].name + '」と、もう1種を重ねてみよう。';
      return RECIPES[i][3] || '異なる草を組み合わせよう。';
    }
    return 'どこで出会えるのか、まだ分かっていない。';
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
    RARITIES: RARITIES, LINEAGES: LINEAGES, SPECIES: SPECIES, RECIPES: RECIPES, FIELD_STEPS: FIELD_STEPS,
    findByName: findByName, merge: merge, createGame: createGame, fieldSize: fieldSize,
    unlockedSpecies: unlockedSpecies, seedLabel: seedLabel, START_SEEDS: START_SEEDS, SEED_UNLOCKS: SEED_UNLOCKS, price: price, sellPrice: sellPrice, sell: sell, buySeed: buySeed, expand: expand, LAND_PRICE: LAND_PRICE, place: place, drop: drop, collection: collection,
    move: move, plant: plant, number: number, speciesOf: speciesOf, hint: hint, save: save, load: load, RARITY_NAMES: RARITIES,
    mulberry32: mulberry32,
    shuffle: shuffle,
    roll: roll
  };
});
