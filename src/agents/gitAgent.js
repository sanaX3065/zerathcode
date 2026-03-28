/**
 * src/agents/gitAgent.js
 * ZerathCode — Git Agent
 * Author: sanaX3065
 *
 * Git operations inside Termux.
 * Private repos trigger a secure credential prompt.
 *
 * Commands:
 *   hex git clone <url> [dest]
 *   hex git pull [dir]
 *   hex git status [dir]
 *   hex git init [dir]
 *   hex git log [dir] [--limit N]
 *   hex git diff [dir]
 */

"use strict";

const path         = require("path");
const fs           = require("fs");
const BaseAgent    = require("./baseAgent");
const shell        = require("../utils/shell");
const { ask, secret, confirm } = require("../utils/prompt");

// Providers that may need credentials
const PRIVATE_REPO_PATTERNS = [
  /github\.com/i,
  /gitlab\.com/i,
  /bitbucket\.org/i,
];

class GitAgent extends BaseAgent {
  constructor(services) {
    super(services);
    // Check git is available at startup
    this._gitAvailable = shell.isAvailable("git");
  }

  async run(args) {
    this._requireGit();

    const command = args[0];
    if (!command) { this._help(); return; }

    switch (command.toLowerCase()) {
      case "clone":  return this._clone(args.slice(1));
      case "pull":   return this._pull(args.slice(1));
      case "status": return this._status(args.slice(1));
      case "init":   return this._init(args.slice(1));
      case "log":    return this._log(args.slice(1));
      case "diff":   return this._diff(args.slice(1));
      default:
        this.log.fail(`Unknown git command: "${command}"`);
        this._help();
        process.exit(1);
    }
  }

  // ── Clone ──────────────────────────────────────────────────────────────────
  async _clone(args) {
    if (args.length === 0) this.usageError("hex git clone <url> [destination]");

    let repoUrl = args[0];
    let dest    = args[1] || null;

    // Derive default dest from repo name
    if (!dest) {
      const repoName = path.basename(repoUrl, ".git");
      dest = repoName;
    }

    // Resolve destination safely
    const resolvedDest = await this.safePath(dest);

    // Check if dest already exists
    if (fs.existsSync(resolvedDest)) {
      this.log.fail(`Destination "${dest}" already exists. Choose a different name.`);
      process.exit(1);
    }

    // Detect if it looks like a private/authenticated repo
    const isKnownProvider = PRIVATE_REPO_PATTERNS.some((r) => r.test(repoUrl));
    const isPrivate        = args.includes("--private") ||
                             args.includes("--auth");

    if (isKnownProvider || isPrivate) {
      const needsAuth = await confirm(
        `\x1b[33m  Is this a private repository requiring authentication?\x1b[0m`,
        false
      );
      if (needsAuth) {
        repoUrl = await this._injectCredentials(repoUrl);
      }
    }

    console.log(`\n\x1b[36m⟶  Cloning into: ${path.basename(resolvedDest)}\x1b[0m`);
    console.log(`\x1b[90m   URL: ${this._maskToken(repoUrl)}\x1b[0m\n`);

    await shell.run("git", ["clone", repoUrl, resolvedDest]);

    this.log.success(`Repository cloned to: \x1b[33m${resolvedDest}\x1b[0m`);
  }

  // ── Pull ───────────────────────────────────────────────────────────────────
  async _pull(args) {
    const dir       = args[0] || ".";
    const resolved  = await this.safePath(dir);

    if (!this._isGitRepo(resolved)) {
      this.log.fail(`"${dir}" is not a git repository.`);
      process.exit(1);
    }

    console.log(`\n\x1b[36m⟶  Pulling latest changes in: ${path.basename(resolved)}\x1b[0m\n`);
    await shell.run("git", ["pull"], { cwd: resolved });
    this.log.success("Pull complete.");
  }

  // ── Status ─────────────────────────────────────────────────────────────────
  async _status(args) {
    const dir      = args[0] || ".";
    const resolved = await this.safePath(dir);

    if (!this._isGitRepo(resolved)) {
      this.log.fail(`"${dir}" is not a git repository.`);
      process.exit(1);
    }

    console.log(`\n\x1b[36m── Git Status: ${path.basename(resolved)}\x1b[0m\n`);
    await shell.run("git", ["status"], { cwd: resolved });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async _init(args) {
    const dir      = args[0] || ".";
    const resolved = await this.safePath(dir);

    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }

    await shell.run("git", ["init"], { cwd: resolved });
    this.log.success(`Initialised git repo in: ${resolved}`);
  }

  // ── Log ────────────────────────────────────────────────────────────────────
  async _log(args) {
    const limitIdx = args.indexOf("--limit");
    const limit    = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 10;
    const dir      = args.find((a) => !a.startsWith("--")) || ".";
    const resolved = await this.safePath(dir);

    if (!this._isGitRepo(resolved)) {
      this.log.fail(`"${dir}" is not a git repository.`); process.exit(1);
    }

    console.log(`\n\x1b[36m── Git Log: ${path.basename(resolved)} (last ${limit})\x1b[0m\n`);
    await shell.run("git", [
      "log",
      `--max-count=${limit}`,
      "--pretty=format:\x1b[33m%h\x1b[0m %s \x1b[90m(%an, %ar)\x1b[0m",
    ], { cwd: resolved });
    console.log("\n");
  }

  // ── Diff ───────────────────────────────────────────────────────────────────
  async _diff(args) {
    const dir      = args[0] || ".";
    const resolved = await this.safePath(dir);

    if (!this._isGitRepo(resolved)) {
      this.log.fail(`"${dir}" is not a git repository.`); process.exit(1);
    }

    console.log(`\n\x1b[36m── Git Diff: ${path.basename(resolved)}\x1b[0m\n`);
    await shell.run("git", ["diff", "--color=always"], { cwd: resolved });
  }

  // ── Credential injection ───────────────────────────────────────────────────
  /**
   * Prompts for a token or username/password and embeds them into the URL.
   * Returns the authenticated URL (token never logged in plain text).
   * @param {string} repoUrl
   * @returns {Promise<string>} authenticated URL
   */
  async _injectCredentials(repoUrl) {
    console.log(`\n\x1b[33m── Repository Authentication ──────────────────\x1b[0m`);
    console.log(`  [1] Personal access token (GitHub/GitLab recommended)`);
    console.log(`  [2] Username & password`);

    const choice = await ask("  Choose (1/2): ");

    let authedUrl;
    const parsed = new URL(repoUrl.startsWith("http") ? repoUrl : `https://${repoUrl}`);

    if (choice.trim() === "1") {
      const token = await secret("  Token: ");
      // Embed token as password with placeholder username
      parsed.username = "oauth2";
      parsed.password = token;
      authedUrl = parsed.toString();
    } else {
      const username = await ask("  Username: ");
      const password = await secret("  Password: ");
      parsed.username = encodeURIComponent(username);
      parsed.password = encodeURIComponent(password);
      authedUrl = parsed.toString();
    }

    console.log(`\x1b[32m  ✔  Credentials set.\x1b[0m\n`);
    return authedUrl;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  _isGitRepo(dir) {
    return fs.existsSync(path.join(dir, ".git"));
  }

  /** Mask embedded token in URL for safe display */
  _maskToken(url) {
    try {
      const parsed = new URL(url);
      if (parsed.password) parsed.password = "••••••••";
      if (parsed.username) parsed.username = parsed.username;
      return parsed.toString();
    } catch {
      return url;
    }
  }

  _requireGit() {
    if (!this._gitAvailable) {
      this.log.fail("git is not installed.\n  Install it: \x1b[33mpkg install git\x1b[0m");
      process.exit(1);
    }
  }

  _help() {
    console.log(`
\x1b[36mGit Agent Commands:\x1b[0m
  hex git clone <url> [destination] [--private]
  hex git pull [dir]
  hex git status [dir]
  hex git init [dir]
  hex git log [dir] [--limit N]
  hex git diff [dir]
`);
  }
}

module.exports = GitAgent;
