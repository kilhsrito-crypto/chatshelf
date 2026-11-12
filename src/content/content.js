/**
 * ChatShelf floating panel injected on ChatGPT / Claude pages.
 */
(function () {
  const Storage = globalThis.ChatShelfStorage;
  const Adapter = globalThis.ChatShelfAdapter;
  const C = globalThis.ChatShelfConstants;
  if (!Storage || !Adapter || !C) {
    console.warn("[ChatShelf] missing deps");
    return;
  }

  const ROOT_ID = "chatshelf-root";
  let panelOpen = false;
  let stateCache = null;

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function refreshState() {
    stateCache = await Storage.ensureSeed();
    return stateCache;
  }

  function mount() {
    if (document.getElementById(ROOT_ID)) return;
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <button type="button" class="cs-fab" id="cs-fab" title="ChatShelf" aria-label="Open ChatShelf">
        <span class="cs-fab-icon">📁</span>
      </button>
      <div class="cs-panel" id="cs-panel" hidden>
        <header class="cs-panel-header">
          <div>
            <strong>ChatShelf</strong>
            <span class="cs-badge" id="cs-site-badge">${esc(Adapter.site)}${
              Adapter.supportLevel === "partial" ? " · partial" : ""
            }</span>
          </div>
          <button type="button" class="cs-icon-btn" id="cs-close" aria-label="Close">✕</button>
        </header>
        <nav class="cs-tabs">
          <button type="button" class="cs-tab active" data-tab="save">Save chat</button>
          <button type="button" class="cs-tab" data-tab="folders">Folders</button>
          <button type="button" class="cs-tab" data-tab="prompts">Prompts</button>
        </nav>
        <div class="cs-body" id="cs-body"></div>
        <footer class="cs-panel-footer">
          <button type="button" class="cs-link" id="cs-open-options">Settings</button>
          <button type="button" class="cs-upgrade-btn" id="cs-upgrade" hidden>Upgrade</button>
        </footer>
      </div>
    `;
    document.documentElement.appendChild(root);

    root.querySelector("#cs-fab").addEventListener("click", () => togglePanel(true));
    root.querySelector("#cs-close").addEventListener("click", () => togglePanel(false));
    root.querySelector("#cs-open-options").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: C.MSG.OPEN_UPGRADE, action: "options" });
    });
    root.querySelector("#cs-upgrade").addEventListener("click", onUpgradeClick);
    root.querySelectorAll(".cs-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        root.querySelectorAll(".cs-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderTab(btn.dataset.tab);
      });
    });
  }

  function togglePanel(open) {
    panelOpen = open !== undefined ? open : !panelOpen;
    const panel = document.getElementById("cs-panel");
    if (!panel) return;
    panel.hidden = !panelOpen;
    if (panelOpen) {
      refreshState().then(() => {
        const active = document.querySelector(".cs-tab.active");
        renderTab(active ? active.dataset.tab : "save");
      });
    }
  }

  function showUpgrade(show, reason) {
    const btn = document.getElementById("cs-upgrade");
    if (!btn) return;
    btn.hidden = !show;
    if (reason) btn.title = reason;
  }

  function onUpgradeClick() {
    const toast = document.createElement("div");
    toast.className = "cs-toast";
    toast.textContent =
      "Opening ChatShelf Pro on Gumroad. After purchase, paste your license key in Settings.";
    document.getElementById(ROOT_ID)?.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
    chrome.runtime.sendMessage({ type: C.MSG.OPEN_UPGRADE, action: "buy" });
  }

  async function renderTab(tab) {
    const body = document.getElementById("cs-body");
    if (!body) return;
    await refreshState();
    const pro = Storage.isPro(stateCache.license);
    showUpgrade(!pro, "");

    if (tab === "save") renderSave(body);
    else if (tab === "folders") renderFolders(body);
    else if (tab === "prompts") renderPrompts(body);
  }

  function renderSave(body) {
    const title = Adapter.getConversationTitle();
    const url = Adapter.getConversationUrl();
    const folders = stateCache.folders;
    const options = folders
      .map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`)
      .join("");

    body.innerHTML = `
      <label class="cs-label">Title</label>
      <input class="cs-input" id="cs-chat-title" value="${esc(title)}" />
      <label class="cs-label">Folder</label>
      <select class="cs-input" id="cs-chat-folder">${options}</select>
      <label class="cs-label">Note (optional)</label>
      <input class="cs-input" id="cs-chat-note" placeholder="Why you saved this…" />
      <p class="cs-muted cs-url">${esc(url)}</p>
      <button type="button" class="cs-primary" id="cs-save-chat">Save to folder</button>
      <div class="cs-msg" id="cs-save-msg"></div>
      <hr class="cs-hr" />
      <h4 class="cs-subhead">Saved on this site</h4>
      <ul class="cs-list" id="cs-chat-list"></ul>
    `;

    body.querySelector("#cs-save-chat").addEventListener("click", async () => {
      const res = await Storage.saveChat({
        title: body.querySelector("#cs-chat-title").value,
        url,
        site: Adapter.site,
        folderId: body.querySelector("#cs-chat-folder").value,
        note: body.querySelector("#cs-chat-note").value,
      });
      const msg = body.querySelector("#cs-save-msg");
      if (res.ok) {
        msg.textContent = "Saved.";
        msg.className = "cs-msg ok";
        await refreshState();
        fillChatList(body.querySelector("#cs-chat-list"));
      } else {
        msg.textContent = res.error || "Failed";
        msg.className = "cs-msg err";
      }
    });

    fillChatList(body.querySelector("#cs-chat-list"));
  }

  function fillChatList(ul) {
    if (!ul) return;
    const siteChats = stateCache.chats.filter((c) => c.site === Adapter.site).slice(0, 20);
    if (!siteChats.length) {
      ul.innerHTML = `<li class="cs-muted">No saved chats yet.</li>`;
      return;
    }
    const folderName = (id) => stateCache.folders.find((f) => f.id === id)?.name || "?";
    ul.innerHTML = siteChats
      .map(
        (c) => `
      <li class="cs-list-item">
        <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a>
        <span class="cs-muted">${esc(folderName(c.folderId))}</span>
        <button type="button" class="cs-icon-btn" data-del="${esc(c.id)}" title="Remove">🗑</button>
      </li>`
      )
      .join("");
    ul.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await Storage.deleteChat(btn.getAttribute("data-del"));
        await refreshState();
        fillChatList(ul);
      });
    });
  }

  function renderFolders(body) {
    const gate = Storage.canAddFolder(stateCache);
    body.innerHTML = `
      <div class="cs-row">
        <input class="cs-input" id="cs-new-folder" placeholder="New folder name" ${
          gate.allowed ? "" : "disabled"
        } />
        <button type="button" class="cs-primary" id="cs-add-folder" ${
          gate.allowed ? "" : "disabled"
        }>Add</button>
      </div>
      ${
        gate.allowed
          ? ""
          : `<div class="cs-upgrade-banner">${esc(gate.reason)} <button type="button" class="cs-upgrade-btn cs-inline-upg">Upgrade</button></div>`
      }
      <ul class="cs-list" id="cs-folder-list"></ul>
    `;
    body.querySelector("#cs-add-folder")?.addEventListener("click", async () => {
      const name = body.querySelector("#cs-new-folder").value;
      const res = await Storage.createFolder(name);
      if (res.upgrade) {
        showUpgrade(true, res.error);
        onUpgradeClick();
        return;
      }
      if (!res.ok) return alert(res.error);
      await refreshState();
      renderFolders(body);
    });
    body.querySelector(".cs-inline-upg")?.addEventListener("click", onUpgradeClick);

    const ul = body.querySelector("#cs-folder-list");
    ul.innerHTML = stateCache.folders
      .map((f) => {
        const count = stateCache.chats.filter((c) => c.folderId === f.id).length;
        return `<li class="cs-list-item">
          <input class="cs-input cs-inline-edit" data-id="${esc(f.id)}" value="${esc(f.name)}" />
          <span class="cs-muted">${count}</span>
          <button type="button" class="cs-icon-btn" data-del-f="${esc(f.id)}" title="Delete">🗑</button>
        </li>`;
      })
      .join("");

    ul.querySelectorAll(".cs-inline-edit").forEach((input) => {
      input.addEventListener("change", async () => {
        await Storage.renameFolder(input.dataset.id, input.value);
        await refreshState();
      });
    });
    ul.querySelectorAll("[data-del-f]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const res = await Storage.deleteFolder(btn.getAttribute("data-del-f"));
        if (!res.ok) return alert(res.error);
        await refreshState();
        renderFolders(body);
      });
    });
  }

  function renderPrompts(body) {
    const gate = Storage.canAddPrompt(stateCache);
    body.innerHTML = `
      <div class="cs-prompt-form">
        <input class="cs-input" id="cs-prm-title" placeholder="Prompt title" ${
          gate.allowed ? "" : "disabled"
        } />
        <textarea class="cs-input cs-textarea" id="cs-prm-body" rows="3" placeholder="Prompt text…" ${
          gate.allowed ? "" : "disabled"
        }></textarea>
        <button type="button" class="cs-primary" id="cs-add-prompt" ${
          gate.allowed ? "" : "disabled"
        }>Save prompt</button>
      </div>
      ${
        gate.allowed
          ? ""
          : `<div class="cs-upgrade-banner">${esc(gate.reason)} <button type="button" class="cs-upgrade-btn cs-inline-upg">Upgrade</button></div>`
      }
      <ul class="cs-list" id="cs-prompt-list"></ul>
    `;
    body.querySelector("#cs-add-prompt")?.addEventListener("click", async () => {
      const res = await Storage.createPrompt({
        title: body.querySelector("#cs-prm-title").value,
        body: body.querySelector("#cs-prm-body").value,
      });
      if (res.upgrade) {
        showUpgrade(true, res.error);
        onUpgradeClick();
        return;
      }
      if (!res.ok) return alert(res.error);
      await refreshState();
      renderPrompts(body);
    });
    body.querySelector(".cs-inline-upg")?.addEventListener("click", onUpgradeClick);

    const ul = body.querySelector("#cs-prompt-list");
    if (!stateCache.prompts.length) {
      ul.innerHTML = `<li class="cs-muted">No prompts yet. Save reusable snippets here.</li>`;
      return;
    }
    ul.innerHTML = stateCache.prompts
      .map(
        (p) => `<li class="cs-list-item cs-prompt-item">
        <div>
          <strong>${esc(p.title)}</strong>
          <p class="cs-muted cs-clip">${esc(p.body)}</p>
        </div>
        <div class="cs-actions">
          <button type="button" class="cs-primary cs-sm" data-ins="${esc(p.id)}">Insert</button>
          <button type="button" class="cs-icon-btn" data-del-p="${esc(p.id)}">🗑</button>
        </div>
      </li>`
      )
      .join("");

    ul.querySelectorAll("[data-ins]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = stateCache.prompts.find((x) => x.id === btn.getAttribute("data-ins"));
        if (!p) return;
        const res = Adapter.insertPrompt(p.body);
        const toast = document.createElement("div");
        toast.className = "cs-toast";
        toast.textContent = res.ok ? "Inserted into composer." : res.error;
        document.getElementById(ROOT_ID)?.appendChild(toast);
        setTimeout(() => toast.remove(), 2800);
      });
    });
    ul.querySelectorAll("[data-del-p]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await Storage.deletePrompt(btn.getAttribute("data-del-p"));
        await refreshState();
        renderPrompts(body);
      });
    });
  }

  // SPA URL changes
  let lastHref = location.href;
  const mo = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (panelOpen) {
        const active = document.querySelector(".cs-tab.active");
        if (active?.dataset.tab === "save") renderTab("save");
      }
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === C.MSG.INSERT_PROMPT && msg.body) {
      sendResponse(Adapter.insertPrompt(msg.body));
      return true;
    }
    if (msg?.type === "CS_PING") {
      sendResponse({ ok: true, site: Adapter.site, support: Adapter.supportLevel });
      return true;
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
