/**
 * src/core/apiKeyManager.js
 * ZerathCode — API Key Manager
 * Author: sanaX3065
 *
 * Manages multiple API keys per provider with automatic rotation.
 *
 * Rotation Strategy:
 *   1. Try current key (index 0 by default)
 *   2. On rate-limit / auth error → rotate to next key
 *   3. If all keys exhausted → prompt user to add a new key or wait
 *
 * Storage: ~/.zerathcode/keys.json  (permissions: 0o600)
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const readline = require("readline");

const CONFIG_DIR  = path.join(os.homedir(), ".zerathcode");
const KEYS_FILE   = path.join(CONFIG_DIR, "keys.json");

// HTTP status codes that indicate rate limiting
const RATE_LIMIT_CODES  = new Set([429, 503]);
// HTTP status codes that indicate bad/expired key
const AUTH_ERROR_CODES  = new Set([401, 403]);

class ApiKeyManager {
  constructor() {
    this._ensureConfigDir();
    this._store = this._load();
    // In-memory rotation cursor: { [provider]: currentIndex }
    this._cursor = {};
  }

  // ── Public: Add a key ─────────────────────────────────────────────────────
  /**
   * Add a new API key for a provider.
   * Multiple keys can be added — they form a rotation pool.
   * @param {string} provider - e.g. "claude", "gemini", "openai"
   * @param {string} key
   */
  addKey(provider, key) {
    if (!key || key.length < 8) throw new Error("API key too short.");
    const p = provider.toLowerCase();
    if (!this._store[p]) this._store[p] = [];
    // Prevent duplicates
    if (this._store[p].includes(key)) {
      console.warn(`\x1b[33m⚠  Key already exists for "${p}" — skipping duplicate.\x1b[0m`);
      return;
    }
    this._store[p].push(key);
    this._save();
  }

  // ── Public: Get current active key ───────────────────────────────────────
  /**
   * Returns the currently active key for a provider.
   * Reads from env vars as fallback (same convention as ZerathCode).
   * @param {string} provider
   * @returns {string|null}
   */
  getKey(provider) {
    const p      = provider.toLowerCase();
    const pool   = this._store[p] || [];
    const cursor = this._cursor[p] ?? 0;

    if (pool.length > 0 && cursor < pool.length) {
      return pool[cursor];
    }

    // Env var fallback
    return this._envFallback(p);
  }

  // ── Public: Rotate to next key ────────────────────────────────────────────
  /**
   * Advance the cursor to the next key in the pool.
   * @param {string} provider
   * @returns {string|null} The new key, or null if all exhausted.
   */
  rotateKey(provider) {
    const p    = provider.toLowerCase();
    const pool = this._store[p] || [];

    this._cursor[p] = (this._cursor[p] ?? 0) + 1;

    if (this._cursor[p] < pool.length) {
      const newKey = pool[this._cursor[p]];
      const masked = this._mask(newKey);
      console.log(`\x1b[33m⟳  Rotating to next key for "${p}": ${masked}\x1b[0m`);
      return newKey;
    }

    return null; // All exhausted
  }

  // ── Public: Call with auto-rotation ───────────────────────────────────────
  /**
   * Wraps an async API call with automatic key rotation on failure.
   *
   * Usage:
   *   const result = await keyManager.callWithRotation("claude", async (key) => {
   *     return await fetch(..., { headers: { "x-api-key": key } });
   *   });
   *
   * @param {string}   provider
   * @param {Function} apiFn - async (key: string) => any — should throw on error
   *                           Error object should have .status (HTTP status code)
   * @returns {Promise<any>}
   */
  async callWithRotation(provider, apiFn) {
    const p = provider.toLowerCase();

    while (true) {
      const key = this.getKey(p);

      if (!key) {
        // All keys exhausted — prompt user
        const shouldContinue = await this._promptExhausted(p);
        if (!shouldContinue) {
          throw new Error(`All API keys for "${p}" are exhausted. Operation aborted.`);
        }
        // User may have added a new key — reset cursor and retry
        this._cursor[p] = 0;
        this._store = this._load(); // reload from disk
        continue;
      }

      try {
        return await apiFn(key);
      } catch (err) {
        const code = err.status || err.statusCode || 0;

        if (RATE_LIMIT_CODES.has(code)) {
          console.warn(`\x1b[33m⚠  Rate limit hit for "${p}" key ${this._cursor[p] ?? 0}. Rotating…\x1b[0m`);
          const next = this.rotateKey(p);
          if (!next) continue; // will hit exhaustion on next loop
        } else if (AUTH_ERROR_CODES.has(code)) {
          console.warn(`\x1b[33m⚠  Auth error for "${p}" key ${this._cursor[p] ?? 0}. Rotating…\x1b[0m`);
          const next = this.rotateKey(p);
          if (!next) continue;
        } else {
          // Not a key-related error — rethrow
          throw err;
        }
      }
    }
  }

  // ── Public: List keys (masked) ────────────────────────────────────────────
  listKeys() {
    const providers = Object.keys(this._store);
    if (providers.length === 0) {
      console.log(`\x1b[90m  No API keys stored. Use: hex keys add <provider> <key>\x1b[0m`);
      return;
    }
    console.log(`\n\x1b[36m── Stored API Keys ───────────────────────\x1b[0m`);
    for (const [p, keys] of Object.entries(this._store)) {
      const cursor = this._cursor[p] ?? 0;
      console.log(`  \x1b[33m${p}\x1b[0m (${keys.length} key${keys.length > 1 ? "s" : ""})`);
      keys.forEach((k, i) => {
        const active = i === cursor ? " \x1b[32m← active\x1b[0m" : "";
        console.log(`    [${i}] ${this._mask(k)}${active}`);
      });
    }
    console.log("");
  }

  // ── Public: Remove key ────────────────────────────────────────────────────
  removeKey(provider, index) {
    const p = provider.toLowerCase();
    if (!this._store[p]) return;
    if (index !== undefined) {
      this._store[p].splice(index, 1);
    } else {
      delete this._store[p];
    }
    this._cursor[p] = 0;
    this._save();
  }

  // ── Private helpers ───────────────────────────────────────────────────────
  _envFallback(provider) {
    const map = {
      claude:  ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
      gemini:  ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
      openai:  ["OPENAI_API_KEY", "GPT_API_KEY"],
      gpt:     ["OPENAI_API_KEY", "GPT_API_KEY"],
      github:  ["GITHUB_TOKEN"],
    };
    for (const v of (map[provider] || [])) {
      if (process.env[v]) return process.env[v];
    }
    return null;
  }

  _mask(key) {
    if (!key || key.length <= 10) return "••••";
    return key.slice(0, 6) + "••••••••" + key.slice(-4);
  }

  _ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
  }

  _load() {
    try {
      if (!fs.existsSync(KEYS_FILE)) return {};
      return JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
    } catch {
      return {};
    }
  }

  _save() {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(this._store, null, 2), {
      mode: 0o600,  // owner read/write only — protects API keys
    });
  }

  /**
   * Prompt user when all keys are exhausted.
   * @param {string} provider
   * @returns {Promise<boolean>} true if user added a new key and wants to retry
   */
  async _promptExhausted(provider) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
      });

      console.log(`\n\x1b[31m⚠  All API keys for "${provider}" are exhausted.\x1b[0m`);
      console.log(`   Options:`);
      console.log(`     [1] Add a new key now`);
      console.log(`     [2] Abort operation`);

      rl.question(`\n   Choice (1/2): `, (answer) => {
        rl.close();
        if (answer.trim() === "1") {
          rl.close();
          // Ask for the new key
          const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
          rl2.question(`   Enter new API key for "${provider}": `, (newKey) => {
            rl2.close();
            newKey = newKey.trim();
            if (newKey.length < 8) {
              console.error('\x1b[31m   Key too short — aborting.\x1b[0m');
              resolve(false);
            } else {
              this.addKey(provider, newKey);
              console.log('\x1b[32m   New key saved. Retrying…\x1b[0m');
              resolve(true);
            }
          });
        } else {
          resolve(false);
        }
      });
    });
  }
}

module.exports = ApiKeyManager;
