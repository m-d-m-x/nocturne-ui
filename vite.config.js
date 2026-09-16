import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import legacy from "@vitejs/plugin-legacy";

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ["chrome >= 64"],
      // Do NOT set renderLegacyChunks:false. Chromium 69 appears in the
      // network log requesting the modern bundle, but it cannot PARSE it -
      // Vite's modern target is es2020 and optional chaining arrived in
      // Chrome 80. Without the legacy chunks the app dies with
      // "SyntaxError: Unexpected token ?" and never mounts. The legacy bundle
      // is the one that actually runs, via plugin-legacy's fallback.
      renderLegacyChunks: true,
      modernPolyfills: true,
    }),
  ],
});
