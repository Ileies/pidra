import { isDateKey } from "$pipeline/util/ids";
import type { RequestHandler } from "./$types";
import { bridgeProxy } from "#lib/server/bridge.js";

// One chapter as MP3. The bridge speaks it on the first request and serves it from the database
// afterwards. POST rather than GET because the first request can cost money.

export const POST: RequestHandler = async ({ params }) => {
  if (!isDateKey(params.date) || !/^[0-9a-f]{16}$/.test(params.key)) {
    return Response.json({ error: "Invalid chapter" }, { status: 400 });
  }

  return bridgeProxy(`/api/report-audio/${params.date}/${params.key}`, { method: "POST" }, {
    stream: true,
    headers: { "Cache-Control": "private, no-store" },
    copyHeaders: ["Content-Length", "X-Audio-Duration-Ms"],
  });
};
