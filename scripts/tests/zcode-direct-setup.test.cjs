const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const YAML = createRequire(path.resolve(__dirname, '../../packages/experimental/pi-tui/package.json'))('yaml');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-direct-key-'));
  const directory = path.join(root, 'proxy');
  const home = path.join(root, 'home');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'config.yaml'), 'auth:\n  proxyApiKey: fake-private-direct-key\n');
  const filename = path.join(home, '.credentials.yaml');
  const run = () => spawnSync('bun', ['run', path.resolve(__dirname, '../zcode-direct-setup.mjs'), directory], {
    env: { ...process.env, DSH_HOME: home, ZCODE_PROXY_API_KEY: '' }, windowsHide: true, encoding: 'utf8', timeout: 5000,
  });
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'dsh-direct-key-')));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { directory, home, filename, run };
}

test('direct setup creates a private store without printing its key', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(YAML.parse(fs.readFileSync(f.filename, 'utf8')).refs.ZCODE_DIRECT_API_KEY, 'fake-private-direct-key');
  assert.doesNotMatch(result.stdout + result.stderr, /fake-private-direct-key/);
});

test('direct setup preserves other credentials, OAuth records and comments across repeat runs', t => {
  const f = fixture(t);
  fs.mkdirSync(f.home);
  fs.writeFileSync(f.filename, '# keep-comment\nversion: 1\nrefs:\n  OTHER_KEY: fake-other\nrecords:\n  oauth-record: { marker: keep }\n');
  assert.equal(f.run().status, 0);
  const first = fs.readFileSync(f.filename, 'utf8');
  assert.match(first, /# keep-comment/);
  const store = YAML.parse(first);
  assert.equal(store.refs.OTHER_KEY, 'fake-other');
  assert.equal(store.records['oauth-record'].marker, 'keep');
  assert.equal(f.run().status, 0);
  assert.equal(fs.readFileSync(f.filename, 'utf8'), first);
});

test('invalid credentials fail without overwriting the document or printing secrets', t => {
  const f = fixture(t);
  fs.mkdirSync(f.home);
  const content = 'version: 1\nrefs: [fake-existing-secret]\n';
  fs.writeFileSync(f.filename, content);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(f.filename, 'utf8'), content);
  assert.doesNotMatch(result.stdout + result.stderr, /fake-private-direct-key|fake-existing-secret/);
});

test('setup adds the shipped route to an existing home override without replacing other providers', t => {
  const f = fixture(t);
  fs.mkdirSync(f.home);
  const patch = path.join(f.home, 'cordis.patch.yml');
  fs.writeFileSync(patch, '# keep-home-comment\n- id: llm-pi-ai\n  config:\n    providers:\n      other:\n        baseURL: http://127.0.0.1:9/v1\n');
  assert.equal(f.run().status, 0);
  const first = fs.readFileSync(patch, 'utf8');
  assert.match(first, /# keep-home-comment/);
  assert.doesNotMatch(first, /!!js/);
  const data = YAML.parse(first);
  assert.equal(data[0].config.providers.other.baseURL, 'http://127.0.0.1:9/v1');
  assert.equal(data[0].config.providers['zcode-direct'].apiKeyEnv, 'ZCODE_DIRECT_API_KEY');
  assert.equal(data[0].config.providers['zcode-direct'].baseURL, 'http://127.0.0.1:18080/v1');
  assert.equal(data[0].config.providers['zcode-direct'].baseURLPortEnv, 'ZCODE_PORT');
  assert.equal(data[0].config.providers['zcode-direct'].reasoning, 'low');
  assert.equal(f.run().status, 0);
  assert.equal(fs.readFileSync(patch, 'utf8'), first);
});
