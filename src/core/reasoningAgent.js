/**
 * src/core/reasoningAgent.js
 * ZerathCode — Reasoning Agent
 * Author: ZerathCode Team
 *
 * Intermediate reasoning layer between retrieval and answer generation.
 * Synthesizes multiple sources, resolves conflicts, performs multi-hop reasoning.
 * Makes the system more intelligent and agentic.
 */

"use strict";

const QueryReasoner = require("./queryReasoner");
const SourceEvaluator = require("./sourceEvaluator");

class ReasoningAgent {
  /**
   * Analyze retrieved context and plan reasoning steps.
   *
   * @param {string} query - Original user query
   * @param {string} retrievedContext - Raw retrieved text from web/sources
   * @param {string[]} sources - URLs of sources
   * @returns {{
   *   plan: string[],
   *   conflicts: string[],
   *   confidence: number,
   *   reasoning: string,
   *   shouldSearch: boolean,
   *   needsMultiHop: boolean,
   * }}
   */
  static analyze(query, retrievedContext, sources = []) {
    const q = String(query || "").trim();
    const ctx = String(retrievedContext || "").trim();
    const srcs = Array.isArray(sources) ? sources : [];

    if (!ctx) {
      return {
        plan: ["Insufficient context - needs broader search"],
        conflicts: [],
        confidence: 0,
        reasoning: "No retrievedcontext available",
        shouldSearch: true,
        needsMultiHop: false,
      };
    }

    // Analyze query structure
    const queryAnalysis = QueryReasoner.analyze(q);

    // Extract claims and evidence
    const claims = ReasoningAgent._extractClaims(ctx);
    const evidence = ReasoningAgent._mapEvidenceToClaims(claims, ctx);

    // Check source credibility
    const sourceScores = srcs.map((s) => ({
      url: s,
      score: SourceEvaluator.qualityScore(s, ctx, q),
      authority: SourceEvaluator.evaluateAuthority(s, q).level,
    }));

    // Detect conflicts
    const conflicts = ReasoningAgent._detectConflicts(claims, evidence);

    // Build reasoning plan based on analysis
    const plan = ReasoningAgent._buildReasoningPlan(queryAnalysis, evidence, conflicts);

    // Calculate confidence
    const confidence = ReasoningAgent._calculateConfidence(
      evidence,
      conflicts,
      sourceScores,
      queryAnalysis
    );

    // Check if multi-hop reasoning is needed
    const needsMultiHop = queryAnalysis.type === "multihop" && conflicts.length > 0;

    return {
      plan,
      conflicts,
      confidence,
      reasoning: ReasoningAgent._formatReasoning(queryAnalysis, evidence, conflicts),
      shouldSearch: confidence < 0.5 || conflicts.length > 2,
      needsMultiHop,
    };
  }

  /**
   * Extract key claims from text.
   * @private
   */
  static _extractClaims(text) {
    const t = String(text || "");
    const claims = [];

    // Simple heuristic: sentence-like segments after colons or paragraphs
    const segments = t.split(/[.!?\n]+/).filter((s) => s.trim().length > 20);

    for (const seg of segments.slice(0, 10)) {
      const s = seg.trim();
      if (s.length > 15 && !s.startsWith("(")) {
        claims.push(s);
      }
    }

    return claims;
  }

  /**
   * Map evidence to claims (simple text matching).
   * @private
   */
  static _mapEvidenceToClaims(claims, text) {
    const evidence = new Map();
    const t = String(text || "").toLowerCase();

    for (const claim of claims) {
      const c = claim.toLowerCase();
      const tokens = c.split(/\s+/).filter((w) => w.length > 3);

      let matches = 0;
      for (const token of tokens) {
        if (t.includes(token)) matches++;
      }

      const matchRatio = tokens.length > 0 ? matches / tokens.length : 0;
      evidence.set(claim, {
        found: matchRatio > 0.6,
        strength: matchRatio,
        matchCount: matches,
      });
    }

    return evidence;
  }

  /**
   * Detect conflicting or contradictory claims.
   * @private
   */
  static _detectConflicts(claims, evidence) {
    const conflicts = [];

    // Check for negations
    for (const [claim, info] of evidence) {
      if (!info.found) continue;

      const c = claim.toLowerCase();

      // Look for negating phrase in other claims
      for (const [other, otherInfo] of evidence) {
        if (other === claim || !otherInfo.found) continue;
        const o = other.toLowerCase();

        // Simple negation detection
        if (
          (c.includes("not ") && o.includes("is ")) ||
          (o.includes("not ") && c.includes("is "))
        ) {
          conflicts.push(`Potential conflict: "${claim.slice(0, 50)}" vs "${other.slice(0, 50)}"`);
        }
      }
    }

    return Array.from(new Set(conflicts));
  }

  /**
   * Build a reasoning plan based on analysis.
   * @private
   */
  static _buildReasoningPlan(queryAnalysis, evidence, conflicts) {
    const plan = [];

    // Step 1: State the problem
    plan.push(`Answering: ${queryAnalysis.original?.slice(0, 60)}`);

    // Step 2: Identify approach
    if (queryAnalysis.type === "definition") {
      plan.push("1. Find primary definition");
      plan.push("2. Add context and examples");
    } else if (queryAnalysis.type === "howto") {
      plan.push("1. Identify prerequisites");
      plan.push("2. List steps in order");
      plan.push("3. Highlight common pitfalls");
    } else if (queryAnalysis.type === "comparison") {
      plan.push("1. Identify compared items");
      plan.push("2. List key differences");
      plan.push("3. Rank by relevance criteria");
    } else if (queryAnalysis.type === "multihop") {
      plan.push("1. Establish first condition");
      plan.push("2. Trace implications");
      plan.push("3. Connect to final answer");
    }

    // Step 3: Handle conflicts
    if (conflicts.length > 0) {
      plan.push(`4. Resolve ${conflicts.length} conflict(s)`);
    }

    return plan;
  }

  /**
   * Calculate confidence score (0-1).
   * @private
   */
  static _calculateConfidence(evidence, conflicts, sourceScores, queryAnalysis) {
    let confidence = 0.5;

    // Evidence coverage
    const foundClaims = Array.from(evidence.values()).filter((e) => e.found).length;
    const totalClaims = evidence.size || 1;
    confidence += (foundClaims / totalClaims) * 0.3;

    // Source authority
    const avgSourceScore = sourceScores.length > 0
      ? sourceScores.reduce((sum, s) => sum + s.score, 0) / sourceScores.length
      : 0.5;
    confidence += avgSourceScore * 0.2;

    // Conflict penalty
    confidence -= conflicts.length * 0.05;

    // Query complexity bonus (well-defined queries = higher confidence)
    if (queryAnalysis.type !== "factual") {
      confidence += 0.1;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Format reasoning explanation.
   * @private
   */
  static _formatReasoning(queryAnalysis, evidence, conflicts) {
    const lines = [];

    lines.push(`Query type: ${queryAnalysis.type}`);
    lines.push(`Entities: ${queryAnalysis.entities.join(", ") || "(none)"}`);
    lines.push(`Key concepts: ${queryAnalysis.concepts.slice(0, 3).join(", ") || "(none)"}`);

    const foundEvidence = Array.from(evidence.values()).filter((e) => e.found).length;
    lines.push(`Evidence found: ${foundEvidence}/${evidence.size}`);

    if (conflicts.length > 0) {
      lines.push(`Conflicts: ${conflicts.slice(0, 2).join(" | ")}`);
    }

    return lines.join(" | ");
  }

  /**
   * Generate follow-up queries for multi-hop reasoning.
   *
   * @param {string} query - Original query
   * @param {string} retrievedContext - Current context
   * @returns {string[]} - List of suggested follow-up queries
   */
  static suggestFollowUps(query, retrievedContext = "") {
    const queryAnalysis = QueryReasoner.analyze(query);
    const followUps = [];

    if (queryAnalysis.entities.length > 1) {
      // Multi-entity: ask about relationships
      const [e1, e2] = queryAnalysis.entities;
      followUps.push(`How do ${e1} and ${e2} interact?`);
    }

    if (queryAnalysis.type === "comparison") {
      // Comparison: ask for trade-offs
      followUps.push(`What are the trade-offs?`);
      followUps.push(`Which is better for my use case?`);
    }

    if (queryAnalysis.type === "howto") {
      // How-to: ask for alternatives
      followUps.push(`What are alternative approaches?`);
      followUps.push(`Common mistakes to avoid?`);
    }

    if (queryAnalysis.type === "multihop") {
      // Multi-hop: decompose further
      for (const sq of queryAnalysis.subqueries.slice(1, 2)) {
        followUps.push(`Explain: ${sq}`);
      }
    }

    return followUps;
  }
}

module.exports = ReasoningAgent;
