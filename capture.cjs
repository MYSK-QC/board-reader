'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const PROFILE = process.env.XXL_CAPTURE_PROFILE ||
  path.join(os.homedir(), '.xxl-capture.json');

const PNG_MAGIC = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10
]);

function run(adb, args, timeout = 3000, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(adb, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const chunks = [];
    const errors = [];
    let size = 0;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);

    const abort = () => child.kill('SIGKILL');

    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }

    child.stdout.on('data', chunk => {
      size += chunk.length;

      if (size > 16 * 1024 * 1024) {
        child.kill('SIGKILL');
        return;
      }

      chunks.push(chunk);
    });

    child.stderr.on('data', chunk => {
      if (errors.length < 20) errors.push(chunk);
    });

    child.on('error', finishError);

    child.on('close', code => {
      if (settled) return;

      if (timedOut) return finishError(new Error('ADB timeout'));
      if (signal?.aborted) return finishError(new Error('Aborted'));
      if (size > 16 * 1024 * 1024) {
        return finishError(new Error('Screenshot too large'));
      }

      if (code !== 0) {
        return finishError(new Error(
          Buffer.concat(errors).toString('utf8').slice(0, 500) ||
          `adb exited with ${code}`
        ));
      }

      finish(null, Buffer.concat(chunks));
    });

    function finishError(e) { finish(e); }

    function finish(e, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (e) reject(e);
      else resolve(value);
    }
  });
}

async function selectSerial(adb, requested) {
  if (requested) return requested;

  const output = await run(adb, ['devices']);
  const devices = output.toString('utf8')
    .split(/\r?\n/)
    .map(line => line.match(/^(\S+)\s+device(?:\s|$)/))
    .filter(Boolean)
    .map(match => match[1]);

  if (devices.length !== 1) {
    throw new Error(
      `Found ${devices.length} online devices; specify serial`
    );
  }

  return devices[0];
}

function checkPNG(data) {
  if (!Buffer.isBuffer(data) ||
      !data.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error('Invalid PNG screenshot');
  }

  return data;
}

async function captureMode(adb, serial, mode, signal) {
  const prefix = ['-s', serial];

  if (mode === 'pipe') {
    return checkPNG(await run(adb, [
      ...prefix,
      'exec-out',
      'su', '-c', 'screencap -p'
    ], 3500, signal));
  }

  if (mode !== 'pull') throw new Error('Invalid capture mode');

  const name = `xxl-${process.pid}-${randomBytes(4).toString('hex')}.png`;
  const remote = `/data/local/tmp/${name}`;
  const local = path.join(os.tmpdir(), name);

  try {
    await run(adb, [
      ...prefix,
      'shell', 'su', '-c',
      `screencap -p ${remote} && chmod 644 ${remote}`
    ], 3500, signal);

    await run(adb, [
      ...prefix, 'pull', remote, local
    ], 3500, signal);

    return checkPNG(fs.readFileSync(local));
  } finally {
    try { fs.unlinkSync(local); } catch {}

    try {
      await run(adb, [
        ...prefix, 'shell', 'su', '-c', `rm -f ${remote}`
      ], 1500);
    } catch {}
  }
}

function readProfile() {
  try { return JSON.parse(fs.readFileSync(PROFILE, 'utf8')); }
  catch { return {}; }
}

async function capture(options = {}) {
  const adb = options.adb || 'adb';
  const serial = await selectSerial(
    adb, options.serial || process.env.ANDROID_SERIAL
  );

  const configured = options.mode || process.env.XXL_CAPTURE || 'auto';
  const profile = readProfile();

  const mode = configured === 'auto'
    ? profile[serial] || 'pipe'
    : configured;

  const started = performance.now();

  try {
    const png = await captureMode(adb, serial, mode, options.signal);

    return {
      png,
      serial,
      mode,
      captureMs: Math.round(performance.now() - started)
    };
  } catch (e) {
    if (configured !== 'auto') throw e;

    const fallback = mode === 'pipe' ? 'pull' : 'pipe';
    const png = await captureMode(adb, serial, fallback, options.signal);

    return {
      png,
      serial,
      mode: fallback,
      captureMs: Math.round(performance.now() - started)
    };
  }
}

async function benchmark(adb = 'adb', requestedSerial) {
  const serial = await selectSerial(adb, requestedSerial);
  const samples = { pipe: [], pull: [] };
  const errors = {};

  // Alternate modes to reduce warm-up/order bias.
  for (let i = 0; i < 3; i++) {
    for (const mode of ['pipe', 'pull']) {
      try {
        const start = performance.now();
        await captureMode(adb, serial, mode);
        samples[mode].push(performance.now() - start);
      } catch (e) {
        errors[mode] = e.message;
      }
    }
  }

  const median = a => {
    if (!a.length) return Infinity;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };

  const pipe = median(samples.pipe);
  const pull = median(samples.pull);

  if (!Number.isFinite(pipe) && !Number.isFinite(pull)) {
    throw new Error(`Both capture modes failed: ${JSON.stringify(errors)}`);
  }

  const selected = pipe <= pull ? 'pipe' : 'pull';
  const profile = readProfile();
  profile[serial] = selected;

  fs.writeFileSync(PROFILE, JSON.stringify(profile, null, 2));

  return {
    serial,
    pipeMs: Number.isFinite(pipe) ? Math.round(pipe) : null,
    pullMs: Number.isFinite(pull) ? Math.round(pull) : null,
    selected,
    errors
  };
}

if (require.main === module) {
  benchmark('adb', process.argv[2])
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(e => {
      console.error(e.message);
      process.exitCode = 1;
    });
}

module.exports = { capture, benchmark };
