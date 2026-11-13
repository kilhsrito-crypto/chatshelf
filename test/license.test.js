const assert = require("assert");
const fs = require("fs");
const path = require("path");
const C = require("../src/shared/constants.js");

const PRODUCT = "prod_3FqFPPZL4T22ud6OFOyhgg";
const NOW = Date.parse("2026-11-13T00:00:00Z");

function activeLicense(overrides) {
  return Object.assign(
    {
      product_id: PRODUCT,
      status: "active",
      activation: 1,
      activation_limit: 3,
      expires_at: null,
      instance: { id: "inst_abc", name: "cs-abcdef1234567890", status: "active" },
      message: "ignore this upstream text",
      key: "SHOULD-NOT-LEAK",
    },
    overrides || {}
  );
}

const ok = C.interpretLicense(activeLicense(), PRODUCT, NOW);
assert.strictEqual(ok.ok, true);
assert.strictEqual(ok.instanceId, "inst_abc");
assert.strictEqual(ok.error, undefined);

const wrongProduct = C.interpretLicense(activeLicense({ product_id: "prod_other" }), PRODUCT, NOW);
assert.strictEqual(wrongProduct.ok, false);
assert.strictEqual(wrongProduct.code, "invalid_key");
assert.strictEqual(wrongProduct.error, C.LICENSE_ERRORS.invalid_key);
assert.ok(!wrongProduct.error.includes("SHOULD-NOT-LEAK"));

const missingProduct = C.interpretLicense(activeLicense({ product_id: "" }), PRODUCT, NOW);
assert.strictEqual(missingProduct.code, "invalid_key");

const expired = C.interpretLicense(activeLicense({ status: "expired" }), PRODUCT, NOW);
assert.strictEqual(expired.code, "expired");

const past = C.interpretLicense(
  activeLicense({ expires_at: "2020-01-01T00:00:00Z" }),
  PRODUCT,
  NOW
);
assert.strictEqual(past.code, "expired");

const openEnded = C.interpretLicense(activeLicense({ expires_at: null }), PRODUCT, NOW);
assert.strictEqual(openEnded.ok, true);

const revoked = C.interpretLicense(activeLicense({ status: "disabled" }), PRODUCT, NOW);
assert.strictEqual(revoked.code, "revoked");

const inactive = C.interpretLicense(activeLicense({ status: "inactive" }), PRODUCT, NOW);
assert.strictEqual(inactive.code, "not_active");

const deactivated = C.interpretLicense(
  activeLicense({ instance: { id: "inst_abc", name: "cs-a", status: "deactivated" } }),
  PRODUCT,
  NOW
);
assert.strictEqual(deactivated.code, "not_active");

const nasty = C.mapLicenseHttpFailure(403, {
  error: "nope",
  message: "activation limit token=SECRET stack trace",
});
assert.strictEqual(nasty.code, "activation_limit");
assert.strictEqual(nasty.error, C.LICENSE_ERRORS.activation_limit);
assert.ok(!nasty.error.includes("SECRET"));

const leaked500 = C.mapLicenseHttpFailure(500, { error: "invalid_key", message: "sql password" });
assert.strictEqual(leaked500.code, "unavailable");
assert.strictEqual(leaked500.definitive, false);
assert.ok(!leaked500.error.includes("password"));

const notActive = C.mapLicenseHttpFailure(404, { error: "not_active", message: LICENSE_TEXT() });
assert.strictEqual(notActive.code, "not_active");
assert.strictEqual(notActive.definitive, true);

const offline = C.mapLicenseHttpFailure(0, null);
assert.strictEqual(offline.definitive, false);

function LICENSE_TEXT() {
  return "raw body SHOULD-NOT-LEAK";
}
assert.ok(!notActive.error.includes("SHOULD-NOT-LEAK"));

const id = C.newInstallId(() => "AbC-def_12345678");
assert.strictEqual(id, "cs-abcdef12345678");
assert.match(id, /^cs-[a-z0-9]{8,40}$/);

assert.strictEqual(C.LICENSE.PRODUCT_ID, PRODUCT);
assert.strictEqual(
  C.LICENSE.PRODUCT_URL,
  "https://www.creem.io/product/prod_3FqFPPZL4T22ud6OFOyhgg"
);
assert.strictEqual(C.LICENSE.API_BASE, "https://chatshelf.naruhodoowl.me");
assert.strictEqual(C.LICENSE.PROMPT_PACK_URL, "");
assert.strictEqual(C.LICENSE.ACTIVATE_PATH, "/api/licenses/activate");
assert.strictEqual(C.LICENSE.VALIDATE_PATH, "/api/licenses/validate");
assert.strictEqual(C.LICENSE.DEACTIVATE_PATH, "/api/licenses/deactivate");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.strictEqual(manifest.version, "0.3.0");
assert.deepStrictEqual(
  manifest.host_permissions.filter((item) => item.includes("license") || item.includes("gumroad") || item.includes("creem") || item.includes("naruhodoowl")),
  ["https://chatshelf.naruhodoowl.me/*"]
);
assert.strictEqual(manifest.homepage_url, "https://github.com/kilhsrito-crypto/chatshelf");
assert.ok(!manifest.host_permissions.some((item) => item.includes("gumroad") || item.includes("creem.io")));

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const TEXT_EXT = new Set([
  ".js",
  ".json",
  ".md",
  ".html",
  ".css",
  ".py",
  ".conf",
  ".service",
  ".example",
  ".gitignore",
]);
const files = walk(root, []).filter((file) => TEXT_EXT.has(path.extname(file)) || path.basename(file) === ".gitignore");
const extSources = files.filter((file) => {
  const rel = path.relative(root, file);
  return rel === "manifest.json" || rel.startsWith("src" + path.sep);
});
for (const file of extSources) {
  const text = fs.readFileSync(file, "utf8");
  assert.ok(!/gumroad/i.test(text), file);
  assert.ok(!text.includes("api.creem.io"), file);
  assert.ok(!text.includes("CREEM_API_KEY"), file);
  assert.ok(!text.includes("x-api-key"), file);
  assert.ok(!text.includes("REPLACE_ME"), file);
  assert.ok(!text.includes("REPLACE_WITH_GUMROAD"), file);
}

const tree = files
  .filter((file) => {
    const rel = path.relative(root, file);
    return !rel.startsWith(".git" + path.sep) && !rel.startsWith("test" + path.sep);
  })
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");
assert.ok(!/gumroad/i.test(tree));
assert.ok(!/creem_[A-Za-z0-9]{8,}/.test(tree));
assert.ok(!tree.includes("replace-with-a-real"));

console.log("license tests ok");
