const test = require('node:test');
const assert = require('node:assert');
const Core = require('./core.js');

test('同じ seed からは同じ数が出る', () => {
  const a = Core.mulberry32(42);
  const b = Core.mulberry32(42);
  for (let i = 0; i < 10; i++) assert.strictEqual(a(), b());
});

test('seed が違えば並びも変わる', () => {
  const a = Core.mulberry32(1);
  const b = Core.mulberry32(2);
  assert.notStrictEqual(a(), b());
});

test('shuffle は中身を減らさない', () => {
  const source = [1, 2, 3, 4, 5, 6, 7, 8];
  const mixed = Core.shuffle(source.slice(), Core.mulberry32(7));
  assert.deepStrictEqual(mixed.slice().sort((x, y) => x - y), source);
});

test('roll は 1〜6 を返す', () => {
  const rng = Core.mulberry32(3);
  for (let i = 0; i < 100; i++) {
    const value = Core.roll(rng);
    assert.ok(Number.isInteger(value) && value >= 1 && value <= 6, `1〜6 のはず: ${value}`);
  }
});

// ---- kusa ----
const id = (name) => Core.findByName(name).id;

test('同じ草を2つ重ねると次の段になる', () => {
  assert.deepStrictEqual(Core.merge(id('ちび芝生'), id('ちび芝生')), { id: id('ふさふさ芝生'), special: false });
});

test('系統のいちばん上は、同じ草でもこれ以上進化しない', () => {
  assert.strictEqual(Core.merge(id('黄金芝生'), id('黄金芝生')), null);
});

test('どの系統も、全段を順にたどって最後まで進化できる', () => {
  Core.LINEAGES.forEach((l) => {
    let cur = l.stages[0][0];
    for (let i = 1; i < l.stages.length; i++) {
      const r = Core.merge(cur, cur);
      assert.ok(r, `${l.name} の ${i} 段で止まった`);
      cur = r.id;
    }
    assert.strictEqual(Core.merge(cur, cur), null);
  });
});

test('特殊合成は組の順番によらず同じ結果になる', () => {
  Core.RECIPES.forEach(([a, b, out]) => {
    assert.strictEqual(Core.merge(id(a), id(b)).id, id(out), `${a}+${b}`);
    assert.strictEqual(Core.merge(id(b), id(a)).id, id(out), `${b}+${a}`);
    assert.strictEqual(Core.merge(id(a), id(b)).special, true);
  });
});

test('レシピに無い組は合成できない', () => {
  assert.strictEqual(Core.merge(id('ちび芝生'), id('ススキ')), null);
});

test('名前で引くレシピの草が、すべて存在する', () => {
  Core.RECIPES.forEach((r) => r.slice(0, 3).forEach((n) => assert.ok(Core.findByName(n), `${n} が無い`)));
});

test('草の id は固定の文字列で、名前や並びから作っていない', () => {
  assert.strictEqual(id('ちび芝生'), 'chibi_shiba');
  Core.SPECIES.forEach((s) => assert.match(s.id, /^[a-z_]+$/, s.name));
});

test('草の id は重ならず、レア度は表の範囲に収まる', () => {
  const ids = Core.SPECIES.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  Core.SPECIES.forEach((s) => assert.ok(s.rarity >= 0 && s.rarity < Core.RARITIES.length, s.name));
});

test('牧場は 4x4 から始まり、芝生・クローバー・野の花 (ハコベ) が出る', () => {
  const g = Core.createGame();
  assert.strictEqual(Core.fieldSize(g), 4);
  assert.strictEqual(g.cells.length, 16);
  assert.deepStrictEqual(Core.unlockedSpecies(g), [id('ちび芝生'), id('三つ葉'), id('ハコベ')]);
});

test('野の花の系統: ハコベ → ヒナギク → スミレ → ワスレナグサ', () => {
  assert.strictEqual(Core.merge(id('ハコベ'), id('ハコベ')).id, id('ヒナギク'));
  assert.strictEqual(Core.merge(id('ヒナギク'), id('ヒナギク')).id, id('スミレ'));
  assert.strictEqual(Core.merge(id('スミレ'), id('スミレ')).id, id('ワスレナグサ'));
  assert.strictEqual(Core.merge(id('ワスレナグサ'), id('ワスレナグサ')), null);
});

test('野草の特殊合成は、最初の牧場で出る草だけで見つけられる (詰まない)', () => {
  // 最初に生える Lv.1 と、それを重ねて育つ草だけで、レシピの両方の草がそろうこと
  const g = Core.createGame();
  const reach = new Set(Core.unlockedSpecies(g));
  let grew = true;
  while (grew) {
    grew = false;
    [...reach].forEach((a) => {
      const r = Core.merge(a, a);
      if (r && !reach.has(r.id)) { reach.add(r.id); grew = true; }
    });
  }
  [['三つ葉', 'ハコベ', 'ホトケノザ'], ['ちび芝生', 'ハコベ', 'オオバコ'], ['ふさふさ芝生', 'ヒナギク', 'ギシギシ']].forEach(([a, b, out]) => {
    assert.ok(reach.has(id(a)) && reach.has(id(b)), `${out} の材料がそろわない`);
    assert.strictEqual(Core.merge(id(a), id(b)).id, id(out));
  });
});

test('特殊合成のレシピには、どれもヒントがある', () => {
  Core.RECIPES.forEach((r) => assert.ok(r[3] && r[3].length > 4, `${r[2]} のヒントが無い`));
});

test('置くと図鑑に載り、重ねると合成して元のマスが空く', () => {
  const g = Core.createGame();
  const a = id('ちび芝生');
  assert.ok(Core.place(g, 0, a));
  assert.ok(Core.place(g, 1, a));
  assert.strictEqual(Core.place(g, 1, a), false, '埋まっているマスには置けない');
  const r = Core.drop(g, 0, 1);
  assert.deepStrictEqual(r, { id: id('ふさふさ芝生'), special: false, newlyFound: true });
  assert.strictEqual(g.cells[0], null);
  assert.strictEqual(g.cells[1], id('ふさふさ芝生'));
  assert.deepStrictEqual(Core.collection(g), { found: 2, total: Core.SPECIES.length });
});

test('合成できない組を重ねても、何も変わらない', () => {
  const g = Core.createGame();
  Core.place(g, 0, id('ちび芝生'));
  Core.place(g, 1, id('ススキ'));
  assert.strictEqual(Core.drop(g, 0, 1), null);
  assert.strictEqual(g.cells[0], id('ちび芝生'));
  assert.strictEqual(g.cells[1], id('ススキ'));
});

test('特殊合成すると、レシピが発見済みに記録される', () => {
  const g = Core.createGame();
  Core.place(g, 0, id('ちび芝生'));
  Core.place(g, 1, id('三つ葉'));
  // ちび芝生 + 三つ葉 はレシピ (クローバー芝生)
  const r = Core.drop(g, 0, 1);
  assert.strictEqual(r.special, true);
  assert.strictEqual(r.id, id('クローバー芝生'));
  assert.strictEqual(Object.keys(g.recipesFound).length, 1);
});

test('草を売るとコインになり、図鑑の発見記録は消えない', () => {
  const g = Core.createGame();
  const a = id('ちび芝生');
  Core.place(g, 0, a);
  const before = g.coins;
  assert.strictEqual(Core.sell(g, 0), Core.sellPrice(a));
  assert.strictEqual(g.coins, before + Core.sellPrice(a));
  assert.strictEqual(g.cells[0], null);
  assert.strictEqual(Core.collection(g).found, 1);
  assert.strictEqual(Core.sell(g, 0), null, '空のマスは売れない');
});

test('種は、解放済みで、コインが足りて、空きがあるときだけ買える', () => {
  const g = Core.createGame();
  assert.strictEqual(Core.buySeed(g, id('ススキ'), 0), false, 'まだ解放されていない');
  assert.strictEqual(g.coins, Core.createGame().coins);
  assert.ok(Core.buySeed(g, id('ちび芝生'), 0));
  assert.strictEqual(g.coins, Core.createGame().coins - Core.price(id('ちび芝生')));
  assert.strictEqual(Core.buySeed(g, id('ちび芝生'), 0), false, '埋まっている');
  g.coins = 0;
  assert.strictEqual(Core.buySeed(g, id('ちび芝生'), 1), false, 'コイン不足');
  assert.strictEqual(g.cells[1], null);
});

test('土地を広げても、草は同じ位置に残り、新しい草が解放される', () => {
  const g = Core.createGame();
  Core.place(g, 5, id('ちび芝生')); // 4x4 の 1 行 1 列
  g.coins = Core.LAND_PRICE[1];
  assert.ok(Core.expand(g));
  assert.strictEqual(Core.fieldSize(g), 6);
  assert.strictEqual(g.cells.length, 36);
  assert.strictEqual(g.cells[1 * 6 + 1], id('ちび芝生'));
  assert.strictEqual(g.cells.filter((c) => c !== null).length, 1);
  assert.strictEqual(g.coins, 0);
  assert.ok(Core.unlockedSpecies(g).indexOf(id('ススキ')) >= 0);
});

test('コインが足りないと土地は広がらない。最後の牧場より先は無い', () => {
  const g = Core.createGame();
  g.coins = Core.LAND_PRICE[1] - 1;
  assert.strictEqual(Core.expand(g), false);
  assert.strictEqual(Core.fieldSize(g), 4);
  g.coins = 1e9;
  while (Core.expand(g));
  assert.strictEqual(g.step, Core.FIELD_STEPS.length - 1);
});

test('草は空きマスへだけ動かせる', () => {
  const g = Core.createGame();
  Core.place(g, 0, id('ちび芝生'));
  Core.place(g, 1, id('三つ葉'));
  assert.strictEqual(Core.move(g, 0, 1), false);
  assert.ok(Core.move(g, 0, 2));
  assert.strictEqual(g.cells[0], null);
  assert.strictEqual(g.cells[2], id('ちび芝生'));
});

test('種をまくと、空きマスに Lv.1 の解放済みの草が1つ生え、満杯なら -1', () => {
  const g = Core.createGame();
  const rng = Core.mulberry32(5);
  const seeds = [id('ちび芝生'), id('三つ葉'), id('ハコベ')];
  for (let i = 0; i < 16; i++) {
    const at = Core.plant(g, rng);
    assert.ok(at >= 0);
    assert.ok(seeds.includes(g.cells[at]));
  }
  assert.strictEqual(g.cells.filter((c) => c === null).length, 0);
  assert.strictEqual(Core.plant(g, rng), -1);
});

test('最初の目標: 種をまいて芝生を重ねていくと、レアの黄金芝生まで届く (4x4 の中で)', () => {
  // ちび芝生だけを拾って重ねる。三つ葉は売って場所を空ける
  const g = Core.createGame();
  const rng = Core.mulberry32(11);
  const gold = id('黄金芝生');
  for (let turn = 0; turn < 500 && !g.discovered[gold]; turn++) {
    if (Core.plant(g, rng) < 0) {
      // 芝生でない草を1つ売って場所を空ける
      const other = g.cells.findIndex((c) => c && Core.speciesOf(c).lineage !== 'shiba');
      assert.ok(other >= 0, '芝生しか無いのに満杯になった (詰んだ)');
      Core.sell(g, other);
    }
    // 同じ草の組をすべて重ねる
    let merged = true;
    while (merged) {
      merged = false;
      for (let a = 0; a < g.cells.length && !merged; a++) {
        for (let b = a + 1; b < g.cells.length && !merged; b++) {
          if (g.cells[a] && g.cells[a] === g.cells[b] && Core.drop(g, a, b)) merged = true;
        }
      }
    }
  }
  assert.ok(g.discovered[gold], '黄金芝生に届かなかった');
  assert.strictEqual(Core.speciesOf(gold).rarity, 2);
});

test('ヒントは答えの名前を出さず、いま分かっていることに合わせて具体的になる', () => {
  const g = Core.createGame();
  // 系統の2〜4段目は、段ごとに違う手がかりが出る (前は全部同じ文だった)
  const shiba = ['ふさふさ芝生', 'こんもり芝生', '黄金芝生'].map((n) => Core.hint(g, id(n)));
  assert.strictEqual(new Set(shiba).size, 3, `段ごとに違うヒント: ${shiba.join(' / ')}`);
  shiba.forEach((h) => assert.ok(h.includes('ちび芝生'), `起点の草が分かる: ${h}`));
  assert.ok(Core.hint(g, id('黄金芝生')).includes('3'), 'あと何段階かが分かる');
  Core.place(g, 0, id('ちび芝生'));
  assert.strictEqual(Core.hint(g, id('ふさふさ芝生')), '「ちび芝生」を2つ重ねてみよう。');
  assert.ok(Core.hint(g, id('こんもり芝生')).includes('あと2段階'), Core.hint(g, id('こんもり芝生')));
  Core.place(g, 1, id('ふさふさ芝生'));
  assert.strictEqual(Core.hint(g, id('こんもり芝生')), '「ふさふさ芝生」を2つ重ねてみよう。');
  assert.ok(Core.hint(g, id('黄金芝生')).includes('「ふさふさ芝生」から、あと2段階'), Core.hint(g, id('黄金芝生')));
});

test('最初の草のヒントは、種から生えるか、牧場を広げないと生えないかを正しく言う', () => {
  const g = Core.createGame();
  ['ちび芝生', '三つ葉', 'ハコベ'].forEach((n) => assert.strictEqual(Core.hint(g, id(n)), '種をまくと生えてくる。', n));
  // 最初は生えない草に「種をまくと生える」と言ってはいけない (前は言っていた)
  const locked = Core.SPECIES.filter((s) => s.level === 1 && !Core.unlockedSpecies(g).includes(s.id) && !Core.RECIPES.some((r) => r[2] === s.name) && s.name !== '雑草');
  assert.ok(locked.length >= 4, '芽 2 つ・水辺の草・光る草');
  locked.forEach((s) => assert.ok(!Core.hint(g, s.id).includes('種をまくと'), `${s.name}: ${Core.hint(g, s.id)}`));
  assert.ok(Core.hint(g, id('光る草')).includes('幻想の牧場'));
  assert.ok(Core.hint(g, id('水辺の草')).includes('第3牧場'));
  // 広げたあとは、種をまくと生える
  g.step = 1;
  assert.strictEqual(Core.hint(g, Core.SPECIES.filter((s) => s.name === '芽')[0].id), '種をまくと生えてくる。');
});

test('特殊合成のヒントは、材料を見つけるほど具体的になる', () => {
  const g = Core.createGame();
  const base = Core.RECIPES.filter((r) => r[2] === 'ホトケノザ')[0][3];
  assert.strictEqual(Core.hint(g, id('ホトケノザ')), base);
  Core.place(g, 0, id('三つ葉'));
  assert.strictEqual(Core.hint(g, id('ホトケノザ')), '「三つ葉」と、もう1種を重ねてみよう。');
  Core.place(g, 1, id('ハコベ'));
  assert.strictEqual(Core.hint(g, id('ホトケノザ')), '「三つ葉」と「ハコベ」を重ねてみよう。');
  // 出どころが決まっていない草は、そう言う
  assert.ok(Core.hint(g, id('雑草')).includes('分かっていない'));
});

test('どの草のヒントも空でなく、どんな状態でも答えの名前を出さない', () => {
  const states = [Core.createGame()];
  const some = Core.createGame();
  ['ちび芝生', '三つ葉', 'ハコベ', 'ふさふさ芝生', 'ヒナギク'].forEach((n, i) => Core.place(some, i, id(n)));
  states.push(some);
  const all = Core.createGame();
  Core.SPECIES.forEach((s) => { all.discovered[s.id] = true; });
  states.push(all);
  states.forEach((g) => Core.SPECIES.forEach((s) => {
    const h = Core.hint(g, s.id);
    assert.ok(h && h.endsWith('。'), `${s.name} のヒントが文になっていない: ${h}`);
    assert.ok(!h.includes(s.name), `${s.name} のヒントに名前が出ている: ${h}`);
  }));
});

test('保存して戻すと同じ状態になり、壊れたデータや知らない草は捨てる', () => {
  const g = Core.createGame();
  Core.place(g, 0, id('ちび芝生'));
  Core.place(g, 1, id('三つ葉'));
  Core.drop(g, 0, 1);
  const back = Core.load(Core.save(g));
  assert.deepStrictEqual(back, g);
  assert.deepStrictEqual(Core.load('こわれた'), Core.createGame());
  const odd = JSON.parse(Core.save(g));
  odd.cells[2] = 'no_such_grass';
  odd.discovered.push('no_such_grass');
  const cleaned = Core.load(JSON.stringify(odd));
  assert.strictEqual(cleaned.cells[2], null);
  assert.ok(!cleaned.discovered.no_such_grass);
});

test('図鑑の番号は 1 から、重ならない', () => {
  const nums = Core.SPECIES.map((s) => Core.number(s.id));
  assert.strictEqual(nums[0], 1);
  assert.strictEqual(new Set(nums).size, nums.length);
});

const Looks = require('./looks.js');

test('どの草にも見た目のデータがあり、知っている層だけを使っている', () => {
  Core.SPECIES.forEach((s) => {
    const look = Looks.LOOKS[s.id];
    assert.ok(look && Array.isArray(look.layers) && look.layers.length > 0, `${s.name} の見た目が無い`);
    look.layers.forEach((l) => assert.ok(Looks.LAYER_TYPES.includes(l.t), `${s.name}: 知らない層 ${l.t}`));
  });
});

test('画像の置き場所は、草のある id にだけ書いてある', () => {
  const ids = new Set(Core.SPECIES.map((s) => s.id));
  Object.keys(Looks.IMAGES).forEach((k) => assert.ok(ids.has(k), `${k} という草は無い`));
});

test('画像の置き場所に書いたファイルが、すべてある', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  Object.entries(Looks.IMAGES).forEach(([k, e]) => {
    const src = typeof e === 'string' ? e : e.src;
    assert.ok(fs.existsSync(path.join(__dirname, src)), `${k}: ${src} が無い`);
    if (typeof e === 'object') assert.ok(e.size > 0.3 && e.size < 1.6, `${k}: 大きさ ${e.size}`);
  });
});

test('見た目の表に、草に無い id や同じ鍵の書き重ねが無い', () => {
  // 同じ鍵を2回書くと、エラーにならずに後ろだけが残る (落とし穴の表)。ソースを字として読んで数える
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'looks.js'), 'utf8');
  const block = src.slice(src.indexOf('const LOOKS = {'), src.indexOf('const IMAGES'));
  const keys = [...block.matchAll(/^\s{4}([a-z_]+): \{/gm)].map((m) => m[1]);
  assert.strictEqual(new Set(keys).size, keys.length, '同じ鍵がある');
  const ids = new Set(Core.SPECIES.map((s) => s.id));
  keys.forEach((k) => assert.ok(ids.has(k), `${k} という草は無い`));
  assert.strictEqual(keys.length, ids.size);
});
