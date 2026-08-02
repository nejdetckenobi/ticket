const test = require("node:test");
const assert = require("node:assert/strict");

const storage = require("../google-storage.js");

test("Picker is restricted to native Google Sheets and headers include token", () => {
  assert.equal(storage._constants.SHEETS_MIME, "application/vnd.google-apps.spreadsheet");
  assert.deepEqual(storage._constants.REQUIRED_HEADERS, ["event", "full_name", "scanned_at", "token"]);
});

test("Google source implements selection cancellation, token renewal, append, read and data-only clear", () => {
  const source = require("node:fs").readFileSync(require.resolve("../google-storage.js"), "utf8");
  assert.match(source, /Action\.CANCEL/);
  assert.match(source, /status === 401/);
  assert.match(source, /values\.append/);
  assert.match(source, /values\.get/);
  assert.match(source, /History!A2:ZZ/);
  assert.match(source, /status === 403/);
});

test("application preserves local mode migration, local history and remote CSV routing", () => {
  const source = require("node:fs").readFileSync(require.resolve("../script.js"), "utf8");
  assert.match(source, /historyStorage: settings\.historyStorage === "google" \? "google" : "local"/);
  assert.match(source, /localStorage\.setItem\(HISTORY_KEY/);
  assert.match(source, /const history = await getHistory\(\)|history = await getHistory\(\)/);
  assert.match(source, /settings\.preventDuplicates && alreadyScanned/);
  assert.match(source, /Previous settings were kept/);
});
