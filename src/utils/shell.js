/**
 * src/utils/shell.js
 * ZerathCode — Shell Executor
 * Author: sanaX3065
 *
 * Safe wrappers around Node's child_process module.
 * Used by git agent, android agent, etc.
 *
 * Does NOT use shell=true by default to prevent shell injection.
 */

"use strict";

const { spawn, execSync } = require("child_process");

/**
 * Run a command and stream its output to the terminal in real time.
 * Resolves with exit code; rejects if exit code != 0 (unless allowFail=true).
 *
 * @param {string}   cmd         - Command to run (e.g. "git")
 * @param {string[]} args        - Arguments array
 * @param {object}   opts
 * @param {string}   opts.cwd    - Working directory
 * @param {boolean}  opts.allowFail - Don't reject on non-zero exit
 * @param {object}   opts.env    - Extra environment variables
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...(opts.env || {}) };
    const cwd = opts.cwd || process.cwd();

    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: opts.silent ? "pipe" : ["inherit", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        const str = chunk.toString();
        stdout += str;
        if (!opts.silent) process.stdout.write(str);
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        const str = chunk.toString();
        stderr += str;
        if (!opts.silent) process.stderr.write(str);
      });
    }

    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error(
          `Command not found: "${cmd}"\n` +
          `  Install it in Termux: pkg install ${cmd}`
        ));
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (code !== 0 && !opts.allowFail) {
        reject(new Error(
          `Command "${cmd} ${args.join(" ")}" exited with code ${code}.\n${stderr.trim()}`
        ));
      } else {
        resolve({ code: code || 0, stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

/**
 * Check if a CLI tool is available in PATH.
 * @param {string} tool
 * @returns {boolean}
 */
function isAvailable(tool) {
  try {
    execSync(`which ${tool}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Require a tool and print install instructions if missing.
 * @param {string} tool
 * @param {string} installCmd - e.g. "pkg install git"
 */
function requireTool(tool, installCmd) {
  if (!isAvailable(tool)) {
    throw new Error(
      `"${tool}" is not installed.\n` +
      `  Install it: \x1b[33m${installCmd}\x1b[0m`
    );
  }
}

module.exports = { run, isAvailable, requireTool };
