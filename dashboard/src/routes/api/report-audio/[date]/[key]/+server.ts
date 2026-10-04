import { isDateKey } from "$pipeline/util/ids";
import { errMessage } from "$pipeline/util/text";
import type { RequestHandler } from "./$types";
import { SKILLS_BRIDGE_URL } from "$app/env/private";

// One chapter as MP3. The bridge speaks it on the first request and serves it from the database
// afterwards. POST rather than GET because the first request can cost money.
const API = SKILLS_BRIDGE_URL ?? "http://localhost:4000";

export const POST: RequestHandler = async ({ params }) => {
  if (!isDateKey(params.date) || !/^[0-9a-f]{16}$/.test(params.key)) {
    return Response.json({ error: "Invalid chapter" }, { status: 400 });
  }

  try {
    const res = await fetch(`${API}/api/report-audio/${params.date}/${params.key}`, { method: "POST" });
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    for (const name of ["Content-Type", "Content-Length", "X-Audio-Duration-Ms"]) {
      const value = res.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(res.body, { status: res.status, headers });
  } catch (err) {
    return Response.json(
      { error: `Skills bridge unreachable at ${API}: ${errMessage(err)}` },
      { status: 502 },
    );
  }
};
