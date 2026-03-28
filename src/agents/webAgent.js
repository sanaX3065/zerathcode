/**
 * src/agents/webAgent.js
 * ZerathCode — Web Agent
 * Author: sanaX3065
 *
 * Fetches web pages, extracts readable content,
 * and optionally summarises via an AI provider.
 *
 * Commands:
 *   hex web fetch <url> [--summarize <provider>] [--save <file>]
 *   hex web ping <url>
 *   hex web headers <url>
 */

"use strict";

const BaseAgent          = require("./baseAgent");
const { withSpinner }    = require("../utils/spinner");
const { confirm }        = require("../utils/prompt");
const AiClient           = require("../utils/aiClient");
const fs                 = require("fs");
const path               = require("path");

class WebAgent extends BaseAgent {
  async run(args) {
    const command = args[0];
    if (!command) { this._help(); return; }

    switch (command.toLowerCase()) {
      case "fetch":   return this._fetch(args.slice(1));
      case "ping":    return this._ping(args.slice(1));
      case "headers": return this._headers(args.slice(1));
      default:
        this.log.fail(`Unknown web command: "${command}"`);
        this._help();
        process.exit(1);
    }
  }

  // ── Fetch ──────────────────────────────────────────────────────────────────
  async _fetch(args) {
    if (args.length === 0) this.usageError("hex web fetch <url> [--summarize claude|gemini|gpt] [--save <file>]");

    const summarizeIdx = args.indexOf("--summarize");
    const saveIdx      = args.indexOf("--save");
    const provider     = summarizeIdx !== -1 ? args[summarizeIdx + 1] : null;
    const saveFile     = saveIdx      !== -1 ? args[saveIdx + 1]      : null;

    // URL is the first arg that doesn't look like a flag
    const url = args.find((a) => a.startsWith("http://") || a.startsWith("https://"));
    if (!url) {
      this.log.fail("No URL provided. URL must start with http:// or https://");
      process.exit(1);
    }

    // Basic URL validation
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      this.log.fail(`Invalid URL: "${url}"`);
      process.exit(1);
    }

    console.log(`\n\x1b[36m⟶  Fetching:\x1b[0m ${url}`);

    // ── Perform fetch ────────────────────────────────────────────────────────
    let rawHtml;
    await withSpinner("Downloading page", async () => {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "ZerathCode/1.0",
          "Accept":     "text/html,text/plain,application/json",
        },
        signal: AbortSignal.timeout(15000), // 15s timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      rawHtml = await response.text();
    });

    // ── Extract readable text ────────────────────────────────────────────────
    const extracted = this._extractText(rawHtml);

    // ── Display ──────────────────────────────────────────────────────────────
    const divider = "─".repeat(60);
    console.log(`\n\x1b[90m${divider}\x1b[0m`);
    console.log(extracted.slice(0, 3000));
    if (extracted.length > 3000) {
      console.log(`\x1b[90m\n… (${extracted.length - 3000} more chars truncated)\x1b[0m`);
    }
    console.log(`\x1b[90m${divider}\x1b[0m\n`);
    console.log(`\x1b[90mPage size: ${(rawHtml.length / 1024).toFixed(1)} KB | Extracted: ${extracted.length} chars\x1b[0m`);

    // ── Save to file ─────────────────────────────────────────────────────────
    if (saveFile) {
      const resolved = await this.safePath(saveFile);
      fs.writeFileSync(resolved, extracted, "utf8");
      this.log.success(`Content saved to: ${saveFile}`);
    }

    // ── Summarize via AI ─────────────────────────────────────────────────────
    if (provider) {
      await this._summarize(url, extracted, provider);
    }
  }

  // ── AI Summarization ───────────────────────────────────────────────────────
  async _summarize(url, content, provider) {
    const validProviders = AiClient.providers();
    const p = provider.toLowerCase();

    if (!validProviders.includes(p)) {
      this.log.fail(`Unknown AI provider: "${provider}". Use: ${validProviders.join(", ")}`);
      process.exit(1);
    }

    const key = this.keyManager.getKey(p);
    if (!key) {
      this.log.fail(`No API key for "${p}". Run: hex keys add ${p} <key>`);
      process.exit(1);
    }

    const prompt = [
      `URL: ${url}`,
      `\n--- PAGE CONTENT ---\n`,
      content.slice(0, 6000),
      `\n--- END ---\n`,
      `Provide a clear summary covering: main topic, key points, and any important data.`,
    ].join("\n");

    console.log(`\n\x1b[36m⚡ Summarising with ${AiClient.label(p)}…\x1b[0m\n`);

    let text;
    const ai = new AiClient(this.keyManager);

    await withSpinner("Calling AI", async () => {
      text = await ai.ask(p, prompt, {
        systemPrompt: "You are a helpful assistant that summarises web page content concisely.",
        maxTokens: 1024,
      });
    });

    const divider = "─".repeat(60);
    console.log(`\x1b[35m${divider}\x1b[0m`);
    console.log(`\x1b[35m  AI Summary (${AiClient.label(p)})\x1b[0m`);
    console.log(`\x1b[35m${divider}\x1b[0m`);
    console.log(text);
    console.log(`\x1b[35m${divider}\x1b[0m\n`);
  }

  // ── Ping ───────────────────────────────────────────────────────────────────
  async _ping(args) {
    const url = args[0];
    if (!url) this.usageError("hex web ping <url>");

    console.log(`\x1b[36mPinging: ${url}\x1b[0m`);
    const t0 = Date.now();
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10000) });
      const ms  = Date.now() - t0;
      const clr = res.ok ? "\x1b[32m" : "\x1b[33m";
      console.log(`${clr}  HTTP ${res.status} ${res.statusText}  •  ${ms}ms\x1b[0m`);
    } catch (err) {
      this.log.fail(`Unreachable: ${err.message}`);
    }
  }

  // ── Headers ────────────────────────────────────────────────────────────────
  async _headers(args) {
    const url = args[0];
    if (!url) this.usageError("hex web headers <url>");

    const res = await fetch(url, { method: "HEAD" });
    console.log(`\n\x1b[36m── Response Headers: ${url}\x1b[0m\n`);
    res.headers.forEach((val, key) => {
      console.log(`  \x1b[33m${key.padEnd(30)}\x1b[0m ${val}`);
    });
    console.log("");
  }

  // ── Text extraction (strip HTML tags) ────────────────────────────────────
  _extractText(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")  // remove scripts
      .replace(/<style[\s\S]*?<\/style>/gi, " ")    // remove styles
      .replace(/<[^>]+>/g, " ")                      // strip all tags
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, " ")                       // collapse whitespace
      .trim();
  }

  _help() {
    console.log(`
\x1b[36mWeb Agent Commands:\x1b[0m
  hex web fetch <url>
  hex web fetch <url> --summarize claude|gemini|gpt
  hex web fetch <url> --save <file>
  hex web ping <url>
  hex web headers <url>
`);
  }
}

module.exports = WebAgent;
