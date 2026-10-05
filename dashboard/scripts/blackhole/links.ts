/** The "content links reach their pages" step: follow what a reader would tap, offline. */
import type { Page } from "playwright-core";
import { isMirroredPath, MIRRORED_ROUTES, STATIC_OFFLINE_ROUTES } from "../../src/lib/offline/tiers.ts";
import { onlineOnlyFor } from "../../src/lib/offline/onlineOnly.ts";
import { expectedText, pathFor } from "./helpers.ts";

/** Follow visible content links whose destinations the fixture can render without a database. */
export async function checkInternalLinks(page: Page, origin: string): Promise<number> {
  let followed = 0;
  const showContentLinks = async (id: string) => {
    if (id !== "/" && id !== "/[date]") return;
    const collapsed = page.locator('main a[aria-expanded="false"][href]');
    while (await collapsed.count()) {
      const toggle = collapsed.first();
      const label = await toggle.innerText({ timeout: 3_000 });
      await toggle.click({ timeout: 3_000 }).catch(() => {
        throw new Error(`${id}: could not expand ${label}`);
      });
    }
  };
  for (const id of [...MIRRORED_ROUTES, ...STATIC_OFFLINE_ROUTES]) {
    const source = pathFor(id);
    await page.goto(`${origin}${source}`);
    await page.getByText(expectedText(id)).first().waitFor({ state: "visible" });
    await showContentLinks(id);
    const sourcePath = new URL(page.url()).pathname;
    const links = await page.locator("main a[href]").evaluateAll((anchors) =>
      anchors.map((anchor, index) => ({ index, href: (anchor as HTMLAnchorElement).href, label: anchor.textContent?.trim() ?? "", toggle: anchor.hasAttribute("aria-expanded") })),
    );
    const seen = new Set<string>();
    for (const link of links) {
      if (link.toggle) continue;
      const target = new URL(link.href);
      if (target.origin !== origin || (target.pathname === sourcePath && target.hash)) continue;
      const name = `${source}: ${link.label || link.href}`;
      const known = isMirroredPath(target.pathname) || STATIC_OFFLINE_ROUTES.has(target.pathname) || onlineOnlyFor(target.pathname);
      if (!known) throw new Error(`${name} points to an unknown route: ${target.pathname}`);
      if (!isMirroredPath(target.pathname) && !STATIC_OFFLINE_ROUTES.has(target.pathname)) continue;
      if (seen.has(target.href)) continue;
      seen.add(target.href);

      await page.goto(`${origin}${source}`);
      await page.getByText(expectedText(id)).first().waitFor({ state: "visible" });
      await showContentLinks(id);
      const anchor = page.locator("main a[href]").nth(link.index);
      if (!(await anchor.isVisible())) continue;
      await anchor.click({ timeout: 3_000 }).catch(() => {
        throw new Error(`${name} could not be clicked`);
      });
      await page.waitForURL(target.href, { timeout: 5_000 }).catch(() => {
        throw new Error(`${name} did not reach ${target.pathname}; reached ${new URL(page.url()).pathname}`);
      });
      const error = page.getByRole("heading", { name: /^(404|Not found|Internal Error)$/i });
      if (await error.isVisible()) throw new Error(`${name} opened an error page: ${target.pathname}`);
      await page.locator("main").first().waitFor({ state: "visible" });
      followed++;
    }
  }
  if (followed === 0) throw new Error("no internal content links were followed");
  return followed;
}
