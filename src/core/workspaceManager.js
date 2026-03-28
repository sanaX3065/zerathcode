/**
 * src/core/workspaceManager.js
 * ZerathCode — Workspace Manager
 * Author: sanaX3065
 *
 * Owns ~/hex-workspace/ — the single root for ALL projects.
 * Every fullstack / mobile project lives in its own sandboxed folder here.
 *
 * Global index: ~/hex-workspace/.index.json
 * Per-project:  ~/hex-workspace/<name>/.zerathcode/memory.json
 *               ~/hex-workspace/<name>/README.md
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const WORKSPACE_ROOT  = path.join(os.homedir(), "hex-workspace");
const WORKSPACE_INDEX = path.join(WORKSPACE_ROOT, ".index.json");

class WorkspaceManager {
  constructor() {
    this._ensureRoot();
  }

  // ── Root path ─────────────────────────────────────────────────────────────
  get root() { return WORKSPACE_ROOT; }

  // ── Create a new project dir ──────────────────────────────────────────────
  /**
   * Creates ~/hex-workspace/<name>/ and registers it in the index.
   * @param {string} name  - Project folder name (slugified)
   * @param {object} meta  - { type, stack, description, provider }
   * @returns {string}     - Absolute project path
   */
  createProject(name, meta = {}) {
    const slug    = this._slug(name);
    const projDir = path.join(WORKSPACE_ROOT, slug);

    if (fs.existsSync(projDir)) {
      throw new Error(`Project "${slug}" already exists at ${projDir}`);
    }

    // Create the directory
    fs.mkdirSync(projDir, { recursive: true });

    // Register in index
    const index = this._loadIndex();
    index[slug] = {
      name:        name,
      slug:        slug,
      type:        meta.type        || "fullstack",
      stack:       meta.stack       || "",
      description: meta.description || "",
      provider:    meta.provider    || "",
      path:        projDir,
      created:     new Date().toISOString(),
      updated:     new Date().toISOString(),
      status:      "created",    // created | active | paused
    };
    this._saveIndex(index);

    return projDir;
  }

  // ── List all projects ─────────────────────────────────────────────────────
  /**
   * Returns array of project entries from the index.
   * @param {"fullstack"|"mobiledev"|null} filterType
   * @returns {Array<object>}
   */
  listProjects(filterType = null) {
    const index    = this._loadIndex();
    let   projects = Object.values(index);

    if (filterType) {
      projects = projects.filter((p) => p.type === filterType);
    }

    // Filter out entries whose directories no longer exist
    projects = projects.filter((p) => fs.existsSync(p.path));

    // Sort by updated desc
    return projects.sort((a, b) =>
      new Date(b.updated) - new Date(a.updated)
    );
  }

  // ── Get a project by slug ─────────────────────────────────────────────────
  getProject(slug) {
    const index = this._loadIndex();
    return index[this._slug(slug)] || null;
  }

  // ── Mark project as updated ───────────────────────────────────────────────
  touchProject(slug, updates = {}) {
    const index = this._loadIndex();
    const s     = this._slug(slug);
    if (index[s]) {
      Object.assign(index[s], updates, { updated: new Date().toISOString() });
      this._saveIndex(index);
    }
  }

  // ── Delete project ────────────────────────────────────────────────────────
  deleteProject(slug) {
    const index = this._loadIndex();
    const s     = this._slug(slug);
    if (index[s]) {
      delete index[s];
      this._saveIndex(index);
    }
  }

  // ── Safe slug ─────────────────────────────────────────────────────────────
  _slug(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
  }

  // ── Ensure workspace root exists ──────────────────────────────────────────
  _ensureRoot() {
    if (!fs.existsSync(WORKSPACE_ROOT)) {
      fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
    }
  }

  // ── Index I/O ─────────────────────────────────────────────────────────────
  _loadIndex() {
    try {
      if (fs.existsSync(WORKSPACE_INDEX)) {
        return JSON.parse(fs.readFileSync(WORKSPACE_INDEX, "utf8"));
      }
    } catch {}
    return {};
  }

  _saveIndex(index) {
    fs.writeFileSync(WORKSPACE_INDEX, JSON.stringify(index, null, 2), "utf8");
  }
}

module.exports = WorkspaceManager;
