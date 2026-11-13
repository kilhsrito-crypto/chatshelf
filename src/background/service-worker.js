/**
 * ChatShelf service worker — message router and Creem license checks.
 * Calls https://chatshelf.naruhodoowl.me only. The Creem API key stays on the proxy.
 */
importScripts("../shared/constants.js");

const C = self.ChatShelfConstants;
const LICENSE_KEY = C.STORAGE_KEYS.license;

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.local.get(["cs_folders"], (data) => {
      if (!data.cs_folders || !data.cs_folders.length) {
        const id = `fld_${Date.now().toString(36)}_inbox`;
        chrome.storage.local.set({
          cs_folders: [
            { id, name: "Inbox", createdAt: Date.now(), updatedAt: Date.now() },
          ],
          cs_chats: [],
          cs_prompts: [],
          cs_settings: {
            theme: "auto",
            showFloatingButton: true,
            defaultFolderId: id,
          },
          cs_license: { ...C.DEFAULT_LICENSE },
        });
      }
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === C.MSG.OPEN_UPGRADE) {
    if (msg.action === "options") {
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
    } else if (msg.action === "prompt-pack") {
      if (!C.LICENSE.PROMPT_PACK_URL) {
        sendResponse({ ok: false, error: "Prompt pack link is not configured." });
      } else {
        chrome.tabs.create({ url: C.LICENSE.PROMPT_PACK_URL });
        sendResponse({ ok: true });
      }
    } else {
      chrome.tabs.create({ url: C.LICENSE.PRODUCT_URL });
      sendResponse({ ok: true });
    }
    return true;
  }

  if (msg.type === C.MSG.VERIFY_LICENSE) {
    activateLicense(String(msg.licenseKey || "").trim()).then(sendResponse);
    return true;
  }

  if (msg.type === C.MSG.DEACTIVATE_LICENSE) {
    deactivateThisBrowser().then(sendResponse);
    return true;
  }

  if (msg.type === "CS_GET_TAB_INFO") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      sendResponse({
        ok: true,
        tab: tab ? { id: tab.id, url: tab.url || "", title: tab.title || "" } : null,
      });
    });
    return true;
  }

  if (msg.type === "CS_FORWARD_INSERT") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab" });
        return;
      }
      chrome.tabs.sendMessage(
        tab.id,
        { type: "CS_INSERT_PROMPT", body: msg.body },
        (res) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse(res || { ok: false, error: "No response from page" });
          }
        }
      );
    });
    return true;
  }
});

function networkFailure() {
  return {
    ok: false,
    definitive: false,
    code: "unavailable",
    error: C.LICENSE_ERRORS.unavailable,
  };
}

async function postLicense(path, payload) {
  let res;
  try {
    res = await fetch(C.LICENSE.API_BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch (_) {
    return { network: true };
  }
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  return { network: false, status: res.status, data };
}

async function readLicense() {
  const data = await chrome.storage.local.get([LICENSE_KEY]);
  return { ...C.DEFAULT_LICENSE, ...(data[LICENSE_KEY] || {}) };
}

async function getInstanceName() {
  const key = C.INSTALL_ID_KEY;
  const data = await chrome.storage.local.get([key]);
  const existing = data[key];
  if (typeof existing === "string" && /^cs-[a-z0-9]{8,40}$/.test(existing)) {
    return existing;
  }
  const name = C.newInstallId();
  await chrome.storage.local.set({ [key]: name });
  return name;
}

function licenseRecord(licenseKey, interpreted) {
  return {
    plan: "pro",
    licenseKey,
    instanceId: interpreted.instanceId,
    validatedAt: Date.now(),
    expiresAt: interpreted.expiresAt || null,
    status: "active",
  };
}

/** Best-effort slot release. Network errors stay ok:false so the caller can retry. */
async function releaseRemote(lic) {
  if (!lic || !lic.licenseKey || !lic.instanceId) return { ok: true };
  const result = await postLicense(C.LICENSE.DEACTIVATE_PATH, {
    key: lic.licenseKey,
    instance_id: lic.instanceId,
  });
  if (result.network) return networkFailure();
  if (result.status === 200 || result.status === 404 || result.status === 409 || result.status === 410) {
    return { ok: true };
  }
  const mapped = C.mapLicenseHttpFailure(result.status, result.data);
  if (
    mapped.code === "invalid_key" ||
    mapped.code === "not_active" ||
    mapped.code === "already_inactive" ||
    mapped.code === "expired" ||
    mapped.code === "revoked" ||
    mapped.code === "expired_or_revoked"
  ) {
    return { ok: true };
  }
  return { ok: false, error: mapped.error };
}

async function downgrade(message) {
  const current = await readLicense();
  if (current.plan !== "pro") return;
  await chrome.storage.local.set({
    [LICENSE_KEY]: { ...C.DEFAULT_LICENSE, lastError: message },
  });
}

function isFatalCode(code) {
  return code === "expired" || code === "revoked" || code === "expired_or_revoked" || code === "invalid_key";
}

async function activateLicense(licenseKey) {
  if (!licenseKey) return { ok: false, error: "Paste a license key first." };
  const instanceName = await getInstanceName();
  const stored = await readLicense();
  const switching = !!(stored.licenseKey && stored.instanceId && stored.licenseKey !== licenseKey);

  // Same key already activated here: validate instead of spending another slot.
  if (!switching && stored.licenseKey === licenseKey && stored.instanceId) {
    const checked = await postLicense(C.LICENSE.VALIDATE_PATH, {
      key: licenseKey,
      instance_id: stored.instanceId,
    });
    if (checked.network) return networkFailure();
    if (checked.status === 200) {
      const interpreted = C.interpretLicense(checked.data, C.LICENSE.PRODUCT_ID);
      if (interpreted.ok) {
        const license = licenseRecord(licenseKey, interpreted);
        await chrome.storage.local.set({ [LICENSE_KEY]: license });
        return { ok: true, plan: "pro", license };
      }
      if (interpreted.code !== "not_active") {
        if (isFatalCode(interpreted.code)) await downgrade(interpreted.error);
        return { ok: false, error: interpreted.error };
      }
    } else {
      const mapped = C.mapLicenseHttpFailure(checked.status, checked.data);
      if (!mapped.definitive) return { ok: false, error: mapped.error };
      const retry =
        mapped.code === "not_active" ||
        mapped.code === "invalid_key" ||
        mapped.code === "bad_request" ||
        mapped.code === "already_inactive";
      if (!retry) {
        if (isFatalCode(mapped.code)) await downgrade(mapped.error);
        return { ok: false, error: mapped.error };
      }
    }
  }

  const activated = await postLicense(C.LICENSE.ACTIVATE_PATH, {
    key: licenseKey,
    instance_name: instanceName,
  });
  if (activated.network) return networkFailure();
  if (activated.status !== 200) {
    const mapped = C.mapLicenseHttpFailure(activated.status, activated.data);
    if (!switching && isFatalCode(mapped.code)) await downgrade(mapped.error);
    return { ok: false, error: mapped.error };
  }
  const interpreted = C.interpretLicense(activated.data, C.LICENSE.PRODUCT_ID);
  if (!interpreted.ok) {
    // Activate already counted. Drop the instance when this key is not Pro.
    if (interpreted.instanceId) {
      await releaseRemote({ licenseKey, instanceId: interpreted.instanceId });
    }
    if (!switching && isFatalCode(interpreted.code)) await downgrade(interpreted.error);
    return { ok: false, error: interpreted.error };
  }
  const license = licenseRecord(licenseKey, interpreted);
  await chrome.storage.local.set({ [LICENSE_KEY]: license });
  // Free the previous browser slot only after the new key is stored.
  if (switching) await releaseRemote(stored);
  return { ok: true, plan: "pro", license };
}

async function deactivateThisBrowser() {
  const lic = await readLicense();
  const released = await releaseRemote(lic);
  if (!released.ok) return { ok: false, error: released.error };
  await chrome.storage.local.set({ [LICENSE_KEY]: { ...C.DEFAULT_LICENSE } });
  return { ok: true };
}

/** Weekly re-check. Only downgrades when the proxy gives a definite no. */
async function recheckLicense() {
  const lic = await readLicense();
  if (lic.plan !== "pro" || !lic.licenseKey || !lic.instanceId) return;
  const ageMs = Date.now() - (lic.validatedAt || 0);
  if (ageMs < C.LICENSE.RECHECK_DAYS * 86400000) return;
  const result = await postLicense(C.LICENSE.VALIDATE_PATH, {
    key: lic.licenseKey,
    instance_id: lic.instanceId,
  });
  if (result.network) return;
  if (result.status === 200) {
    const interpreted = C.interpretLicense(result.data, C.LICENSE.PRODUCT_ID);
    if (interpreted.ok) {
      await chrome.storage.local.set({
        [LICENSE_KEY]: licenseRecord(lic.licenseKey, interpreted),
      });
      return;
    }
    if (!interpreted.definitive) return;
    await chrome.storage.local.set({
      [LICENSE_KEY]: { ...C.DEFAULT_LICENSE, lastError: interpreted.error },
    });
    return;
  }
  const mapped = C.mapLicenseHttpFailure(result.status, result.data);
  if (!mapped.definitive) return;
  await chrome.storage.local.set({
    [LICENSE_KEY]: { ...C.DEFAULT_LICENSE, lastError: mapped.error },
  });
}

chrome.runtime.onStartup.addListener(() => {
  recheckLicense();
});

recheckLicense();
