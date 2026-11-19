'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const N = 9;
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

  for (const ref of raw.references) {
    if (!/^[A-Z#.]$/.test(ref.code)) {
      throw new Error(`Invalid tile code: ${ref.code}`);
    }

    const filename2 = path.resolve(
      path.dirname(filename), ref.file
    );

    const im = PNG.sync.read(fs.readFileSync(filename2));
    const span = ref.span || 1;

    if (span !== 1 && !(span === 2 && ref.code === '#')) {
      throw new Error('Only cookie box supports span=2');
    }

    if (span === 2) {
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          samples.push({
            code: ref.code,
            f: feature(
              im,
              c * im.width / 2,
              r * im.height / 2,
              im.width / 2,
              im.height / 2
            )
          });
        }
      }
    } else {
      samples.push({
        code: ref.code,
        f: feature(im, 0, 0, im.width, im.height)
      });
    }

    legend[ref.code] = ref.label;
  }

  // 只强制要求饼干盒；空格和冰层能缺（不同关卡元素不同）
  for (const code of ['#']) {
    if (!samples.some(s => s.code === code)) {
      throw new Error(`Missing required reference: ${code}`);
    }
  }

  const result = { ...raw, samples, legend };

  cache = { file: filename, mtime: stat.mtimeMs, value: result };
  return result;
}

function classify(f, cal) {
  const bestByCode = new Map();

  for (const sample of cal.samples) {
    const d = distance(f, sample.f);
    const old = bestByCode.get(sample.code);

    if (old === undefined || d < old) {
      bestByCode.set(sample.code, d);
    }
  }

  const ranked = [...bestByCode]
    .sort((a, b) => a[1] - b[1]);

  const best = ranked[0];
  const second = ranked[1];

  if (!best ||
      best[1] > (cal.maxDistance ?? .16) ||
      !second ||
      second[1] - best[1] < (cal.minMargin ?? .035)) {
    return null;
  }

  return best[0];
}

function geometryOK(im, x, y, s) {
  const size = s * N;
  const center = (x + size / 2) / im.width;

  return s >= 8 &&
    x >= 0 && y >= 0 &&
    x + size <= im.width &&
    y + size <= im.height &&
    center > .30 && center < .70 &&
    y > im.height * .18 &&
    y + size < im.height * .96;
}

function seamScore(im, x, y, s) {
  const delta = Math.max(2, s * .05);
  let sum = 0;

  for (let i = 1; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = pixel(im, x + i*s-delta, y+(j+.5)*s);
      const b = pixel(im, x + i*s+delta, y+(j+.5)*s);
      const c = pixel(im, x+(j+.5)*s, y+i*s-delta);
      const d = pixel(im, x+(j+.5)*s, y+i*s+delta);

      for (let k = 0; k < 3; k++) {
        sum += Math.abs(a[k]-b[k]) + Math.abs(c[k]-d[k]);
      }
    }
  }

  return sum / (2 * 8 * N * 3);
}

function validCookies(cells) {
  const seen = new Set();

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const k = r*N+c;

      if (cells[k] !== '#' || seen.has(k)) continue;
      if (r >= 8 || c >= 8) return false;

      const block = [k, k+1, k+N, k+N+1];

      if (!block.every(i => cells[i] === '#' && !seen.has(i))) {
        return false;
      }

      block.forEach(i => seen.add(i));
    }
  }

  return true;
}

function detect(im, cal) {
  const sx = im.width / cal.screen.width;
  const sy = im.height / cal.screen.height;

  if (Math.abs(sx / sy - 1) > .06) return null;

  const nominal = {
    x: cal.board.x * sx,
    y: cal.board.y * sy,
    s: cal.board.cell * sx
  };

  const candidates = [];

  function add(x, y, s) {
    x = Math.round(x);
    y = Math.round(y);
    s = Math.round(s);

    if (!geometryOK(im, x, y, s)) return;

    candidates.push({
      x, y, s,
      seam: seamScore(im, x, y, s)
    });
  }

  // Search around the calibrated board, allowing moderate movement.
  for (const scale of [.93, .965, 1, 1.035, 1.07]) {
    const s = nominal.s * scale;
    const step = Math.max(3, s * .15);

    for (let dx = -.75*s; dx <= .75*s; dx += step) {
      for (let dy = -s; dy <= s; dy += step) {
        add(nominal.x + dx, nominal.y + dy, s);
      }
    }
  }

  candidates.sort((a, b) => b.seam - a.seam);

  const coarse = candidates.slice(0, 15);

  for (const g of coarse) {
    for (const dx of [-.08, 0, .08]) {
      for (const dy of [-.08, 0, .08]) {
        for (const ds of [-1, 0, 1]) {
          add(g.x + dx*g.s, g.y + dy*g.s, g.s + ds);
        }
      }
    }
  }

  candidates.sort((a, b) => b.seam - a.seam);

  let winner = null;

  for (const g of candidates.slice(0, 35)) {
    if (g.seam < (cal.minSeam ?? 6)) continue;

    const cells = [];
    let bad = 0;

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const f = feature(
          im,
          g.x+c*g.s,
          g.y+r*g.s,
          g.s,
          g.s
        );

        const code = classify(f, cal);

        if (!code) bad++;
        cells.push(code || '?');
      }
    }

    // 允许少量认不出的格子（标记为 ?），整体仍可用
    if (bad > Math.round(N * N * 0.55)) continue;

    winner = { ...g, cells };
    break;
  }

  return winner;
}

function readBoard(png, calibrationFile) {
  try {
    const cal = loadCalibration(calibrationFile);
    const im = PNG.sync.read(png);
    const board = detect(im, cal);

    if (!board) {
      return fail(
        'Board not found or classification uncertain'
      );
    }

    return {
      ok: true,
      rows: 9,
      cols: 9,
      grid: Array.from({ length: 9 }, (_, r) =>
        board.cells.slice(r*9, r*9+9).join('')
      ).join('\n'),
      legend: cal.legend,
      x: board.x,
      y: board.y,
      cellSize: board.s
    };
  } catch (e) {
    return fail(e.message);
  }
}

module.exports = { readBoard, feature, classify, loadCalibration };