// context-builder/sources/email.ts `fetchEmailItems` with real mail parsing: which messages become
// items, how the From header is split into name and address, and how a bad message or a dropped
// connection is survived. The IMAP connection is a fake; the error log (a tracked file) is a stub.
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";

type Spec = { from?: string; subject?: string; id?: string | null; date?: string | null; body?: string; html?: string; rawHeaders?: string };

const imap = {
  mails: [] as Spec[],
  searches: [] as unknown[],
  bodyFetches: [] as number[],
  ended: 0,
  opened: 0,
  connectFailures: 0,
  attributesLast: false,
  fetchEndsFirst: false,
  bodyBehavior: new Map<number, "hang" | "error">(),
};
const logged: { source: string; message: string; itemId?: string }[] = [];

mock.module("../src/ingest/imap-client", () => ({
  openImap: async () => {
    imap.opened++;
    if (imap.connectFailures > 0) {
      imap.connectFailures--;
      throw new Error("connection reset");
    }
    return fakeConnection();
  },
}));
mock.module("../context-builder/errors", () => ({
  logError: async (source: string, error: unknown, itemId?: string) => { logged.push({ source, message: String(error), itemId }); },
  loadErrors: async () => [],
  getErrors: () => [],
}));

const { fetchEmailItems } = await import("../context-builder/sources/email");

const headerText = (s: Spec, uid: number): string =>
  s.rawHeaders ?? [
    ...(s.id === null ? [] : [`Message-ID: <${s.id ?? `m${uid}`}@mail.example.com>`]),
    `From: ${s.from ?? "Alice <alice@example.com>"}`,
    `Subject: ${s.subject ?? "Hello"}`,
    ...(s.date === null ? [] : [`Date: ${s.date ?? "Mon, 05 Oct 2026 08:00:00 +0000"}`]),
  ].join("\r\n");

const fullText = (s: Spec, uid: number): string =>
  [headerText(s, uid), `Content-Type: ${s.html ? "text/html" : "text/plain"}; charset=utf-8`, "", s.html ?? s.body ?? "A real paragraph of text."].join("\r\n");

function fakeConnection() {
  return {
    end: () => imap.ended++,
    openBox: (_folder: string, _readOnly: boolean, cb: (err: Error | null) => void) => cb(null),
    search: (criteria: unknown, cb: (err: Error | null, uids: number[]) => void) => {
      imap.searches.push(criteria);
      cb(null, imap.mails.map((_, i) => i + 1));
    },
    fetch: (uids: number[], options: { bodies: string }) => {
      const fetch = new EventEmitter();
      const wantsBody = options.bodies === "";
      queueMicrotask(() => {
        for (const uid of uids) {
          const spec = imap.mails[uid - 1]!;
          if (wantsBody) imap.bodyFetches.push(uid);
          if (wantsBody && imap.bodyBehavior.get(uid) === "error") return void fetch.emit("error", new Error("fetch failed"));
          const msg = new EventEmitter();
          const stream = new EventEmitter();
          fetch.emit("message", msg);
          if (!wantsBody && !imap.attributesLast) msg.emit("attributes", { uid });
          msg.emit("body", stream);
          if (wantsBody ? imap.bodyBehavior.get(uid) !== "hang" : true) {
            const deliver = () => {
              stream.emit("data", Buffer.from(wantsBody ? fullText(spec, uid) : headerText(spec, uid)));
              stream.emit("end");
            };
            if (wantsBody && imap.fetchEndsFirst) setTimeout(deliver, 0);
            else deliver();
          }
          if (!wantsBody && imap.attributesLast) msg.emit("attributes", { uid });
        }
        fetch.emit("end");
      });
      return fetch;
    },
  };
}

const account = { label: "personal", host: "imap.example.com", user: "me@example.com", password: "x", folder: "INBOX", isNewsAccount: false, customInstructions: null };
const run = (skip: string[] = [], progress?: Parameters<typeof fetchEmailItems>[3], over: Partial<typeof account> = {}) =>
  fetchEmailItems({ ...account, ...over }, 2, new Set(skip), progress);
const one = async (spec: Spec) => {
  imap.mails = [spec];
  return (await run()).items[0];
};

let sleepSpy: ReturnType<typeof spyOn>;
let stderrSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  Object.assign(imap, { mails: [], searches: [], bodyFetches: [], ended: 0, opened: 0, connectFailures: 0, attributesLast: false, fetchEndsFirst: false });
  imap.bodyBehavior.clear();
  logged.length = 0;
  sleepSpy = spyOn(Bun, "sleep").mockImplementation((async () => {}) as typeof Bun.sleep);
  stderrSpy = spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
  spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  mock.restore();
});

describe("the From header", () => {
  test("a display name and an address; the address is lower-cased and the quotes are dropped", async () => {
    expect(await one({ from: '"Doe, Jane" <Jane.Doe@Example.COM>' })).toMatchObject({ from: "jane.doe@example.com", fromName: "Doe, Jane" });
  });

  test("an encoded-word name is decoded", async () => {
    expect(await one({ from: "=?UTF-8?Q?M=C3=BCller?= <mueller@example.com>" })).toMatchObject({ fromName: "Müller", from: "mueller@example.com" });
  });

  test("an RFC 5322 comment is not part of the name", async () => {
    expect(await one({ from: '"Release Team" (via Announce List) <list@example.com>' })).toMatchObject({ fromName: "Release Team", from: "list@example.com" });
  });

  test("without a name, the address stands in for it, bare or in angle brackets", async () => {
    expect(await one({ from: "bob@example.com" })).toMatchObject({ fromName: "bob@example.com", from: "bob@example.com" });
    expect(await one({ from: "<carol@example.com>" })).toMatchObject({ fromName: "carol@example.com", from: "carol@example.com" });
  });

  test("a parenthesised text after a bare address is a comment, not a name", async () => {
    expect(await one({ from: "dave@example.com (Dave)" })).toMatchObject({ fromName: "dave@example.com", from: "dave@example.com" });
  });

  test("a header without an address drops the message: the address becomes contacts.identifier", async () => {
    imap.mails = [{ from: "Undisclosed recipients" }, { from: "Alice <alice@example.com>" }];
    expect((await run()).items.map((i) => i.from)).toEqual(["alice@example.com"]);
    expect(logged).toEqual([]);
  });

  test("a header folded over several lines is read whole", async () => {
    const item = await one({ rawHeaders: 'Message-ID: <fold@mail.example.com>\r\nFrom: "A Rather Long\r\n Display Name" <long@example.com>\r\nSubject: One\r\n\ttwo\r\nDate: Mon, 05 Oct 2026 08:00:00 +0000' });
    expect(item).toMatchObject({ fromName: "A Rather Long Display Name", subject: "One two" });
  });
});

describe("which messages become items", () => {
  test("an item carries the id, subject, ISO date and cleaned body", async () => {
    expect(await one({ id: "abc", subject: "Quarterly plan", body: "Please review the plan." })).toEqual({
      messageId: "<abc@mail.example.com>", from: "alice@example.com", fromName: "Alice", subject: "Quarterly plan", date: "2026-10-05T08:00:00.000Z", body: "Please review the plan.",
    });
  });

  test("an HTML-only message is reduced to its text", async () => {
    const item = await one({ html: "<html><body><p>Hello <b>there</b></p><script>alert(1)</script></body></html>" });
    expect(item!.body).toContain("Hello there");
    expect(item!.body).not.toMatch(/<|alert/);
  });

  test("a message without a Message-ID gets one from its UID", async () => {
    imap.mails = [{ id: "a" }, { id: null }];
    expect((await run()).items.map((i) => i.messageId)).toEqual(["<a@mail.example.com>", "unknown-2"]);
  });

  test("the real UID is used even when the attributes arrive after the body", async () => {
    imap.attributesLast = true;
    imap.mails = [{ id: "a", body: "first" }, { id: "b", body: "second" }];
    const { items } = await run();
    expect(items.map((i) => i.body)).toEqual(["first", "second"]);
    expect(imap.bodyFetches).toEqual([1, 2]);
  });

  test("a body whose stream ends after the fetch itself has ended is still read in full", async () => {
    imap.fetchEndsFirst = true;
    imap.mails = [{ body: "Arrives late." }];
    expect((await run()).items.map((i) => i.body)).toEqual(["Arrives late."]);
  });

  test("automated senders are skipped without their body being fetched", async () => {
    imap.mails = [
      { from: "Shop <noreply@example.com>" }, { from: "no-reply@example.com" }, { from: "Mail Delivery <MAILER-DAEMON@example.com>" },
      { from: "Notifications <notification@example.com>" }, { from: "do-not-reply@example.com" }, { from: "bounce+123@example.com" }, { from: "Real Person <person@example.com>" },
    ];
    expect((await run()).items.map((i) => i.from)).toEqual(["person@example.com"]);
    expect(imap.bodyFetches).toEqual([7]);
  });

  test("already indexed messages are counted, not fetched", async () => {
    imap.mails = [{ id: "old" }, { id: "new" }];
    const result = await run(["<old@mail.example.com>"]);
    expect(result.skipped).toBe(1);
    expect(result.items.map((i) => i.messageId)).toEqual(["<new@mail.example.com>"]);
    expect(imap.bodyFetches).toEqual([2]);
  });

  test("a message with an empty body is dropped", async () => {
    imap.mails = [{ body: "   " }, { body: "Something to read." }];
    expect((await run()).items.map((i) => i.body)).toEqual(["Something to read."]);
  });

  test("a long body arrives cut at 6000 characters with a truncation marker (cleanEmailContent's cap; the 50000 slice after it never bites)", async () => {
    const body = (await one({ body: "word ".repeat(20_000) }))!.body;
    expect(body).toHaveLength(6000 + "\n[truncated]".length);
    expect(body.endsWith("\n[truncated]")).toBe(true);
  });

  test("a message over 20 MB yields no item, and the next one is unaffected", async () => {
    imap.mails = [{ body: "x".repeat(21 * 1024 * 1024) }, { body: "Small one." }];
    expect((await run()).items.map((i) => i.body)).toEqual(["Small one."]);
    expect(logged).toEqual([]);
  });

  test("a news account yields nothing and is never connected to", async () => {
    imap.mails = [{}];
    expect(await run([], undefined, { isNewsAccount: true })).toEqual({ items: [], skipped: 0 });
    expect(imap.opened).toBe(0);
  });

  test("an empty mailbox yields nothing", async () => {
    expect(await run()).toEqual({ items: [], skipped: 0 });
    expect(imap.ended).toBe(1);
  });

  test("the search window starts the given number of years back", async () => {
    await run();
    const [[, since]] = imap.searches[0] as [string, Date][];
    const years = (Date.now() - since!.getTime()) / (365.25 * 24 * 3600 * 1000);
    expect(years).toBeGreaterThan(1.99);
    expect(years).toBeLessThan(2.01);
  });
});

describe("progress", () => {
  test("reports the header count once and one step per message, whatever happens to it", async () => {
    imap.mails = [{ id: "old" }, { from: "noreply@example.com" }, { body: " " }, { from: "Nobody" }, { id: "ok" }];
    const counts: number[] = [];
    let done = 0;
    await run(["<old@mail.example.com>"], { onHeaderCount: (n) => counts.push(n), onItemDone: () => done++ });
    expect(counts).toEqual([5]);
    expect(done).toBe(5);
  });
});

describe("failures", () => {
  test("a message whose body fetch fails is logged with its id, and the others still come through", async () => {
    imap.mails = [{ id: "bad" }, { id: "good" }];
    imap.bodyBehavior.set(1, "error");
    const { items } = await run();
    expect(items.map((i) => i.messageId)).toEqual(["<good@mail.example.com>"]);
    expect(logged).toEqual([{ source: "email:me@example.com", message: "Error: fetch failed", itemId: "<bad@mail.example.com>" }]);
  });

  test("a body that never arrives times out as an empty message instead of hanging the run", async () => {
    const real = globalThis.setTimeout;
    spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => real(fn, ms === 20_000 ? 0 : ms)) as typeof setTimeout);
    imap.mails = [{ id: "stuck" }, { id: "fine" }];
    imap.bodyBehavior.set(1, "hang");
    expect((await run()).items.map((i) => i.messageId)).toEqual(["<fine@mail.example.com>"]);
  });

  test("an unparsable Date header loses that one message, logged, not the account", async () => {
    imap.mails = [{ id: "odd", date: "not a date" }, { id: "fine" }];
    expect((await run()).items.map((i) => i.messageId)).toEqual(["<fine@mail.example.com>"]);
    expect(logged).toHaveLength(1);
    expect(logged[0]!.itemId).toBe("<odd@mail.example.com>");
  });

  test("a message without a Date header is dated now", async () => {
    const before = Date.now();
    const item = await one({ date: null });
    expect(new Date(item!.date).getTime()).toBeGreaterThanOrEqual(before);
  });

  test("a dropped connection is retried once after a pause, and the connection is closed each time", async () => {
    imap.connectFailures = 1;
    imap.mails = [{}];
    expect((await run()).items).toHaveLength(1);
    expect(imap.opened).toBe(2);
    expect(sleepSpy).toHaveBeenCalledWith(3000);
    expect(logged).toEqual([]);
    expect(imap.ended).toBe(1);
  });

  test("when the retry fails too, the result is empty and the error is logged", async () => {
    imap.connectFailures = 2;
    imap.mails = [{}];
    expect(await run()).toEqual({ items: [], skipped: 0 });
    expect(imap.opened).toBe(2);
    expect(logged).toEqual([{ source: "email:me@example.com", message: "Error: connection reset", itemId: undefined }]);
    expect(stderrSpy).toHaveBeenCalled();
  });
});
