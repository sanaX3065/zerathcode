/**
 * src/utils/spinner.js
 * ZerathCode — Spinner
 * Author: sanaX3065
 *
 * A lightweight terminal spinner for long-running operations.
 * Termux-compatible (uses stdout write, no cursor-movement libraries).
 */

"use strict";

const FRAMES  = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
const COLOURS = {
  cyan:   "\x1b[36m",
  yellow: "\x1b[33m",
  green:  "\x1b[32m",
  reset:  "\x1b[0m",
};

class Spinner {
  /**
   * @param {string} label   - Text shown next to spinner
   * @param {string} colour  - "cyan" | "yellow" | "green"
   */
  constructor(label = "Working…", colour = "cyan") {
    this.label   = label;
    this.colour  = COLOURS[colour] || COLOURS.cyan;
    this._timer  = null;
    this._frame  = 0;
    this._active = false;
  }

  start() {
    if (this._active) return;
    this._active = true;
    this._frame  = 0;
    this._timer  = setInterval(() => {
      const frame = FRAMES[this._frame++ % FRAMES.length];
      process.stdout.write(`\r${this.colour}${frame}\x1b[0m  ${this.label}…`);
    }, 80);
  }

  /**
   * Stop spinner and optionally print a result message.
   * @param {"success"|"error"|"warn"|null} status
   * @param {string} message
   */
  stop(status = null, message = "") {
    if (!this._active) return;
    clearInterval(this._timer);
    this._active = false;
    process.stdout.write("\r\x1b[2K"); // clear spinner line

    if (status === "success") {
      console.log(`\x1b[32m✔  ${message || this.label + " done"}\x1b[0m`);
    } else if (status === "error") {
      console.error(`\x1b[31m✖  ${message || "Failed"}\x1b[0m`);
    } else if (status === "warn") {
      console.log(`\x1b[33m⚠  ${message || this.label}\x1b[0m`);
    } else if (message) {
      console.log(message);
    }
  }
}

/**
 * Convenience: wrap an async function with a spinner.
 * @param {string}   label
 * @param {Function} fn    - async () => result
 * @returns {Promise<any>}
 */
async function withSpinner(label, fn) {
  const spinner = new Spinner(label);
  spinner.start();
  try {
    const result = await fn();
    spinner.stop("success");
    return result;
  } catch (err) {
    spinner.stop("error", err.message);
    throw err;
  }
}

module.exports = { Spinner, withSpinner };
