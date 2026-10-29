import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        capture: resolve(__dirname, "src/capture.ts"),
        errorCapture: resolve(__dirname, "src/error-capture.ts"),
        captureBridge: resolve(__dirname, "src/capture-bridge.ts"),
        serviceWorker: resolve(__dirname, "src/service-worker.ts")
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "serviceWorker"
            ? "service-worker.js"
            : chunk.name === "errorCapture"
              ? "error-capture.js"
              : chunk.name === "captureBridge"
                ? "capture-bridge.js"
              : `${chunk.name}.js`
      }
    }
  }
});
