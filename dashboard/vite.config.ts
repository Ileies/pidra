import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { $pipeline: fileURLToPath(new URL("../src", import.meta.url)) },
  },
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter(),
      env: { dir: ".." },
      // Registered by hand in app.html, not auto-registered: the inline script costs no extra
      // round trip, and its CSP hash is pinned in hooks.server.ts.
      serviceWorker: { register: false },
      // Root-relative asset paths, because the service worker serves one cached shell for every
      // mirrored path. With the default relative paths, a shell
      // captured at `/notes` says `./_app/...`, which at `/2026-09-25/detail/<ids>` resolves two
      // levels too deep, and SvelteKit derives its base from `location` the same way.
      paths: { relative: false },
    })
  ],
  server: { port: 5173 }
});
