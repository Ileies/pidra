import { json } from "@sveltejs/kit";
import { UUID_RE } from "#lib/ids.js";
import { sql } from "#lib/server/postgres.js";
import { tidyRawContent } from "#lib/mail.js";

/**
 * The stored body of one extraction's source item, read on demand by the detail page's "Fetch
 * contents" button. It stays out of the offline mirror and out of `GET /api/extractions` on
 * purpose (`docs/offline-mode.md`), so it is only ever held in the page that asked for it and is
 * dropped with it: `no-store` keeps the browser and the service worker from keeping a copy too.
 */
export const GET = async ({ params }) => {
  const id = params.id;
  if (!UUID_RE.test(id)) return json({ error: "Invalid extraction id" }, { status: 400 });

  const rows = await sql()`
    SELECT r.raw_content
    FROM extractions e
    JOIN raw_items r ON r.id = e.raw_item_id
    WHERE e.id = ${id}
  `;
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });

  return json(
    { rawContent: tidyRawContent(rows[0].raw_content as string | null) },
    { headers: { "Cache-Control": "no-store" } },
  );
};
