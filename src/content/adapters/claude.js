/**
 * Claude.ai DOM adapter — marked PARTIAL; selectors change often.
 */
(function (root) {
  const SITE = "claude";

  function getConversationTitle() {
    const raw = (document.title || "").replace(/\s*[|–—-]\s*Claude.*$/i, "").trim();
    if (raw && !/^Claude$/i.test(raw)) return raw;

    const heading =
      document.querySelector('[data-testid="conversation-title"]') ||
      document.querySelector("main h1") ||
      document.querySelector('[class*="Conversation"] h1');
    if (heading) {
      const t = (heading.textContent || "").trim();
      if (t) return t.slice(0, 200);
    }
    return "Claude conversation";
  }

  function getConversationUrl() {
    return location.href.split("?")[0];
  }

  function findComposer() {
    const candidates = [
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"][aria-label*="Write"]',
      'div[contenteditable="true"][aria-label*="Message"]',
      'fieldset div[contenteditable="true"]',
      "main div[contenteditable=\"true\"]",
      "textarea",
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
      return true;
    }
    if (el.isContentEditable) {
      el.focus();
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
    if (!el) {
      return {
        ok: false,
        error: "Claude composer not found (partial support). Try focusing the input first.",
      };
    }
    const ok = setNativeValue(el, text);
    if (ok) el.focus();
    return ok ? { ok: true } : { ok: false, error: "Could not write into Claude composer." };
  }

  function isSupportedPage() {
    return location.hostname.includes("claude.ai");
  }

  root.ChatShelfAdapter = {
    site: SITE,
    supportLevel: "partial",
    getConversationTitle,
    getConversationUrl,
    insertPrompt,
    findComposer,
    isSupportedPage,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
