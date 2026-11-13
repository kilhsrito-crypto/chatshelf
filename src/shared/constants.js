/**
 * ChatShelf — shared constants (loaded as classic script in content; also importable).
 * Pro licenses are checked through our proxy. Never put a Creem API key in this file.
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

  /** Stable per-install id. Not part of backups. Not a hostname. */
  const INSTALL_ID_KEY = "cs_install_id";

  const DEFAULT_SETTINGS = Object.freeze({
    theme: "auto",
    showFloatingButton: true,
    defaultFolderId: null,
  });

  /**
   * Creem Pro unlock. The extension talks only to API_BASE.
   * The server-side proxy holds the merchant credential. Never put that credential here.
   * PROMPT_PACK_URL stays empty until a real pack page exists.
   */
  const LICENSE = Object.freeze({
    PRODUCT_ID: "prod_3FqFPPZL4T22ud6OFOyhgg",
    PRODUCT_URL: "https://www.creem.io/product/prod_3FqFPPZL4T22ud6OFOyhgg",
    PROMPT_PACK_URL: "",
    API_BASE: "https://chatshelf.naruhodoowl.me",
    ACTIVATE_PATH: "/api/licenses/activate",
    VALIDATE_PATH: "/api/licenses/validate",
    DEACTIVATE_PATH: "/api/licenses/deactivate",
    ACTIVATION_LIMIT: 3,
    RECHECK_DAYS: 7,
  });

  /** User-facing strings. Callers must show these, never an upstream body. */
  const LICENSE_ERRORS = Object.freeze({
    invalid_key: "This license key is not valid.",
    bad_request: "This license key is not valid.",
    activation_limit:
      "This key has reached its activation limit (3 browsers). Remove it from another browser and try again.",
    expired: "This license has expired.",
    revoked: "This license was revoked.",
    expired_or_revoked: "This license has expired or was revoked.",
    not_active: "This license is not active on this browser.",
    already_inactive: "This browser was already deactivated.",
    unavailable: "Couldn't reach the license server. Check your connection and try again.",
  });

  const DEFAULT_LICENSE = Object.freeze({
    plan: "free", // "free" | "pro"
    licenseKey: null,
    instanceId: null,
    validatedAt: null,
    expiresAt: null,
    status: null,
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

  function newInstallId(rng) {
    let raw = "";
    const cryptoObj = typeof crypto !== "undefined" ? crypto : null;
    if (typeof rng === "function") {
      raw = String(rng());
    } else if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
      raw = cryptoObj.randomUUID();
    } else {
      raw = Math.random().toString(16).slice(2) + Date.now().toString(16);
    }
    raw = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (raw.length < 8) raw = (raw + "00000000").slice(0, 8);
    return ("cs-" + raw).slice(0, 40);
  }

  function expiresInPast(expiresAt, now) {
    if (expiresAt == null || expiresAt === "") return false;
    const t = Date.parse(expiresAt);
    if (Number.isNaN(t)) return false;
    return t <= now;
  }

  function licenseFailure(code, definitive, instanceId) {
    return {
      ok: false,
      definitive: !!definitive,
      code,
      error: LICENSE_ERRORS[code] || LICENSE_ERRORS.unavailable,
      instanceId: instanceId || null,
    };
  }

  function instanceFrom(data) {
    const instance = data && data.instance;
    if (!instance || typeof instance !== "object" || Array.isArray(instance)) return null;
    if (typeof instance.id !== "string" || !instance.id.trim()) return null;
    return instance;
  }

  /**
   * Read a sanitized proxy success body. Does not look at free-form messages.
   * @returns {{ok:boolean, definitive?:boolean, code:string, error?:string, instanceId?:string|null}}
   */
  function interpretLicense(data, expectedProductId, nowMs) {
    const now = typeof nowMs === "number" ? nowMs : Date.now();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return licenseFailure("unavailable", false, null);
    }
    const instance = instanceFrom(data);
    const instanceId = instance ? instance.id.trim() : null;
    const productId = typeof data.product_id === "string" ? data.product_id.trim() : "";
    if (!productId || productId !== expectedProductId) {
      return licenseFailure("invalid_key", true, instanceId);
    }
    const status = typeof data.status === "string" ? data.status : "";
    if (status === "disabled") return licenseFailure("revoked", true, instanceId);
    if (status === "expired" || expiresInPast(data.expires_at, now)) {
      return licenseFailure("expired", true, instanceId);
    }
    if (status !== "active" || !instanceId || (instance && instance.status === "deactivated")) {
      return licenseFailure("not_active", true, instanceId);
    }
    return {
      ok: true,
      definitive: true,
      code: "active",
      instanceId,
      instanceName: typeof instance.name === "string" ? instance.name : null,
      expiresAt: typeof data.expires_at === "string" ? data.expires_at : null,
      activation: typeof data.activation === "number" ? data.activation : null,
      activationLimit: typeof data.activation_limit === "number" ? data.activation_limit : null,
      status: "active",
    };
  }

  /**
   * Map a non-2xx proxy response. Ignores body.message so upstream text never reaches the UI.
   */
  function mapLicenseHttpFailure(status, body) {
    const http = Number(status) || 0;
    if (http === 0 || http === 401 || http === 408 || http === 429 || http >= 500) {
      return licenseFailure("unavailable", false, null);
    }
    const code =
      body && typeof body === "object" && !Array.isArray(body) && typeof body.error === "string"
        ? body.error
        : "";
    if (Object.prototype.hasOwnProperty.call(LICENSE_ERRORS, code) && code !== "unavailable") {
      return licenseFailure(code, true, null);
    }
    if (http === 403) return licenseFailure("activation_limit", true, null);
    if (http === 410) return licenseFailure("expired_or_revoked", true, null);
    if (http === 404) return licenseFailure("invalid_key", true, null);
    if (http === 409) return licenseFailure("not_active", true, null);
    if (http === 400 || http === 413 || http === 415) return licenseFailure("bad_request", true, null);
    return licenseFailure("unavailable", false, null);
  }

  const api = {
    FREE_LIMITS,
    STORAGE_KEYS,
    INSTALL_ID_KEY,
    DEFAULT_SETTINGS,
    DEFAULT_LICENSE,
    MSG,
    ALT_NAMES,
    LICENSE,
    LICENSE_ERRORS,
    newInstallId,
    interpretLicense,
    mapLicenseHttpFailure,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ChatShelfConstants = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
