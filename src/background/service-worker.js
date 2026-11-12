/**
 * ChatShelf service worker — message router, upgrade opener, and
 * Gumroad license verification (POST https://api.gumroad.com/v2/licenses/verify).
 */
importScripts("../shared/constants.js");

const C = self.ChatShelfConstants;
const MSG = {
  OPEN_UPGRADE: C.MSG.OPEN_UPGRADE,
  VERIFY_LICENSE: C.MSG.VERIFY_LICENSE,
  GET_TAB_INFO: "CS_GET_TAB_INFO",
};
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
          cs_license: {
            plan: "free",
            licenseKey: null,
            validatedAt: null,
            expiresAt: null,
          },
        });
      }
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === MSG.OPEN_UPGRADE) {
    if (msg.action === "options") {
      chrome.runtime.openOptionsPage();
    } else if (msg.action === "prompt-pack") {
      chrome.tabs.create({ url: C.GUMROAD.PROMPT_PACK_URL });
    } else {
      // Default: open the Gumroad product page for ChatShelf Pro.
      chrome.tabs.create({ url: C.GUMROAD.PRODUCT_URL });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === MSG.VERIFY_LICENSE) {
    activateLicense(String(msg.licenseKey || "").trim()).then(sendResponse);
    return true;
  }

  if (msg.type === MSG.GET_TAB_INFO) {
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

// ---------------------------------------------------------------------------
// Gumroad license verification
// Docs: https://gumroad.com/api#licenses  (no OAuth / API key required)
//   POST product_id, license_key, increment_uses_count ("true"/"false")
//   200 {success:true, uses, purchase:{refunded, disputed, chargebacked, ...}}
//   404 {success:false, message}
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{ok:boolean, definitive?:boolean, data?:object, error?:string}>}
 *   definitive=true means Gumroad answered (key really invalid), false = network issue.
 */
async function gumroadVerify(licenseKey, incrementUses) {
  if (!C.isGumroadConfigured()) {
    return {
      ok: false,
      definitive: false,
      error: "Pro checkout is not configured in this build (GUMROAD.PRODUCT_ID placeholder).",
    };
  }
  let res;
  try {
    res = await fetch(C.GUMROAD.VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        product_id: C.GUMROAD.PRODUCT_ID,
        license_key: licenseKey,
        increment_uses_count: incrementUses ? "true" : "false",
      }),
    });
  } catch (err) {
    return { ok: false, definitive: false, error: "Network error — try again. " + (err?.message || "") };
  }
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* non-JSON */
  }
  if (!res.ok || !data || data.success !== true) {
    const definitive = res.status === 404 || (data && data.success === false && res.status < 500);
    return { ok: false, definitive, error: data?.message || `Gumroad returned HTTP ${res.status}` };
  }
  const p = data.purchase || {};
  if (p.refunded || p.chargebacked || (p.disputed && !p.dispute_won)) {
    return { ok: false, definitive: true, error: "This purchase was refunded or disputed." };
  }
  if (p.subscription_ended_at || p.subscription_cancelled_at || p.subscription_failed_at) {
    return { ok: false, definitive: true, error: "The subscription for this key is no longer active." };
  }
  return { ok: true, data };
}

async function activateLicense(licenseKey) {
  if (!licenseKey) return { ok: false, error: "Paste a license key first." };
  // Count this activation once (increment_uses_count=true).
  const r = await gumroadVerify(licenseKey, true);
  if (!r.ok) return { ok: false, error: r.error };
  const uses = Number(r.data.uses || 0);
  if (uses > C.GUMROAD.MAX_USES) {
    return {
      ok: false,
      error: `This key has been activated ${uses} times (limit ${C.GUMROAD.MAX_USES}). Reply to your Gumroad receipt to reset it.`,
    };
  }
  const license = {
    ...C.DEFAULT_LICENSE,
    plan: "pro",
    licenseKey,
    validatedAt: Date.now(),
    expiresAt: null,
    email: r.data.purchase?.email || null,
    uses,
  };
  await chrome.storage.local.set({ [LICENSE_KEY]: license });
  return { ok: true, plan: "pro", license };
}

/** Silent periodic re-check. Only downgrades on a definitive Gumroad "no". */
async function recheckLicense() {
  const data = await chrome.storage.local.get([LICENSE_KEY]);
  const lic = data[LICENSE_KEY];
  if (!lic || lic.plan !== "pro" || !lic.licenseKey) return;
  const ageMs = Date.now() - (lic.validatedAt || 0);
  if (ageMs < C.GUMROAD.RECHECK_DAYS * 86400000) return;
  const r = await gumroadVerify(lic.licenseKey, false);
  if (r.ok) {
    await chrome.storage.local.set({ [LICENSE_KEY]: { ...lic, validatedAt: Date.now() } });
  } else if (r.definitive) {
    await chrome.storage.local.set({
      [LICENSE_KEY]: { ...C.DEFAULT_LICENSE, lastError: r.error },
    });
  }
  // Network errors: keep Pro (offline-friendly).
}

chrome.runtime.onStartup.addListener(() => {
  recheckLicense();
});
