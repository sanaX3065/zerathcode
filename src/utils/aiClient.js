/**
 * src/utils/aiClient.js
 * ZerathCode — AI Client
 * Author: sanaX3065
 *
 * Shared multi-provider AI client used by any agent that needs LLM access.
 * Integrates with ApiKeyManager for automatic key rotation.
 *
 * Providers:
 *   claude  — Anthropic  (claude-sonnet-4-20250514)
 *   gemini  — Google     (gemini-2.0-flash)
 *   gpt     — OpenAI     (gpt-4o-mini)
 *
 * Usage:
 *   const ai = new AiClient(keyManager);
 *   const text = await ai.ask("claude", "Explain closures");
 *   const text = await ai.ask("gemini", "Review this code", { systemPrompt: "You are a code reviewer." });
 */

"use strict";

// Provider metadata
const PROVIDERS = {
  claude: {
    label: "Claude (Anthropic)",
    model: "claude-sonnet-4-20250514",
    endpoint: "https://api.anthropic.com/v1/messages",
  },
  gemini: {
    label:    "Gemini (Google)",
    model:    "gemini-2.0-flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",  // base — model appended dynamically
  },
  gpt: {
    label: "GPT (OpenAI)",
    model: "gpt-4o-mini",
    endpoint: "https://api.openai.com/v1/chat/completions",
  },
  openai: {
    label: "GPT (OpenAI)",
    model: "gpt-4o-mini",
    endpoint: "https://api.openai.com/v1/chat/completions",
  },
};

class AiClient {
  /**
   * @param {import('../core/apiKeyManager')} keyManager
   */
  constructor(keyManager) {
    this.keyManager = keyManager;
  }

  /**
   * Send a prompt to a provider with automatic key rotation.
   *
   * @param {string} provider   - "claude" | "gemini" | "gpt"
   * @param {string} prompt     - User prompt
   * @param {object} opts
   * @param {string} opts.systemPrompt  - Optional system/context message
   * @param {number} opts.maxTokens     - Max response tokens (default 1024)
   * @returns {Promise<string>}         - Response text
   */
  async ask(provider, prompt, opts = {}) {
    const p = provider.toLowerCase();
    if (!PROVIDERS[p]) {
      throw new Error(
        `Unknown AI provider: "${provider}". Available: ${Object.keys(PROVIDERS).join(", ")}`
      );
    }

    // Use keyManager's rotation wrapper
    return this.keyManager.callWithRotation(p, async (key) => {
      return this._dispatch(p, key, prompt, opts);
    });
  }

  /**
   * Dispatch to the correct provider implementation.
   * @private
   */
  async _dispatch(provider, key, prompt, opts) {
    switch (provider) {
      case "claude":  return this._callClaude(key, prompt, opts);
      case "gemini":  return this._callGemini(key, prompt, opts);
      case "gpt":
      case "openai":  return this._callGpt(key, prompt, opts);
      default:        throw new Error(`Unhandled provider: ${provider}`);
    }
  }

  // ── Claude ────────────────────────────────────────────────────────────────
  async _callClaude(key, prompt, opts) {
    const body = {
      model:      PROVIDERS.claude.model,
      max_tokens: opts.maxTokens || 1024,
      messages:   [{ role: "user", content: prompt }],
    };

    if (opts.systemPrompt) body.system = opts.systemPrompt;

    const res = await fetch(PROVIDERS.claude.endpoint, {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errData  = await res.json().catch(() => ({}));
      const err      = new Error(errData?.error?.message || res.statusText);
      err.status     = res.status;
      throw err;
    }

    const data = await res.json();
    return data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }

  // ── Gemini ────────────────────────────────────────────────────────────────
  async _callGemini(key, prompt, opts) {
    // Build endpoint dynamically: /v1beta/models/<model>:generateContent?key=<key>
    const model    = opts.model || PROVIDERS.gemini.model;
    const endpoint = `${PROVIDERS.gemini.endpoint}/${model}:generateContent?key=${key}`;

    // Gemini 2.x supports a dedicated system_instruction field
    const body = {
      contents:         [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: opts.maxTokens || 4096 },
    };

    if (opts.systemPrompt) {
      body.system_instruction = { parts: [{ text: opts.systemPrompt }] };
    }

    const res = await fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg     = errData?.error?.message || res.statusText;
      const err     = new Error(msg);
      err.status    = res.status;
      throw err;
    }

    const data = await res.json();
    return (
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("") || "(no response from Gemini)"
    );
  }

  // ── GPT ───────────────────────────────────────────────────────────────────
  async _callGpt(key, prompt, opts) {
    const messages = [];
    if (opts.systemPrompt) {
      messages.push({ role: "system", content: opts.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const res = await fetch(PROVIDERS.gpt.endpoint, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model:      PROVIDERS.gpt.model,
        max_tokens: opts.maxTokens || 1024,
        messages,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const err     = new Error(errData?.error?.message || res.statusText);
      err.status    = res.status;
      throw err;
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content || "(no response from GPT)";
  }

  /**
   * Returns a list of supported provider names.
   * @returns {string[]}
   */
  static providers() {
    return [...new Set(Object.keys(PROVIDERS))];
  }

  /**
   * Pretty label for display.
   * @param {string} provider
   * @returns {string}
   */
  static label(provider) {
    return PROVIDERS[provider.toLowerCase()]?.label || provider;
  }
}

module.exports = AiClient;
