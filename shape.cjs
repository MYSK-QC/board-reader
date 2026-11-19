'use strict';

const SIZE = 20;
const REGIONS = 4;
const DIRECTIONS = 4;

function contour(im, left, top, width, height) {
  const luminance = new Float32Array(SIZE * SIZE);
  for (let row = 0; row < SIZE; row++) {
    const y = Math.min(im.height - 1, Math.max(0, Math.round(top + height * (.05 + .9 * row / (SIZE - 1)))));
    for (let col = 0; col < SIZE; col++) {
      const x = Math.min(im.width - 1, Math.max(0, Math.round(left + width * (.05 + .9 * col / (SIZE - 1)))));
      const p = (im.width * y + x) * 4;
      luminance[row * SIZE + col] = .299 * im.data[p] + .587 * im.data[p+1] + .114 * im.data[p+2];
    }
  }

  const histogram = new Float32Array(REGIONS * REGIONS * DIRECTIONS);
  let total = 0;
  for (let row = 1; row < SIZE - 1; row++) {
    const gridY = Math.max(0, Math.min(REGIONS - 1, (row + .5) * REGIONS / SIZE - .5));
    const y = Math.floor(gridY);
    for (let col = 1; col < SIZE - 1; col++) {
      const p = row * SIZE + col;
      const dx = luminance[p+1] - luminance[p-1];
      const dy = luminance[p+SIZE] - luminance[p-SIZE];
      const strength = Math.min(80, Math.abs(dx) + Math.abs(dy));
      if (strength < 7) continue;
      const direction = Math.abs(dx) > Math.abs(dy) * 2 ? 0 : Math.abs(dy) > Math.abs(dx) * 2 ? 1 :
        dx * dy >= 0 ? 2 : 3;
      const gridX = Math.max(0, Math.min(REGIONS - 1, (col + .5) * REGIONS / SIZE - .5));
      const x = Math.floor(gridX);
      const fx = gridX - x;
      const fy = gridY - y;
      const bin = (y * REGIONS + x) * DIRECTIONS + direction;
      histogram[bin] += strength * (1 - fx) * (1 - fy);
      if (fx) histogram[bin+DIRECTIONS] += strength * fx * (1 - fy);
      if (fy) histogram[bin+REGIONS*DIRECTIONS] += strength * (1 - fx) * fy;
      if (fx && fy) histogram[bin+(REGIONS+1)*DIRECTIONS] += strength * fx * fy;
      total += strength;
    }
  }
  if (total < 150) return null;
  for (let i = 0; i < histogram.length; i++) histogram[i] /= total;
  return histogram;
}

function contourDistance(a, b) {
  if (!a || !b) return Infinity;
  let differences = 0;
  for (let i = 0; i < a.length; i++) differences += Math.abs(a[i] - b[i]);
  return differences / 2;
}

module.exports = {contour, contourDistance};
