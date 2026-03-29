/**
 * src/agents/webAgent.js
 * ZerathCode — Web Agent
 * Author: sanaX3065
 *
 * Fetches web pages, extracts readable content,
 * and optionally summarises via an AI provider.
 *
 * Commands:
 *   zerath web fetch <url> [--summarize <provider>] [--save <file>]
 *   zerath web ping <url>
 *   zerath web headers <url>
 */

"use strict";

const BaseAgent          = require("./baseAgent");
const { withSpinner }    = require("../utils/spinner");
const AiClient           = require("../utils/aiClient");
const fs                 = require("fs");
const path               = require("path");

class WebAgent extends BaseAgent {
  // ── Programmatic API (used by Orchestrator) ───────────────────────────────
  // These methods MUST NOT print to stdout or call process.exit().
  static extractText(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")  // remove scripts
      .replace(/<style[\s\S]*?<\/style>/gi, " ")    // remove styles
      .replace(/<[^>]+>/g, " ")                     // strip all tags
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, " ")                      // collapse whitespace
      .trim();
  }

  /**
   * Fetch a URL and return extracted readable text (for agentic web_fetch).
   * @param {string} url
   * @param {{timeoutMs?: number, maxChars?: number, userAgent?: string}} opts
   * @returns {Promise<{ok:boolean,status:number,statusText:string,url:string,text:string,rawSize:number,textSize:number}>}
   */
  static async fetchText(url, opts = {}) {
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 15000;
    const maxChars  = Number.isFinite(opts.maxChars)  ? opts.maxChars  : 3000;
    const userAgent = opts.userAgent || "ZerathCode/1.0";

    const res = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,text/plain,application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    const raw = await res.text();
    const text = WebAgent.extractText(raw).slice(0, maxChars);

    return {
      ok:         !!res.ok,
      status:     res.status,
      statusText: res.statusText || "",
      url:        res.url || url,
      text,
      rawSize:    raw.length,
      textSize:   text.length,
    };
  }

  // Heuristic: used by Orchestrator as a fallback when the model forgets web_fetch.
  static shouldAutoFetch(userInput) {
    const s = String(userInput || "").toLowerCase().trim();
    if (!s) return false;

    // User opt-out
    if (/\b(do not|don't|no)\s+(use|do)\s+(web|internet|search|browse)\b/.test(s)) return false;

    // Always-web categories
    if (/\b(today|now|current|latest|recent|as of|breaking|news|price|weather|forecast|score|standings|stocks?|crypto|btc|eth|exchange rate)\b/.test(s)) {
      return true;
    }

    // Version-specific questions: "5.0", "v3.2.1", etc.
    const hasVersion = /\b(v?\d+\.\d+(?:\.\d+)?)(?:\s*(?:alpha|beta|rc)\d*)?\b/.test(s);
    const hasTechWord = /\b(django|react|node|python|java|kotlin|postgres|mysql|sqlite|orm|sdk|api|framework|library)\b/.test(s);
    if (hasVersion && hasTechWord) return true;

    // Security advisories tend to be time/version dependent
    if (/\b(cve-\d{4}-\d+|vulnerability|advisory|zero[- ]day)\b/.test(s)) return true;

    return false;
  }

  static googleSearchUrl(q) {
    return `https://www.google.com/search?q=${encodeURIComponent(String(q || "").trim())}`;
  }

  static autoFetchUrls(userInput) {
    const s = String(userInput || "").toLowerCase();
    const urls = [];

    if (s.includes("django")) {
      const m = s.match(/\b(\d+\.\d+)\b/);
      const v = m ? m[1] : "5.0";

      if (/(n\+1|n\s*\+\s*1|select_related|prefetch_related|prefetch|query optimization)/.test(s)) {
        urls.push(`https://docs.djangoproject.com/en/${v}/topics/db/optimization/`);
      }
      if (/(sql\s*injection|injection)/.test(s)) {
        urls.push(`https://docs.djangoproject.com/en/${v}/topics/security/`);
      }
    }

    if (urls.length === 0) urls.push(WebAgent.googleSearchUrl(userInput));

    return Array.from(new Set(urls)).slice(0, 2);
  }

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
    if (args.length === 0) this.usageError("zerath web fetch <url> [--summarize claude|gemini|gpt] [--save <file>]");

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
    const extracted = WebAgent.extractText(rawHtml);

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
      this.log.fail(`No API key for "${p}". Run: zerath keys add ${p} <key>`);
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
    if (!url) this.usageError("zerath web ping <url>");

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
    if (!url) this.usageError("zerath web headers <url>");

    const res = await fetch(url, { method: "HEAD" });
    console.log(`\n\x1b[36m── Response Headers: ${url}\x1b[0m\n`);
    res.headers.forEach((val, key) => {
      console.log(`  \x1b[33m${key.padEnd(30)}\x1b[0m ${val}`);
    });
    console.log("");
  }

  // ── Text extraction (strip HTML tags) ────────────────────────────────────
  _help() {
    console.log(`
\x1b[36mWeb Agent Commands:\x1b[0m
  zerath web fetch <url>
  zerath web fetch <url> --summarize claude|gemini|gpt
  zerath web fetch <url> --save <file>
  zerath web ping <url>
  zerath web headers <url>
`);
  }
}

module.exports = WebAgent;
