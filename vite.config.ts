import { originUrl } from "./src/sync/types";
import { defineConfig, loadEnv } from "vite";
import { manifestFor } from "./scripts/manifest";
import { readFileSync } from "node:fs";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const syncOrigin = env.VITE_SYNC_ORIGIN
    ? originUrl(env.VITE_SYNC_ORIGIN, true)
    : "";
  const target = mode === 'firefox' ? 'firefox' : 'chromium';
  const googleClientId = (target === 'firefox' ? env.VITE_GOOGLE_CLIENT_ID_FIREFOX : env.VITE_GOOGLE_CLIENT_ID_CHROMIUM) ?? '';
  const provider = ['cloudflare', 'google-drive'].includes(env.VITE_SYNC_PROVIDER) ? env.VITE_SYNC_PROVIDER : 'dropbox';
  return {
    define: { __SYNC_ORIGIN__: JSON.stringify(syncOrigin), __GOOGLE_CLIENT_ID__: JSON.stringify(googleClientId), __DROPBOX_CLIENT_ID__: JSON.stringify(env.VITE_DROPBOX_CLIENT_ID ?? ''), __SYNC_PROVIDER__: JSON.stringify(provider), __BROWSER_TARGET__: JSON.stringify(target) },
    base: "./",
    publicDir: false,
    plugins: [
      {
        name: "browser-manifest",
        generateBundle() {
          for (const size of [16, 32, 48, 128]) {
            this.emitFile({
              type: "asset",
              fileName: `icons/icon-${size}.png`,
              source: readFileSync(new URL(`./assets/icons/icon-${size}.png`, import.meta.url)),
            });
          }
          for (const fileName of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
            this.emitFile({ type: "asset", fileName, source: readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8") });
          }
          this.emitFile({
            type: "asset",
            fileName: "manifest.json",
            source: JSON.stringify(
              manifestFor(
                mode === "firefox" ? "firefox" : "chromium",
                syncOrigin,
                provider === 'google-drive' || !!googleClientId,
                googleClientId,
                env.VITE_CHROMIUM_EXTENSION_KEY ?? '',
                provider === 'dropbox',
              ),
              null,
              2,
            ),
          });
        },
      },
    ],
    build: {
      outDir: `dist/${mode === "firefox" ? "firefox" : "chromium"}`,
      rollupOptions: {
        input: {
          explorer: "explorer.html",
          background: "src/background/index.ts",
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "assets/[name]-[hash].js",
        },
      },
    },
  };
});
