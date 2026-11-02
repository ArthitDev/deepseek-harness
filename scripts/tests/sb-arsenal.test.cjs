const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const filename = path.resolve(__dirname, '../sb-arsenal.cjs');
const source = fs.readFileSync(filename, 'utf8');
const marker = '\x1eDSH_ARSENAL_STARTED\x1f';

function fixture(t, outcomes, readinessFails = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-arsenal-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const launches = [];
  const checks = [];
  const childProcess = {
    spawn(executable, argv, options) {
      launches.push({ executable, argv, options });
      assert.ok(outcomes.length, 'Unexpected command replay');
      const outcome = outcomes.shift();
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        if (outcome.error) {
          child.emit('error', new Error(outcome.error));
        } else {
          if (outcome.started !== false) {
            child.stderr.emit('data', Buffer.from(marker.slice(0, 9)));
            child.stderr.emit('data', Buffer.from(marker.slice(9)));
          }
          if (outcome.stdout) child.stdout.emit('data', Buffer.from(outcome.stdout));
          if (outcome.stderr) child.stderr.emit('data', Buffer.from(outcome.stderr));
        }
        child.emit('close', Object.hasOwn(outcome, 'code') ? outcome.code : outcome.error ? -1 : 0);
      });
      return child;
    },
    execSync(command, options) {
      checks.push({ command, options });
      if (readinessFails) throw new Error('Fixture readiness failure');
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    require: name => name === 'child_process' ? childProcess : require(name),
    module, __dirname: path.dirname(filename), Buffer,
    process: { env: { SB_RUNS_DIR: root, SB_RUN_ID: 'fixture' } },
    console: { log() {} },
  }, { filename });
  return { arsenal: module.exports, launches, checks };
}

test('successful dispatch launches once without a readiness probe and hides the marker', async t => {
  const { arsenal, launches, checks } = fixture(t, [{ stdout: 'answer\n', stderr: 'warning\n' }]);
  const result = await arsenal.dispatch('dig_lookup', { domain: 'example.invalid' });
  assert.equal(result.success, true);
  assert.equal(result.commandStarted, true);
  assert.equal(result.stdout, 'answer\n');
  assert.equal(result.stderr, 'warning\n');
  assert.equal(launches.length, 1);
  assert.equal(checks.length, 0);
  assert.deepEqual(Array.from(launches[0].argv.slice(0, 7)), ['-d', 'kali-linux', '-u', 'root', '--', 'bash', '-c']);
  assert.equal(launches[0].options.windowsHide, true);
  assert.equal(fs.readFileSync(result.logPath, 'utf8').includes(marker), false);
});

test('fast tool errors are returned once even if output contains WSL error text', async t => {
  const { arsenal, launches, checks } = fixture(t, [{ code: 2,
    stdout: 'distribution not installed\n', stderr: 'WSL_E_FAKE\n' }]);
  const result = await arsenal.dispatch('dig_lookup', { domain: 'example.invalid' });
  assert.equal(result.success, false);
  assert.equal(result.exitCode, 2);
  assert.equal(launches.length, 1);
  assert.equal(checks.length, 0);
});

test('structured WSL failure before command start probes readiness and retries once', async t => {
  const { arsenal, launches, checks } = fixture(t, [
    { started: false, code: 1, stdout: 'Error code: Wsl/Service/CreateInstance/HCS/HCS_E_SERVICE_NOT_AVAILABLE' },
    { stdout: 'recovered\n' },
  ]);
  const result = await arsenal.dispatch('dig_lookup', { domain: 'example.invalid' });
  assert.equal(result.success, true);
  assert.equal(launches.length, 2);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].command, 'wsl -d kali-linux -u root -- true');
});

test('a second WSL failure is reported without a third launch', async t => {
  const failed = { started: false, code: 1, stderr: 'WSL_E_VM_MODE_INVALID' };
  const { arsenal, launches, checks } = fixture(t, [{ ...failed }, { ...failed }]);
  const result = await arsenal.dispatch('dig_lookup', { domain: 'example.invalid' });
  assert.equal(result.success, false);
  assert.equal(result.commandStarted, false);
  assert.equal(launches.length, 2);
  assert.equal(checks.length, 1);
});

test('failed readiness preserves the first failure without replaying the command', async t => {
  const { arsenal, launches, checks } = fixture(t, [
    { started: false, code: 1, stderr: 'WSL_E_DISTRO_NOT_FOUND' },
  ], true);
  const result = await arsenal.dispatch('dig_lookup', { domain: 'example.invalid' });
  assert.equal(result.success, false);
  assert.match(result.stderr, /WSL_E_DISTRO_NOT_FOUND/);
  assert.equal(launches.length, 1);
  assert.deepEqual(checks.map(check => check.options.timeout), [90000, 120000]);
});

test('an unclassified launch error is not replayed', async t => {
  const { arsenal, launches, checks } = fixture(t, [{ error: 'spawn wsl ENOENT' }]);
  const result = await arsenal.dispatch('dig_lookup', { domain: 'example.invalid' });
  assert.equal(result.success, false);
  assert.match(result.error, /ENOENT/);
  assert.equal(launches.length, 1);
  assert.equal(checks.length, 0);
});

test('an uncertain timeout is returned without replaying the command', async t => {
  const { arsenal, launches, checks } = fixture(t, [
    { started: false, code: null, stderr: 'The operation timed out' },
  ]);
  const result = await arsenal.dispatch('dig_lookup', { domain: 'example.invalid' });
  assert.equal(result.success, false);
  assert.equal(result.exitCode, null);
  assert.equal(launches.length, 1);
  assert.equal(checks.length, 0);
});

test('UTF-16-like WSL error output is recognized before command start', async t => {
  const { arsenal, launches } = fixture(t, [
    { started: false, code: 1, stdout: 'WSL_E_VM_MODE_INVALID'.split('').join('\0') },
    {},
  ]);
  assert.equal((await arsenal.dispatch('dig_lookup', { domain: 'example.invalid' })).success, true);
  assert.equal(launches.length, 2);
});

test('campaign and parallel jobs launch only one WSL process per successful command', async t => {
  const { arsenal, launches, checks } = fixture(t, [{}, {}, {}, {}]);
  const campaign = await arsenal.campaign({ steps: [
    { name: 'one', tool: 'dig_lookup', params: { domain: 'example.invalid' } },
    { name: 'two', tool: 'dig_lookup', params: { domain: 'example.invalid' } },
  ] });
  assert.equal(campaign.success, true);
  const parallel = await arsenal.dispatchAll([
    { name: 'three', tool: 'dig_lookup', params: { domain: 'example.invalid' } },
    { name: 'four', tool: 'dig_lookup', params: { domain: 'example.invalid' } },
  ]);
  assert.equal(parallel.success, true);
  assert.equal(launches.length, 4);
  assert.equal(checks.length, 0);
});

test('unknown tools do not start WSL', async t => {
  const { arsenal, launches, checks } = fixture(t, []);
  assert.equal((await arsenal.dispatch('unknown')).success, false);
  assert.equal(launches.length, 0);
  assert.equal(checks.length, 0);
});
