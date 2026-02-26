import fs from "fs";
import path from "path";

const fromRoot = "node_modules/pdfjs-dist";
const toRoot = "dist/pdfjs-assets";

const folders = ["cmaps", "standard_fonts", "wasm", "image_decoders"];

fs.mkdirSync(toRoot, { recursive: true });

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

for (const f of folders) {
  copyDir(path.join(fromRoot, f), path.join(toRoot, f));
}

console.log("Copied PDF.js assets →", toRoot);