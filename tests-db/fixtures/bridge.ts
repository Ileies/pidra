// The skills-bridge Hono app (src/server/index.ts) loaded for a route test: the model turn, the
// pipeline run, TTS and the skill gate are stubbed through `stub`; stores and SQL are real.
// Call `loadBridge()` after `useTestDatabase()`.
import { mock } from "bun:test";
import { HttpError } from "../../src/util/errors";

export class AudioError extends HttpError {}

type Fn = (...args: any[]) => any;

export const calls: [string, unknown[]][] = [];
const record = (name: string, args: unknown[]) => calls.push([name, args]);

export const stub: Record<string, Fn> = {};
export function resetStubs(): void {
  calls.length = 0;
  Object.assign(stub, {
    processAnswer: async () => {},
    runPipeline: async () => {},
    deepen: async () => "deepened text",
    sendMessage: async () => ({ reply: "hello" }),
    streamMessage: async function* () {},
    audioManifest: async () => ({ voice: "cedar", chapters: [] }),
    chapterAudio: async () => ({ audio: Buffer.from("mp3-bytes"), durationMs: 1200 }),
    resolvePendingSkill: async () => ({ status: "executed", message: "done" }),
    executeSkill: async () => ({ status: "executed", message: "Added to the calendar" }),
  });
}
resetStubs();

const through = (name: string) => (...args: unknown[]) => {
  record(name, args);
  return stub[name]!(...args);
};

mock.module("../../src/questions/process-answer", () => ({ processAnswer: through("processAnswer") }));
mock.module("../../src/pipeline/run", () => ({ runPipeline: through("runPipeline") }));
mock.module("../../src/ai/deepen", () => ({ deepen: through("deepen") }));
mock.module("../../src/ai/chat", () => ({ sendMessage: through("sendMessage"), streamMessage: (...args: unknown[]) => { record("streamMessage", args); return stub.streamMessage!(...args); } }));
mock.module("../../src/audio/store", () => ({ AudioError, audioManifest: through("audioManifest"), chapterAudio: through("chapterAudio") }));
mock.module("../../src/skills/execute", () => ({ resolvePendingSkill: through("resolvePendingSkill"), executeSkill: through("executeSkill") }));

export async function loadBridge() {
  // The real module with only the network reads replaced: a test must never reach Google. Imported
  // here, not at the top, because it reaches `src/db`, which must see the cloned database's URL.
  const realGoogle = await import("../../src/ingest/google");
  mock.module("../../src/ingest/google", () => ({ ...realGoogle, calendarTimeZone: async () => "Europe/Zurich", listCalendarEvents: async () => [] }));
  const server = (await import("../../src/server/index")).default;
  return {
    server,
    call: (path: string, init: RequestInit & { json?: unknown } = {}) => {
      const { json, ...rest } = init;
      const headers = new Headers(rest.headers);
      if (json !== undefined) headers.set("content-type", "application/json");
      return server.fetch(new Request(`http://bridge.test${path}`, { ...rest, headers, body: json === undefined ? rest.body : JSON.stringify(json) }));
    },
  };
}
