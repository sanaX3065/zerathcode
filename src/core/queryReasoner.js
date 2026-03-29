/**
 * src/core/queryReasoner.js
 * ZerathCode — Query Reasoning Engine
 * Author: ZerathCode Team
 *
 * Intelligent query understanding and decomposition.
 * Detects multi-hop questions, entities, relationships, and question types.
 * Goes beyond heuristic "and" splitting.
 */

"use strict";

class QueryReasoner {
  /**
   * Parse a query and return structured understanding.
   *
   * @param {string} query
   * @returns {{
   *   original: string,
   *   type: 'definition'|'howto'|'comparison'|'multihop'|'factual',
   *   entities: string[],
   *   concepts: string[],
   *   subqueries: string[],
   *   confidence: number,
   * }}
   */
  static analyze(query) {
    const q = String(query || "").trim();
    if (!q) {
      return {
        original: q,
        type: "factual",
        entities: [],
        concepts: [],
        subqueries: [q],
        confidence: 0,
      };
    }

    const type = QueryReasoner._detectType(q);
    const entities = QueryReasoner._extractEntities(q);
    const concepts = QueryReasoner._extractConcepts(q);
    const subqueries = QueryReasoner._decompose(q, type, entities, concepts);

    return {
      original: q,
      type,
      entities,
      concepts,
      subqueries,
      confidence: Math.min(0.95, (subqueries.length / 3) * 0.9),
    };
  }

  /**
   * Detect question type.
   * @private
   */
  static _detectType(query) {
    const q = query.toLowerCase();

    // Definition: "What is X?", "Define X", "Explain X"
    if (/^(what is|define|explain|what do|what does|describe|tell me about|how would you define)\b/.test(q)) {
      return "definition";
    }

    // How-to: "How to X?", "How do I X?", "Steps to X"
    if (/^(how to|how do i|how can i|how should i|steps to|guide to|tutorial|build|create|set up|implement)\b/.test(q)) {
      return "howto";
    }

    // Comparison: "Difference between X and Y", "X vs Y", "Compare X and Y"
    if (/\b(vs|versus|difference between|vs\.|compared? to|than|better than|worse than)\b/.test(q)) {
      return "comparison";
    }

    // Multi-hop: "Given X, how to Y?", "When X, why does Y happen?"
    if (/\b(given|when|if|because|since|that leads to|causes|results in|unless)\b/.test(q)) {
      return "multihop";
    }

    return "factual";
  }

  /**
   * Extract entities (proper nouns, tech terms, names).
   * @private
   */
  static _extractEntities(query) {
    const entities = [];
    const q = query.toLowerCase();

    // Technology frameworks
    const frameworks = [
      "django", "flask", "fastapi", "tornado",
      "react", "vue", "angular", "svelte", "ember",
      "express", "hapi", "koa", "next.js", "nuxt", "nest.js",
      "spring", "spring boot", "play", "grails",
      "rails", "sinatra", "hanami",
      "laravel", "symfony", "yii", "slim",
      "node", "python", "javascript", "typescript", "java", "go", "rust", "c#", ".net", "php", "ruby",
      "postgresql", "mysql", "mongodb", "redis", "cassandra", "elasticsearch",
      "aws", "gcp", "azure", "heroku", "digitalocean", "linode",
      "docker", "kubernetes", "terraform", "jenkins", "gitlab", "github", "circleci",
    ];

    for (const fw of frameworks) {
      const regex = new RegExp(`\\b${fw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(query)) {
        entities.push(fw.toLowerCase());
      }
    }

    // Version numbers: "5.0", "1.2.3"
    const versions = query.match(/v?(\d+\.\d+(?:\.\d+)?)/g) || [];
    entities.push(...versions);

    // SQL terms
    if (/\b(sql|query|orm|database|table|column|index)\b/i.test(query)) {
      entities.push("sql");
    }

    // Security terms
    if (/\b(injection|xss|csrf|encryption|hash|auth|oauth)\b/i.test(query)) {
      entities.push("security");
    }

    // Performance terms
    if (/\b(performance|optimization|cache|indexing|n\+1)\b/i.test(query)) {
      entities.push("performance");
    }

    return Array.from(new Set(entities));
  }

  /**
   * Extract key concepts for decomposition.
   * @private
   */
  static _extractConcepts(query) {
    const q = query.toLowerCase();
    const concepts = [];

    // Filter out stop words and extract meaningful tokens
    const stop = new Set([
      "the", "a", "an", "and", "or", "but", "is", "are", "was", "were",
      "do", "does", "did", "how", "what", "why", "when", "where", "which",
      "it", "its", "be", "been", "in", "on", "at", "to", "for", "of", "by",
      "with", "from", "about", "as", "can", "could", "would", "should", "if",
      "me", "you", "him", "her", "them", "us", "i", "he", "she", "they", "we",
    ]);

    const tokens = q.split(/\b/).filter((t) => t.match(/^\w+$/) && t.length > 2);

    for (const token of tokens) {
      if (!stop.has(token) && token.length > 2) {
        concepts.push(token);
      }
    }

    return Array.from(new Set(concepts)).slice(0, 8);
  }

  /**
   * Decompose query into sub-queries for multi-part questions.
   * @private
   */
  static _decompose(query, type, entities, concepts) {
    const q = query.toLowerCase();

    // Comparison questions: extract both sides
    if (type === "comparison") {
      const parts = q.split(/\b(vs|versus|difference between|compared? to)\b/i);
      if (parts.length >= 2) {
        return [
          parts[0].trim(),
          parts[parts.length - 1].trim(),
        ].filter(Boolean);
      }
    }

    // Multi-hop: decompose on logical connectors
    if (type === "multihop") {
      const connectors = ["given", "when", "if", "because", "since", "unless"];
      for (const conn of connectors) {
        const regex = new RegExp(`\\b${conn}\\b`, "i");
        if (regex.test(q)) {
          const parts = q.split(regex).map((p) => p.trim()).filter(Boolean);
          if (parts.length >= 2) {
            return parts.slice(0, 3);
          }
        }
      }
    }

    // Generic "and" splitting
    const parts = query.split(/\sand\s/i).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      return parts.slice(0, 3);
    }

    // If no decomposition, use original + augmented searches
    if (entities.length > 0) {
      return [
        query,
        `${entities[0]} best practices`,
        concepts.slice(0, 2).join(" "),
      ].filter(Boolean);
    }

    return [query];
  }

  /**
   * Estimate if a query needs web fetch vs local knowledge.
   *
   * @param {string} query
   * @returns {{needsFetch: boolean, reasoning: string}}
   */
  static requiresFetch(query) {
    const q = query.toLowerCase();

    // Real-time data
    if (/(price|stock|weather|today|right now|current|live|latest|breaking|news)/i.test(q)) {
      return { needsFetch: true, reasoning: "Real-time data required" };
    }

    // Recent versions/releases
    if (/\b(version|release|announcement|new|update|coming)\b.*\b(\d{4}|2024|2025)\b/i.test(q)) {
      return { needsFetch: true, reasoning: "Recent version/release info" };
    }

    // Official documentation
    if (/(documentation|docs|official|spec|rfc|standard|guide)/i.test(q)) {
      return { needsFetch: true, reasoning: "Official documentation needed" };
    }

    // Specific software/library version
    if (/\b\d+\.\d+\.\d*\b.*\b(bug|fix|security|issue|problem)/i.test(q)) {
      return { needsFetch: true, reasoning: "Version-specific bug/fix info" };
    }

    return { needsFetch: false, reasoning: "General knowledge sufficient" };
  }

  /**
   * Score how well a source matches a query concept.
   * Higher score = better match.
   *
   * @param {string} sourceTitle
   * @param {string} sourceContent
   * @param {string} query
   * @returns {number} - Score 0-1
   */
  static sourceRelevance(sourceTitle, sourceContent, query) {
    const qt = query.toLowerCase();
    const st = sourceTitle.toLowerCase();
    const sc = sourceContent.toLowerCase();

    let score = 0;

    // Exact title match
    if (st === qt) score += 0.5;

    // Title contains most query terms
    const qTokens = qt.split(/\s+/).filter((w) => w.length > 2);
    const matchedInTitle = qTokens.filter((t) => st.includes(t)).length;
    score += Math.min(0.3, (matchedInTitle / Math.max(qTokens.length, 1)) * 0.3);

    // Content has high token density
    const matchedInContent = qTokens.filter((t) => sc.includes(t)).length;
    score += Math.min(0.2, (matchedInContent / Math.max(qTokens.length, 1)) * 0.2);

    return Math.min(1, score);
  }
}

module.exports = QueryReasoner;
