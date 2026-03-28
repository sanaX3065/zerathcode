/**
 * src/core/sandboxManager.js
 * ZerathCode — Sandbox Manager
 * Author: sanaX3065
 *
 * Provides safe, validated path resolution for ALL file operations.
 *
 * Responsibilities:
 *  - Resolve relative/~ paths to absolute paths
 *  - Detect and block directory traversal (../../etc/passwd style attacks)
 *  - Reject null-byte injections
 *  - Classify paths as HOME-safe or EXTERNAL (for PermissionManager)
 *  - Provide a sanitized path for agent use
 */

"use strict";

const path = require("path");
const os   = require("os");

class SandboxManager {
  constructor() {
    this.home = os.homedir();
    this.cwd  = process.cwd();
  }

  /**
   * Resolve a raw user-supplied path to a safe absolute path.
   *
   * Throws on:
   *   - Null bytes
   *   - Empty string
   *   - Paths that resolve outside both home AND cwd (use permManager for those)
   *
   * @param {string} rawPath
   * @returns {{ resolved: string, isExternal: boolean }}
   */
  resolve(rawPath) {
    if (!rawPath || typeof rawPath !== "string") {
      throw new Error("Path must be a non-empty string.");
    }

    // Guard: null-byte injection
    if (rawPath.includes("\0")) {
      throw new Error("Path contains illegal null bytes.");
    }

    // Guard: extremely long paths (Termux /proc quirk)
    if (rawPath.length > 512) {
      throw new Error("Path is unreasonably long (> 512 chars).");
    }

    // Expand ~ to home directory
    let resolved;
    if (rawPath === "~") {
      resolved = this.home;
    } else if (rawPath.startsWith("~/")) {
      resolved = path.join(this.home, rawPath.slice(2));
    } else {
      resolved = path.resolve(this.cwd, rawPath);
    }

    // Normalise (remove any . or .. components)
    resolved = path.normalize(resolved);

    // Determine if inside safe zone
    const inHome = resolved.startsWith(this.home + path.sep) || resolved === this.home;
    const inCwd  = resolved.startsWith(this.cwd  + path.sep) || resolved === this.cwd;
    const isExternal = !inHome && !inCwd;

    return { resolved, isExternal };
  }

  /**
   * Resolve with full traversal check.
   * Throws if the path traverses outside the allowed base dir.
   *
   * @param {string} rawPath
   * @param {string} baseDir - The directory the path must remain within
   * @returns {string} resolved absolute path
   */
  resolveWithin(rawPath, baseDir) {
    const { resolved } = this.resolve(rawPath);
    const base = path.resolve(baseDir);

    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
      throw new Error(
        `Directory traversal detected: "${rawPath}" escapes "${base}"`
      );
    }

    return resolved;
  }

  /**
   * Validate that a filename is safe (no slashes, no special chars).
   * Used when creating files from AI-generated names.
   * @param {string} name
   * @returns {boolean}
   */
  isSafeFilename(name) {
    if (!name) return false;
    // Allow: letters, digits, dots, hyphens, underscores
    return /^[a-zA-Z0-9._\-]+$/.test(name) && !name.startsWith(".");
  }

  /**
   * Join a base directory with a relative sub-path safely.
   * @param {string} base
   * @param {string} relative
   * @returns {string}
   */
  join(base, relative) {
    const resolved = path.resolve(base, relative);
    if (!resolved.startsWith(path.resolve(base))) {
      throw new Error(`Path "${relative}" escapes base directory.`);
    }
    return resolved;
  }
}

module.exports = SandboxManager;
