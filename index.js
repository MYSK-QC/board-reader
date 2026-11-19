'use strict';

const path = require('node:path');
const { capture } = require('./capture.cjs');
const { readBoard } = require('./board.cjs');

exports.name = 'dsh-plugin-xxl-board';
exports.inject = ['tools'];

exports.apply = async function apply(ctx, config = {}) {
  const { defineTool } = await import('@deepseek-ai/dsh-tools');

  ctx.tools.register(defineTool({
    name: 'xxl_board',

    description:
      'Read the current 开心消消乐 9x9 board via rooted ADB. ' +
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
            ` Capture: ${result.captureMs}ms`
          : `Board unavailable: ${result.reason}`
      }]
    },

    timeoutMs: 5000,

    async execute(args, execution) {
      try {
        const frame = await capture({
          adb: config.adb || 'adb',
          serial: args.serial || config.serial,
          mode: config.mode || 'auto',
          signal: execution?.signal
        });

        const calibration = path.resolve(
          __dirname,
          process.env.XXL_CALIBRATION ||
            config.calibration ||
            'calibration.json'
        );

        const result = readBoard(frame.png, calibration);

        if (!result.ok) return result;

        return {
          ...result,
          captureMs: frame.captureMs
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
