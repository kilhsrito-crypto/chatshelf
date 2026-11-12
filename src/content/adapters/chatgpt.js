/**
 * ChatGPT.com / chat.openai.com DOM adapter.
 * Selectors are fragile — keep all site-specific queries here.
 */
(function (root) {
  const SITE = "chatgpt";

  function getConversationTitle() {
    // Prefer document title "Foo | ChatGPT"
    const raw = (document.title || "").replace(/\s*[|–—-]\s*ChatGPT.*$/i, "").trim();
    if (raw && !/^ChatGPT$/i.test(raw)) return raw;

    // Sidebar active conversation link
    const active =
      document.querySelector('a[href*="/c/"][aria-current="page"]') ||
      document.querySelector('nav a[data-testid*="conversation"]') ||
      document.querySelector('aside a[href*="/c/"].bg-token-sidebar-surface-secondary');
    if (active) {
      const t = (active.textContent || "").trim();
      if (t) return t.slice(0, 200);
    }
    return "ChatGPT conversation";
  }

  function getConversationUrl() {
    return location.href.split("?")[0];
  }

  function findComposer() {
    // ProseMirror / contenteditable composer (2024–2026 layouts)
    const candidates = [
      "#prompt-textarea",
      'div[contenteditable="true"]#prompt-textarea',
      'div[contenteditable="true"][data-testid="prompt-textarea"]',
      'textarea[name="prompt-textarea"]',
      'form textarea',
      'main div[contenteditable="true"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function setNativeValue(el, value) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    if (el.isContentEditable) {
      el.focus();
      // Prefer execCommand for ProseMirror compatibility when available
      try {
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, value);
      } catch (_) {
        el.textContent = value;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
      return true;
    }
    return false;
  }

  function insertPrompt(text) {
    const el = findComposer();
    if (!el) return { ok: false, error: "Composer not found — ChatGPT DOM may have changed." };
    const ok = setNativeValue(el, text);
    if (ok) el.focus();
    return ok
      ? { ok: true }
      : { ok: false, error: "Could not write into composer." };
  }

  function isSupportedPage() {
    return /chatgpt\.com|chat\.openai\.com/.test(location.hostname);
  }

  root.ChatShelfAdapter = {
    site: SITE,
    supportLevel: "full",
    getConversationTitle,
    getConversationUrl,
    insertPrompt,
    findComposer,
    isSupportedPage,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
