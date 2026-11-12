/**
 * ChatShelf — chrome.storage.local helpers + free-tier limit checks.
 * License: isPro() reads cs_license; validateLicense() asks the service worker
 * to call Gumroad's public license verify API.
 */
(function (root) {
  const C = root.ChatShelfConstants;
  if (!C) throw new Error("ChatShelfConstants missing — load constants.js first");

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async function getAll() {
    const keys = Object.values(C.STORAGE_KEYS);
    const data = await chrome.storage.local.get(keys);
    return {
      folders: data[C.STORAGE_KEYS.folders] || [],
      chats: data[C.STORAGE_KEYS.chats] || [],
      prompts: data[C.STORAGE_KEYS.prompts] || [],
      settings: { ...C.DEFAULT_SETTINGS, ...(data[C.STORAGE_KEYS.settings] || {}) },
      license: { ...C.DEFAULT_LICENSE, ...(data[C.STORAGE_KEYS.license] || {}) },
    };
  }

  async function setPartial(partial) {
    await chrome.storage.local.set(partial);
  }

  function isPro(license) {
    return license && license.plan === "pro" && !!license.licenseKey;
  }

  /**
   * Verify a Gumroad license key via the service worker (which has
   * host permission for api.gumroad.com, so no CORS issue).
   * @param {string} key
   * @returns {Promise<{ok:boolean, plan?:string, error?:string}>}
   */
  function validateLicense(key) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: C.MSG.VERIFY_LICENSE, licenseKey: key }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { ok: false, error: "No response from background." });
          }
        });
      } catch (err) {
        resolve({ ok: false, error: String(err && err.message || err) });
      }
    });
  }

  async function deactivateLicense() {
    await setPartial({ [C.STORAGE_KEYS.license]: { ...C.DEFAULT_LICENSE } });
    return { ok: true };
  }

  async function setLicense(license) {
    await setPartial({ [C.STORAGE_KEYS.license]: { ...C.DEFAULT_LICENSE, ...license } });
  }

  async function ensureSeed() {
    const state = await getAll();
    if (state.folders.length === 0) {
      const inbox = {
        id: uid("fld"),
        name: "Inbox",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      state.folders = [inbox];
      await setPartial({ [C.STORAGE_KEYS.folders]: state.folders });
    }
    return getAll();
  }

  function canAddFolder(state) {
    if (isPro(state.license)) return { allowed: true };
    if (state.folders.length >= C.FREE_LIMITS.maxFolders) {
      return {
        allowed: false,
        reason: `Free plan allows ${C.FREE_LIMITS.maxFolders} folders. Upgrade for unlimited.`,
      };
    }
    return { allowed: true };
  }

  function canAddPrompt(state) {
    if (isPro(state.license)) return { allowed: true };
    if (state.prompts.length >= C.FREE_LIMITS.maxPrompts) {
      return {
        allowed: false,
        reason: `Free plan allows ${C.FREE_LIMITS.maxPrompts} prompts. Upgrade for unlimited.`,
      };
    }
    return { allowed: true };
  }

  // --- Folders CRUD ---
  async function createFolder(name) {
    const state = await ensureSeed();
    const gate = canAddFolder(state);
    if (!gate.allowed) return { ok: false, upgrade: true, error: gate.reason };
    const folder = {
      id: uid("fld"),
      name: (name || "New folder").trim().slice(0, 80),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const folders = [...state.folders, folder];
    await setPartial({ [C.STORAGE_KEYS.folders]: folders });
    return { ok: true, folder, folders };
  }

  async function renameFolder(id, name) {
    const state = await getAll();
    const folders = state.folders.map((f) =>
      f.id === id ? { ...f, name: name.trim().slice(0, 80), updatedAt: Date.now() } : f
    );
    await setPartial({ [C.STORAGE_KEYS.folders]: folders });
    return { ok: true, folders };
  }

  async function deleteFolder(id) {
    const state = await getAll();
    if (state.folders.length <= 1) {
      return { ok: false, error: "Keep at least one folder." };
    }
    const folders = state.folders.filter((f) => f.id !== id);
    const fallback = folders[0].id;
    const chats = state.chats.map((c) =>
      c.folderId === id ? { ...c, folderId: fallback } : c
    );
    const settings = { ...state.settings };
    if (settings.defaultFolderId === id) settings.defaultFolderId = fallback;
    await setPartial({
      [C.STORAGE_KEYS.folders]: folders,
      [C.STORAGE_KEYS.chats]: chats,
      [C.STORAGE_KEYS.settings]: settings,
    });
    return { ok: true, folders, chats };
  }

  // --- Chats ---
  async function saveChat({ title, url, site, folderId, note }) {
    const state = await ensureSeed();
    const fid = folderId || state.settings.defaultFolderId || state.folders[0]?.id;
    if (!fid) return { ok: false, error: "No folder available." };

    // Upsert by URL when possible
    const existing = state.chats.find((c) => c.url === url);
    let chats;
    if (existing) {
      chats = state.chats.map((c) =>
        c.id === existing.id
          ? {
              ...c,
              title: title || c.title,
              folderId: fid,
              note: note != null ? note : c.note,
              updatedAt: Date.now(),
            }
          : c
      );
    } else {
      const chat = {
        id: uid("cht"),
        title: (title || "Untitled chat").slice(0, 200),
        url: url || "",
        site: site || "unknown",
        folderId: fid,
        note: note || "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      chats = [chat, ...state.chats];
    }
    await setPartial({ [C.STORAGE_KEYS.chats]: chats });
    return { ok: true, chats };
  }

  async function moveChat(chatId, folderId) {
    const state = await getAll();
    const chats = state.chats.map((c) =>
      c.id === chatId ? { ...c, folderId, updatedAt: Date.now() } : c
    );
    await setPartial({ [C.STORAGE_KEYS.chats]: chats });
    return { ok: true, chats };
  }

  async function deleteChat(chatId) {
    const state = await getAll();
    const chats = state.chats.filter((c) => c.id !== chatId);
    await setPartial({ [C.STORAGE_KEYS.chats]: chats });
    return { ok: true, chats };
  }

  // --- Prompts ---
  async function createPrompt({ title, body, tags }) {
    const state = await getAll();
    const gate = canAddPrompt(state);
    if (!gate.allowed) return { ok: false, upgrade: true, error: gate.reason };
    const prompt = {
      id: uid("prm"),
      title: (title || "Untitled").trim().slice(0, 100),
      body: (body || "").slice(0, 20000),
      tags: Array.isArray(tags) ? tags.slice(0, 10) : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const prompts = [prompt, ...state.prompts];
    await setPartial({ [C.STORAGE_KEYS.prompts]: prompts });
    return { ok: true, prompt, prompts };
  }

  async function updatePrompt(id, patch) {
    const state = await getAll();
    const prompts = state.prompts.map((p) =>
      p.id === id
        ? {
            ...p,
            ...patch,
            title: patch.title != null ? String(patch.title).slice(0, 100) : p.title,
            body: patch.body != null ? String(patch.body).slice(0, 20000) : p.body,
            updatedAt: Date.now(),
          }
        : p
    );
    await setPartial({ [C.STORAGE_KEYS.prompts]: prompts });
    return { ok: true, prompts };
  }

  async function deletePrompt(id) {
    const state = await getAll();
    const prompts = state.prompts.filter((p) => p.id !== id);
    await setPartial({ [C.STORAGE_KEYS.prompts]: prompts });
    return { ok: true, prompts };
  }

  // --- Backup ---
  async function exportJson() {
    const state = await getAll();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      folders: state.folders,
      chats: state.chats,
      prompts: state.prompts,
      settings: state.settings,
      // license intentionally omitted from export for safety
    };
  }

  /**
   * Merge a prompt pack ({ type: "prompt-pack", prompts: [...] }) into the
   * existing library without touching folders/chats. Dedupes by title+body.
   */
  async function importPromptPack(payload) {
    const state = await getAll();
    const incoming = Array.isArray(payload.prompts) ? payload.prompts : [];
    const seen = new Set(state.prompts.map((p) => `${p.title}\u0000${p.body}`));
    const fresh = [];
    for (const p of incoming) {
      if (!p || !p.body) continue;
      const sig = `${p.title}\u0000${p.body}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      fresh.push({
        id: uid("prm"),
        title: String(p.title || "Untitled").slice(0, 100),
        body: String(p.body).slice(0, 20000),
        tags: Array.isArray(p.tags) ? p.tags.slice(0, 10).map(String) : [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    let toAdd = fresh;
    let truncated = false;
    if (!isPro(state.license)) {
      const room = Math.max(0, C.FREE_LIMITS.maxPrompts - state.prompts.length);
      truncated = fresh.length > room;
      toAdd = fresh.slice(0, room);
    }
    await setPartial({ [C.STORAGE_KEYS.prompts]: [...state.prompts, ...toAdd] });
    return { ok: true, added: toAdd.length, skipped: fresh.length - toAdd.length, truncated };
  }

  async function importJson(payload) {
    if (payload && payload.type === "prompt-pack") return importPromptPack(payload);
    if (!payload || payload.version !== 1) {
      return { ok: false, error: "Unsupported backup format." };
    }
    const folders = Array.isArray(payload.folders) ? payload.folders : [];
    const chats = Array.isArray(payload.chats) ? payload.chats : [];
    const prompts = Array.isArray(payload.prompts) ? payload.prompts : [];
    const settings = { ...C.DEFAULT_SETTINGS, ...(payload.settings || {}) };

    // Enforce free limits on import unless pro
    const state = await getAll();
    let nextFolders = folders;
    let nextPrompts = prompts;
    if (!isPro(state.license)) {
      nextFolders = folders.slice(0, C.FREE_LIMITS.maxFolders);
      nextPrompts = prompts.slice(0, C.FREE_LIMITS.maxPrompts);
    }
    if (nextFolders.length === 0) {
      nextFolders = [
        { id: uid("fld"), name: "Inbox", createdAt: Date.now(), updatedAt: Date.now() },
      ];
    }
    await setPartial({
      [C.STORAGE_KEYS.folders]: nextFolders,
      [C.STORAGE_KEYS.chats]: chats,
      [C.STORAGE_KEYS.prompts]: nextPrompts,
      [C.STORAGE_KEYS.settings]: settings,
    });
    return {
      ok: true,
      truncated: !isPro(state.license) &&
        (folders.length > C.FREE_LIMITS.maxFolders || prompts.length > C.FREE_LIMITS.maxPrompts),
    };
  }

  async function updateSettings(patch) {
    const state = await getAll();
    const settings = { ...state.settings, ...patch };
    await setPartial({ [C.STORAGE_KEYS.settings]: settings });
    return { ok: true, settings };
  }

  const api = {
    uid,
    getAll,
    ensureSeed,
    isPro,
    canAddFolder,
    canAddPrompt,
    createFolder,
    renameFolder,
    deleteFolder,
    saveChat,
    moveChat,
    deleteChat,
    createPrompt,
    updatePrompt,
    deletePrompt,
    exportJson,
    importJson,
    updateSettings,
    validateLicense,
    deactivateLicense,
    setLicense,
    importPromptPack,
  };

  root.ChatShelfStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
