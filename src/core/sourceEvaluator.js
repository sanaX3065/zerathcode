/**
 * src/core/sourceEvaluator.js
 * ZerathCode — Source Evaluator
 * Author: ZerathCode Team
 *
 * Scores sources by credibility, authority, recency, and duplication.
 * Uses heuristics optimized for speed and accuracy.
 */

"use strict";

class SourceEvaluator {
  /**
   * Evaluate authority/credibility of a URL.
   * Returns a score 0-1 and authority level.
   *
   * @param {string} url
   * @param {string} queryContext - The user's query (for domain matching)
   * @returns {{score: number, level: 'primary'|'secondary'|'tertiary', reason: string}}
   */
  static evaluateAuthority(url, queryContext = "") {
    const u = String(url || "").toLowerCase();
    const q = String(queryContext || "").toLowerCase();

    let score = 0.5;
    let level = "secondary";
    let reason = "general source";

    // Primary: Official documentation
    if (SourceEvaluator._isPrimarySource(u, q)) {
      score = 0.95;
      level = "primary";
      reason = "official documentation";
      return { score, level, reason };
    }

    // Secondary: Well-known tech communities
    if (SourceEvaluator._isSecondarySource(u, q)) {
      score = 0.8;
      level = "secondary";
      reason = "reputable tech source";
      return { score, level, reason };
    }

    // Tertiary: Blogs, forums (but established ones)
    if (SourceEvaluator._isTertiarySource(u)) {
      score = 0.6;
      level = "tertiary";
      reason = "community/blog source";
      return { score, level, reason };
    }

    // Penalize: Low-quality sources
    if (SourceEvaluator._isLowQuality(u)) {
      score = 0.2;
      level = "tertiary";
      reason = "low credibility source";
      return { score, level, reason };
    }

    return { score, level, reason };
  }

  /**
   * Detect if URL is official documentation.
   * @private
   */
  static _isPrimarySource(url, context) {
    const patterns = [
      /^https?:\/\/docs\.djangoproject\.com\//,
      /^https?:\/\/docs\.python\.org\//,
      /^https?:\/\/nodejs\.org\/docs\//,
      /^https?:\/\/developer\.mozilla\.org\//,
      /^https?:\/\/owasp\.org\//,
      /^https?:\/\/www\.w3\.org\//,
      /^https?:\/\/learn\.microsoft\.com\//,
      /^https?:\/\/developers\.google\.com\//,
      /^https?:\/\/developer\.apple\.com\//,
      /^https?:\/\/httpwg\.org\//,
      /^https?:\/\/www\.postgresql\.org\/docs\//,
      /^https?:\/\/sqlite\.org\/docs\.html/,
    ];

    return patterns.some((p) => p.test(url));
  }

  /**
   * Detect well-known secondary sources.
   * @private
   */
  static _isSecondarySource(url, context) {
    const patterns = [
      /^https?:\/\/stackoverflow\.com\//,
      /^https?:\/\/github\.com\//,
      /^https?:\/\/medium\.com(@|\/)[\w-]+/,
      /^https?:\/\/dev\.to\//,
      /^https?:\/\/www\.digitalocean\.com\//,
      /^https?:\/\/auth0\.com\/blog\//,
      /^https?:\/\/www\.cloudflare\.com\/learning\//,
      /^https?:\/\/aws\.amazon\.com\/blogs\//,
      /^https?:\/\/engineering\.(fb|instagram|pinterest|twitter|airbnb)\.com\//,
    ];

    return patterns.some((p) => p.test(url));
  }

  /**
   * Detect tertiary (blog/forum) sources.
   * @private
   */
  static _isTertiarySource(url) {
    const patterns = [
      /\.blogspot\.com/,
      /wordpress\.com/,
      /\.substack\.com/,
      /reddit\.com/,
      /quora\.com/,
      /medium\.com/,
      /dev\.to/,
    ];

    return patterns.some((p) => p.test(url));
  }

  /**
   * Detect low-quality sources.
   * @private
   */
  static _isLowQuality(url) {
    const patterns = [
      /^https?:\/\/bit\.ly\//,
      /^https?:\/\/short\.link\//,
      /^https?:\/\/tinyurl\.com\//,
      /ads?\.example\.com/,
      /^https?:\/\/.*cdn.*\/ads\//,
    ];

    return patterns.some((p) => p.test(url));
  }

  /**
   * Extract likely publication date from URL or infer from domain patterns.
   * Returns a Date object or null.
   *
   * @param {string} url
   * @param {string} content - Optional content to search for dates
   * @returns {Date | null}
   */
  static extractDate(url, content = "") {
    const u = String(url || "").toLowerCase();
    const c = String(content || "");

    // Try URL patterns: /2024/12/, /blog/2024-12-25/, etc.
    const urlDatePatterns = [
      /\/(\d{4})[/-](\d{2})[/-](\d{2})\//,
      /\/(\d{4})[/-](\d{2})\//,
      /(\d{4})[/-](\d{2})[/-](\d{2})/,
    ];

    for (const pattern of urlDatePatterns) {
      const match = u.match(pattern);
      if (match) {
        const year = parseInt(match[1]);
        const month = parseInt(match[2]) - 1;
        const day = parseInt(match[3]) || 1;
        if (year > 2000 && year < 2100) {
          return new Date(year, month, day);
        }
      }
    }

    // Try content: "Published on 2024-12-25" or "Updated: December 25, 2024"
    const contentPatterns = [
      /(?:published|updated|posted|modified)[\s:]*(\w+\s+\d+,?\s+\d{4})/i,
      /(\d{1,2}[-/]\d{1,2}[-/]\d{4})/,
      /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/,
    ];

    for (const pattern of contentPatterns) {
      const match = c.match(pattern);
      if (match) {
        try {
          const date = new Date(match[1]);
          if (date instanceof Date && !isNaN(date.getTime())) {
            return date;
          }
        } catch {}
      }
    }

    return null;
  }

  /**
   * Calculate recency score based on publication date.
   * Weights recent content higher.
   *
   * @param {Date | null} date
   * @returns {number} - Score 0-1 (1 = very recent, 0 = very old)
   */
  static recencyScore(date) {
    if (!date || !(date instanceof Date)) return 0.5; // neutral if unknown

    const now = new Date();
    const ageMs = now - date;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    // Scoring: recent = high, old = low
    // 0-30 days: 1.0
    // 1 year: 0.9
    // 2 years: 0.7
    // 5 years: 0.4
    // 10+ years: 0.1

    if (ageDays <= 30) return 1.0;
    if (ageDays <= 90) return 0.95;
    if (ageDays <= 180) return 0.9;
    if (ageDays <= 365) return 0.85;
    if (ageDays <= 730) return 0.7;
    if (ageDays <= 1825) return 0.4;
    return 0.1;
  }

  /**
   * Detect if URL is a duplicate/mirror of another URL.
   * Returns a similarity score 0-1.
   *
   * @param {string} url1
   * @param {string} url2
   * @returns {number} - Similarity [0, 1]
   */
  static duplicateScore(url1, url2) {
    const u1 = String(url1 || "").toLowerCase().replace(/^https?:\/\/www\./, "");
    const u2 = String(url2 || "").toLowerCase().replace(/^https?:\/\/www\./, "");

    //Exact match
    if (u1 === u2) return 1.0;

    // Same domain
    try {
      const d1 = new URL("https://" + u1).hostname;
      const d2 = new URL("https://" + u2).hostname;
      if (d1 === d2) return 0.8; // Same domain, might be different pages
    } catch {}

    // Levenshtein-like: simple similarity
    const common = SourceEvaluator._commonLength(u1, u2);
    const maxLen = Math.max(u1.length, u2.length);
    return maxLen > 0 ? common / maxLen : 0;
  }

  /**
   * Longest common subsequence length (for similarity).
   * @private
   */
  static _commonLength(s1, s2) {
    const m = Math.min(s1.length, s2.length);
    let common = 0;
    for (let i = 0; i < m; i++) {
      if (s1[i] === s2[i]) common++;
      else break;
    }
    return common;
  }

  /**
   * Overall source quality score (0-1).
   * Combines authority, recency, and other factors.
   *
   * @param {string} url
   * @param {string} content - Optional content
   * @param {string} queryContext - Optional query for domain matching
   * @returns {number}
   */
  static qualityScore(url, content = "", queryContext = "") {
    const authority = SourceEvaluator.evaluateAuthority(url, queryContext);
    const date = SourceEvaluator.extractDate(url, content);
    const recency = SourceEvaluator.recencyScore(date);

    // Weighted average: authority 60%, recency 40%
    return authority.score * 0.6 + recency * 0.4;
  }

  /**
   * Filter and sort sources by quality.
   *
   * @param {string[]} urls
   * @param {string} queryContext
   * @returns {Array<{url: string, score: number, authority: string}>}
   */
  static rankSources(urls, queryContext = "") {
    const scored = urls.map((url) => ({
      url,
      score: SourceEvaluator.qualityScore(url, "", queryContext),
      authority: SourceEvaluator.evaluateAuthority(url, queryContext).level,
    }));

    // Remove duplicates (keep highest scoring)
    const unique = [];
    const seen = new Set();
    for (const s of scored.sort((a, b) => b.score - a.score)) {
      const key = new URL(s.url).hostname;
      if (!seen.has(key)) {
        unique.push(s);
        seen.add(key);
      }
    }

    return unique;
  }
}

module.exports = SourceEvaluator;
