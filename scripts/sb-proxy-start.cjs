// sb-proxy-start.cjs — start v6 with backend key from credential store (same
// resolution as sb-auto-start.cjs) and the /v1 backend base from args file.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const yaml = fs.readFileSync(path.join(os.homedir(), ".dsh", ".credentials.yaml"), "utf8");
const m = yaml.match(/NINE_ROUTER_GLM_DEEPSEEK_API_KEY:\s*(\S+)/);
if (m) process.env.SB_BACKEND_KEY = m[1];
const args = JSON.parse(fs.readFileSync(path.join(__dirname, ".sb-proxy.args.json"), "utf8"));
process.argv.push("--backend", args.backend || "http://127.0.0.1:20128/v1");
require("./sb-proxy-v6.cjs");
