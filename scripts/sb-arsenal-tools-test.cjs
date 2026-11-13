#!/usr/bin/env node
/** Check optional command adapters without starting Kali or scanners. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { TOOLS } = require('./sb-arsenal.cjs');

const adapters = [
  ['dalfox_xss', 'dalfox '], ['arjun_params', 'arjun '],
  ['paramspider_extract', 'paramspider '], ['x8_params', 'x8 '],
  ['graphql_scan', 'for ep '], ['dotdotpwn_traversal', 'dotdotpwn '],
  ['fscan_intranet', 'fscan '], ['jwt_analyzer', 'jwt_tool '],
  ['hash_length_extension', 'hash_extender '], ['linpeas_enum', 'linpeas '],
  ['checksec_binary', 'checksec '], ['ropper_gadgets', 'ropper '],
  ['one_gadget_find', 'one_gadget '], ['pacu_aws', 'pacu '],
  ['scoutsuite_audit', 'scout.py '], ['kube_hunter', 'kube-hunter '],
  ['trivy_scan', 'trivy '], ['shodan_search', 'shodan '],
  ['virustotal_search', 'vt '], ['zsteg_stego', 'zsteg '],
  ['foremost_carve', 'mkdir -p '], ['trufflehog_scan', 'trufflehog '],
  ['baddns_scan', 'baddns '],
];

for (const [name, prefix] of adapters) {
  test(`${name} builds an optional tool command`, () => {
    assert.ok(TOOLS[name].desc);
    assert.ok(Array.isArray(TOOLS[name].params));
    const params = Object.fromEntries(TOOLS[name].params.map(key => [key, 'fixture value']));
    const command = TOOLS[name].build(params);
    assert.ok(command.startsWith(prefix));
    assert.ok(!command.includes('undefined'));
  });
}

test('hash length extension keeps scalar options inside shell quotes', () => {
  const command = TOOLS.hash_length_extension.build({
    signature: 'abc', data: 'data', append: 'more',
    keylen: '16; printf injected', algo: "sha256' ; printf injected",
  });
  assert.ok(command.includes("-l '16; printf injected'"));
  assert.ok(command.includes("-f 'sha256'\\'' ; printf injected'"));
});
