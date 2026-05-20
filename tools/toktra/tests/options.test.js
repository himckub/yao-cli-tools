import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";

const optionsSource = readFileSync(new URL("../extension/options.js", import.meta.url), "utf8");
const optionsHtml = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");

function loadOptions() {
  const { window } = parseHTML(optionsHtml);
  window.chrome = {
    runtime: {
      sendMessage(_message, callback) {
        callback({ ok: true, settings: { enabled: true, autoTranslate: false } });
      }
    }
  };
  Function("document", "chrome", "globalThis", optionsSource)(window.document, window.chrome, window);
  return window.ToktraOptions;
}

test("options maps settings to manual, site, and global translation modes", () => {
  const options = loadOptions();

  assert.equal(options.modeFromSettings({ autoTranslate: false, domainMode: "all" }), "manual");
  assert.equal(options.modeFromSettings({ autoTranslate: true, domainMode: "allowlist" }), "site");
  assert.equal(options.modeFromSettings({ autoTranslate: true, domainMode: "all" }), "global");
  assert.deepEqual(options.applyModeToSettings({ enabled: true }, "manual"), { enabled: true, autoTranslate: false });
  assert.deepEqual(options.applyModeToSettings({ enabled: true }, "site"), {
    enabled: true,
    autoTranslate: true,
    domainMode: "allowlist"
  });
  assert.deepEqual(options.applyModeToSettings({ enabled: true }, "global"), {
    enabled: true,
    autoTranslate: true,
    domainMode: "all"
  });
});
