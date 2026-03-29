/**
 * src/core/selfHealingAgent.js
 * ZerathCode — Self-Healing Agent
 * Author: sanaX3065
 *
 * Runs a project command, captures stdout/stderr,
 * detects errors, asks the AI to generate a fix,
 * applies the fix (file patches), then re-runs.
 *
 * Max healing attempts: 3 (configurable)
 *
 * Used by Orchestrator when action = "run_command"
 */

"use strict";

const fs             = require("fs");
const path           = require("path");
const { spawn }      = require("child_process");
const renderer       = require("../ui/renderer");

const MAX_ATTEMPTS = 3;

// Known Termux / Node 22+ incompatible native packages
// Catches sqlite3, better-sqlite3, any prebuild-install/gyp failure on ARM64
const TERMUX_NATIVE_FAIL = /sqlite3.*prebuild-install|prebuild-install.*sqlite3|Cannot find module 'ini'|Cannot find module 'simple-concat'|Cannot find module 'readable-stream'|better-sqlite3.*prebuild|prebuild-install.*better-sqlite3|android_ndk_path|Undefined variable android_ndk_path/;
const TERMUX_ESBUILD_FAIL = /Cannot find package.*esbuild|ERR_MODULE_NOT_FOUND.*esbuild/;
// Bad semver anywhere in package.json (AI writes "version":"^1.0.0" or empty dep versions)
const NPM_INVALID_VERSION = /npm error Invalid Version|invalid version|Invalid SemVer/i;

// Error patterns that indicate something fixable
const FIXABLE_PATTERNS = [
  /SyntaxError/i,
  /Cannot find module/i,
  /not found/i,
  /ENOENT/i,
  /TypeError/i,
  /ReferenceError/i,
  /Error:/i,
  /failed/i,
  /unexpected token/i,
  /is not defined/i,
  /cannot read propert/i,
  /npm ERR/i,
  /Invalid Version/i,
];

class SelfHealingAgent {
  /**
   * @param {object} opts
   * @param {import('./memoryManager')} opts.memory
   * @param {import('../utils/aiClient')} opts.ai
   * @param {string}  opts.provider
   * @param {string}  opts.workDir
   */
  constructor(opts) {
    this.memory   = opts.memory;
    this.ai       = opts.ai;
    this.provider = opts.provider;
    this.workDir  = opts.workDir;
  }

  /**
   * Run a command with self-healing.
   * Returns { success, output, attempts }
   *
   * @param {string}   cmd
   * @param {string[]} args
   * @param {string}   cwd
   * @param {number}   timeoutMs
   */
  async run(cmd, args = [], cwd = null, timeoutMs = 60000) {
    const workDir   = cwd || this.workDir;
    let attempt     = 0;
    let lastError   = "";        // track to avoid identical AI calls
    let knownFixed  = false;     // track if Termux pre-fix was already applied

    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      renderer.agentLog("system", "run",
        `${cmd} ${args.join(" ")}  (attempt ${attempt}/${MAX_ATTEMPTS})`);

      const { code, stdout, stderr } = await this._exec(cmd, args, workDir, timeoutMs);
      const combined = (stdout + "\n" + stderr).trim();

      if (code === 0) {
        renderer.agentLog("system", "ok", `Exited 0 — success`);
        this.memory.setStatus("running");
        return { success: true, output: combined, attempts: attempt };
      }

      // Detect error
      const errorLines = this._extractErrors(combined);
      renderer.agentLog("system", "error",
        `Exit ${code}: ${errorLines[0] || combined.slice(0, 80)}`);

      // Log to memory
      this.memory.logError(`${cmd} ${args.join(" ")}`, combined.slice(0, 500));
      this.memory.setStatus("error");

      if (attempt >= MAX_ATTEMPTS) {
        renderer.agentLog("system", "warn",
          `Max healing attempts (${MAX_ATTEMPTS}) reached. Manual fix needed.`);
        return { success: false, output: combined, attempts: attempt };
      }

      // ── Step 1: Check for known Termux/platform issues BEFORE calling AI ──
      if (!knownFixed) {
        const termuxResult = await this._applyTermuxKnownFix(combined, workDir);
        if (termuxResult) {
          knownFixed = true;
          renderer.agentLog("system", "info", "Platform-specific fix applied — retrying…");
          attempt--; // don't count this as a healing attempt
          continue;
        }
      }

      // ── Step 2: Skip AI call if same error repeats (AI fix didn't work) ──
      if (combined === lastError) {
        renderer.agentLog("system", "warn",
          "Same error after fix — AI patch had no effect. Stopping.");
        return { success: false, output: combined, attempts: attempt };
      }
      lastError = combined;

      // ── Step 3: Ask AI to fix ─────────────────────────────────────────────
      const fixed = await this._requestFix(cmd, args, combined, workDir);
      if (!fixed) {
        renderer.agentLog("system", "warn", "AI could not generate a fix.");
        return { success: false, output: combined, attempts: attempt };
      }

      renderer.agentLog("system", "info", "Fix applied — retrying…");
    }

    return { success: false, output: "", attempts: attempt };
  }

  // ── Termux / platform-specific known fixes ────────────────────────────────
  async _applyTermuxKnownFix(errorOutput, workDir) {

    // ── npm error Invalid Version ─────────────────────────────────────────────
    // The AI writes broken semver in package.json in two ways:
    //   1. "version": "^1.0.0"  — range prefix in the top-level version field
    //   2. "express": ""         — empty string / null in a dependency version
    // We fix EVERY version string in the entire file, not just one field.
    if (NPM_INVALID_VERSION.test(errorOutput)) {
      const pkgPath = path.join(workDir, "package.json");
      if (!fs.existsSync(pkgPath)) return false;

      let raw = fs.readFileSync(pkgPath, "utf8");
      let pkg;

      // Try to parse; fix smart-quotes first if needed
      try {
        pkg = JSON.parse(raw);
      } catch {
        raw = raw.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
        try { pkg = JSON.parse(raw); } catch {
          renderer.agentLog("system", "warn", "package.json is unparseable — cannot auto-fix");
          return false;
        }
      }

      let changed = false;

      // Fix top-level "version" — must be plain semver, no range prefix
      const origVer = pkg.version || "";
      if (!origVer || /^[^0-9]/.test(origVer) || !/^\d+\.\d+\.\d+/.test(origVer.replace(/^[^0-9]*/, ""))) {
        const fixed = origVer.replace(/^[^0-9]*/, "").replace(/[^0-9.]/g, "") || "1.0.0";
        const clean = /^\d+\.\d+\.\d+/.test(fixed) ? fixed : "1.0.0";
        renderer.agentLog("file", "warn",
          `package.json version "${origVer}" is not valid semver → "${clean}"`);
        pkg.version = clean;
        changed = true;
      }

      // Fix all dependency version strings
      // Valid: "^1.0.0", "~1.0.0", "1.0.0", ">=1.0.0", "*", "latest", "next"
      // Invalid: "", null, undefined, "^", "~", "^latest" (last one is edge case)
      const VALID_DEP_VERSION = /^(\*|latest|next|>=?|<=?|~|\^)?[0-9]|^\*$|^latest$|^next$/;
      for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        if (!pkg[section] || typeof pkg[section] !== "object") continue;
        for (const [dep, ver] of Object.entries(pkg[section])) {
          const v = String(ver || "").trim();
          if (v === "" || v === "^" || v === "~" || v === "null" || v === "undefined") {
            renderer.agentLog("file", "warn",
              `package.json ${section}.${dep} has invalid version "${v}" → "latest"`);
            pkg[section][dep] = "latest";
            changed = true;
          }
        }
      }

      if (!changed) {
        renderer.agentLog("system", "warn",
          "package.json looks valid but npm still says Invalid Version — dumping content for debug:");
        renderer.agentLog("system", "info", JSON.stringify(pkg).slice(0, 200));
        return false;
      }

      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8");
      renderer.agentLog("file", "edit", `package.json — sanitized all version strings`);
      return true;
    }

    // ── sqlite3 / better-sqlite3 — both require Android NDK, never on Termux ─
    // The ONLY working option: sql.js (pure JS/WASM, zero native compilation).
    if (TERMUX_NATIVE_FAIL.test(errorOutput)) {
      const pkgPath = path.join(workDir, "package.json");
      if (!fs.existsSync(pkgPath)) return false;

      let pkg;
      try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); } catch { return false; }

      const hasSqlite3       = pkg.dependencies?.sqlite3 || pkg.devDependencies?.sqlite3;
      const hasBetterSqlite3 = pkg.dependencies?.["better-sqlite3"] || pkg.devDependencies?.["better-sqlite3"];

      if (!hasSqlite3 && !hasBetterSqlite3) {
        // Transitive dep failure — wipe both bad node_modules dirs and retry bare
        renderer.agentLog("system", "warn",
          "Native addon compile failure (transitive) — wiping broken node_modules entries");
        for (const bad of ["sqlite3", "better-sqlite3"]) {
          const badDir = path.join(workDir, "node_modules", bad);
          try { if (fs.existsSync(badDir)) fs.rmSync(badDir, { recursive: true, force: true }); } catch {}
        }
        return false;
      }

      renderer.agentLog("system", "warn",
        "sqlite3/better-sqlite3 require Android NDK — not present in Termux. Switching to sql.js (pure JS/WASM)");

      // Remove both native variants, add sql.js
      for (const section of ["dependencies", "devDependencies"]) {
        if (!pkg[section]) continue;
        delete pkg[section].sqlite3;
        delete pkg[section]["better-sqlite3"];
      }
      if (!pkg.dependencies) pkg.dependencies = {};
      pkg.dependencies["sql.js"] = "^1.10.3";
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8");
      renderer.agentLog("file", "edit", "package.json — sqlite3/better-sqlite3 → sql.js");

      // Wipe broken node_modules
      for (const bad of ["sqlite3", "better-sqlite3"]) {
        const badDir = path.join(workDir, "node_modules", bad);
        try { if (fs.existsSync(badDir)) fs.rmSync(badDir, { recursive: true, force: true }); } catch {}
      }

      // Rewrite server files that import the native packages
      const candidates = ["server.js", "index.js", "app.js", "db.js", "database.js", "src/db.js"];
      for (const c of candidates) {
        const fp = path.join(workDir, c);
        if (!fs.existsSync(fp)) continue;
        let content = fs.readFileSync(fp, "utf8");
        if (!content.includes("sqlite3") && !content.includes("better-sqlite3")) continue;
        content = this._convertToSqlJs(content);
        fs.writeFileSync(fp, content, "utf8");
        renderer.agentLog("file", "edit", `${c} — rewritten to sql.js API`);
      }

      return true;
    }

    // ── esbuild ARM binary missing (Vite on Termux Node 22+) ─────────────────
    if (TERMUX_ESBUILD_FAIL.test(errorOutput)) {
      renderer.agentLog("system", "warn",
        "esbuild ARM binary missing — attempting force reinstall");
      try {
        const ebuildDir = path.join(workDir, "node_modules", "esbuild");
        if (fs.existsSync(ebuildDir)) fs.rmSync(ebuildDir, { recursive: true, force: true });
        await this._exec("npm", ["install", "--ignore-scripts", "esbuild"], workDir, 60000);
        return true;
      } catch {
        renderer.agentLog("system", "warn",
          "esbuild reinstall failed — Vite does not work on Termux Node 22+. Use plain HTML/JS.");
        return false;
      }
    }

    return false;
  }

  // ── Convert sqlite3 / better-sqlite3 imports to sql.js ───────────────────
  _convertToSqlJs(content) {
    let c = content;
    c = c.replace(
      /const\s+\w+\s*=\s*require\(['"](?:sqlite3|better-sqlite3)['"]\)(?:\.verbose\(\))?;?\s*/g,
      "const initSqlJs = require('sql.js');\n"
    );
    c = c.replace(
      /(?:const\s+\w+\s*=\s*)?new\s+(?:\w+\.)?Database\([^)]*\)(?:,\s*(?:function\s*)?\([^)]*\)\s*\{[^}]*\})?;?/g,
      "// sql.js: await initSqlJs() then: const db = new SQL.Database();"
    );
    c = c.replace(/\w+\.serialize\s*\(\s*(?:function\s*)?\(\s*\)\s*\{/g, "{");
    return c;
  }

  // ── Convert sqlite3 to better-sqlite3 (DEPRECATED — kept for reference) ──
  // better-sqlite3 also fails on Termux ARM. Use _convertToSqlJs instead.
  _convertSqlite3ToBetter(content) {
    let c = content;

    // Replace require statements
    c = c.replace(
      /const\s+(\w+)\s*=\s*require\(['"]sqlite3['"]\)(?:\.verbose\(\))?/g,
      "const Database = require('better-sqlite3')"
    );

    // Replace new Database constructor  (new sqlite3.Database / new db.Database)
    c = c.replace(/new\s+\w+\.Database\(([^)]+)\)/g, "new Database($1)");

    // Convert db.serialize() wrapper — just remove it, better-sqlite3 is sync
    c = c.replace(/\w+\.serialize\s*\(\s*(?:function\s*)?\(\s*\)\s*\{/g, "{");

    // Convert db.run(sql, params, callback) → db.prepare(sql).run(params)
    c = c.replace(
      /(\w+)\.run\((`[^`]+`|'[^']+'|"[^"]+"|\[[^\]]+\]|[^,]+),\s*(\[[^\]]*\]|\[[^\]]*\]),\s*(?:function\s*\([^)]*\)|[^{]*)\{([^}]*)\}\s*\)/g,
      (m, db, sql, params) =>
        `try { ${db}.prepare(${sql}).run(${params}); } catch(_e) { console.error(_e); }`
    );

    // Convert db.get(sql, params, callback) → const row = db.prepare(sql).get(params)
    c = c.replace(
      /(\w+)\.get\((`[^`]+`|'[^']+'|"[^"]+"|\[[^\]]+\]|[^,]+),\s*(\[[^\]]*\]|\[[^\]]*\]),\s*function\s*\(err,\s*(\w+)\)\s*\{/g,
      (m, db, sql, params, rowVar) =>
        `{ const ${rowVar} = ${db}.prepare(${sql}).get(${params}); if (true) {`
    );

    // Convert db.all(sql, params, callback) → const rows = db.prepare(sql).all(params)
    c = c.replace(
      /(\w+)\.all\((`[^`]+`|'[^']+'|"[^"]+"|\[[^\]]+\]|[^,]+),\s*(\[[^\]]*\]|\[[^\]]*\]),\s*function\s*\(err,\s*(\w+)\)\s*\{/g,
      (m, db, sql, params, rowsVar) =>
        `{ const ${rowsVar} = ${db}.prepare(${sql}).all(${params}); if (true) {`
    );

    return c;
  }

  // ── Ask AI for a fix ───────────────────────────────────────────────────────
  async _requestFix(cmd, args, errorOutput, workDir) {
    renderer.agentLog("ai", "plan", "Analysing error and generating fix…");

    // Build a list of relevant files for context
    const filesContext = this._gatherRelevantFiles(workDir, errorOutput);
    const ctx          = this.memory.buildContextBlock();

    const prompt = `You are an autonomous self-healing coding agent running inside Termux on Android (ARM64, Node.js v22+).

FAILED COMMAND: ${cmd} ${args.join(" ")}
WORKING DIR: ${workDir}

ERROR OUTPUT:
\`\`\`
${errorOutput.slice(0, 2000)}
\`\`\`

RELEVANT FILES:
${filesContext}

${ctx}

TERMUX RULES (critical — these apply to ALL fixes):
- NEVER use sqlite3 — requires node-gyp + Android NDK, always fails on Termux ARM.
- NEVER use better-sqlite3 — SAME PROBLEM. Also uses NDK. Do NOT suggest it.
- FOR DATABASE: ONLY use "sql.js" (npm install sql.js). Pure JS/WASM, zero native.
  sql.js usage: const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(); db.run('CREATE TABLE...'); });
  Query: const res = db.exec('SELECT * FROM t'); rows = res[0]?.values.map(r=>Object.fromEntries(res[0].columns.map((c,i)=>[c,r[i]]))) || [];
- "Cannot find module 'ini'" / "simple-concat" / "android_ndk_path" — native addon broken. Replace with pure-JS alternative.
- "npm error Invalid Version" — package.json has a broken version string. The "version" field must be plain semver "1.0.0" (no ^ or ~ prefix). Dependency versions like "^4.18.2" are fine. Empty strings "" or just "^" are NOT fine — fix them to "latest".
- NEVER use vite/parcel/webpack — use plain HTML+CSS+JS in public/ served by Express.
- npm install --ignore-scripts bypasses failed postinstall hooks.

RULES:
- Output ONLY a valid JSON array of patch objects — no prose, no markdown outside the array.
- Each patch must fix the EXACT error shown above.
- Use ONLY these action types:
  { "action": "create_file", "params": { "path": "relative/path", "content": "full content" } }
  { "action": "edit_file",   "params": { "path": "relative/path", "find": "exact text", "replace": "fixed text" } }
  { "action": "run_command", "params": { "cmd": "npm", "args": ["install", "missing-package"], "cwd": "." } }
  { "action": "message",     "params": { "text": "explanation of what was wrong and what was fixed" } }
- Always include a message step explaining the fix.
- Do NOT include plan or memory_note steps.`;

    let rawResponse;
    try {
      rawResponse = await this.ai.ask(this.provider, prompt, { maxTokens: 2048 });
    } catch (err) {
      renderer.agentLog("ai", "error", `Fix request failed: ${err.message}`);
      return false;
    }

    // Parse steps
    const steps = this._parseSteps(rawResponse);
    if (!steps || steps.length === 0) {
      renderer.agentLog("system", "warn", "Could not parse fix steps from AI response.");
      return false;
    }

    // Apply each step (file patches only — no recursive run_command to avoid loops)
    for (const step of steps) {
      await this._applyStep(step, workDir);
    }

    return true;
  }

  // ── Apply a single fix step ────────────────────────────────────────────────
  async _applyStep(step, workDir) {
    const { action, params = {} } = step;

    if (action === "message") {
      renderer.agentLog("system", "info", `Fix: ${params.text?.slice(0, 100)}`);
      return;
    }

    if (action === "create_file") {
      const filePath = this._resolvePath(params.path, workDir);
      if (!filePath) return;
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, params.content || "", "utf8");
      const rel = path.relative(workDir, filePath);
      renderer.agentLog("file", "create", `[heal] ${rel}`);
      this.memory.registerFile(filePath, "Auto-healed file", "");
      return;
    }

    if (action === "edit_file") {
      const filePath = this._resolvePath(params.path, workDir);
      if (!filePath || !fs.existsSync(filePath)) return;

      let content = fs.readFileSync(filePath, "utf8");

      if (params.find !== undefined && params.replace !== undefined) {
        if (content.includes(params.find)) {
          content = content.replace(params.find, params.replace);
          fs.writeFileSync(filePath, content, "utf8");
          const rel = path.relative(workDir, filePath);
          renderer.agentLog("file", "edit", `[heal] ${rel}`);
        }
      } else if (params.line && params.content !== undefined) {
        const lines = content.split("\n");
        const idx   = parseInt(params.line) - 1;
        if (idx >= 0 && idx < lines.length) {
          lines[idx] = params.content;
          fs.writeFileSync(filePath, lines.join("\n"), "utf8");
          const rel = path.relative(workDir, filePath);
          renderer.agentLog("file", "edit", `[heal] ${rel} line ${params.line}`);
        }
      }
      return;
    }

    // Install missing packages — only npm/pip/pkg allowed, not arbitrary commands
    if (action === "run_command") {
      const safeCommands = new Set(["npm", "pip", "pip3", "pkg", "yarn"]);
      if (!safeCommands.has(params.cmd)) {
        renderer.agentLog("system", "warn", `Heal: skipping unsafe command "${params.cmd}"`);
        return;
      }
      const resolvedCwd = params.cwd
        ? path.resolve(workDir, params.cwd)
        : workDir;
      renderer.agentLog("system", "install",
        `[heal] ${params.cmd} ${(params.args || []).join(" ")}`);
      try {
        await this._exec(params.cmd, params.args || [], resolvedCwd, 120000);
      } catch {}
    }
  }

  // ── Gather relevant file contents for AI context ──────────────────────────
  _gatherRelevantFiles(workDir, errorText) {
    const lines   = [];
    const maxSize = 500; // chars per file

    // Extract filenames mentioned in error
    const mentioned = [];
    const fileRe    = /([a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,5})(?::\d+)?/g;
    let m;
    while ((m = fileRe.exec(errorText)) !== null) {
      const candidate = path.resolve(workDir, m[1]);
      if (fs.existsSync(candidate)) mentioned.push(candidate);
    }

    // Also include package.json, main entry files
    const defaults = ["package.json", "index.js", "index.ts", "app.js", "server.js",
                      "build.gradle", "settings.gradle", "app/build.gradle"];
    for (const f of defaults) {
      const fp = path.join(workDir, f);
      if (fs.existsSync(fp)) mentioned.push(fp);
    }

    // Deduplicate and read
    const seen = new Set();
    for (const fp of mentioned) {
      if (seen.has(fp) || seen.size >= 6) continue;
      seen.add(fp);
      try {
        const content = fs.readFileSync(fp, "utf8").slice(0, maxSize);
        const rel     = path.relative(workDir, fp);
        lines.push(`\`${rel}\`:\n${content}\n`);
      } catch {}
    }

    return lines.join("\n---\n") || "(no relevant files found)";
  }

  // ── Parse AI response into step array ─────────────────────────────────────
  _parseSteps(raw) {
    if (!raw) return null;
    let str = raw.trim();
    const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) str = fence[1].trim();
    const s = str.indexOf("[");
    const e = str.lastIndexOf("]");
    if (s === -1 || e === -1) return null;
    try {
      const parsed = JSON.parse(str.slice(s, e + 1));
      return Array.isArray(parsed)
        ? parsed.filter((x) => x && typeof x.action === "string")
        : null;
    } catch { return null; }
  }

  // ── Shell exec (returns { code, stdout, stderr }) ─────────────────────────
  _exec(cmd, args, cwd, timeoutMs) {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const child = spawn(cmd, args, {
        cwd,
        env:   process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      child.stdout.on("data", (d) => {
        const s = d.toString();
        stdout += s;
        process.stdout.write(s); // stream to terminal
      });

      child.stderr.on("data", (d) => {
        const s = d.toString();
        stderr += s;
        process.stderr.write(s);
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: 1, stdout, stderr: err.message });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ code: 124, stdout, stderr: "Process timed out." });
        } else {
          resolve({ code: code || 0, stdout, stderr });
        }
      });
    });
  }

  // ── Extract error lines from output ───────────────────────────────────────
  _extractErrors(output) {
    return output.split("\n").filter((l) =>
      FIXABLE_PATTERNS.some((re) => re.test(l))
    );
  }

  // ── Safe path resolution ───────────────────────────────────────────────────
  _resolvePath(rawPath, workDir) {
    if (!rawPath) return null;
    const resolved = rawPath.startsWith("/")
      ? rawPath
      : path.resolve(workDir, rawPath);
    // Ensure it stays within workDir
    if (!resolved.startsWith(workDir)) {
      renderer.agentLog("file", "warn", `Heal: path "${rawPath}" escapes workDir`);
      return null;
    }
    return resolved;
  }
}

module.exports = SelfHealingAgent;