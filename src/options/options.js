(async function () {
  const Storage = globalThis.ChatShelfStorage;
  const C = globalThis.ChatShelfConstants;
  const $ = (id) => document.getElementById(id);

  async function refreshPlan() {
    const state = await Storage.getAll();
    const pro = Storage.isPro(state.license);
    $("plan-status").textContent = pro
      ? `Pro · key ${state.license.licenseKey?.slice(0, 8) || ""}…`
      : `Free · max ${C.FREE_LIMITS.maxFolders} folders, ${C.FREE_LIMITS.maxPrompts} prompts`;
    if (state.license.licenseKey) $("license-key").value = state.license.licenseKey;
    $("deactivate-license").hidden = !pro;
    $("buy-pro").hidden = pro;
    if (!pro && state.license.lastError) {
      $("license-msg").textContent = "Pro was turned off: " + state.license.lastError;
      $("license-msg").className = "hint err";
    }
  }

  $("buy-pro").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: C.MSG.OPEN_UPGRADE, action: "buy" });
  });

  $("deactivate-license").addEventListener("click", async () => {
    await Storage.deactivateLicense();
    $("license-key").value = "";
    $("license-msg").textContent = "Key removed. You're on the free plan.";
    $("license-msg").className = "hint";
    refreshPlan();
  });

  $("activate-license").addEventListener("click", async () => {
    const key = $("license-key").value.trim();
    if (!key) {
      $("license-msg").textContent = "Paste a license key first.";
      $("license-msg").className = "hint err";
      return;
    }
    $("activate-license").disabled = true;
    $("license-msg").textContent = "Checking with Gumroad…";
    $("license-msg").className = "hint";
    const res = await Storage.validateLicense(key);
    $("activate-license").disabled = false;
    if (!res.ok) {
      $("license-msg").textContent = res.error || "Activation failed";
      $("license-msg").className = "hint err";
      return;
    }
    $("license-msg").textContent = "Pro activated — unlimited folders and prompts. Thank you!";
    $("license-msg").className = "hint ok";
    refreshPlan();
  });

  $("export-btn").addEventListener("click", async () => {
    const data = await Storage.exportJson();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chatshelf-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    $("backup-msg").textContent = "Exported.";
    $("backup-msg").className = "hint ok";
  });

  $("import-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await Storage.importJson(json);
      if (!res.ok) {
        $("backup-msg").textContent = res.error;
        $("backup-msg").className = "hint err";
        return;
      }
      if (json && json.type === "prompt-pack") {
        $("backup-msg").textContent =
          `Added ${res.added} prompts` +
          (res.truncated ? ` (free plan limit reached — ${res.skipped} not added; Pro removes the limit).` : ".");
      } else {
        $("backup-msg").textContent = res.truncated
          ? "Imported (truncated to free limits)."
          : "Imported.";
      }
      $("backup-msg").className = "hint ok";
      refreshPlan();
    } catch (err) {
      $("backup-msg").textContent = "Invalid JSON: " + err.message;
      $("backup-msg").className = "hint err";
    }
    e.target.value = "";
  });

  refreshPlan();
})();
