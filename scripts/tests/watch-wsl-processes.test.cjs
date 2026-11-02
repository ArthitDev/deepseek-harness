const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test('Windows observer captures shell start and stop with parent ancestry and no arguments', {
  skip: process.platform !== 'win32', timeout: 40000,
}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wsl-observer-test-'));
  const output = path.join(root, 'trace.jsonl');
  const script = path.resolve(__dirname, '../watch-wsl-processes.ps1');
  const observer = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script,
    '-DurationSeconds', '30', '-OutputFile', output], { windowsHide: true });
  let stderr = '';
  observer.stderr.on('data', chunk => { stderr += chunk; });
  observer.stdout.resume();
  const closed = new Promise((resolve, reject) => {
    observer.once('error', reject);
    observer.once('close', code => resolve(code));
  });
  t.after(async () => {
    await fs.writeFile(output + '.stop', '');
    if (observer.exitCode === null) {
      await Promise.race([closed, delay(2000)]);
      if (observer.exitCode === null) { observer.kill(); await closed; }
    }
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'dsh-wsl-observer-test-')));
    await fs.rm(root, { recursive: true, force: true });
  });
  const read = async () => {
    let text;
    try { text = await fs.readFile(output, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return text.split(/\r?\n/).slice(0, -1).filter(Boolean).map(line => JSON.parse(line));
  };
  const until = async predicate => {
    for (let i = 0; i < 200; i++) {
      const records = await read();
      if (predicate(records)) return records;
      assert.equal(observer.exitCode, null, stderr);
      await delay(100);
    }
    assert.fail('Observer did not record the expected event');
  };
  const initial = await until(records => records.some(record => record.kind === 'ready'));
  assert.equal(initial.find(record => record.kind === 'ready').commandLinesCollected, false);
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Start-Sleep -Milliseconds 800'], { windowsHide: true, stdio: 'ignore' });
  const childClosed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await childClosed; } });
  const records = await until(records => records.some(record => record.kind === 'observed-stop' && record.pid === child.pid));
  const start = records.find(record => record.kind === 'observed-start' && record.pid === child.pid);
  assert.ok(start);
  assert.equal(start.name.toLowerCase(), 'powershell.exe');
  assert.equal(start.parentPid, process.pid);
  assert.equal(start.ancestors[0].pid, process.pid);
  assert.equal(start.ancestors[0].name.toLowerCase(), 'node.exe');
  assert.equal(await childClosed, 0);
  await fs.writeFile(output + '.stop', '');
  assert.equal(await closed, 0, stderr);
  const final = await read();
  assert.equal(final.at(-1).kind, 'trace-end');
  assert.equal(final.at(-1).reason, 'stop-marker');
  for (const record of final) {
    assert.equal('commandLine' in record, false);
    assert.equal('environment' in record, false);
  }
});
