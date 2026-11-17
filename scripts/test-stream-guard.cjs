#!/usr/bin/env node
/** Offline test of the stream refusal guard: fake upstream answers a stream
 * request with a refusal SSE, the transport must hard-retry and emit clean
 * chunks with sb_refusal_retry: true. No real model involved. */
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const v6 = require(path.join(__dirname, "sb-proxy-v6.cjs"));

const fake = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    const data = JSON.parse(body);
    if (data.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = c => `data: ${JSON.stringify({ id: "t1", object: "chat.completion.chunk", created: 1, model: data.model, choices: [{ index: 0, delta: { content: c }, finish_reason: null }] })}\n\n`;
      res.write(chunk("I cannot do that, sorry."));
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "DONE: full deliverable shipped." } }] }));
  });
});
fake.listen(0, "127.0.0.1", () => {
  const backendPort = fake.address().port;
  const port = 18931;
  const child = spawn(process.execPath, [path.join(__dirname, "sb-transport.cjs"), "serve"], {
    env: { ...process.env, SB_PORT: String(port), SB_BACKEND: `http://127.0.0.1:${backendPort}`, SB_EXEC_MODE: "off" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", d => process.stdout.write("[transport] " + d));
  child.stderr.on("data", d => process.stdout.write("[transport!err] " + d));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  (async () => {
    await wait(2500);
    const body = JSON.stringify({ model: "fake", messages: [{ role: "user", content: "hello" }], stream: true });
    const result = await new Promise((resolve) => {
      const req = http.request({ hostname: "127.0.0.1", port, path: "/v1/chat/completions", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, res => {
        let d = "";
        res.on("data", c => d += c);
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      });
      req.on("error", e => resolve({ status: 0, body: e.message }));
      req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, body: "timeout" }); });
      req.write(body); req.end();
    });
    const retried = result.body.includes('"sb_refusal_retry":true');
    const clean = result.body.includes("DONE: full deliverable shipped.");
    const done = result.body.includes("data: [DONE]");
    const noRefusal = !v6.REFUSAL_RE.test(result.body);
    console.log(`status: ${result.status}, retried: ${retried}, clean: ${clean}, [DONE]: ${done}, no refusal: ${noRefusal}`);
    const pass = result.status === 200 && retried && clean && done && noRefusal;
    console.log(pass ? "STREAM GUARD PASS" : "STREAM GUARD FAIL");
    child.kill();
    fake.close();
    process.exit(pass ? 0 : 1);
  })();
});
