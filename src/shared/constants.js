/**
 * ChatShelf — shared constants (loaded as classic script in content; also importable).
 */
(function (root) {
  const FREE_LIMITS = Object.freeze({
    maxFolders: 2,
    maxPrompts: 10,
  });

  const STORAGE_KEYS = Object.freeze({
    folders: "cs_folders",
    chats: "cs_chats",
    prompts: "cs_prompts",
    settings: "cs_settings",
    license: "cs_license",
  });

  const DEFAULT_SETTINGS = Object.freeze({
    theme: "auto",
    showFloatingButton: true,
    defaultFolderId: null,
  });

  /**
   * Gumroad Pro unlock config.
   * Before publishing: replace PRODUCT_ID with the id shown in the
   * "License key" block on your Gumroad product's Content tab, and
   * PRODUCT_URL with the public product page.
   * Verify API docs: https://gumroad.com/api#licenses (no auth needed).
   */
  const GUMROAD = Object.freeze({
    PRODUCT_ID: "REPLACE_WITH_GUMROAD_PRODUCT_ID",
    PRODUCT_URL: "https://REPLACE_ME.gumroad.com/l/chatshelf-pro",
    PROMPT_PACK_URL: "https://REPLACE_ME.gumroad.com/l/ai-power-prompts",
    VERIFY_URL: "https://api.gumroad.com/v2/licenses/verify",
    MAX_USES: 3, // browsers/devices allowed per key (counted on first activation)
    RECHECK_DAYS: 7, // silent re-check interval (increment_uses_count=false)
  });

  function isGumroadConfigured() {
    return !GUMROAD.PRODUCT_ID.startsWith("REPLACE_") && !GUMROAD.PRODUCT_URL.includes("REPLACE_ME");
  }

  const DEFAULT_LICENSE = Object.freeze({
    plan: "free", // "free" | "pro"
    licenseKey: null,
    validatedAt: null,
    expiresAt: null,
    email: null,
    uses: null,
  });

  const MSG = Object.freeze({
    GET_STATE: "CS_GET_STATE",
    SAVE_CHAT: "CS_SAVE_CHAT",
    CRUD_FOLDER: "CS_CRUD_FOLDER",
    CRUD_PROMPT: "CS_CRUD_PROMPT",
    INSERT_PROMPT: "CS_INSERT_PROMPT",
    EXPORT_DATA: "CS_EXPORT_DATA",
    IMPORT_DATA: "CS_IMPORT_DATA",
    CHECK_LIMIT: "CS_CHECK_LIMIT",
    OPEN_UPGRADE: "CS_OPEN_UPGRADE",
    VERIFY_LICENSE: "CS_VERIFY_LICENSE",
    DEACTIVATE_LICENSE: "CS_DEACTIVATE_LICENSE",
  });

  const ALT_NAMES = [
    "ChatShelf",
    "FolderAI Chat",
    "PromptNest",
  ];

  const api = {
    FREE_LIMITS,
    STORAGE_KEYS,
    DEFAULT_SETTINGS,
    DEFAULT_LICENSE,
    MSG,
    ALT_NAMES,
    GUMROAD,
    isGumroadConfigured,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ChatShelfConstants = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
