'use strict';

const path = require('node:path');
const os = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');
const { capture } = require('./capture.cjs');
const { readBoard } = require('./board.cjs');

exports.name = 'dsh-plugin-xxl-board';
exports.inject = ['tools'];

exports.apply = async function apply(ctx, config = {}) {
  const { defineTool } = await import('@deepseek-ai/dsh-tools');

  ctx.tools.register(defineTool({
    name: 'xxl_board',

    description:
      'Read the current 开心消消乐 board via rooted ADB. ' +
      'Returns text grid, legend and pixel coordinates. ' +
      'Ice and special tiles require calibration. ' +
      'Never guess uncertain cells.',

    parameters: {
      serial: {
        type: 'string',
        description: 'Optional Android device serial'
      }
    },

    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          grid: { type: 'string' },
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
          reason: { type: 'string' }
        },
        additionalProperties: false
      },

      render: (_args, result) => [{
        type: 'text',
        text: result.ok
          ? result.grid +
            '\nLegend: ' + JSON.stringify(result.legend) +
            `\nOrigin: (${result.x},${result.y})` +
            ` Cell: ${result.cellSize}px` +
            ` Capture: ${result.captureMs}ms` +
            '\nCoordinates (row,col:x,y): ' + result.cells.filter(c => c.status !== 'hole')
              .map(c => `${c.row},${c.col}:${c.x},${c.y}`).join(' ')
          : `Board unavailable: ${result.reason}`
      }]
    },

    timeoutMs: 12000,

    async execute(args, execution) {
      try {
        const captureOptions = {
          adb: config.adb || 'adb',
          serial: args.serial || config.serial,
          mode: config.mode || process.env.XXL_CAPTURE || 'auto',
          signal: execution?.signal
        };
        const frame = await capture(captureOptions);
        let next;
        if (config.frames !== 1) {
          await delay(config.frameDelayMs ?? 75, undefined, { signal: captureOptions.signal });
          next = await capture({ ...captureOptions, serial: frame.serial });
        }

        const calibration = path.resolve(
          __dirname,
          process.env.XXL_CALIBRATION ||
            config.calibration ||
            'calibration.json'
        );

        const result = readBoard(frame.png, calibration, {
          frames: next ? [next.png] : [],
          learnedDir: config.learnedDir === false ? undefined :
            path.resolve(config.learnedDir || process.env.XXL_LEARNED_DIR || path.join(os.homedir(), '.xxl-board', 'samples'))
        });

        if (!result.ok) return result;

        return {
          ...result,
          captureMs: frame.captureMs + (next?.captureMs ?? 0)
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
