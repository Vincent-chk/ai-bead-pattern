import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomPalette, generateBeadPatternExact, getPaletteProvider } from '../../packages/core/src/index.js';

const palette = createCustomPalette({ id: 'test', name: 'Test', colors: [
  { code: 'clear', hex: '#000000', isTransparent: true },
  { code: 'black', hex: '#000000' },
  { code: 'white', hex: '#FFFFFF' },
  { code: 'red', hex: '#FF0000' },
] });

const image = (width, height, data) => ({ width, height, data: Uint8ClampedArray.from(data) });

test('preserves opaque white and maps palette indices past transparent entries', async () => {
  const result = await generateBeadPatternExact(image(2, 1, [255, 255, 255, 255, 0, 0, 0, 255]), { cols: 2, rows: 1, palette });
  assert.deepEqual(result.grid.cells, ['white', 'black']);
  assert.deepEqual(result.statistics.beadCounts, { white: 1, black: 1 });
});

test('uses visible coverage with a half-inclusive threshold and alpha weights', async () => {
  const fifty = await generateBeadPatternExact(image(2, 1, [255, 0, 0, 255, 0, 0, 0, 0]), { cols: 1, rows: 1, palette });
  const fortyNinePixels = Array.from({ length: 100 }, (_, i) => [255, 0, 0, i < 49 ? 255 : 0]).flat();
  const fortyNine = await generateBeadPatternExact(image(100, 1, fortyNinePixels), { cols: 1, rows: 1, palette });
  const mixed = await generateBeadPatternExact(image(2, 1, [255, 0, 0, 255, 0, 0, 0, 128]), { cols: 1, rows: 1, palette });
  assert.deepEqual(fifty.grid.cells, ['red']);
  assert.deepEqual(fortyNine.grid.cells, [null]);
  assert.equal(fortyNine.statistics.totalBeads, 0);
  assert.equal(fortyNine.statistics.emptyCells, 1);
  assert.deepEqual(mixed.grid.cells, ['red']);
});

test('weights fractional crop and grid boundaries by their actual overlap', async () => {
  const source = image(3, 1, [255, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  const result = await generateBeadPatternExact(source, { cols: 2, rows: 1, crop: { x: 0.25, y: 0, width: 2.5, height: 1 }, palette });
  assert.deepEqual(result.grid.cells, ['red', 'white']);
  const partial = await generateBeadPatternExact(source, { cols: 1, rows: 1, crop: { x: 0.75, y: 0, width: 1.5, height: 1 }, palette });
  assert.deepEqual(partial.grid.cells, ['black']);
});

test('uses stable palette order for equally distant colors', async () => {
  const tiePalette = createCustomPalette({ id: 'tie', name: 'Tie', colors: [
    { code: 'first', hex: '#000000' }, { code: 'second', hex: '#020000' },
  ] });
  const result = await generateBeadPatternExact(image(1, 1, [1, 0, 0, 255]), { cols: 1, rows: 1, palette: tiePalette });
  assert.deepEqual(result.grid.cells, ['first']);
});

test('matches known MARD colors, preserves white, and counts exact codes', async () => {
  const source = image(4, 1, [250, 244, 200, 255, 0, 0, 0, 255, 254, 255, 255, 255, 0, 0, 0, 0]);
  const result = await generateBeadPatternExact(source, { cols: 4, rows: 1 });
  assert.deepEqual(result.grid.cells, ['A1', 'H7', 'H2', null]);
  assert.deepEqual(result.statistics.beadCounts, { A1: 1, H7: 1, H2: 1 });
  assert.equal(result.statistics.totalBeads, 3);
  assert.equal(result.statistics.emptyCells, 1);
  assert.deepEqual(Array.from(result.rawIndices, i => i < 0 ? null : getPaletteProvider().colors[i].code), ['A1', 'H7', 'H2', null]);
});

test('produces complete reproducible 29, 52 and 104 grids', async () => {
  const source = image(1, 1, [255, 255, 255, 255]);
  for (const size of [29, 52, 104]) {
    const result = await generateBeadPatternExact(source, { cols: size, rows: size });
    const repeated = await generateBeadPatternExact(source, { cols: size, rows: size });
    assert.equal(result.grid.cols, size);
    assert.equal(result.grid.rows, size);
    assert.equal(result.grid.cells.length, size * size);
    assert.deepEqual(result.grid.cells, repeated.grid.cells);
    assert.ok(result.grid.cells.every(code => code === 'H2'));
    assert.equal(result.statistics.totalBeads, size * size);
    assert.equal(result.statistics.beadCounts.H2, size * size);
  }
});

test('keeps more than 32 distinct color codes without merging', async () => {
  const colors = Array.from({ length: 40 }, (_, i) => ({ code: `c${i}`, hex: `#${(i * 6).toString(16).padStart(2, '0')}0000` }));
  const many = createCustomPalette({ id: 'many', name: 'Many', colors });
  const pixels = colors.flatMap((_, i) => [i * 6, 0, 0, 255]);
  const result = await generateBeadPatternExact(image(40, 1, pixels), { cols: 40, rows: 1, palette: many });
  assert.deepEqual(result.grid.cells, colors.map(color => color.code));
  assert.equal(result.statistics.usedColors, 40);
  assert.equal(result.statistics.totalBeads, 40);
});

test('includes every exactly half-covered cell across fractional grid boundaries', async () => {
  const source = image(2, 2, [0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0]);
  const result = await generateBeadPatternExact(source, { cols: 29, rows: 29, palette });
  assert.equal(result.statistics.totalBeads, 435);
  for (let row = 0; row < 29; row++) {
    assert.equal(result.grid.cells[row * 29 + 14], 'black');
    assert.equal(result.grid.cells[row * 29 + 15], null);
  }
});

test('keeps a cell empty when coverage is measurably below half', async () => {
  const source = image(2, 1, [0, 0, 0, 255, 0, 0, 0, 0]);
  const result = await generateBeadPatternExact(source, {
    cols: 1, rows: 1, crop: { x: 0.5000000001, y: 0, width: 1, height: 1 }, palette,
  });
  assert.deepEqual(result.grid.cells, [null]);
});
