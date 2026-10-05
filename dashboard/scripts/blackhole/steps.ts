/**
 * The controls the suite taps, per route. Each starts where the previous one left the page, so
 * the order within a route matters. `EXPECTED_WRITES` is what they queue, once each.
 */
import type { Page } from "playwright-core";
import * as F from "./fixture.ts";
import { card, clickLink, expectQueued, INDICATOR, remaining, tap, visible } from "./helpers.ts";

export interface Control {
  name: string;
  run: (page: Page, deadline: number) => Promise<void>;
}

export const CONTROLS: Record<string, Control[]> = {
  "/[date]": [
    {
      name: "open the sources inline",
      async run(page, deadline) {
        // A tap on the prose itself, away from any link in it, is what a reader does.
        await tap(page.locator("[data-expandable] .report-body").first(), deadline, { position: { x: 4, y: 4 } });
        await visible(page.getByText("Example permit reminder"), deadline);
      },
    },
    {
      name: "rate an entry",
      async run(page, deadline) {
        // The rating buttons live inside the opened entry, so this follows "open the sources inline".
        await tap(page.getByRole("button", { name: "Relevant - this was worth reading" }).first(), deadline);
        await page.waitForFunction(() => document.querySelector('button[aria-pressed="true"]') !== null, null, { timeout: remaining(deadline) });
        await expectQueued(page, deadline);
      },
    },
    {
      name: "open the archive",
      async run(page, deadline) {
        await tap(page.getByRole("button", { name: /Today/ }), deadline);
        await visible(page.getByText("Recent reports"), deadline);
        await visible(page.locator(`a[href="/${F.YESTERDAY}"]`), deadline);
        await page.keyboard.press("Escape");
      },
    },
    {
      name: "step to the previous day",
      async run(page, deadline) {
        await tap(page.getByRole("link", { name: /Previous day/ }), deadline);
        await visible(page.getByText(F.TEXT.yesterday), deadline);
      },
    },
    {
      name: "open a day with no report",
      async run(page, deadline) {
        await clickLink(page, `/${F.EMPTY_DAY}`);
        await visible(page.getByText(/^No report for/), deadline);
        await visible(page.getByText("Running the pipeline needs the connection."), deadline);
        if (await page.getByRole("button", { name: "Run pipeline now" }).isEnabled()) throw new Error("Run pipeline now is enabled offline");
      },
    },
    {
      name: "search the offline copy",
      async run(page, deadline) {
        await clickLink(page, `/${F.TODAY}`);
        await visible(page.getByText(F.TEXT.personal), deadline);
        await page.keyboard.press("/");
        await page.keyboard.type("permit");
        await visible(page.getByText(/^Offline: searching the copy on this device/), deadline);
        await visible(page.getByRole("dialog").getByText(/permit/i), deadline);
        await page.keyboard.press("Escape");
      },
    },
    {
      // Never queued: it writes to Google Calendar or Tasks. Offline it is disabled with the reason.
      name: "a quick action says it needs the connection",
      async run(page, deadline) {
        const list = page.getByRole("list", { name: "Quick actions" });
        await visible(list.getByText(F.ACTION.title), deadline);
        await visible(list.getByText("Needs the connection"), deadline);
        if (await list.getByRole("button", { name: "Add to to-do" }).isEnabled()) throw new Error("Add to to-do is enabled offline");
      },
    },
    {
      name: "open the sync sheet",
      async run(page, deadline) {
        await tap(INDICATOR(page), deadline);
        await visible(page.getByText("Sync status"), deadline);
        await visible(page.getByRole("dialog").getByText("Rating"), deadline);
        await page.keyboard.press("Escape");
      },
    },
  ],
  "/[date]/detail/[ids]": [
    {
      name: "rate an extraction",
      async run(page, deadline) {
        await tap(page.getByRole("button", { name: "Not relevant" }).first(), deadline);
        await page.waitForFunction(
          () => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Not relevant") && b.getAttribute("aria-pressed") === "true"),
          null,
          { timeout: remaining(deadline) },
        );
        await expectQueued(page, deadline);
      },
    },
    {
      name: "go deeper is online-only",
      async run(page, deadline) {
        await visible(page.getByText("Going deeper needs the connection."), deadline);
        if (await page.getByRole("button", { name: /go deeper/ }).isEnabled()) throw new Error("Summarise and go deeper is enabled offline");
      },
    },
  ],
  "/notes": [
    {
      name: "create a note",
      async run(page, deadline) {
        await tap(page.getByRole("button", { name: "New note", exact: true }), deadline);
        await page.getByLabel("New note content").fill("Offline note from the suite");
        await tap(page.getByRole("button", { name: "Add", exact: true }), deadline);
        const text = "Offline note from the suite";
        await visible(page.getByText(text, { exact: true }), deadline);
        await visible(card(page, text, page.getByText("Queued", { exact: true })), deadline);
      },
    },
    {
      name: "open a note's history",
      async run(page, deadline) {
        await tap(page.getByText("1 change", { exact: true }), deadline);
        // Known offline it is never sent; still checking, it is sent and cut off by the probe.
        await visible(page.getByText(/^(Needs the connection\.|Lost the connection before the server answered\.)$/), deadline);
        // The sheet is modal: the rest of the page is inert until it is closed.
        await tap(page.getByRole("button", { name: "Close", exact: true }), deadline);
      },
    },
    {
      name: "edit a note",
      async run(page, deadline) {
        await tap(page.getByRole("button", { name: F.TEXT.note }), deadline);
        await page.getByLabel("Note content", { exact: true }).fill("Edited offline");
        await tap(page.getByRole("button", { name: "Save", exact: true }), deadline);
        await visible(page.getByText("Edited offline", { exact: true }), deadline);
        await visible(card(page, "Edited offline", page.getByText("Queued", { exact: true })), deadline);
      },
    },
    {
      name: "delete a note",
      async run(page, deadline) {
        // Delete lives in the open editor, not on the resting card.
        await tap(page.getByRole("button", { name: "Edited offline" }), deadline);
        await tap(page.getByRole("button", { name: "Delete this note" }), deadline);
        await visible(page.getByText("Note deleted."), deadline);
        await page.getByText("Edited offline", { exact: true }).waitFor({ state: "hidden", timeout: remaining(deadline) });
      },
    },
    {
      name: "restore a note from the trash",
      async run(page, deadline) {
        // The two toasts of the steps before sit over the last card, as they would under a thumb.
        for (const dismiss of await page.getByRole("button", { name: "Dismiss notification" }).all()) {
          await dismiss.click({ timeout: 500 }).catch(() => {}); // one may time out on its own meanwhile
        }
        await tap(page.getByRole("button", { name: /^Trash/ }), deadline);
        const restore = page.getByRole("button", { name: "Restore", exact: true });
        await tap(card(page, F.TEXT.trashedNote, restore).getByRole("button", { name: "Restore", exact: true }), deadline);
        await page.getByText(F.TEXT.trashedNote, { exact: true }).waitFor({ state: "hidden", timeout: remaining(deadline) });
        await tap(page.getByRole("button", { name: "Notes", exact: true }), deadline);
        await visible(page.getByText(F.TEXT.trashedNote, { exact: true }), deadline);
      },
    },
    {
      name: "search the notes",
      async run(page, deadline) {
        await page.getByLabel("Search notes").fill("from the suite");
        await visible(page.getByText("Offline note from the suite", { exact: true }), deadline);
        await page.getByText(F.TEXT.trashedNote, { exact: true }).waitFor({ state: "hidden", timeout: remaining(deadline) });
        await page.getByLabel("Search notes").fill("");
      },
    },
  ],
  "/context-builder": [
    {
      name: "run controls are online-only",
      async run(page, deadline) {
        await visible(page.getByText("Starting or stopping a run needs the connection."), deadline);
        for (const name of ["Start", "Force full", "Stop"]) {
          if (await page.getByRole("button", { name, exact: true }).isEnabled()) throw new Error(`${name} is enabled offline`);
        }
      },
    },
  ],
  "/entities": [
    {
      name: "search the entities",
      async run(page, deadline) {
        await page.getByLabel("Search entities").fill("Project");
        await page.getByLabel("Search entities").press("Enter");
        await visible(page.getByText(F.TEXT.otherEntity), deadline);
        await page.getByText(F.TEXT.entity, { exact: true }).waitFor({ state: "hidden", timeout: remaining(deadline) });
      },
    },
    {
      name: "open an entity",
      async run(page, deadline) {
        await tap(page.getByRole("link", { name: F.TEXT.otherEntity }).first(), deadline);
        await visible(page.getByRole("heading", { name: F.TEXT.otherEntity }), deadline);
      },
    },
  ],
  "/entities/[id]": [
    {
      name: "watching is online-only",
      async run(page, deadline) {
        await visible(page.getByText(/^Watching needs the connection/), deadline);
        const watch = page.locator('button[title="Needs the connection"]').first();
        await visible(watch, deadline);
        if (await watch.isEnabled()) throw new Error("the watch button is enabled offline");
      },
    },
  ],
  "/contacts": [
    {
      name: "editing is online-only",
      async run(page, deadline) {
        await visible(page.getByText(/^Editing needs the connection/), deadline);
        const edit = page.locator('button[title="Needs the connection"]').first();
        await visible(edit, deadline);
        if (await edit.isEnabled()) throw new Error("the contact edit button is enabled offline");
      },
    },
  ],
  "/topics": [
    {
      name: "curation is online-only",
      async run(page, deadline) {
        // Disabled once the app knows it is offline, which on a blackholed cold start is the
        // probe's 3 s in; a tap before that is answered "Not sent" by the form guard.
        await visible(page.getByText(/never queued offline/), deadline);
        await page.waitForFunction(
          () => {
            const buttons = [...document.querySelectorAll<HTMLButtonElement>('form[action="?/setStatus"] button')];
            return buttons.length > 0 && buttons.every((b) => b.disabled);
          },
          null,
          { timeout: remaining(deadline) },
        );
      },
    },
  ],
};

export const RETRY: Control = {
  name: "try again",
  async run(page, deadline) {
    await tap(page.getByRole("button", { name: "Try again" }), deadline);
    // The probe answers within its own 3 s budget; the notice must still be there afterwards.
    await page.getByRole("button", { name: "Try again" }).waitFor({ state: "visible", timeout: remaining(deadline) });
  },
};

/** What the controls above queue, once each. */
export const EXPECTED_WRITES = [
  `POST /api/feedback`,
  `POST /api/notes`,
  `PATCH /api/notes/${F.NOTE_ID}`,
  `DELETE /api/notes/${F.NOTE_ID}`,
  `POST /api/notes/${F.TRASHED_NOTE_ID}/restore`,
];
