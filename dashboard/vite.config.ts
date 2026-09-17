import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    // Registered by hand in app.html, not auto-registered: the /sw.js migration needs to
    // unregister the old worker's registration before the new one takes over (OFFLINE_PLAN.md §7).
    sveltekit({ adapter: adapter(), env: { dir: ".." }, serviceWorker: { register: false } })
  ],
  server: { port: 5173 }
});
