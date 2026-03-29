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
    const minChars  = Number.isFinite(opts.minChars)  ? opts.minChars  : 350;
    const userAgent = opts.userAgent || "ZerathCode/1.0";

    const fetchOnce = async (u) => {
      const res = await fetch(u, {
        headers: {
          "User-Agent": userAgent,
          "Accept": "text/html,text/plain,application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await res.text();
      const text = WebAgent.extractText(raw).slice(0, maxChars);
      return { res, raw, text };
    };

    let u = url;
    let { res, raw, text } = await fetchOnce(u);

    // Fallback: some pages (notably Google SERPs) are mostly JS, so extracted text is tiny.
    // Use r.jina.ai "readable proxy" to get server-rendered/plain content.
    if (text.length < minChars && !String(u).startsWith("https://r.jina.ai/")) {
      const jinaUrl = WebAgent._jinaUrl(u);
      try {
        const out = await fetchOnce(jinaUrl);
        // If the proxy is better, keep it (still report original status if proxy returns 200 OK).
        if (out.text.length > text.length) {
          res = out.res;
          raw = out.raw;
          text = out.text;
          u = jinaUrl;
        }
      } catch {
        // Ignore fallback failures, keep original.
      }
    }

    return {
      ok:         !!res.ok,
      status:     res.status,
      statusText: res.statusText || "",
      url:        res.url || u,
      text,
      rawSize:    raw.length,
      textSize:   text.length,
    };
  }

  // ── RAG-like extraction for better "web_fetch" usefulness ────────────────
  // Goal: return only the most relevant parts of a page (or multiple pages)
  // so the LLM sees signal, not noise.
  static async fetchRelevant(url, query = "", opts = {}) {
    const q = String(query || "").trim();

    // If user asked to fetch a search URL, treat it as "search then scrape sources".
    if (WebAgent._isSearchUrl(url)) {
      const sq = WebAgent._extractSearchQuery(url) || q;
      return WebAgent._searchThenRag(sq, q || sq, opts);
    }

    if (!q) return WebAgent.fetchText(url, opts);

    // Direct page: fetch more content, then select top excerpts.
    const page = await WebAgent.fetchText(url, {
      ...opts,
      // Fetch more than the final output so the retriever has room to work.
      maxChars: Math.max(Number(opts.maxChars || 0) || 0, 12000),
      minChars: Number.isFinite(opts.minChars) ? opts.minChars : 350,
    });

    const excerpts = WebAgent._selectRelevantExcerpts(page.text, q, {
      maxSnippets: 6,
      snippetChars: 520,
    });

    const header = `Source: ${url}\nQuery: ${q}\n`;
    const body = excerpts.length
      ? excerpts.map((s, i) => `(${i + 1}) ${s}`).join("\n\n")
      : page.text.slice(0, Number(opts.maxChars) || 3000);

    const maxOut = Number.isFinite(opts.maxChars) ? opts.maxChars : 3000;
    return {
      ok: page.ok,
      status: page.status,
      statusText: page.statusText,
      url: page.url,
      text: (header + "\n" + body).slice(0, maxOut),
      rawSize: page.rawSize,
      textSize: Math.min((header + "\n" + body).length, maxOut),
      sources: [url],
    };
  }

  /**
   * Search + scrape + chunk + similarity select (RAG-style).
   * This is the preferred "query-only web_fetch" path for chat.
   *
   * @param {string} query
   * @param {{timeoutMs?: number, maxChars?: number, userAgent?: string, maxSites?: number}} opts
   */
  static async searchAndRag(query, opts = {}) {
    const q = String(query || "").trim();
    const maxOut = Number.isFinite(opts.maxChars) ? opts.maxChars : 3000;
    const maxSites = Number.isFinite(opts.maxSites) ? opts.maxSites : 5;
    if (!q) {
      return { ok: false, status: 400, statusText: "Bad Request", url: "", text: "(no query provided)", rawSize: 0, textSize: 0, sources: [] };
    }

    // If the question has multiple distinct topics, run multiple searches.
    // This prevents one topic (e.g., N+1) from dominating the retrieved chunks.
    const subQueries = WebAgent._decomposeQuery(q);
    const multi = opts.multi !== false && subQueries.length > 1;

    if (!multi) {
      return WebAgent._searchAndRagSingle(q, opts);
    }

    // Keep the number of sub-queries bounded to avoid huge fanout.
    const limited = subQueries.slice(0, 3);
    const parts = [];
    const allSources = [];

    // Allocate output budget across parts.
    const perBudget = Math.max(900, Math.floor(maxOut / limited.length));

    for (const sq of limited) {
      const out = await WebAgent._searchAndRagSingle(sq, { ...opts, maxChars: perBudget });
      if (out?.text) {
        parts.push(out.text.trim());
      }
      if (Array.isArray(out?.sources)) allSources.push(...out.sources);
    }

    const combined = [
      `RAG (multi-query) from: ${q}`,
      "",
      parts.join("\n\n===\n\n") || "(no excerpts found)",
    ].join("\n").slice(0, maxOut);

    const sources = Array.from(new Set(allSources)).slice(0, maxSites * limited.length);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      url: WebAgent.googleSearchUrl(q),
      text: combined,
      rawSize: combined.length,
      textSize: combined.length,
      sources,
    };
  }

  static async _searchAndRagSingle(query, opts = {}) {
    const q = String(query || "").trim();
    const maxOut = Number.isFinite(opts.maxChars) ? opts.maxChars : 3000;
    const maxSites = Number.isFinite(opts.maxSites) ? opts.maxSites : 5;
    const concurrency = Number.isFinite(opts.concurrency) ? Math.max(1, Math.floor(opts.concurrency)) : 3;

    let urls = [];
    try {
      urls = await WebAgent._duckDuckGoHtmlUrls(q, opts);
    } catch {
      urls = [];
    }

    if (urls.length === 0) {
      urls = WebAgent._inferAuthoritativeUrls(q);
    }

    urls = urls.slice(0, maxSites);

    const fetched = await WebAgent._mapLimit(urls, concurrency, async (u) => {
      try {
        const page = await WebAgent.fetchText(u, {
          ...opts,
          // Give the chunker enough room; final output is trimmed later.
          maxChars: 12000,
          minChars: 350,
        });
        if (page && page.text && page.text.length > 250) {
          return { url: u, text: page.text };
        }
      } catch {}
      return null;
    });

    const pages = fetched.filter(Boolean);
    const sources = pages.map((p) => p.url);

    const selected = WebAgent._selectTopRagChunks(pages, q, {
      maxChunks: 8,
      maxPerSource: 2,
      chunkSize: 900,
      overlap: 140,
      snippetChars: 520,
    });

    const header = [
      `RAG subquery: ${q}`,
      `Sources (${sources.length}/${maxSites}):`,
      ...sources.map((s) => `- ${s}`),
      "",
      "Top relevant excerpts:",
      "",
    ].join("\n");

    const body = selected.length
      ? selected.map((c, i) => `(${i + 1}) [${c.score}] ${c.source}\n${c.text}`).join("\n\n")
      : "(no relevant excerpts found)";

    const text = (header + body).slice(0, maxOut);
    return { ok: true, status: 200, statusText: "OK", url: WebAgent.googleSearchUrl(q), text, rawSize: text.length, textSize: text.length, sources };
  }

  static _decomposeQuery(query) {
    const s = String(query || "").toLowerCase();
    const out = [];

    // Django hints
    const hasDjango = s.includes("django");
    const ver = (s.match(/\b(\d+\.\d+)\b/) || [])[1] || "5.0";

    const hasN1 = /(n\+1|n\s*\+\s*1)/.test(s) || s.includes("select_related") || s.includes("prefetch_related");
    const hasInj = /(sql\s*injection|injection|rawsql|raw\s+sql|extra\()/i.test(s);
    const hasConnector = /\bconnector\b|_connector/.test(s);

    if (hasN1) {
      out.push(`${hasDjango ? `Django ${ver} ` : ""}ORM N+1 problem select_related prefetch_related query optimization`);
    }
    if (hasInj || hasConnector) {
      out.push(`${hasDjango ? `Django ${ver} ` : ""}ORM SQL injection prevention RawSQL extra() raw() params parameterized queries ${hasConnector ? "connector" : ""}`.trim());
    }

    // If we didn't detect anything, do a best-effort split on "and" for multi-part questions.
    if (out.length === 0) {
      const parts = String(query).split(/\s+\band\b\s+/i).map((p) => p.trim()).filter(Boolean);
      if (parts.length > 1) {
        for (const p of parts.slice(0, 3)) out.push(p);
      }
    }

    return out.length ? out : [query];
  }

  static async _mapLimit(items, limit, fn) {
    const arr = Array.isArray(items) ? items : [];
    const out = new Array(arr.length);
    let idx = 0;

    const workers = new Array(Math.min(limit, arr.length)).fill(0).map(async () => {
      while (true) {
        const i = idx++;
        if (i >= arr.length) break;
        out[i] = await fn(arr[i], i);
      }
    });

    await Promise.all(workers);
    return out;
  }

  static _jinaUrl(url) {
    const u = String(url || "");
    if (u.startsWith("https://r.jina.ai/")) return u;
    // r.jina.ai expects the full scheme in the path: https://r.jina.ai/https://example.com
    return `https://r.jina.ai/${u}`;
  }

  static _isSearchUrl(url) {
    try {
      const u = new URL(String(url));
      const host = u.hostname.toLowerCase();
      if (host.includes("google.") && u.pathname === "/search") return true;
      if (host === "html.duckduckgo.com" && u.pathname.startsWith("/html/")) return true;
      if (host === "duckduckgo.com" && u.pathname === "/html/") return true;
      if (host.includes("bing.com") && u.pathname === "/search") return true;
    } catch {}
    return false;
  }

  static _extractSearchQuery(url) {
    try {
      const u = new URL(String(url));
      return u.searchParams.get("q") || "";
    } catch {
      return "";
    }
  }

  static async _searchThenRag(searchQuery, ragQuery, opts = {}) {
    const sq = String(searchQuery || "").trim();
    const rq = String(ragQuery || "").trim() || sq;
    const maxOut = Number.isFinite(opts.maxChars) ? opts.maxChars : 3000;

    // Prefer high-signal, authoritative sources when we can infer them.
    const inferred = WebAgent._inferAuthoritativeUrls(rq);
    let urls = inferred;

    // If we couldn't infer anything, do a lightweight HTML search (DuckDuckGo).
    if (urls.length === 0 && sq) {
      try {
        const found = await WebAgent._duckDuckGoHtmlUrls(sq, opts);
        urls = found;
      } catch {
        urls = [];
      }
    }

    if (urls.length === 0) {
      // Last resort: just fetch the original URL.
      return WebAgent.fetchText(WebAgent.googleSearchUrl(sq || rq), opts);
    }

    const all = [];
    const sources = [];
    for (const u of urls.slice(0, 2)) {
      try {
        const page = await WebAgent.fetchText(u, {
          ...opts,
          maxChars: 14000,
        });
        const excerpts = WebAgent._selectRelevantExcerpts(page.text, rq, {
          maxSnippets: 4,
          snippetChars: 520,
        });
        if (excerpts.length) {
          all.push(`Source: ${u}\n` + excerpts.map((s, i) => `(${i + 1}) ${s}`).join("\n\n"));
          sources.push(u);
        }
      } catch {
        // ignore one bad source
      }
    }

    const text = [
      `Search query: ${sq}`,
      `RAG query: ${rq}`,
      "",
      all.join("\n\n---\n\n") || "(no relevant excerpts found)",
    ].join("\n").slice(0, maxOut);

    return { ok: true, status: 200, statusText: "OK", url: WebAgent.googleSearchUrl(sq), text, rawSize: text.length, textSize: text.length, sources };
  }

  static _inferAuthoritativeUrls(query) {
    const s = String(query || "").toLowerCase();
    const urls = [];

    // Django-specific shortcuts are extremely high yield.
    if (s.includes("django")) {
      const m = s.match(/\b(\d+\.\d+)\b/);
      const v = m ? m[1] : "5.0";

      if (/(n\+1|n\s*\+\s*1|select_related|prefetch_related|prefetch)/.test(s)) {
        urls.push(`https://docs.djangoproject.com/en/${v}/topics/db/optimization/`);
        urls.push(`https://docs.djangoproject.com/en/${v}/ref/models/querysets/`);
      }
      if (/(?:sql\s*injection|injection|rawsql|extra\(|raw\s+sql)/.test(s)) {
        urls.push(`https://docs.djangoproject.com/en/${v}/topics/security/`);
        urls.push(`https://docs.djangoproject.com/en/${v}/topics/db/sql/`);
      }
    }

    // Generic security fallback
    if (/(sql\s*injection|injection)/.test(s)) {
      urls.push("https://owasp.org/www-community/attacks/SQL_Injection");
    }

    return Array.from(new Set(urls));
  }

  static async _duckDuckGoHtmlUrls(query, opts = {}) {
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 15000;
    const userAgent = opts.userAgent || "ZerathCode/1.0";
    const q = encodeURIComponent(String(query || "").trim());
    const searchUrl = `https://html.duckduckgo.com/html/?q=${q}`;

    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const html = await res.text();

    // DDG html format typically uses <a class="result__a" href="...">.
    const urls = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const href = m[1];
      // Sometimes direct, sometimes a redirect; handle both.
      const u = WebAgent._normalizeCandidateUrl(href);
      if (u) urls.push(u);
      if (urls.length >= 6) break;
    }

    return Array.from(new Set(urls));
  }

  static _normalizeCandidateUrl(href) {
    try {
      const h = String(href || "");
      if (h.startsWith("http://") || h.startsWith("https://")) return h;
      // DDG redirect links sometimes look like "/l/?uddg=<encoded>"
      if (h.startsWith("/l/") && h.includes("uddg=")) {
        const u = new URL("https://duckduckgo.com" + h);
        const raw = u.searchParams.get("uddg");
        if (raw) return decodeURIComponent(raw);
      }
    } catch {}
    return null;
  }

  static _selectRelevantExcerpts(text, query, cfg = {}) {
    const maxSnippets = Number.isFinite(cfg.maxSnippets) ? cfg.maxSnippets : 6;
    const snippetChars = Number.isFinite(cfg.snippetChars) ? cfg.snippetChars : 520;
    const t = String(text || "");
    const q = String(query || "");
    const tokens = WebAgent._queryTokens(q);
    if (!tokens.length || !t) return [];

    const chunks = WebAgent._chunkText(t, 900, 140);
    const scored = chunks
      .map((c) => ({ c, score: WebAgent._scoreChunk(c, tokens) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSnippets);

    const out = [];
    for (const { c } of scored) {
      out.push(WebAgent._compactSnippet(c, snippetChars));
    }
    return out;
  }

  static _selectTopRagChunks(pages, query, cfg = {}) {
    const maxChunks = Number.isFinite(cfg.maxChunks) ? cfg.maxChunks : 10;
    const maxPerSource = Number.isFinite(cfg.maxPerSource) ? cfg.maxPerSource : 3;
    const chunkSize = Number.isFinite(cfg.chunkSize) ? cfg.chunkSize : 900;
    const overlap = Number.isFinite(cfg.overlap) ? cfg.overlap : 140;
    const snippetChars = Number.isFinite(cfg.snippetChars) ? cfg.snippetChars : 520;

    const tokens = WebAgent._queryTokens(query);
    if (!tokens.length) return [];

    const candidates = [];
    for (const p of Array.isArray(pages) ? pages : []) {
      const src = p && p.url ? String(p.url) : "";
      const text = p && p.text ? String(p.text) : "";
      if (!src || !text) continue;
      const chunks = WebAgent._chunkText(text, chunkSize, overlap);
      for (const ch of chunks) {
        const score = WebAgent._scoreChunk(ch, tokens);
        if (score <= 0) continue;
        candidates.push({
          source: src,
          score,
          text: WebAgent._compactSnippet(ch, snippetChars),
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    const per = new Map();
    const out = [];
    for (const c of candidates) {
      const n = per.get(c.source) || 0;
      if (n >= maxPerSource) continue;
      out.push(c);
      per.set(c.source, n + 1);
      if (out.length >= maxChunks) break;
    }
    return out;
  }

  static _queryTokens(query) {
    const s = String(query || "").toLowerCase().replace(/\+/g, " + ");
    const raw = s.split(/[^a-z0-9+_]+/g).filter(Boolean);
    const stop = new Set([
      "the","and","or","in","on","to","for","of","a","an","is","are","was","were","be",
      "how","what","why","when","where","which","like","something","about","version",
      "prevent","prevention","fix","issue","problem","explain","tell","me",
    ]);
    const tokens = [];
    for (const w of raw) {
      if (w.length < 3) continue;
      if (stop.has(w)) continue;
      tokens.push(w);
    }
    return Array.from(new Set(tokens));
  }

  static _chunkText(text, size, overlap) {
    const t = String(text || "");
    const out = [];
    if (!t) return out;
    const step = Math.max(50, size - overlap);
    for (let i = 0; i < t.length; i += step) {
      out.push(t.slice(i, i + size));
      if (out.length > 80) break; // hard cap to keep CPU predictable
    }
    return out;
  }

  static _scoreChunk(chunk, tokens) {
    const c = String(chunk || "").toLowerCase();
    let score = 0;
    for (const tok of tokens) {
      const re = new RegExp(WebAgent._escapeRegExp(tok), "g");
      const m = c.match(re);
      if (m) score += m.length;
    }
    // Boost for core Django ORM optimization terms.
    if (c.includes("select_related")) score += 2;
    if (c.includes("prefetch_related")) score += 2;
    if (c.includes("sql injection")) score += 2;
    return score;
  }

  static _escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  static _compactSnippet(s, maxChars) {
    const t = String(s || "").replace(/\s{2,}/g, " ").trim();
    if (t.length <= maxChars) return t;
    return t.slice(0, maxChars - 1).trimEnd() + "…";
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
