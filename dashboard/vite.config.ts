import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter(),
      env: { dir: ".." },
      // Registered by hand in app.html, not auto-registered: the /sw.js migration needs to
      // unregister the old worker's registration before the new one takes over (OFFLINE_PLAN.md §7).
      serviceWorker: { register: false },
      // Root-relative asset paths, because the service worker serves one cached shell for every
      // mirrored path (OFFLINE_PLAN.md §14.3, H2). With the default relative paths, a shell
      // captured at `/notes` says `./_app/...`, which at `/2026-09-25/detail/<ids>` resolves two
      // levels too deep, and SvelteKit derives its base from `location` the same way.
      paths: { relative: false },
    })
  ],
  server: { port: 5173 }
});
