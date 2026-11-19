'use strict';

const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { capture } = require('./capture.cjs');
const { readBoard } = require('./board.cjs');

exports.name = 'dsh-plugin-xxl-board';
exports.inject = ['tools'];

exports.apply = async function apply(ctx, config = {}) {
  const { defineTool } = await import('@deepseek-ai/dsh-tools');
  const geometryBySerial = new Map();

  ctx.tools.register(defineTool({
    name: 'xxl_board',

    description:
      'Read the current 开心消消乐 board via rooted ADB. ' +
      'Returns a coordinate map, per-cell pixel centers, visual types and color labels. ' +
      'Ice and special tiles require calibration. ' +
      'Use cells with movable=true. Use quick only after the board settles; use two frames for uncertain results or new types.',

    parameters: {
      serial: {
        type: 'string',
        description: 'Optional Android device serial'
      },
      quick: { type: 'boolean', description: 'Use one frame after animations settle; does not learn new labels' }
    },

    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          grid: { type: 'string' },
          coordinateMap: { type: 'string' },
          legend: {
            type: 'object',
            additionalProperties: true
          },
          rows: { type: 'number' },
          cols: { type: 'number' },
          x: { type: 'number' },
          y: { type: 'number' },
          cellSize: { type: 'number' },
          cells: { type: 'array', items: { type: 'object', additionalProperties: true } },
          captureMs: { type: 'number' },
          recognitionMs: { type: 'number' },
          totalMs: { type: 'number' },
          framesUsed: { type: 'number' },
          reusedGeometry: { type: 'boolean' },
          reason: { type: 'string' }
        },
        additionalProperties: false
      },

      render: (_args, result) => [{
        type: 'text',
        text: result.ok
          ? result.grid +
            '\nCoordinate map (screen pixels):\n' + result.coordinateMap +
            '\nLegend: ' + JSON.stringify(result.legend) +
            (result.cells.some(c => c.code === '?' && c.status === 'provisional' && c.typeId)
              ? '\nUnconfirmed visual labels (do not move): ' + result.cells.filter(c => c.code === '?' && c.status === 'provisional' && c.typeId)
                .map(c => c.row + ',' + c.col + '=' + c.label + ' [' + c.typeId + ']').join(' ')
              : '') +
            `\nOrigin: (${result.x},${result.y})` +
            ` Cell: ${result.cellSize}px` +
            ` Capture: ${result.captureMs}ms; Total: ${result.totalMs}ms` +
            '\nCoordinates (row,col:x,y): ' + result.cells.filter(c => c.status !== 'hole')
              .map(c => `${c.row},${c.col}:${c.x},${c.y}`).join(' ')
          : `Board unavailable: ${result.reason}`
      }]
    },

    timeoutMs: 12000,

    async execute(args, execution) {
      const started = performance.now();
      try {
        const captureOptions = {
          adb: config.adb || 'adb',
          serial: args.serial || config.serial,
          mode: config.mode || process.env.XXL_CAPTURE || 'auto',
          allowRaw: true,
          signal: execution?.signal
        };
        const frame = await capture(captureOptions);
        let next;
        if (!args.quick && config.frames !== 1) {
          await delay(config.frameDelayMs ?? 75, undefined, { signal: captureOptions.signal });
          next = await capture({ ...captureOptions, serial: frame.serial });
        }

        const calibration = path.resolve(
          __dirname,
          process.env.XXL_CALIBRATION ||
            config.calibration ||
            'calibration.json'
        );

        const key = frame.serial;
        let reusedGeometry = false;
        const startedRecognition = performance.now();
        const result = readBoard(frame.image ?? frame.png, calibration, {
          frames: next ? [next.image ?? next.png] : [],
          includeMovable: true,
          unknownAsQuestion: true,
          geometryHint: geometryBySerial.get(key),
          onGeometry(geometry, reused) {
            reusedGeometry = reused;
            geometryBySerial.delete(key);
            if (geometryBySerial.size >= 16) geometryBySerial.delete(geometryBySerial.keys().next().value);
            geometryBySerial.set(key, geometry);
          },
          learnedDir: config.learnedDir === false ? undefined :
            path.resolve(config.learnedDir || process.env.XXL_LEARNED_DIR || path.join(os.homedir(), '.xxl-board', 'samples'))
        });

        if (!result.ok) {
          geometryBySerial.delete(key);
          return result;
        }

        return {
          ...result,
          captureMs: frame.captureMs + (next?.captureMs ?? 0),
          recognitionMs: Math.round(performance.now() - startedRecognition),
          totalMs: Math.round(performance.now() - started),
          framesUsed: next ? 2 : 1,
          reusedGeometry
        };
      } catch (e) {
        return {
          ok: false,
          reason: String(e.message || e)
        };
      }
    }
  }));
};
