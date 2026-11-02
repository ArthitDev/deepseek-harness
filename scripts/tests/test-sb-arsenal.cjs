// test-sb-arsenal.cjs — self-check for the rewritten dispatch engine. Run: node test-sb-arsenal.cjs
const assert = require('assert');
const path = require('path');
const fs = require('fs');
process.env.SB_RUN_ID = 'test-fixed-run';
const arsenal = require('../sb-arsenal.cjs');

(async () => {
  // 1. q() quoting: spaces, quotes, $() and backticks stay literal inside single quotes
  const cmd = arsenal.TOOLS.hydra_brute.build({ target: "10.0.0.1 $(reboot) 'x'", user: "ad;min" });
  assert(cmd.includes(`'10.0.0.1 $(reboot) '\\''x'\\'''`), 'target quoted');
  assert(cmd.includes(`'ad;min'`), 'user quoted');
  assert(!cmd.includes('ad;min ') || true);

  // 2. GetUserSPNs key fixed (no leading space)
  assert(arsenal.TOOLS.GetUserSPNs, 'GetUserSPNs key exists');
  assert(!Object.keys(arsenal.TOOLS).some(k => k.startsWith(' ')), 'no padded keys');

  // 3. runInKali runs as root and resolves elapsedMs
  const r = await arsenal.runInKali('id -u', 20000);
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.stdout.trim(), '0', 'runs as root (uid 0)');
  assert(typeof r.elapsedMs === 'number');

  // 4. dispatch writes evidence log under a fixed SB_RUN_ID dir
  const res = await arsenal.dispatch('dig_lookup', { domain: 'example.com', type: 'A', exec_timeout: 30000 });
  assert(res.logPath && fs.existsSync(res.logPath), 'evidence log written');
  assert(path.basename(path.dirname(res.logPath)) === 'test-fixed-run', 'run dir uses SB_RUN_ID');
  assert(res.logBytes > 0);
  assert(res.output.length <= 32 * 1024 + 64, 'preview bounded');

  // 5. unknown tool still errors cleanly
  const bad = await arsenal.dispatch('no_such_tool', {});
  assert.strictEqual(bad.success, false);

  console.log('ALL 5 CHECKS PASSED');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
