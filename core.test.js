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
    let cur = l.id + ':1';
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
  Core.RECIPES.forEach((r) => r.forEach((n) => assert.ok(Core.findByName(n), `${n} が無い`)));
});

test('草の id は重ならず、レア度は表の範囲に収まる', () => {
  const ids = Core.SPECIES.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  Core.SPECIES.forEach((s) => assert.ok(s.rarity >= 0 && s.rarity < Core.RARITIES.length, s.name));
});

test('牧場は 4x4 から始まり、芝生とクローバーだけが出る', () => {
  const g = Core.createGame();
  assert.strictEqual(Core.fieldSize(g), 4);
  assert.strictEqual(g.cells.length, 16);
  assert.deepStrictEqual(Core.unlockedSpecies(g), [id('ちび芝生'), id('三つ葉')]);
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
