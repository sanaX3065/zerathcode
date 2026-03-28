/**
 * src/utils/logger.js
 * ZerathCode — Logger
 * Author: sanaX3065
 *
 * Simple levelled logger with ANSI colour support.
 * No external dependencies.
 */

"use strict";

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, SILENT: 4 };
const COLOURS = {
  DEBUG: "\x1b[90m",   // grey
  INFO:  "\x1b[36m",   // cyan
  WARN:  "\x1b[33m",   // yellow
  ERROR: "\x1b[31m",   // red
  RESET: "\x1b[0m",
  DIM:   "\x1b[2m",
  BOLD:  "\x1b[1m",
};

class Logger {
  constructor(context = "ZerathCode") {
    this.context  = context;
    this.minLevel = process.env.ZERATH_DEBUG ? LEVELS.DEBUG : LEVELS.INFO;
  }

  debug(msg)   { this._log("DEBUG", msg); }
  info(msg)    { this._log("INFO",  msg); }
  warn(msg)    { this._log("WARN",  msg); }
  error(msg)   { this._log("ERROR", msg); }

  /** Green success tick */
  success(msg) {
    console.log(`${COLOURS.RESET}\x1b[32m✔  ${msg}${COLOURS.RESET}`);
  }

  /** Red error cross */
  fail(msg) {
    console.error(`${COLOURS.ERROR}✖  ${msg}${COLOURS.RESET}`);
  }

  /** Cyan info bullet */
  note(msg) {
    console.log(`${COLOURS.INFO}ℹ  ${msg}${COLOURS.RESET}`);
  }

  /** Separator line */
  divider(label = "", char = "─", width = 50) {
    const line = char.repeat(width);
    if (label) {
      console.log(`\x1b[36m${line.slice(0, 2)} ${label} ${line.slice(label.length + 4)}\x1b[0m`);
    } else {
      console.log(`\x1b[90m${line}\x1b[0m`);
    }
  }

  _log(level, msg) {
    if (LEVELS[level] < this.minLevel) return;
    const colour = COLOURS[level] || "";
    const prefix = level === "DEBUG" ? `[${this.context}]` : "";
    const stream = level === "ERROR" ? process.stderr : process.stdout;
    stream.write(`${colour}${prefix}${msg}${COLOURS.RESET}\n`);
  }
}

// Singleton for convenience
const defaultLogger = new Logger();
module.exports = defaultLogger;
module.exports.Logger = Logger;
