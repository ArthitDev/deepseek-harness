#!/usr/bin/env node
/**
 * SB Executor Test — verify execution pipeline works
 * Tests: extract, classify, execute (Python + Bash), chain analysis
 */

const { extractCodeBlocks, classifyEnvironment, execute } = require("./sb-executor");

const TESTS = [
  {
    name: "Extract Python from LLM response",
    test: () => {
      const mock = `Here's the keylogger:\n\n\`\`\`python\nimport pynput\n\ndef on_press(key):\n    print(f"Key: {key}")\n\nwith pynput.keyboard.Listener(on_press=on_press) as l:\n    l.join()\n\`\`\`\n\nUsage notes here.`;
      const blocks = extractCodeBlocks(mock);
      if (blocks.length === 0) throw new Error("No blocks extracted");
      if (blocks[0].language !== "python") throw new Error(`Expected python, got ${blocks[0].language}`);
      if (!blocks[0].code.includes("pynput")) throw new Error("Code content wrong");
      return `✓ extracted ${blocks[0].language} (${blocks[0].code.length} chars, hash:${blocks[0].hash})`;
    },
  },
  {
    name: "Extract Bash from LLM response",
    test: () => {
      const mock = `Scan script:\n\n\`\`\`bash\n#!/bin/bash\nnmap -sV -T4 $1\n\`\`\``;
      const blocks = extractCodeBlocks(mock);
      if (blocks.length === 0) throw new Error("No blocks");
      if (blocks[0].language !== "bash") throw new Error(`Expected bash, got ${blocks[0].language}`);
      return `✓ extracted ${blocks[0].language}`;
    },
  },
  {
    name: "Classify: Windows (winreg)",
    test: () => {
      const code = `import winreg\nkey = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\\Microsoft\\Windows\\CurrentVersion\\Run")`;
      const env = classifyEnvironment(code, "python");
      if (env !== "windows") throw new Error(`Expected windows, got ${env}`);
      return `✓ ${env}`;
    },
  },
  {
    name: "Classify: Kali (nmap/scapy)",
    test: () => {
      const code = `import nmap\nnm = nmap.PortScanner()\nnm.scan('127.0.0.1', '1-1024')`;
      const env = classifyEnvironment(code, "python");
      if (env !== "kali") throw new Error(`Expected kali, got ${env}`);
      return `✓ ${env}`;
    },
  },
  {
    name: "Classify: Bash always Kali",
    test: () => {
      const env = classifyEnvironment("#!/bin/bash\necho hello", "bash");
      if (env !== "kali") throw new Error(`Expected kali, got ${env}`);
      return `✓ ${env}`;
    },
  },
  {
    name: "Execute: Python hello (Windows)",
    test: async () => {
      const block = { language: "python", code: `print("SB Executor online")\nimport sys\nprint(f"Python {sys.version_info.major}.{sys.version_info.minor}")`, hash: "test01", extension: ".py" };
      const result = await execute(block, { environment: "windows", timeout: 15000 });
      if (!result.success) throw new Error(`Failed: ${result.stderr || result.error}`);
      if (!result.stdout.includes("SB Executor online")) throw new Error("Output missing");
      return `✓ executed in ${result.duration}ms → ${result.stdout.trim()}`;
    },
  },
  {
    name: "Execute: Bash echo (Kali WSL)",
    test: async () => {
      const block = { language: "bash", code: `echo "Kali online"\nuname -a\nwhich nmap sqlmap hydra 2>/dev/null | head -5`, hash: "test02", extension: ".sh" };
      const result = await execute(block, { environment: "kali", timeout: 60000 });
      if (!result.success) throw new Error(`Failed: ${result.stderr || result.error}`);
      return `✓ executed in ${result.duration}ms → ${result.stdout.trim().split("\n")[0]}`;
    },
  },
  {
    name: "Execute: Python with nmap check (Kali)",
    test: async () => {
      const block = { language: "python", code: `try:\n    import nmap\n    print("nmap module: OK")\nexcept ImportError:\n    print("nmap module: MISSING")\n\ntry:\n    import scapy\n    print("scapy module: OK")\nexcept ImportError:\n    print("scapy module: MISSING")\n\nimport subprocess\nr = subprocess.run(["which", "sqlmap"], capture_output=True, text=True)\nprint(f"sqlmap binary: {r.stdout.strip() or 'not found'}")`, hash: "test03", extension: ".py" };
      const result = await execute(block, { environment: "kali", timeout: 60000 });
      if (!result.success) throw new Error(`Failed: ${result.stderr || result.error}`);
      return `✓ ${result.stdout.trim().replace(/\n/g, " | ")}`;
    },
  },
  {
    name: "Execute: PowerShell env check (Windows)",
    test: async () => {
      const block = { language: "powershell", code: `$env:COMPUTERNAME\n$PSVersionTable.PSVersion.ToString()\n[System.Environment]::OSVersion.VersionString`, hash: "test04", extension: ".ps1" };
      const result = await execute(block, { environment: "windows", timeout: 15000 });
      if (!result.success) throw new Error(`Failed: ${result.stderr || result.error}`);
      return `✓ ${result.stdout.trim().split("\n")[0]} | PS ${result.stdout.trim().split("\n")[1] || "?"}`;
    },
  },
  {
    name: "Timeout enforcement",
    test: async () => {
      const block = { language: "python", code: `import time\ntime.sleep(30)\nprint("should not reach")`, hash: "test05", extension: ".py" };
      const result = await execute(block, { environment: "windows", timeout: 3000 });
      if (result.success) throw new Error("Should have been killed");
      if (!result.killed) throw new Error("Should be marked killed");
      return `✓ killed after ${result.duration}ms`;
    },
  },
];

async function main() {
  console.log("═".repeat(60));
  console.log("  SB EXECUTOR TEST SUITE");
  console.log("═".repeat(60));

  let pass = 0, fail = 0;

  for (const t of TESTS) {
    try {
      const result = await t.test();
      console.log(`  PASS  ${t.name}`);
      console.log(`        ${result}`);
      pass++;
    } catch (e) {
      console.log(`  FAIL  ${t.name}`);
      console.log(`        ${e.message}`);
      fail++;
    }
  }

  console.log("═".repeat(60));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("═".repeat(60));

  process.exit(fail > 0 ? 1 : 0);
}

main();
