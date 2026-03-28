/**
 * src/agents/qaAgent.js
 * ZerathCode — QA Agent (Healer)
 * Zero npm deps. Pure Node.js child_process.
 *
 * Commands:
 *   zerath qa test [dir]          Run npm test / gradle test
 *   zerath qa lint [dir]          ESLint if available
 *   zerath qa debug [dir]         AI-powered debug loop
 */

"use strict";

const fs              = require("fs");
const path            = require("path");
const { exec, spawn } = require("child_process");
const { promisify }   = require("util");
const renderer        = require("../ui/renderer");

const execAsync = promisify(exec);

class QAAgent {
  constructor(opts = {}) {
    this.permManager = opts.permManager || null;
    this.keyManager  = opts.keyManager  || null;
  }

  async run(args = []) {
    const sub = args[0] || "test";
    const dir = args[1] || process.cwd();

    switch (sub) {
      case "test":  return this._runTests(dir);
      case "lint":  return this._lint(dir);
      case "debug": return this._debugLoop(dir, parseInt(args[2]) || 5);
      default:
        console.error(`\x1b[31m✖  Unknown qa command: "${sub}". Use test|lint|debug\x1b[0m`);
    }
  }

  // ── RUN TESTS ─────────────────────────────────────────────────────────────
  async _runTests(dir) {
    const type = this._detectType(dir);
    renderer.agentLog("qa", "run", `Tests (${type}): ${dir}`);

    if (type === "android") return this._gradleTest(dir);
    return this._npmTest(dir);
  }

  // ── GRADLE TEST ───────────────────────────────────────────────────────────
  async _gradleTest(dir) {
    try {
      const output = await this._exec("./gradlew", ["test", "--no-daemon"], dir, 180000);
      renderer.agentLog("qa", "ok", "All Gradle tests passed");
      return { passed: true };
    } catch (err) {
      renderer.agentLog("qa", "error", "Gradle tests failed");
      const failures = this._parseGradleFailures(err.output || "");
      this._printFailures(failures);
      return { passed: false, failures };
    }
  }

  // ── NPM TEST ──────────────────────────────────────────────────────────────
  async _npmTest(dir) {
    // Find package.json — check dir, dir/backend
    const targets = [dir, path.join(dir, "backend")]
      .filter(d => fs.existsSync(path.join(d, "package.json")));

    if (targets.length === 0) {
      renderer.agentLog("qa", "warn", "No package.json found — nothing to test");
      return { passed: true };
    }

    let allPassed = true;
    for (const target of targets) {
      const pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
      if (!pkg.scripts?.test) {
        renderer.agentLog("qa", "info", `No test script in ${path.relative(dir, target) || "."}`);
        continue;
      }
      try {
        await this._exec("npm", ["test", "--", "--passWithNoTests"], target, 120000);
        renderer.agentLog("qa", "ok", `Tests passed: ${path.relative(dir, target) || "."}`);
      } catch (err) {
        allPassed = false;
        renderer.agentLog("qa", "error", `Tests failed: ${path.relative(dir, target) || "."}`);
        const failures = this._parseJestFailures(err.output || "");
        this._printFailures(failures);
      }
    }
    return { passed: allPassed };
  }

  // ── LINT ──────────────────────────────────────────────────────────────────
  async _lint(dir) {
    const hasEslint = await this._which("eslint");
    if (!hasEslint) {
      renderer.agentLog("qa", "warn", "ESLint not found — install: npm install -g eslint");
      return;
    }

    renderer.agentLog("qa", "scan", `ESLint: ${dir}`);
    try {
      await execAsync(`cd "${dir}" && eslint . --ext .js,.ts --format compact 2>&1`, { timeout: 30000 });
      renderer.agentLog("qa", "ok", "Lint passed");
    } catch (err) {
      const issues = (err.stdout || "").split("\n").filter(Boolean).slice(0, 20);
      renderer.agentLog("qa", "warn", `${issues.length} lint issue(s)`);
      issues.forEach(i => console.log(`  \x1b[90m${i}\x1b[0m`));
    }
  }

  // ── DEBUG LOOP ────────────────────────────────────────────────────────────
  async _debugLoop(dir, maxLoops = 5) {
    renderer.agentLog("qa", "run", `Debug loop started (max ${maxLoops} iterations)`);

    for (let i = 1; i <= maxLoops; i++) {
      renderer.agentLog("qa", "info", `── Iteration ${i}/${maxLoops}`);

      const result = await this._runTests(dir);
      if (result.passed) {
        renderer.agentLog("qa", "ok", `All tests passing after ${i} iteration(s) ✔`);
        return { success: true, iterations: i };
      }

      renderer.agentLog("qa", "warn", `Failures remain — attempting AI fix (iteration ${i})`);

      // Try to apply simple automatic fixes before calling AI
      const fixed = await this._autoFix(result.failures || [], dir);
      if (!fixed) {
        renderer.agentLog("qa", "warn", "Could not auto-fix — manual review needed");
        break;
      }
    }

    renderer.agentLog("qa", "warn", `Debug loop complete — ${maxLoops} iteration(s) done`);
    return { success: false, iterations: maxLoops };
  }

  // ── Simple auto-fix (missing deps etc.) ──────────────────────────────────
  async _autoFix(failures, dir) {
    for (const f of failures) {
      // Missing module → npm install
      const moduleMatch = (f.error || f.test || "").match(/Cannot find module ['"]([^'"]+)['"]/);
      if (moduleMatch) {
        const pkg = moduleMatch[1];
        if (!pkg.startsWith(".") && !pkg.startsWith("/")) {
          renderer.agentLog("qa", "install", `Installing missing: ${pkg}`);
          try {
            await execAsync(`cd "${dir}" && npm install ${pkg}`, { timeout: 60000 });
            return true;
          } catch {}
        }
      }
    }
    return false;
  }

  // ── Exec helper (returns stdout, throws with output on failure) ────────────
  _exec(cmd, args, cwd, timeout = 60000) {
    return new Promise((resolve, reject) => {
      let output = "";
      const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(Object.assign(new Error("Timed out"), { output }));
      }, timeout);

      child.stdout.on("data", d => { output += d; process.stdout.write(d); });
      child.stderr.on("data", d => { output += d; process.stderr.write(d); });
      child.on("error", err => { clearTimeout(timer); reject(Object.assign(err, { output })); });
      child.on("close", code => {
        clearTimeout(timer);
        if (code === 0) resolve(output);
        else reject(Object.assign(new Error(`Exit ${code}`), { output }));
      });
    });
  }

  // ── Parse Jest/Mocha failures ──────────────────────────────────────────────
  _parseJestFailures(output) {
    const failures = [];
    const lines    = output.split("\n");
    let   current  = null;

    for (const line of lines) {
      if (line.includes("● ") || line.includes("FAIL ")) {
        if (current) failures.push(current);
        current = { test: line.replace("●", "").trim(), error: "", file: "" };
      }
      if (current) {
        if (line.match(/\.(js|ts|kt|java):\d+/)) {
          current.file = line.trim();
        }
        if (line.includes("Expected") || line.includes("Error:") || line.includes("Received")) {
          current.error += line.trim() + " ";
        }
      }
    }
    if (current) failures.push(current);
    return failures.filter(f => f.test || f.error);
  }

  // ── Parse Gradle failures ──────────────────────────────────────────────────
  _parseGradleFailures(output) {
    const failures = [];
    output.split("\n")
      .filter(l => l.includes("FAILED") || l.includes("error:"))
      .forEach(l => failures.push({ test: l.trim(), error: l.trim() }));
    return failures;
  }

  // ── Print failures ─────────────────────────────────────────────────────────
  _printFailures(failures) {
    if (!failures.length) return;
    console.log(`\n  \x1b[91m${failures.length} failure(s):\x1b[0m`);
    failures.slice(0, 5).forEach(f => {
      console.log(`  \x1b[90m•\x1b[0m  \x1b[93m${f.test || "unknown test"}\x1b[0m`);
      if (f.error) console.log(`     \x1b[90m${f.error.slice(0, 100)}\x1b[0m`);
    });
    console.log("");
  }

  // ── Detect project type ───────────────────────────────────────────────────
  _detectType(dir) {
    if (fs.existsSync(path.join(dir, "gradlew")))     return "android";
    if (fs.existsSync(path.join(dir, "package.json"))) return "node";
    if (fs.existsSync(path.join(dir, "backend")))      return "fullstack";
    return "unknown";
  }

  async _which(cmd) {
    try { await execAsync(`which ${cmd}`); return true; } catch { return false; }
  }
}

module.exports = QAAgent;
