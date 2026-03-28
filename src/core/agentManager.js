/**
 * src/core/agentManager.js
 * ZerathCode v4 — Agent Manager
 *
 * ZerathCode AgentManager
 * ADDS: infra, security, qa, assistant, monitor direct commands
 */

"use strict";

const PermissionManager = require("./permissionManager");
const ApiKeyManager     = require("./apiKeyManager");

// ── Agent Registry ─────────────────────────────────────────────────────────────
const AGENT_REGISTRY = {
  // ── HexOverlord agents ──
  file:      "../agents/fileAgent",
  web:       "../agents/webAgent",
  git:       "../agents/gitAgent",
  android:   "../agents/androidAgent",
  // ── ZerathCode agents ──
  infra:     "../agents/infrastructureAgent",
  security:  "../agents/securityAgent",
  qa:        "../agents/qaAgent",
  assistant: "../agents/assistantAgent",
};

class AgentManager {
  constructor() {
    this.permManager = new PermissionManager();
    this.keyManager  = new ApiKeyManager();
  }

  async dispatch(agentName, args) {
    const name = agentName.toLowerCase();

    // ── System commands ──────────────────────────────────────────────────────
    if (name === "keys")    return this._handleKeys(args);
    if (name === "perms")   return this._handlePerms(args);
    if (name === "config")  return this._handleConfig(args);
    if (name === "monitor") {
      const SystemMonitor = require("./systemMonitor");
      const m = new SystemMonitor();
      return m.printLiveStats();
    }

    // ── Agent commands ───────────────────────────────────────────────────────
    if (!AGENT_REGISTRY[name]) {
      console.error(
        `\x1b[31m✖  Unknown agent: "${agentName}"\x1b[0m\n` +
        `   Available: \x1b[36m${Object.keys(AGENT_REGISTRY).join(", ")}\x1b[0m\n` +
        `   Run \x1b[33mzerath help\x1b[0m for full usage.`
      );
      process.exit(1);
    }

    let AgentClass;
    try {
      AgentClass = require(AGENT_REGISTRY[name]);
    } catch (err) {
      console.error(`\x1b[31m✖  Failed to load agent "${name}": ${err.message}\x1b[0m`);
      process.exit(1);
    }

    const agent = new AgentClass({ permManager: this.permManager, keyManager: this.keyManager });

    try {
      await agent.run(args);
    } catch (err) {
      console.error(`\x1b[31m✖  Agent "${name}" error: ${err.message}\x1b[0m`);
      if (process.env.ZERATH_DEBUG) console.error(err.stack);
      process.exit(1);
    }
  }

  // ── Keys ──────────────────────────────────────────────────────────────────
  async _handleKeys(args) {
    const sub = args[0];
    switch (sub) {
      case "add": {
        const [, provider, key] = args;
        if (!provider || !key) {
          console.error("\x1b[31m✖  Usage: zerath keys add <provider> <apiKey>\x1b[0m");
          process.exit(1);
        }
        this.keyManager.addKey(provider, key);
        const masked = key.slice(0, 6) + "••••••••" + key.slice(-4);
        console.log(`\x1b[32m✔  Key added for \x1b[36m${provider}\x1b[32m: ${masked}\x1b[0m`);
        break;
      }
      case "list":
        this.keyManager.listKeys();
        break;
      case "remove": {
        const [, provider, idx] = args;
        if (!provider) {
          console.error("\x1b[31m✖  Usage: zerath keys remove <provider> [index]\x1b[0m");
          process.exit(1);
        }
        this.keyManager.removeKey(provider, idx ? parseInt(idx) : undefined);
        console.log(`\x1b[32m✔  Key(s) removed for "${provider}"\x1b[0m`);
        break;
      }
      case "rotate":
        if (!args[1]) { console.error("\x1b[31m✖  Usage: zerath keys rotate <provider>\x1b[0m"); process.exit(1); }
        this.keyManager.rotateKey(args[1]);
        console.log(`\x1b[32m✔  Rotated key for "${args[1]}"\x1b[0m`);
        break;
      default:
        console.error(
          "\x1b[31m✖  Usage:\x1b[0m\n" +
          "   zerath keys add <provider> <apiKey>\n" +
          "   zerath keys list\n" +
          "   zerath keys remove <provider> [index]\n" +
          "   zerath keys rotate <provider>"
        );
    }
  }

  // ── Perms ──────────────────────────────────────────────────────────────────
  async _handlePerms(args) {
    const sub = args[0];
    if (sub === "show") this.permManager.showGrants();
    else if (sub === "reset") { this.permManager.resetGrants(); console.log("\x1b[32m✔  Grants reset.\x1b[0m"); }
    else console.log("  hex perms show | reset");
  }

  // ── Config ─────────────────────────────────────────────────────────────────
  async _handleConfig(args) {
    const os = require("os");
    console.log(`\n\x1b[36m── ZerathCode Config ────────────────────────────────\x1b[0m`);
    console.log(`  \x1b[90mHome:       \x1b[0m${os.homedir()}`);
    console.log(`  \x1b[90mConfig dir: \x1b[0m${require("path").join(os.homedir(), ".zerathcode")}`);
    console.log(`  \x1b[90mWorkspace:  \x1b[0m${require("path").join(os.homedir(), "hex-workspace")}`);
    console.log(`  \x1b[90mNode:       \x1b[0m${process.version}`);
    console.log(`  \x1b[90mPlatform:   \x1b[0m${process.platform} (${process.arch})`);
    console.log(`  \x1b[90mDebug mode: \x1b[0m${process.env.ZERATH_DEBUG ? "ON" : "OFF"}`);
    console.log("");
    this.keyManager.listKeys();
  }
}

module.exports = AgentManager;
