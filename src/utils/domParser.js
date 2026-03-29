/**
 * src/utils/domParser.js
 * ZerathCode — DOM Parser
 * Author: ZerathCode Team
 *
 * Proper HTML parsing with structure preservation.
 * Extracts readable content while maintaining headings, lists, and tables.
 * Uses htmlparser2 for Termux compatibility and performance.
 */

"use strict";

const { parseDocument, DomHandler } = require("htmlparser2");

class DomParser {
  /**
   * Parse HTML into readable text while preserving structure.
   *
   * @param {string} html
   * @param {{preserveTables?: boolean, preserveLists?: boolean}} opts
   * @returns {string}
   */
  static extractText(html, opts = {}) {
    const preserveTables = opts.preserveTables !== false;
    const preserveLists = opts.preserveLists !== false;

    try {
      const doc = parseDocument(html);
      return DomParser._walkNode(doc, {
        preserveTables,
        preserveLists,
      }).trim();
    } catch (err) {
      // Fallback to regex extraction if parsing fails
      return DomParser._extractTextFallback(html);
    }
  }

  /**
   * Extract structured content with semantic markers.
   * Returns text with inline tags like [HEADING1], [LIST], etc.
   *
   * @param {string} html
   * @returns {string}
   */
  static extractStructured(html) {
    try {
      const doc = parseDocument(html);
      return DomParser._walkNodeStructured(doc).trim();
    } catch (err) {
      return DomParser._extractTextFallback(html);
    }
  }

  /**
   * Extract main content block (removes header, footer, nav, sidebars).
   * Useful for focusing on article/body content.
   *
   * @param {string} html
   * @returns {string}
   */
  static extractMainContent(html) {
    try {
      const doc = parseDocument(html);

      // Find main content block
      let main = DomParser._findElement(doc, (n) => {
        const tag = n.name?.toLowerCase();
        if (tag === "main") return true;
        if (tag === "article") return true;
        if (tag === "div" && n.attribs?.class?.includes("content")) return true;
        if (tag === "div" && n.attribs?.id?.includes("content")) return true;
        return false;
      });

      if (!main) {
        // Fallback: use body
        main = DomParser._findElement(doc, (n) => n.name?.toLowerCase() === "body");
      }

      if (!main) return DomParser._extractTextFallback(html);

      return DomParser._walkNode(main, {
        preserveTables: true,
        preserveLists: true,
      }).trim();
    } catch (err) {
      return DomParser._extractTextFallback(html);
    }
  }

  /**
   * Walk DOM tree and extract text with structure preservation.
   * @private
   */
  static _walkNode(node, opts, depth = 0) {
    if (!node) return "";

    const { preserveTables, preserveLists } = opts;

    // Text nodes
    if (node.type === "text") {
      return String(node.data || "").replace(/\s+/g, " ");
    }

    // Skip certain tags
    if (node.type === "tag") {
      const tag = node.name?.toLowerCase();

      // Remove script, style, noscript
      if (["script", "style", "noscript", "iframe", "meta", "link"].includes(tag)) {
        return "";
      }

      // Skip navigation, footer, etc.
      if (["nav", "header", "footer", "aside", "svg"].includes(tag)) {
        return "";
      }

      // Banner, advertisement content
      if (
        node.attribs?.class?.includes("ad") ||
        node.attribs?.id?.includes("ad") ||
        node.attribs?.class?.includes("banner")
      ) {
        return "";
      }

      // Headings
      if (tag === "h1" || tag === "h2" || tag === "h3") {
        const text = DomParser._walkNode(node, opts, depth + 1);
        const prefix = tag === "h1" ? "# " : tag === "h2" ? "## " : "### ";
        return text ? `\n${prefix}${text}\n` : "";
      }

      // Headings h4-h6
      if (tag === "h4" || tag === "h5" || tag === "h6") {
        const text = DomParser._walkNode(node, opts, depth + 1);
        return text ? `\n${text}\n` : "";
      }

      // Paragraphs
      if (tag === "p" || tag === "div") {
        const text = DomParser._walkNode(node, opts, depth + 1);
        return text ? `${text}\n` : "";
      }

      // Lists
      if (preserveLists && (tag === "ul" || tag === "ol")) {
        return DomParser._walkList(node, tag === "ol", opts, depth + 1);
      }

      // List items
      if (tag === "li") {
        const text = DomParser._walkNode(node, opts, depth + 1);
        return text ? `- ${text}\n` : "";
      }

      // Tables
      if (preserveTables && tag === "table") {
        return DomParser._walkTable(node, opts, depth + 1);
      }

      // Code blocks
      if (tag === "code" || tag === "pre") {
        const text = DomParser._walkNode(node, opts, depth + 1);
        return text ? `\`${text}\`\n` : "";
      }

      // Strong, bold
      if (tag === "strong" || tag === "b") {
        const text = DomParser._walkNode(node, opts, depth + 1);
        return text ? `**${text}**` : "";
      }

      // Emphasis, italic
      if (tag === "em" || tag === "i") {
        const text = DomParser._walkNode(node, opts, depth + 1);
        return text ? `*${text}*` : "";
      }

      // Links (keep URL)
      if (tag === "a") {
        const text = DomParser._walkNode(node, opts, depth + 1);
        const href = node.attribs?.href || "";
        return text ? `${text} (${href})` : "";
      }

      // Images
      if (tag === "img") {
        const alt = node.attribs?.alt || "";
        const title = node.attribs?.title || "";
        return alt || title ? `[Image: ${alt || title}]` : "";
      }

      // For other tags, just walk children
      if (node.children) {
        return node.children.map((c) => DomParser._walkNode(c, opts, depth + 1)).join("");
      }
    }

    return "";
  }

  /**
   * Walk list (ul/ol) and extract items.
   * @private
   */
  static _walkList(node, isOrdered, opts, depth) {
    if (!node.children) return "";

    const items = node.children
      .filter((n) => n.type === "tag" && n.name?.toLowerCase() === "li")
      .map((li, idx) => {
        const text = DomParser._walkNode(li, opts, depth + 1);
        return text ? `- ${text.replace(/^- /, "")}` : "";
      })
      .filter(Boolean);

    return items.length ? `\n${items.join("\n")}\n` : "";
  }

  /**
   * Walk table and extract rows.
   * @private
   */
  static _walkTable(node, opts, depth) {
    if (!node.children) return "";

    const rows = [];
    for (const child of node.children) {
      if (child.type !== "tag") continue;

      const tag = child.name?.toLowerCase();
      if (tag === "thead" || tag === "tbody" || tag === "tfoot") {
        // Walk tr inside
        if (child.children) {
          for (const tr of child.children) {
            if (tr.type === "tag" && tr.name?.toLowerCase() === "tr") {
              const row = DomParser._walkTableRow(tr, opts, depth + 1);
              if (row) rows.push(row);
            }
          }
        }
      } else if (tag === "tr") {
        const row = DomParser._walkTableRow(child, opts, depth + 1);
        if (row) rows.push(row);
      }
    }

    return rows.length ? `\n${rows.join("\n")}\n` : "";
  }

  /**
   * Walk table row (tr) and extract cells.
   * @private
   */
  static _walkTableRow(tr, opts, depth) {
    if (!tr.children) return "";

    const cells = [];
    for (const cell of tr.children) {
      if (cell.type !== "tag") continue;
      const tag = cell.name?.toLowerCase();
      if (tag === "td" || tag === "th") {
        const text = DomParser._walkNode(cell, opts, depth + 1);
        cells.push(text || "");
      }
    }

    return cells.length ? `| ${cells.join(" | ")} |` : "";
  }

  /**
   * Walk DOM with structural markup (for analysis).
   * @private
   */
  static _walkNodeStructured(node, depth = 0) {
    if (!node) return "";

    if (node.type === "text") {
      return String(node.data || "").replace(/\s+/g, " ");
    }

    if (node.type === "tag") {
      const tag = node.name?.toLowerCase();

      if (["script", "style", "noscript", "meta", "link"].includes(tag)) {
        return "";
      }

      if (TAG === "h1" || tag === "h2" || tag === "h3") {
        const text = DomParser._walkNodeStructured(node, depth + 1);
        return text ? `[HEADING${tag[1]}]${text}[/HEADING${tag[1]}]` : "";
      }

      if (tag === "p") {
        const text = DomParser._walkNodeStructured(node, depth + 1);
        return text ? `[P]${text}[/P]` : "";
      }

      if (tag === "ul" || tag === "ol") {
        const text = DomParser._walkNodeStructured(node, depth + 1);
        return text ? `[LIST]${text}[/LIST]` : "";
      }

      if (tag === "li") {
        const text = DomParser._walkNodeStructured(node, depth + 1);
        return text ? `- ${text}\n` : "";
      }

      if (tag === "table") {
        const text = DomParser._walkNodeStructured(node, depth + 1);
        return text ? `[TABLE]${text}[/TABLE]` : "";
      }

      if (node.children) {
        return node.children.map((c) => DomParser._walkNodeStructured(c, depth + 1)).join("");
      }
    }

    return "";
  }

  /**
   * Find element matching predicate.
   * @private
   */
  static _findElement(node, predicate) {
    if (!node) return null;
    if (predicate(node)) return node;

    if (node.children) {
      for (const child of node.children) {
        const result = DomParser._findElement(child, predicate);
        if (result) return result;
      }
    }

    return null;
  }

  /**
   * Fallback regex-based extraction (used if DOM parsing fails).
   * @private
   */
  static _extractTextFallback(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
}

module.exports = DomParser;
