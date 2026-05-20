import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../extension/", import.meta.url);
const required = [
  "manifest.json",
  "background.js",
  "core.js",
  "content.js",
  "options.html",
  "options.js",
  "popup.html",
  "popup.js",
  "pdf-viewer.html",
  "pdf-viewer.css",
  "pdf-viewer-core.js",
  "pdf-viewer.js",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "vendor/pdf.min.mjs",
  "vendor/pdf.worker.min.mjs"
];

for (const file of required) {
  readFileSync(new URL(file, root));
}

const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
if (manifest.manifest_version !== 3) {
  throw new Error("manifest_version must be 3");
}
if (manifest.name !== "toktra") {
  throw new Error("extension name must be toktra");
}
if (!manifest.content_scripts?.[0]?.js?.includes("content.js")) {
  throw new Error("content.js must be registered");
}
if (manifest.icons?.["128"] !== "icons/icon128.png") {
  throw new Error("128px store icon must be registered");
}
if (manifest.action?.default_icon?.["32"] !== "icons/icon32.png") {
  throw new Error("action icon must be registered");
}

for (const file of ["background.js", "core.js", "content.js", "options.js", "popup.js", "pdf-viewer-core.js"]) {
  const source = readFileSync(new URL(file, root), "utf8");
  new Function(source);
}

console.log(`Checked ${join("extension", "manifest.json")} and ${required.length} extension files.`);
