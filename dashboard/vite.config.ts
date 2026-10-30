import adapter from "@sveltejs/adapter-bun";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/**
 * jsdom (the DOM behind `isomorphic-dompurify`'s server-side sanitising) reads its default
 * stylesheet from disk when it is imported and resolves a sync-XHR worker file by path. Neither
 * works inside a bundle, and the server has no node_modules to find them in, so both are replaced
 * at build time. A pattern that stops matching after a jsdom upgrade fails the build on purpose:
 * the alternative is a dashboard that bundles fine and crashes on import.
 */
function bundleJsdom(): Plugin {
  const replacements: { file: string; pattern: RegExp; to: (dir: string) => string }[] = [
    {
      file: "/jsdom/lib/jsdom/living/css/helpers/computed-style.js",
      pattern: /fs\.readFileSync\(\s*path\.resolve\(__dirname, "\.\.\/\.\.\/\.\.\/browser\/default-stylesheet\.css"\),\s*\{ encoding: "utf-8" \}\s*\)/,
      to: (dir) => JSON.stringify(readFileSync(`${dir}/browser/default-stylesheet.css`, "utf-8")),
    },
    {
      file: "/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js",
      pattern: /require\.resolve\("\.\/xhr-sync-worker\.js"\)/,
      to: () => '""',
    },
  ];
  return {
    name: "bundle-jsdom",
    enforce: "pre",
    transform(code, id) {
      const path = id.split("?")[0]!;
      const hit = replacements.find((r) => path.endsWith(r.file));
      if (!hit) return null;
      if (!hit.pattern.test(code)) throw new Error(`bundle-jsdom: ${hit.file} no longer matches ${hit.pattern}`);
      const dir = path.slice(0, path.indexOf("/lib/jsdom/") + "/lib/jsdom".length);
      return { code: code.replace(hit.pattern, hit.to(dir)), map: null };
    },
  };
}

export default defineConfig({
  resolve: {
    alias: { $pipeline: fileURLToPath(new URL("../src", import.meta.url)) },
  },
  plugins: [
    bundleJsdom(),
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
