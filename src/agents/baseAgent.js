/**
 * src/agents/baseAgent.js
 * ZerathCode — Base Agent
 * Author: sanaX3065
 *
 * All agents extend this class.
 * Provides access to shared services via dependency injection:
 *   - permManager  (PermissionManager)
 *   - keyManager   (ApiKeyManager)
 *   - sandbox      (SandboxManager)
 *   - log          (Logger)
 */

"use strict";

const SandboxManager = require("../core/sandboxManager");
const logger         = require("../utils/logger");

class BaseAgent {
  /**
   * @param {{ permManager, keyManager }} services - Injected by AgentManager
   */
  constructor(services = {}) {
    this.permManager = services.permManager;
    this.keyManager  = services.keyManager;
    this.sandbox     = new SandboxManager();
    this.log         = logger;
  }

  /**
   * Each agent must implement run(args).
   * @param {string[]} args
   */
  async run(args) {
    throw new Error(`Agent "${this.constructor.name}" has not implemented run().`);
  }

  /**
   * Resolve a path safely and check/request permission.
   * @param {string} rawPath
   * @returns {Promise<string>} resolved absolute path
   */
  async safePath(rawPath) {
    const { resolved, isExternal } = this.sandbox.resolve(rawPath);

    if (isExternal) {
      const allowed = await this.permManager.requestAccess(resolved);
      if (!allowed) {
        throw new Error(`Access denied to: ${resolved}`);
      }
    }

    return resolved;
  }

  /**
   * Print agent-specific usage and exit with code 1.
   * @param {string} usage
   */
  usageError(usage) {
    this.log.fail(`Usage: ${usage}`);
    process.exit(1);
  }
}

module.exports = BaseAgent;
