(async function () {
  const Storage = globalThis.ChatShelfStorage;
  const C = globalThis.ChatShelfConstants;
  let state = await Storage.ensureSeed();
  let selectedPromptId = null;

  const $ = (id) => document.getElementById(id);

  function render() {
    const pro = Storage.isPro(state.license);
    $("plan-label").textContent = pro ? "Pro plan" : "Free plan";
    $("limits").textContent = pro
      ? "Unlimited folders & prompts"
      : `Folders ${state.folders.length}/${C.FREE_LIMITS.maxFolders} · Prompts ${state.prompts.length}/${C.FREE_LIMITS.maxPrompts}`;
    $("upgrade-box").hidden = pro;

    const fl = $("folder-list");
    fl.innerHTML = state.folders
      .map((f) => {
        const n = state.chats.filter((c) => c.folderId === f.id).length;
        return `<li><span class="name">${escapeHtml(f.name)} <small style="color:#93a0c0">(${n})</small></span>
          <button type="button" class="mini" data-del-f="${f.id}" title="Delete">🗑</button></li>`;
      })
      .join("");
    fl.querySelectorAll("[data-del-f]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const res = await Storage.deleteFolder(btn.dataset.delF);
        if (!res.ok) {
          $("folder-hint").textContent = res.error;
          $("folder-hint").className = "hint err";
          return;
        }
        state = await Storage.getAll();
        render();
      });
    });

    const pl = $("prompt-list");
    if (!state.prompts.length) {
      pl.innerHTML = `<li><span class="name" style="color:#93a0c0">No prompts yet</span></li>`;
    } else {
      pl.innerHTML = state.prompts
        .map(
          (p) => `<li class="${selectedPromptId === p.id ? "selected" : ""}">
          <span class="name">${escapeHtml(p.title)}</span>
          <button type="button" class="use" data-sel="${p.id}">Select</button>
          <button type="button" class="mini" data-del-p="${p.id}">🗑</button>
        </li>`
        )
        .join("");
    }
    pl.querySelectorAll("[data-sel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedPromptId = btn.dataset.sel;
        $("insert-selected").disabled = false;
        render();
      });
    });
    pl.querySelectorAll("[data-del-p]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await Storage.deletePrompt(btn.dataset.delP);
        if (selectedPromptId === btn.dataset.delP) selectedPromptId = null;
        state = await Storage.getAll();
        render();
      });
    });

    const fg = Storage.canAddFolder(state);
    $("add-folder").disabled = !fg.allowed;
    $("folder-name").disabled = !fg.allowed;
    $("folder-hint").textContent = fg.allowed ? "" : fg.reason;
    $("folder-hint").className = fg.allowed ? "hint" : "hint err";

    const pg = Storage.canAddPrompt(state);
    $("add-prompt").disabled = !pg.allowed;
    $("prompt-title").disabled = !pg.allowed;
    $("prompt-body").disabled = !pg.allowed;
    $("prompt-hint").textContent = pg.allowed ? "" : pg.reason;
    $("prompt-hint").className = pg.allowed ? "hint" : "hint err";
    if (!pg.allowed || !fg.allowed) $("upgrade-box").hidden = false;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  $("add-folder").addEventListener("click", async () => {
    const res = await Storage.createFolder($("folder-name").value);
    if (res.upgrade) {
      $("folder-hint").textContent = res.error;
      $("folder-hint").className = "hint err";
      $("upgrade-box").hidden = false;
      return;
    }
    if (!res.ok) {
      $("folder-hint").textContent = res.error;
      $("folder-hint").className = "hint err";
      return;
    }
    $("folder-name").value = "";
    $("folder-hint").textContent = "Folder added";
    $("folder-hint").className = "hint ok";
    state = await Storage.getAll();
    render();
  });

  $("add-prompt").addEventListener("click", async () => {
    const res = await Storage.createPrompt({
      title: $("prompt-title").value,
      body: $("prompt-body").value,
    });
    if (res.upgrade) {
      $("prompt-hint").textContent = res.error;
      $("prompt-hint").className = "hint err";
      $("upgrade-box").hidden = false;
      return;
    }
    if (!res.ok) {
      $("prompt-hint").textContent = res.error;
      $("prompt-hint").className = "hint err";
      return;
    }
    $("prompt-title").value = "";
    $("prompt-body").value = "";
    $("prompt-hint").textContent = "Prompt saved";
    $("prompt-hint").className = "hint ok";
    state = await Storage.getAll();
    render();
  });

  $("upgrade-btn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: C.MSG.OPEN_UPGRADE, action: "buy" });
  });

  $("have-key").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  $("insert-selected").addEventListener("click", async () => {
    const p = state.prompts.find((x) => x.id === selectedPromptId);
    if (!p) return;
    chrome.runtime.sendMessage(
      { type: "CS_FORWARD_INSERT", body: p.body },
      (res) => {
        if (chrome.runtime.lastError || !res?.ok) {
          $("page-hint").textContent =
            res?.error ||
            chrome.runtime.lastError?.message ||
            "Open a ChatGPT/Claude tab and try again.";
          $("page-hint").className = "hint err";
        } else {
          $("page-hint").textContent = "Inserted.";
          $("page-hint").className = "hint ok";
        }
      }
    );
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url || "";
    const ok =
      /https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai)\//.test(url);
    $("page-hint").textContent = ok
      ? "Supported page — use the purple floating button or Insert below."
      : "Open chatgpt.com or claude.ai to use the floating panel.";
    $("insert-selected").disabled = !ok || !selectedPromptId;
  });

  render();
})();
