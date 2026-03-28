/**
 * src/core/permissionManager.js
 * ZerathCode — Permission Manager
 * Author: sanaX3065
 *
 * Enforces a strict sandbox: by default, ALL file access must stay inside
 * the Termux home directory.  Any path outside the home dir (e.g. /sdcard,
 * /storage, /data/media) triggers an interactive permission prompt.
 *
 * Grants are persisted to ~/.zerathcode/grants.json so the user is not
 * asked repeatedly for the same path in the same session.
 */

"use strict";

const fs       = require("fs");
const path     = require("path");
const os       = require("os");
const readline = require("readline");

const CONFIG_DIR   = path.join(os.homedir(), ".zerathcode");
const GRANTS_FILE  = path.join(CONFIG_DIR, "grants.json");

// Paths that are always considered "sensitive" (outside Termux home)
const SENSITIVE_PREFIXES = [
  "/sdcard",
  "/storage",
  "/mnt/sdcard",
  "/mnt/user",
  "/data/media",
  "/Download",
  "/Downloads",
];

class PermissionManager {
  constructor() {
    this._ensureConfigDir();
    // grants: Set of path prefixes the user has approved this session
    this._sessionGrants = new Set();
    this._persistedGrants = this._loadGrants();
  }

  /**
   * Check if the given absolute path is allowed.
   * - Paths inside Termux home: always allowed.
   * - Paths outside: requires user grant.
   *
   * @param {string}  absPath     - Absolute resolved path
   * @param {boolean} persist     - Remember grant permanently? (default: false)
   * @returns {Promise<boolean>}  - true = allowed, false = denied
   */
  async requestAccess(absPath, persist = false) {
    const home = os.homedir();

    // Always allow paths within home
    if (absPath.startsWith(home + path.sep) || absPath === home) {
      return true;
    }

    // Check persisted grants first
    if (this._isGranted(absPath)) {
      return true;
    }

    // Path is outside home — prompt user
    const isSensitive = SENSITIVE_PREFIXES.some((prefix) =>
      absPath.startsWith(prefix)
    );

    const label = isSensitive
      ? "\x1b[31mSENSITIVE EXTERNAL STORAGE\x1b[0m"
      : "\x1b[33mExternal Path\x1b[0m";

    console.log(`\n\x1b[33m╔══════════════════════════════════════════════╗\x1b[0m`);
    console.log(`\x1b[33m║  ⚠  PERMISSION REQUIRED                      ║\x1b[0m`);
    console.log(`\x1b[33m╚══════════════════════════════════════════════╝\x1b[0m`);
    console.log(`  Type:   ${label}`);
    console.log(`  Path:   \x1b[90m${absPath}\x1b[0m`);
    console.log(`\n  ZerathCode wants to access this path.`);

    const answer = await this._ask("  Allow? (yes / no / always): ");
    const clean  = answer.trim().toLowerCase();

    if (clean === "yes" || clean === "y") {
      this._sessionGrants.add(absPath);
      if (persist) this._persistGrant(absPath);
      console.log(`\x1b[32m  ✔  Access granted for this session.\x1b[0m\n`);
      return true;
    }

    if (clean === "always") {
      this._sessionGrants.add(absPath);
      this._persistGrant(absPath);
      console.log(`\x1b[32m  ✔  Access permanently granted.\x1b[0m\n`);
      return true;
    }

    console.log(`\x1b[31m  ✖  Access denied.\x1b[0m\n`);
    return false;
  }

  /**
   * Synchronous check — no prompt. Use for pre-validation.
   * @param {string} absPath
   * @returns {boolean}
   */
  isAllowed(absPath) {
    const home = os.homedir();
    if (absPath.startsWith(home + path.sep) || absPath === home) return true;
    return this._isGranted(absPath);
  }

  // ── Display grants ────────────────────────────────────────────────────────
  showGrants() {
    console.log(`\n\x1b[36m── Permission Grants ─────────────────────\x1b[0m`);
    console.log(`  \x1b[90mHome (always allowed): ${os.homedir()}\x1b[0m`);

    const session = [...this._sessionGrants];
    const persisted = this._persistedGrants;

    if (session.length === 0 && persisted.length === 0) {
      console.log(`  \x1b[90mNo additional grants.\x1b[0m\n`);
      return;
    }

    if (session.length > 0) {
      console.log(`\n  \x1b[33mSession grants:\x1b[0m`);
      session.forEach((p) => console.log(`    • ${p}`));
    }

    if (persisted.length > 0) {
      console.log(`\n  \x1b[32mPermanent grants:\x1b[0m`);
      persisted.forEach((p) => console.log(`    • ${p}`));
    }
    console.log("");
  }

  resetGrants() {
    this._sessionGrants.clear();
    this._persistedGrants = [];
    this._saveGrants([]);
  }

  // ── Private helpers ───────────────────────────────────────────────────────
  _isGranted(absPath) {
    if (this._sessionGrants.has(absPath)) return true;
    // Also check if any stored prefix covers this path
    return this._persistedGrants.some(
      (granted) => absPath.startsWith(granted + path.sep) || absPath === granted
    );
  }

  _persistGrant(absPath) {
    if (!this._persistedGrants.includes(absPath)) {
      this._persistedGrants.push(absPath);
      this._saveGrants(this._persistedGrants);
    }
  }

  _loadGrants() {
    try {
      if (!fs.existsSync(GRANTS_FILE)) return [];
      return JSON.parse(fs.readFileSync(GRANTS_FILE, "utf8"));
    } catch {
      return [];
    }
  }

  _saveGrants(grants) {
    fs.writeFileSync(GRANTS_FILE, JSON.stringify(grants, null, 2), { mode: 0o600 });
  }

  _ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Simple async readline prompt.
   * @param {string} question
   * @returns {Promise<string>}
   */
  _ask(question) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, (ans) => { rl.close(); resolve(ans); });
    });
  }
}

module.exports = PermissionManager;
