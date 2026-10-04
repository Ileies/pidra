import { Hono } from "hono";
import { isDateKey } from "../../util/ids";
import { audioManifest, AudioError, chapterAudio } from "../../audio/store";

// Listening to a report. The chapters and their text come from the stored report; a request names
// only a date and a chapter key, so it can never make the server speak text of its own choosing.
const KEY_PARAM = /^[0-9a-f]{16}$/;

export const audio = new Hono();

audio.get("/api/report-audio/:date", async (c) => {
  const date = c.req.param("date");
  if (!isDateKey(date)) return c.json({ error: "Invalid date" }, 400);
  return c.json(await audioManifest(date));
});

// POST because it can cost money (a chapter not yet spoken); a cached chapter is a plain read.
audio.post("/api/report-audio/:date/:key", async (c) => {
  const { date, key } = c.req.param();
  if (!isDateKey(date) || !KEY_PARAM.test(key)) return c.json({ error: "Invalid chapter" }, 400);
  try {
    const { audio: mp3, durationMs } = await chapterAudio(date, key);
    return new Response(new Uint8Array(mp3), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(mp3.length),
        "X-Audio-Duration-Ms": String(durationMs),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof AudioError) throw err;
    console.error("report audio failed:", err);
    return c.json({ error: "The voice could not be generated. Try again." }, 502);
  }
});
