// sb-kali-routing-test.cjs — asserts for the routing injection
"use strict";
const gm = require("./sb-kali-routing.cjs");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`ok - ${label}`); }
  else { fail++; console.error(`FAIL - ${label}`); }
}

ok(gm.ON === true, "enabled by default");
const block = gm.loadRouting();
ok(typeof block === "string" && block.length > 500, `routing block loaded (${block ? block.length : 0} chars)`);
ok(block.includes("wsl -d kali-linux -u root"), "block has WSL invocation");
ok(block.includes("sb-arsenal.cjs"), "block has arsenal dispatch");
ok(block.includes("is not recognized as an internal or external command"), "block has wrong-shell signal");

// inject into request without system message
const req1 = { messages: [{ role: "user", content: "scan 10.0.0.1" }] };
gm.injectRouting(req1);
ok(req1.messages[0].role === "system" && req1.messages[0].content.includes("KALI-FIRST-EXECUTION-ROUTING"), "injects as new system when none");

// inject into request with existing system — appended, not duplicated
const req2 = { messages: [{ role: "system", content: "existing persona" }, { role: "user", content: "x" }] };
gm.injectRouting(req2);
ok(req2.messages[0].content.startsWith("existing persona"), "existing system preserved");
ok(req2.messages[0].content.includes("KALI-FIRST-EXECUTION-ROUTING"), "routing appended");
const before = req2.messages[0].content;
gm.injectRouting(req2);
ok(req2.messages[0].content === before, "no double injection");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
