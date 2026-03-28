/**
 * src/utils/prompt.js
 * ZerathCode — Prompt Utilities
 * Author: sanaX3065
 *
 * Reusable async readline helpers for interactive prompts.
 * Used by permission manager, git agent (credentials), android agent.
 */

"use strict";

const readline = require("readline");

/**
 * Ask a yes/no question. Returns true for yes.
 * @param {string} question
 * @param {boolean} defaultYes
 * @returns {Promise<boolean>}
 */
async function confirm(question, defaultYes = false) {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await ask(`${question} ${hint}: `);
  const clean  = answer.trim().toLowerCase();
  if (clean === "") return defaultYes;
  return clean === "y" || clean === "yes";
}

/**
 * Prompt for text input.
 * @param {string}  question
 * @param {string}  defaultVal
 * @returns {Promise<string>}
 */
async function ask(question, defaultVal = "") {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim() || defaultVal);
    });
  });
}

/**
 * Prompt for a password/secret (input is NOT echoed on supported terminals).
 * Falls back to normal input in environments that don't support raw mode.
 * @param {string} question
 * @returns {Promise<string>}
 */
async function secret(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);

    // Attempt to suppress echo
    let muted = false;
    try {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        muted = true;
      }
    } catch {}

    let input = "";

    if (muted) {
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      function onData(char) {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(input);
        } else if (char === "\u007f" || char === "\b") {
          // Backspace
          input = input.slice(0, -1);
        } else {
          input += char;
        }
      }

      process.stdin.on("data", onData);
    } else {
      // Fallback: normal readline (input IS visible)
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("", (ans) => { rl.close(); resolve(ans.trim()); });
    }
  });
}

/**
 * Display a numbered menu and return the chosen index.
 * @param {string}   title
 * @param {string[]} options
 * @returns {Promise<number>} 0-based index
 */
async function menu(title, options) {
  console.log(`\n\x1b[36m${title}\x1b[0m`);
  options.forEach((opt, i) => console.log(`  [${i + 1}] ${opt}`));
  const answer = await ask(`\n  Choice (1–${options.length}): `);
  const index  = parseInt(answer) - 1;
  if (isNaN(index) || index < 0 || index >= options.length) {
    throw new Error(`Invalid choice: "${answer}"`);
  }
  return index;
}

module.exports = { ask, confirm, secret, menu };
