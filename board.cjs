'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PNG } = require('pngjs');
const { contour, contourDistance } = require('./shape.cjs');

const fail = reason => ({ ok: false, reason });

let cache = null;

function pixel(im, x, y) {
  x = Math.max(0, Math.min(im.width - 1, Math.round(x)));
  y = Math.max(0, Math.min(im.height - 1, Math.round(y)));

  const k = 4 * (y * im.width + x);
  return [im.data[k], im.data[k + 1], im.data[k + 2]];
}

function colorBin(r, g, b) {
  r /= 255; g /= 255; b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  if (d < .15 || max < .2) {
    return 12 + Math.min(3, Math.floor(max * 4));
  }

  let h = max === r
    ? ((g - b) / d) % 6
    : max === g ? (b - r) / d + 2 : (r - g) / d + 4;

  if (h < 0) h += 6;
  return Math.min(11, Math.floor(h * 2));
}

// Feature: global histogram, 4 quadrant histograms and RGB means.
function feature(im, x, y, w, h) {
  const hist = new Float64Array(80);
  const colors = new Float64Array(12);

  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const rgb = pixel(
        im,
        x + w * (.12 + .76 * (i + .5) / 8),
        y + h * (.12 + .76 * (j + .5) / 8)
      );

      const bin = colorBin(...rgb);
      const q = (j >= 4 ? 2 : 0) + (i >= 4 ? 1 : 0);

      hist[bin]++;
      hist[16 + q * 16 + bin]++;

      for (let c = 0; c < 3; c++) {
        colors[q * 3 + c] += rgb[c] / 255;
      }
    }
  }

  for (let i = 0; i < 80; i++) {
    hist[i] /= i < 16 ? 64 : 16;
  }

  for (let i = 0; i < 12; i++) colors[i] /= 16;

  return {
    hist: Array.from(hist),
    colors: Array.from(colors)
  };
}

function distance(a, b) {
  let global = 0, local = 0, color = 0;

  for (let i = 0; i < 80; i++) {
    const d = Math.abs(a.hist[i] - b.hist[i]);
    if (i < 16) global += d;
    else local += d;
  }

  for (let i = 0; i < 12; i++) {
    color += Math.abs(a.colors[i] - b.colors[i]);
  }

  return .45 * global / 2 +
    .25 * local / 8 +
    .30 * color / 12;
}

function loadCalibration(filename) {
  const stat = fs.statSync(filename);

  if (cache?.file === filename && cache.mtime === stat.mtimeMs) {
    return cache.value;
  }

  const raw = JSON.parse(fs.readFileSync(filename, 'utf8'));

  if (raw.version !== 1 ||
      !raw.board || !raw.screen ||
      !Array.isArray(raw.references)) {
    throw new Error('Invalid calibration format');
  }

  const samples = [];
  const legend = {};
  const outlines = new Map();
  const obstacles = new Set(['#', 'I']);
  const specials = new Set();
  const uncertain = new Set();
  const multiCell = new Map();
  const singleCell = new Map();

  for (const ref of raw.references) {
    if (!/^[A-Z#.~]$/.test(ref.code)) {
      throw new Error(`Invalid tile code: ${ref.code}`);
    }

    const filename2 = path.resolve(
      path.dirname(filename), ref.file
    );

    const im = PNG.sync.read(fs.readFileSync(filename2));
    const span = ref.span || 1;
    const {code, maxDistance} = ref;
    if (maxDistance !== undefined &&
        (!Number.isFinite(maxDistance) || maxDistance < 0 || maxDistance > 1)) {
      throw new Error('Invalid reference distance: ' + ref.file);
    }

    if (ref.kind === 'obstacle') obstacles.add(ref.code);
    if (ref.kind === 'special') specials.add(ref.code);
    if (ref.kind === 'uncertain') uncertain.add(ref.code);
    if (span !== 1 && !(span === 2 && obstacles.has(ref.code))) {
      throw new Error('Only obstacles support span=2: ' + ref.code);
    }

    if (ref.shapeOnly && span !== 1) throw new Error('Shape-only references must be single tiles');
    const recordOutline = sample => {
      if (!sample.border) return;
      if (!outlines.has(code)) outlines.set(code, []);
      outlines.get(code).push(sample.border);
    };

    if (span === 2) {
      const w = im.width / 2;
      const h = im.height / 2;
      const block = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) =>
        ({ code, maxDistance, f: feature(im, x, y, w, h), border: contour(im, x, y, w, h) }));
      samples.push(...block);
      block.forEach(recordOutline);
      if (!multiCell.has(ref.code)) multiCell.set(ref.code, []);
      multiCell.get(ref.code).push(block);
    } else {
      const sample = { code, maxDistance, f: feature(im, 0, 0, im.width, im.height),
        border: contour(im, 0, 0, im.width, im.height) };
      recordOutline(sample);
      if (ref.shapeOnly) continue;
      samples.push(sample);
      if (!singleCell.has(ref.code)) singleCell.set(ref.code, []);
      singleCell.get(ref.code).push(sample);
    }
    legend[ref.code] = ref.label;
  }

  const result = { ...raw, samples, legend, obstacles, specials, uncertain, multiCell, singleCell, outlines };

  cache = { file: filename, mtime: stat.mtimeMs, value: result };
  return result;
}

function rank(f, samples, cal) {
  const scores = new Map();
  for (const sample of samples) {
    const score = distance(f, sample.f);
    if (cal && (sample.maxDistance !== undefined || cal.maxDistanceByCode?.[sample.code] !== undefined) &&
        score > sampleLimit(cal, sample)) continue;
    scores.set(sample.code, Math.min(scores.get(sample.code) ?? Infinity, score));
  }
  return [...scores].sort((a, b) => a[1] - b[1]);
}

function distanceLimit(cal, code) {
  return cal.maxDistanceByCode?.[code] ?? cal.maxDistance ?? .16;
}

function sampleLimit(cal, sample) {
  return Math.min(sample.maxDistance ?? Infinity, distanceLimit(cal, sample.code));
}

function classifyRanked([best, second], cal) {
  if (best && best[1] <= distanceLimit(cal, best[0]) &&
      (second?.[1] ?? Infinity) - best[1] >= (cal.minMarginByCode?.[best[0]] ?? cal.minMargin ?? .035)) return best[0];
  return null;
}

function classify(f, cal) {
  return classifyRanked(rank(f, cal.samples, cal), cal);
}

function scan(im, cal, lattice, keepCells = false) {
  const { x, y, s } = lattice;
  const cells = [];
  const [top, bottom] = cal.searchY ?? [.22, .87];
  let score = 0;
  let strong = 0;
  for (let row = Math.ceil((im.height * top - y) / s); y + (row + 1) * s <= im.height * bottom; row ++) {
    for (let col = Math.ceil(-x / s); x + (col + 1) * s <= im.width + .01; col ++) {
      const left = x + col * s;
      const upper = y + row * s;
      const f = feature(im, left, upper, s, s);
      const [best, second] = rank(f, cal.anchors);
      const limit = cal.anchorDistance ?? .19;
      const anchor = best && best[1] < limit &&
        (second?.[1] ?? Infinity) - best[1] >= (cal.minMargin ?? .035);
      if (anchor) {
        score += 1 - .75 * best[1] / limit;
        if (best[1] <= limit * .70) strong++;
      }
      if (keepCells) cells.push({ row, col, left, upper, f, anchor });
    }
  }
  return { ...lattice, cells, score, strong };
}

function detect(im, cal) {
  const sx = im.width / cal.screen.width;
  const sy = im.height / cal.screen.height;
  const base = cal.board.cell * Math.min(sx, sy);
  if (!Number.isFinite(base) || base < 8 || !cal.anchors.length) return null;
  const candidates = [];
  for (const scale of [.8, .9, 1, 1.1, 1.2]) {
    const s = base * scale;
    for (const dy of [-.4, -.2, 0, .2, .4]) {
      for (const dx of [-.4, -.2, 0, .2, .4]) {
        candidates.push(scan(im, cal, {
          x: cal.board.x * sx + dx * s, y: cal.board.y * sy + dy * s, s
        }));
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const refined = [];
  for (const g of candidates.slice(0, 5)) {
    for (const ds of [-.04, 0, .04]) {
      for (const dy of [-.08, 0, .08]) {
        for (const dx of [-.08, 0, .08]) {
          refined.push(scan(im, cal, { x: g.x + dx*g.s, y: g.y + dy*g.s, s: g.s * (1 + ds) }));
        }
      }
    }
  }
  const ranked = [...refined, ...candidates].sort((a, b) => b.score - a.score);
  const best = scan(im, cal, ranked[0], true);
  const anchors = best.cells.filter(cell => cell.anchor);
  if (anchors.length < 4 || new Set(anchors.map(c => c.row)).size < 2 ||
      new Set(anchors.map(c => c.col)).size < 2) return null;
  const different = ranked.find(g => !aligned(best, g, .26));
  if (different && different.score >= best.score * .96) return null;
  return best;
}

function reuseLattice(im, cal, hint) {
  if (!hint || hint.width !== im.width || hint.height !== im.height) return null;
  const {x, y, s} = hint;
  if (![x, y, s].every(Number.isFinite) || s < 8 || s > im.width / 2) return null;
  const candidate = scan(im, cal, {x, y, s}, true);
  const anchorCells = candidate.cells.filter(cell => cell.anchor);
  const confirmed = anchorCells.filter(cell => cal.anchorCodes.has(classify(cell.f, cal)));
  if (candidate.strong < 4 || candidate.score < anchorCells.length * .40 || confirmed.length < 4 ||
      new Set(confirmed.map(c => c.row)).size < 2 ||
      new Set(confirmed.map(c => c.col)).size < 2) return null;

  for (const [dx, dy, ds] of [[.14,0,0],[-.14,0,0],[0,.14,0],[0,-.14,0],[0,0,.045],[0,0,-.045]]) {
    const alternative = scan(im, cal, {x:x+dx*s, y:y+dy*s, s:s*(1+ds)});
    if (alternative.score > candidate.score * 1.14 + .20) return null;
  }
  return candidate;
}

function aligned(a, b, tolerance) {
  if (Math.abs(a.s - b.s) > a.s * .065) return false;
  const phase = delta => Math.abs(delta / b.s - Math.round(delta / b.s));
  return phase(a.x - b.x) <= tolerance && phase(a.y - b.y) <= tolerance;
}

const provisionalCodes = 'abcdefghijklmnopqrstuvwxyz0123456789';
const hueLabels = ['红橙', '橙黄', '黄绿', '绿色', '绿色', '青绿', '青色', '蓝青', '蓝色', '蓝紫', '紫红', '红紫'];

function visualColor(f) {
  const hues = f.hist.slice(0, 12);
  const saturation = hues.reduce((sum, part) => sum + part, 0);
  if (saturation < .35) return null;
  const score = hues.map((part, i) =>
    part + .5 * (hues[(i + 11) % 12] + hues[(i + 1) % 12]));
  const peak = Math.max(...score);
  return peak >= saturation * .65 ? hueLabels[score.indexOf(peak)] : null;
}

function learnedSamples(folder) {
  if (!folder || !fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).sort()
    .filter(name => /^(?:[a-z0-9]|type-[0-9a-f-]{36})\.json$/.test(name)).map(name => {
      const key = path.basename(name, '.json');
      const sample = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
      const code = key.length === 1 ? key : '!';
      if (sample.version !== 1 || sample.code !== code ||
          sample.f?.hist?.length !== 80 || sample.f?.colors?.length !== 12 ||
          ![...sample.f.hist, ...sample.f.colors].every(Number.isFinite)) {
        throw new Error('Invalid learned sample: ' + name);
      }
      return { ...sample, typeId: 'learned:' + key, color: sample.color ?? visualColor(sample.f) };
    });
}

// null means competing templates are too close. undefined means a novel appearance.
function matchLearned(f, samples) {
  const [best, second] = samples.map(sample => ({sample, score: distance(f, sample.f)}))
    .sort((a, b) => a.score - b.score);
  if (best?.score <= .095) {
    return (second?.score ?? Infinity) - best.score >= .025 ? best.sample : null;
  }
  return best?.score < .16 ? null : undefined;
}

function identifyNovel(f, folder, learned) {
  const existing = matchLearned(f, learned);
  if (existing !== undefined || !folder) return existing;

  fs.mkdirSync(folder, { recursive: true });
  const lock = path.join(folder, '.write.lock');
  let fd;
  try {
    fd = fs.openSync(lock, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') return null;
    throw error;
  }

  const temporary = path.join(folder, '.sample.tmp');
  try {
    learned.splice(0, learned.length, ...learnedSamples(folder));
    const current = matchLearned(f, learned);
    if (current !== undefined) return current;

    const code = [...provisionalCodes].find(c => !learned.some(sample => sample.code === c)) ?? '!';
    const key = code === '!' ? 'type-' + randomUUID() : code;
    const color = visualColor(f);
    const label = '临时类型 ' + (code === '!' ? key.slice(5, 13) : code) + (color ? '（' + color + '）' : '');
    const sample = { version: 1, code, label, color, f };
    fs.writeFileSync(temporary, JSON.stringify(sample));
    fs.renameSync(temporary, path.join(folder, key + '.json'));
    const entry = { ...sample, typeId: 'learned:' + key };
    learned.push(entry);
    return entry;
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
  }
}

function coordinateMap(cells, cols) {
  const span = Math.max(4, ...cells.map(cell => String(cell.x).length + 1));
  const pad = value => String(value).padStart(span);
  const prefix = label => label.padStart(7) + ' |';
  const lines = [prefix('col') + cells.slice(0, cols).map(cell => pad(cell.col)).join(''),
    prefix('x(px)') + cells.slice(0, cols).map(cell => pad(cell.x)).join(''),
    prefix('row/y') + '-'.repeat(span * cols)];
  for (let i = 0; i < cells.length; i += cols) {
    const row = cells.slice(i, i + cols);
    lines.push(prefix(row[0].row + '/' + row[0].y) +
      row.map(cell => pad(cell.code)).join(''));
  }
  return lines.join('\n');
}

function rejectPartialObstacles(cells, cal) {
  const key = (row, col) => row + ',' + col;
  for (const [code, templates] of cal.multiCell) {
    const candidates = cells.filter(cell => cell.code === code);
    const byPosition = new Map(candidates.map(cell => [key(cell.row, cell.col), cell]));
    const complete = new Set();
    const fits = (cell, sample) => cell.observations.every(f => distance(f, sample.f) <= sampleLimit(cal, sample));
    for (const cell of candidates) {
      const {row, col} = cell;
      const block = [cell, byPosition.get(key(row, col + 1)),
        byPosition.get(key(row + 1, col)), byPosition.get(key(row + 1, col + 1))];
      if (block.every(Boolean) && templates.some(template =>
        block.every((part, i) => fits(part, template[i])))) {
        block.forEach(part => complete.add(part));
      }
    }
    const singles = cal.singleCell.get(code) ?? [];
    for (const cell of candidates) {
      if (!complete.has(cell) && !singles.some(sample => fits(cell, sample))) cell.code = null;
    }
  }
}

function confirmContour(code, observations, frames, sizes, cal) {
  const isAnimal = cal.anchorCodes.has(code);
  const isIce = cal.iceCodes.has(code);
  if (!isAnimal && !isIce) return true;
  const references = cal.outlines.get(code) ?? [];

  return observations.every((cell, index) => {
    const s = sizes[index];
    const outline = contour(frames[index], cell.left, cell.upper, s, s);
    const closest = references.reduce((best, ref) => Math.min(best, contourDistance(ref, outline)), Infinity);
    if (isIce) {
      const animal = cal.animalOutlines.reduce((best, ref) => Math.min(best, contourDistance(ref, outline)), Infinity);
      return closest <= .30 && animal - closest >= .016;
    }
    if (closest > .25) return false;
    const ice = cal.iceOutlines.reduce((best, ref) => Math.min(best, contourDistance(ref, outline)), Infinity);
    return ice - closest >= .028;
  });
}

function readBoard(png, calibrationFile, options = {}) {
  try {
    const reference = loadCalibration(calibrationFile);
    const nonAnchors = new Set(['.', '~', ...reference.obstacles, ...reference.specials, ...reference.uncertain]);
    const anchors = reference.samples.filter(s => !nonAnchors.has(s.code));
    const iceCodes = new Set(reference.contourIceCodes ?? 'I');
    const iceOutlines = [...iceCodes].flatMap(code => reference.outlines.get(code) ?? []);
    const anchorCodes = new Set(anchors.map(sample => sample.code));
    const animalOutlines = [...anchorCodes].flatMap(code => reference.outlines.get(code) ?? []);
    const cal = { ...reference, anchors, anchorCodes, iceCodes, iceOutlines, animalOutlines };
    const frames = [png, ...(options.frames ?? [])].map(data =>
      Buffer.isBuffer(data) ? PNG.sync.read(data) : data);
    if (frames.some(im => !Number.isInteger(im?.width) || im.width <= 0 ||
        !Number.isInteger(im.height) || im.height <= 0 ||
        im.data?.length !== im.width * im.height * 4)) return fail('Invalid screenshot');
    if (frames.some(im => im.width !== frames[0].width || im.height !== frames[0].height)) {
      return fail('Screen size changed between frames');
    }
    const [first, ...rest] = frames;
    const reused = reuseLattice(first, cal, options.geometryHint);
    const board = reused ?? detect(first, cal);
    if (!board) return fail('Board lattice missing, ambiguous or moving');
    const geometry = {x:board.x, y:board.y, s:board.s, width:first.width, height:first.height};
    const boards = rest.map(im => reuseLattice(im, cal, geometry) ?? detect(im, cal));
    if (boards.some(g => !g || !aligned(board, g, .17))) {
      return fail('Board lattice missing, ambiguous or moving');
    }
    const sizes = [board, ...boards].map(g => g.s);
    const stable = board.cells.map(cell => {
      const matches = boards.map(g => g.cells.find(other =>
        Math.abs(other.left - cell.left) < board.s * .18 &&
        Math.abs(other.upper - cell.upper) < board.s * .18));
      const observations = [cell, ...matches];
      const ranked = observations.map(other => other && rank(other.f, cal.samples, cal));
      const codes = ranked.map(matches => matches && classifyRanked(matches, cal));
      const same = matches.every(other => other && distance(cell.f, other.f) <= .085);
      const candidate = same && codes.every(value => value === codes[0]) ? codes[0] : null;
      const code = candidate && confirmContour(candidate, observations, frames, sizes, cal) ? candidate : null;
      return { ...cell, code, observations: cal.multiCell.has(code) ? observations.map(other => other.f) : undefined,
        novel: same && codes.every(value => !value) &&
        observations.every(other => other && cal.samples.every(sample =>
          distance(other.f, sample.f) >
            Math.max(sampleLimit(cal, sample), cal.anchorDistance ?? .19) + .035)) };
    });
    rejectPartialObstacles(stable, cal);
    const occupied = stable.filter(c => c.code && c.code !== '~');
    if (occupied.filter(c => c.anchor && !nonAnchors.has(c.code)).length < 4) return fail('Too few stable board cells');
    const bounds = list => ({
      minRow: Math.min(...list.map(cell => cell.row)), maxRow: Math.max(...list.map(cell => cell.row)),
      minCol: Math.min(...list.map(cell => cell.col)), maxCol: Math.max(...list.map(cell => cell.col))
    });
    const inside = (cell, box) => cell.row >= box.minRow && cell.row <= box.maxRow &&
      cell.col >= box.minCol && cell.col <= box.maxCol;
    const initial = bounds(occupied);
    const near = {minRow: initial.minRow - 1, maxRow: initial.maxRow + 1,
      minCol: initial.minCol - 1, maxCol: initial.maxCol + 1};
    const nextTo = (cell, candidates) => candidates.some(other =>
      Math.abs(cell.row - other.row) + Math.abs(cell.col - other.col) === 1);
    const animalAnchors = occupied.filter(cell => cell.anchor && !nonAnchors.has(cell.code));
    const enclosing = (cell, axis, other) =>
      occupied.some(a => a[axis] === cell[axis] && a[other] < cell[other]) &&
      occupied.some(a => a[axis] === cell[axis] && a[other] > cell[other]);

    const novel = stable.filter(c => c.novel && inside(c, near) &&
      c.f.hist.slice(0, 12).reduce((sum, n) => sum + n, 0) >= .35 &&
      Math.max(...c.f.hist.slice(0, 12)) < .9);
    const adjacentNovel = novel.filter(cell => nextTo(cell, inside(cell, initial) ? occupied : animalAnchors));
    const learned = learnedSamples(options.learnedDir);
    const discoveries = new Map();
    for (const cell of novel) {
      const interior = inside(cell, initial);
      const enclosed = interior && (enclosing(cell, 'row', 'col') || enclosing(cell, 'col', 'row'));
      const neighbors = interior ? occupied : animalAnchors;
      const adjacent = nextTo(cell, neighbors);
      const peers = adjacentNovel.filter(other => inside(other, initial) === interior &&
        (interior || other.row === cell.row || other.col === cell.col) &&
        distance(cell.f, other.f) <= .08);
      const repeated = adjacent && peers.length >= (interior ? 2 : 3);
      const known = interior && adjacent ? matchLearned(cell.f, learned) : undefined;
      if (frames.length === 1) {
        if (known) discoveries.set(cell, known);
        continue;
      }
      if (!enclosed && !repeated && !known) continue;
      const sample = known ?? identifyNovel(cell.f, options.learnedDir, learned);
      if (sample !== null) discoveries.set(cell, sample);
    }

    const box = bounds([...occupied, ...discoveries.keys()]);
    const {minRow, minCol} = box;
    const rows = box.maxRow - minRow + 1;
    const cols = box.maxCol - minCol + 1;
    const legend = { ...cal.legend, '?': '不确定', '!': '未知或调色板已满，见逐格标签', '~': '空洞' };
    const cells = stable.filter(c => inside(c, box)).map(c => {
      const entry = discoveries.get(c);
      const detected = c.code ?? entry?.code ?? (discoveries.has(c) ? '!' : '?');
      const uncertain = cal.uncertain.has(detected);
      const code = uncertain || (options.unknownAsQuestion && (entry || detected === '!')) ? '?' : detected;
      const result = {
        row: c.row - minRow + 1, col: c.col - minCol + 1, code,
        x: Math.round(c.left + board.s / 2), y: Math.round(c.upper + board.s / 2),
        status: entry ? 'provisional' : detected === '!' ? 'unknown' : code === '~' ? 'hole' :
          code === '?' ? 'uncertain' : cal.obstacles.has(code) ? 'obstacle' :
            cal.specials.has(code) ? 'special' : code === '.' ? 'empty' : 'known'
      };
      if (entry) {
        result.typeId = entry.typeId;
        result.label = entry.label;
        result.color = entry.color;
      } else if (c.code && !uncertain && !'.~'.includes(c.code)) {
        result.typeId = 'calibrated:' + code;
        result.label = cal.legend[code];
        result.color = cal.colors?.[code] ?? null;
      } else if (detected === '!') {
        result.color = visualColor(c.f);
      }
      return result;
    });
    if (options.includeMovable) for (const cell of cells) cell.movable = cell.status === 'known';
    if (options.unknownAsQuestion) {
      delete legend['!'];
      legend['?'] = '类型未确认，禁止按普通棋子移动';
    } else {
      for (const sample of learned) {
        if (sample.code !== '!') legend[sample.code] = sample.label;
      }
    }
    for (const code of cal.uncertain) delete legend[code];
    options.onGeometry?.(geometry, Boolean(reused));
    return {
      ok: true, rows, cols, legend, cells, coordinateMap: coordinateMap(cells, cols),
      grid: Array.from({ length: rows }, (_, r) => cells.slice(r*cols, (r+1)*cols).map(c => c.code).join('')).join('\n'),
      x: Math.round(board.x + minCol * board.s),
      y: Math.round(board.y + minRow * board.s),
      cellSize: board.s
    };
  } catch (error) {
    return fail(error.message);
  }
}

module.exports = { readBoard, feature, classify, loadCalibration };
