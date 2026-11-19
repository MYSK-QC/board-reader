'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {decodeRaw} = require('../capture.cjs');

test('decodes Android RGBA and RGBX screenshots with either header length', () => {
  const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]);
  for (const [headerSize, format] of [[12, 1], [16, 2]]) {
    const screenshot = Buffer.alloc(headerSize + pixels.length);
    screenshot.writeUInt32LE(2, 0);
    screenshot.writeUInt32LE(1, 4);
    screenshot.writeUInt32LE(format, 8);
    pixels.copy(screenshot, headerSize);
    assert.deepEqual(decodeRaw(screenshot), {width: 2, height: 1, data: pixels});
    assert.throws(() => decodeRaw(screenshot.subarray(0, -1)), /size/);
  }
  assert.throws(() => decodeRaw(Buffer.alloc(16)), /format/);
});
