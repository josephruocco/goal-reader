import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        // extension files
        { src: "src/manifest.json", dest: "." },
        { src: "src/sw.js", dest: "." },
        { src: "src/viewer.html", dest: "." },
        { src: "src/viewer.css", dest: "." },
        { src: "src/icons", dest: "." },

        // pdfjs assets needed for JPX/OpenJPEG + fonts/cmaps
        { src: "node_modules/pdfjs-dist/cmaps", dest: "pdfjs-assets" },
        { src: "node_modules/pdfjs-dist/standard_fonts", dest: "pdfjs-assets" },
        { src: "node_modules/pdfjs-dist/wasm", dest: "pdfjs-assets" },
        { src: "node_modules/pdfjs-dist/image_decoders", dest: "pdfjs-assets" }
      ]
    })
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        viewer: "src/viewer.html"
      },
      output: {
        // keep filenames stable
        entryFileNames: "[name].js",
        assetFileNames: "[name][extname]"
      }
    }
  }
});