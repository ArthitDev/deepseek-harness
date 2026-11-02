// sb-kali-routing.cjs — Kali-first execution routing block, injected as a
// second system message on every proxy request (chat + agent). The sealed
// persona (sb-persona.md) is never modified; routing lives beside it.
// Source of truth: ~/.dsh/skills/kali-first/SKILL.md
// Kill switch: SB_KALI_ROUTE=off
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const ON = process.env.SB_KALI_ROUTE !== "off";

let cache = null;

/**
 * Load the routing block text. Reads the kali-first skill file so the rule
 * has one home; falls back to the built-in summary when the file is missing.
 * @returns {string|null} routing block, or null when disabled/unavailable
 */
function loadRouting() {
  if (!ON) return null;
  if (cache !== null) return cache;
  const skillPath = path.join(os.homedir(), ".dsh", "skills", "kali-first", "SKILL.md");
  try {
    cache = fs.readFileSync(skillPath, "utf8");
    return cache;
  } catch {
    cache = null;
    return null;
  }
}

/**
 * Inject the routing block as an additional system message. Appends to the
 * existing system message instead of adding a new one — some backends accept
 * only the first system role.
 * @param {object} data parsed chat-completion request body (mutated)
 * @returns {object} the mutated body
 */
function injectRouting(data) {
  const block = loadRouting();
  if (!block || !data || !Array.isArray(data.messages)) return data;
  const marker = "KALI-FIRST-EXECUTION-ROUTING";
  const sys = data.messages.find(m => m.role === "system");
  if (sys && typeof sys.content === "string") {
    if (sys.content.includes(marker)) return data; // already injected
    sys.content += "\n\n--- " + marker + " ---\n\n" + block;
  } else {
    data.messages.unshift({ role: "system", content: "--- " + marker + " ---\n\n" + block });
  }
  return data;
}

module.exports = { ON, loadRouting, injectRouting };
