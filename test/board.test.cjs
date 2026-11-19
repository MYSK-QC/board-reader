'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');
const { readBoard, feature } = require('../board.cjs');

test('irregular lattice, scaling, novelty persistence and motion', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xxl-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calibration = path.join(dir, 'calibration.json');
  const learnedDir = path.join(dir, 'learned');
  const tiles = Object.fromEntries(Object.entries({ P: 'purple', G: 'green', Y: 'chick', R: 'red', E: 'egg', F: 'frozen-creature', K: 'key', U: 'blue-orb-unconfirmed', '#': 'cookie' })
    .map(([code, file]) => [code, PNG.sync.read(fs.readFileSync(path.join(__dirname, '../refs', file + '.png')))]));
  const hole = new PNG({width: 24, height: 24});
  const novel = new PNG({width: 24, height: 24});
  for (let i = 0; i < 576; i++) {
    hole.data.set([18, 22, 35, 255], i*4);
    novel.data.set(i % 24 < 12 ? [230, 0, 225, 255] : [0, 255, 255, 255], i*4);
  }
  tiles['~'] = hole;
  tiles['!'] = novel;
  const cookie = tiles['#'];
  tiles.C = new PNG({width: cookie.width / 2, height: cookie.height / 2});
  PNG.bitblt(cookie, tiles.C, 0, 0, tiles.C.width, tiles.C.height, 0, 0);
  const references = 'PGYREFKU#~'.split('').map((code, i) => {
    const file = i + '.png';
    fs.writeFileSync(path.join(dir, file), PNG.sync.write(tiles[code]));
    const ref = {code, file, label: code};
    if ('#F'.includes(code)) ref.span = 2;
    if ('EF'.includes(code)) ref.kind = 'obstacle';
    if (code === 'K') ref.kind = 'special';
    if (code === 'U') ref.kind = 'uncertain';
    return ref;
  });
  fs.writeFileSync(calibration, JSON.stringify({
    version: 1, screen: {width: 288, height: 432}, board: {x: 48, y: 144, cell: 48},
    anchorDistance: .19, maxDistance: .15, minMargin: .025, colors: {P: '紫色'}, references
  }));

  function frame(grid, scale = 1) {
    const im = new PNG({width: 288*scale, height: 432*scale});
    for (let i = 0; i < im.data.length; i += 4) im.data.set([18, 22, 35, 255], i);
    const size = 48*scale;
    grid.forEach((row, r) => [...row].forEach((code, c) => {
      if (code === '_') return;
      const source = tiles[code];
      const span = '#F'.includes(code) ? 2 : 1;
      for (let y = 0; y < size*span; y++) {
        for (let x = 0; x < size*span; x++) {
          const offset = 4*(Math.floor(y*source.height/(size*span))*source.width + Math.floor(x*source.width/(size*span)));
          const target = 4*((144*scale + r*size + y)*im.width + 48*scale + c*size + x);
          source.data.copy(im.data, target, offset, offset + 4);
        }
      }
    }));
    return PNG.sync.write(im);
  }

  const layout = ['~PGY', 'P!PG', 'G#_Y', 'P__R'];
  const a = frame(layout);
  const blank = frame([]);
  assert.equal(readBoard(blank, calibration).ok, false);
  const unknown = readBoard(a, calibration, {frames: [a]});
  assert.equal(unknown.ok, true, unknown.reason);
  assert.equal(unknown.grid, '~PGY\nP!PG\nG##Y\nP##R');
  const result = readBoard(a, calibration, {frames: [a], learnedDir});
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.grid, '~PGY\nPaPG\nG##Y\nP##R');
  assert.deepEqual(result.cells[0], {row: 1, col: 1, code: '~', x: 72, y: 168, status: 'hole'});
  assert.deepEqual(fs.readdirSync(learnedDir), ['a.json']);
  assert.match(result.coordinateMap, /x\(px\).*72/);
  assert.match(result.coordinateMap, /1\/168.*~.*P/);
  assert.equal(result.cells[1].color, '紫色');
  assert.equal(result.cells[5].typeId, 'learned:a');
  const quick = readBoard(a, calibration, {learnedDir, includeMovable: true});
  assert.equal(quick.cells[5].typeId, 'learned:a');
  assert.equal(quick.cells[5].movable, false);
  assert.equal(quick.cells[1].movable, true);
  const conservative = readBoard(a, calibration, {frames: [a], learnedDir,
    unknownAsQuestion: true, includeMovable: true});
  assert.equal(conservative.cells[5].code, '?');
  assert.equal(conservative.cells[5].movable, false);
  assert.equal(conservative.cells[5].typeId, 'learned:a');
  assert.equal(conservative.legend.a, undefined);

  let geometry;
  const cold = readBoard(a, calibration, {onGeometry: value => {geometry = value;}});
  assert.equal(cold.ok, true, cold.reason);
  let reusedGeometry;
  const warm = readBoard(PNG.sync.read(a), calibration, {
    geometryHint: geometry, onGeometry: (_next, reused) => {reusedGeometry = reused;}
  });
  assert.equal(warm.grid, cold.grid);
  assert.equal(reusedGeometry, true);
  assert.equal(readBoard(blank, calibration, {geometryHint: geometry}).ok, false);

  const overflowDir = path.join(dir, 'overflow');
  fs.mkdirSync(overflowDir);
  const filler = feature(hole, 0, 0, hole.width, hole.height);
  for (const code of 'abcdefghijklmnopqrstuvwxyz0123456789') {
    fs.writeFileSync(path.join(overflowDir, code + '.json'),
      JSON.stringify({version: 1, code, label: code, f: filler}));
  }
  const overflow = readBoard(a, calibration, {frames: [a], learnedDir: overflowDir});
  assert.equal(overflow.ok, true, overflow.reason);
  assert.equal(overflow.cells[5].code, '!');
  assert.equal(overflow.cells[5].status, 'provisional');
  assert.match(overflow.cells[5].typeId, /^learned:type-/);
  const reused = readBoard(a, calibration, {frames: [a], learnedDir: overflowDir});
  assert.equal(reused.cells[5].typeId, overflow.cells[5].typeId);
  assert.equal(fs.readdirSync(overflowDir).length, 37);

  const fringe = frame(['!!!~', 'PGYR', 'GRYP', 'YPGR']);
  const extension = readBoard(fringe, calibration, {frames: [fringe], learnedDir});
  assert.equal(extension.ok, true, extension.reason);
  assert.equal(extension.grid.split('\n')[0], 'aaa~');
  const scaled = frame(layout, 2);
  assert.equal(readBoard(scaled, calibration, {frames: [scaled], learnedDir}).grid, result.grid);
  const moved = readBoard(a, calibration, {frames: [frame(['~PGY','PYPG','G#_Y','P__R'])], learnedDir});
  assert.equal(moved.grid.split('\n')[1], 'P?PG');
  assert.equal(readBoard(a, calibration, {frames: [scaled]}).ok, false);

  const isolated = frame(['EPGY', 'PCPG', 'G#_Y', 'P__R']);
  const obstacles = readBoard(isolated, calibration, {frames: [isolated]});
  assert.equal(obstacles.ok, true, obstacles.reason);
  assert.equal(obstacles.grid, 'EPGY\nP?PG\nG##Y\nP##R');
  assert.equal(obstacles.cells[0].status, 'obstacle');

  const frozen = frame(['EKGY', 'PGPG', 'GF_Y', 'P__R']);
  const special = readBoard(frozen, calibration, {frames: [frozen]});
  assert.equal(special.ok, true, special.reason);
  assert.equal(special.grid, 'EKGY\nPGPG\nGFFY\nPFFR');
  assert.equal(special.cells[1].status, 'special');
  assert.equal(special.cells[9].status, 'obstacle');

  const lookalike = frame(['EUGY', 'PGPG', 'GF_Y', 'P__R']);
  const lookalikeResult = readBoard(lookalike, calibration, {includeMovable: true});
  assert.equal(lookalikeResult.ok, true, lookalikeResult.reason);
  assert.equal(lookalikeResult.cells[1].code, '?');
  assert.equal(lookalikeResult.cells[1].status, 'uncertain');
  assert.equal(lookalikeResult.cells[1].movable, false);
});
