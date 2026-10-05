// src/ingest/imap.ts `ingestImapAccount` against real SQL with real mail parsing: what becomes a
// `raw_items` row, what is logged to `ingest_drops` and why, and that a retried run does not double
// either. Only the IMAP connection and the unsubscribe-link lookup are stubs.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { useTestDatabase } from "./fixtures/database";

const connection = {
  mails: [] as string[],
  searches: [] as unknown[],
  opened: [] as string[],
  ended: 0,
  searchError: null as Error | null,
  connectError: null as Error | null,
};
const unsubscribeLookups: string[] = [];

mock.module("../src/ingest/imap-client", () => ({
  openImap: async () => {
    if (connection.connectError) throw connection.connectError;
    return {
      end: () => connection.ended++,
      openBox: (folder: string, _readOnly: boolean, cb: (err: Error | null) => void) => {
        connection.opened.push(folder);
        cb(null);
      },
      search: (criteria: unknown, cb: (err: Error | null, uids: number[]) => void) => {
        connection.searches.push(criteria);
        if (connection.searchError) return cb(connection.searchError, []);
        cb(null, connection.mails.map((_, i) => i + 1));
      },
      fetch: () => {
        const fetch = new EventEmitter();
        queueMicrotask(() => {
          for (const mail of connection.mails) {
            const msg = new EventEmitter();
            const body = new EventEmitter();
            fetch.emit("message", msg);
            msg.emit("body", body);
            body.emit("data", Buffer.from(mail));
            body.emit("end");
          }
          fetch.emit("end");
        });
        return fetch;
      },
    };
  },
}));
mock.module("../src/ingest/unsubscribe", () => ({
  findUnsubscribeLink: async (parsed: { from?: { text?: string } }) => {
    unsubscribeLookups.push(parsed.from?.text ?? "");
    return "https://news.example.com/unsubscribe";
  },
}));

const database = await useTestDatabase();
const { db, rawItems, ingestDrops, sourceQuality } = await import("../src/db");
const { ingestImapAccount } = await import("../src/ingest/imap");

const DAY = "2026-10-06";
const account = { label: "news", host: "imap.example.com", user: "news@example.com", password: "x", folder: "INBOX", isNewsAccount: true, customInstructions: null };
const config = { domains: { "weekly.example.org": "Weekly Review" }, addresses: { "editor@paper.example.com": "The Paper" } };

let counter = 0;
function mail(o: { from?: string; subject?: string; id?: string | null; body?: string; headers?: string[]; html?: string } = {}): string {
  const id = o.id === null ? [] : [`Message-ID: <${o.id ?? `m${++counter}`}@mail.example.com>`];
  const lines = [
    ...id,
    `From: ${o.from ?? "Alice <alice@example.com>"}`,
    "To: news@example.com",
    `Subject: ${o.subject ?? "Hello"}`,
    "Date: Mon, 05 Oct 2026 08:00:00 +0000",
    ...(o.headers ?? []),
    `Content-Type: ${o.html ? "text/html" : "text/plain"}; charset=utf-8`,
    "",
    o.html ?? o.body ?? "A real paragraph of text.",
  ];
  return lines.join("\r\n");
}

const ingest = (opts: { account?: Partial<typeof account> & { ignore?: string[] }; rss?: string[]; checked?: Set<string>; date?: string } = {}) =>
  ingestImapAccount({ ...account, ...opts.account }, opts.date ?? DAY, config, new Set(opts.rss ?? []), opts.checked ?? new Set());
const items = () => db.select().from(rawItems).orderBy(rawItems.messageId);
const drops = () => db.select().from(ingestDrops).orderBy(ingestDrops.messageId);

beforeEach(async () => {
  Object.assign(connection, { mails: [], searches: [], opened: [], ended: 0, searchError: null, connectError: null });
  unsubscribeLookups.length = 0;
  delete process.env.IMAP_LOOKBACK_DAYS;
  await database.sql`truncate raw_items, ingest_drops, source_quality cascade`;
});

describe("what is stored", () => {
  test("a personal mail keeps its subject and sender in the content and its account on the row", async () => {
    connection.mails = [mail({ id: "p1", from: "Alice <Alice@Example.com>", subject: "Lunch?", body: "Are you free on Friday?" })];
    expect(await ingest({ account: { isNewsAccount: false, user: "private@example.com" } })).toBe(1);

    const [row] = await items();
    expect(row).toMatchObject({ runDate: DAY, sourceType: "personal_email", sourceName: "alice@example.com", accountId: "private@example.com", messageId: "<p1@mail.example.com>" });
    expect(row!.rawContent).toBe("Subject: Lunch?\nFrom: \"Alice\" <Alice@Example.com>\n\nAre you free on Friday?");
    expect(new Date(row!.receivedAt!).toISOString()).toBe("2026-10-05T08:00:00.000Z");
  });

  test("on a news account an address rule, a domain rule and list headers each make it a newsletter", async () => {
    connection.mails = [
      mail({ id: "a", from: "Ed <editor@paper.example.com>" }),
      mail({ id: "b", from: "Newsroom <hello@weekly.example.org>" }),
      mail({ id: "c", from: '"Brand New" <news@fresh.example.net>', headers: ["List-Unsubscribe: <mailto:u@fresh.example.net>"] }),
      mail({ id: "d", from: "Bob <bob@example.com>" }),
    ];
    await ingest();
    const byId = Object.fromEntries((await items()).map((r) => [r.messageId!.slice(1, 2), [r.sourceType, r.sourceName]]));
    expect(byId).toEqual({ a: ["newsletter", "The Paper"], b: ["newsletter", "Weekly Review"], c: ["newsletter", "Brand New"], d: ["personal_email", "bob@example.com"] });
  });

  test("a mail on a non-news account is personal even from a newsletter address", async () => {
    connection.mails = [mail({ id: "a", from: "Ed <editor@paper.example.com>" })];
    await ingest({ account: { isNewsAccount: false } });
    expect((await items())[0]).toMatchObject({ sourceType: "personal_email", sourceName: "editor@paper.example.com" });
  });

  test("html mail is reduced to its text", async () => {
    connection.mails = [mail({ id: "h", html: "<html><body><style>p{color:red}</style><p>First <b>point</b></p><img src='x.gif'><p>Second point</p></body></html>" })];
    await ingest({ account: { isNewsAccount: false } });
    const text = (await items())[0]!.rawContent!;
    expect(text).toContain("First point");
    expect(text).toContain("Second point");
    expect(text).not.toMatch(/<(p|b|img|style)|color:red/);
  });

  test("more mails than one parse batch are all stored", async () => {
    connection.mails = Array.from({ length: 19 }, () => mail({ from: "Bob <bob@example.com>" }));
    expect(await ingest()).toBe(19);
    expect(await items()).toHaveLength(19);
  });
});

describe("what is dropped, and why it is logged", () => {
  test("each discard reason lands in ingest_drops with the mail's own details, and nothing is stored", async () => {
    connection.mails = [
      mail({ id: "s1", from: "Substack <no-reply@substack.com>", subject: "Confirm" }),
      mail({ id: "s2", from: "Substack <notifications@substack.com>", subject: "New comment" }),
      mail({ id: "i1", from: "Spammer <Spam@Example.com>", subject: "Offer" }),
      mail({ id: "r1", from: "Newsroom <hello@weekly.example.org>", subject: "Issue 12" }),
      mail({ id: "e1", from: "Carol <carol@example.com>", subject: "Blank", body: "" }),
    ];
    expect(await ingest({ account: { ignore: ["Spam@EXAMPLE.com"] }, rss: ["Weekly Review"] })).toBe(0);

    expect(await items()).toHaveLength(0);
    const byId = Object.fromEntries((await drops()).map((d) => [d.messageId!.slice(1, 3), d]));
    expect(Object.fromEntries(Object.entries(byId).map(([k, d]) => [k, d.reason]))).toEqual({
      s1: "substack_system", s2: "substack_system", i1: "ignored_sender", r1: "covered_by_rss", e1: "empty_content",
    });
    expect(byId.i1).toMatchObject({ runDate: DAY, accountId: "news@example.com", subject: "Offer", sender: "\"Spammer\" <Spam@Example.com>", sourceType: null });
    expect(byId.r1).toMatchObject({ sourceType: "newsletter", sourceName: "Weekly Review" });
    expect(byId.e1).toMatchObject({ sourceType: "personal_email", sourceName: "carol@example.com" });
    expect(new Date(byId.e1!.receivedAt!).toISOString()).toBe("2026-10-05T08:00:00.000Z");
  });

  test("a covered-by-RSS source is only dropped when the mail is a newsletter", async () => {
    connection.mails = [mail({ id: "p", from: "Weekly Review <person@example.com>" })];
    expect(await ingest({ rss: ["Weekly Review"] })).toBe(1);
  });

  test("a mail already in raw_items, or repeated in the same fetch, is skipped without being logged", async () => {
    connection.mails = [mail({ id: "dup", from: "Bob <bob@example.com>" })];
    await ingest({ date: "2026-10-05" });

    connection.mails = [mail({ id: "dup", from: "Bob <bob@example.com>" }), mail({ id: "new", from: "Bob <bob@example.com>" }), mail({ id: "new", from: "Bob <bob@example.com>" })];
    expect(await ingest()).toBe(1);

    expect((await items()).map((r) => [r.messageId, r.runDate])).toEqual([["<dup@mail.example.com>", "2026-10-05"], ["<new@mail.example.com>", DAY]]);
    expect(await drops()).toHaveLength(0);
  });

  test("an already stored mail is not judged again, so a source that is covered by RSS now does not log it", async () => {
    connection.mails = [mail({ id: "old", from: "Newsroom <hello@weekly.example.org>" })];
    await ingest({ date: "2026-10-05" });
    expect(await ingest({ rss: ["Weekly Review"] })).toBe(0);
    expect(await drops()).toHaveLength(0);
  });

  test("a retried run rewrites this account's drops for the date instead of adding to them", async () => {
    connection.mails = [mail({ id: "s1", from: "Substack <no-reply@substack.com>" })];
    await ingest();
    await ingest();
    expect(await drops()).toHaveLength(1);
  });

  test("the rewrite leaves other accounts and other dates alone", async () => {
    connection.mails = [mail({ id: "s1", from: "Substack <no-reply@substack.com>" })];
    await ingest({ account: { user: "other@example.com" } });
    await ingest({ date: "2026-10-05" });
    await ingest();
    expect((await drops()).map((d) => [d.accountId, d.runDate]).sort()).toEqual([
      ["news@example.com", "2026-10-05"], ["news@example.com", DAY], ["other@example.com", DAY],
    ]);
  });
});

describe("the unsubscribe lookup", () => {
  test("runs once per newsletter source and records the link on source_quality", async () => {
    connection.mails = [mail({ from: "Newsroom <a@weekly.example.org>" }), mail({ from: "Newsroom <b@weekly.example.org>" }), mail({ from: "Ed <editor@paper.example.com>" })];
    await ingest();
    expect(unsubscribeLookups).toHaveLength(2);
    const rows = await db.select().from(sourceQuality).orderBy(sourceQuality.sourceName);
    expect(rows.map((r) => [r.sourceName, r.unsubscribeUrl])).toEqual([["The Paper", "https://news.example.com/unsubscribe"], ["Weekly Review", "https://news.example.com/unsubscribe"]]);
    expect(rows.every((r) => r.unsubscribeCheckedAt)).toBe(true);
  });

  test("the checked set is shared across accounts, so a source seen already is not looked up again", async () => {
    const checked = new Set(["Weekly Review"]);
    connection.mails = [mail({ from: "Newsroom <a@weekly.example.org>" })];
    await ingest({ checked });
    expect(unsubscribeLookups).toEqual([]);
    expect(await db.select().from(sourceQuality)).toHaveLength(0);
  });

  test("a personal mail never triggers it", async () => {
    connection.mails = [mail({ from: "Bob <bob@example.com>" })];
    await ingest();
    expect(unsubscribeLookups).toEqual([]);
  });
});

describe("the connection", () => {
  test("reads INBOX by default, or the account's folder, and searches since the lookback day", async () => {
    process.env.IMAP_LOOKBACK_DAYS = "3";
    const before = Date.now();
    await ingest({ account: { folder: undefined as unknown as string } });
    await ingest({ account: { folder: "Archive" } });
    expect(connection.opened).toEqual(["INBOX", "Archive"]);

    const [[criterion]] = connection.searches[0] as [[string, Date]];
    expect(criterion).toBe("SINCE");
    const since = (connection.searches[0] as [[string, Date]])[0]![1].getTime();
    expect(Math.round((before - since) / (24 * 3600 * 1000))).toBe(3);
  });

  test("defaults to a one day lookback", async () => {
    const before = Date.now();
    await ingest();
    const since = (connection.searches[0] as [[string, Date]])[0]![1].getTime();
    expect(Math.round((before - since) / (24 * 3600 * 1000))).toBe(1);
  });

  test("the connection is closed after a fetch and also when the fetch fails, and a failure stores nothing", async () => {
    connection.mails = [mail({ from: "Bob <bob@example.com>" })];
    await ingest();
    expect(connection.ended).toBe(1);

    connection.searchError = new Error("search failed");
    await expect(ingest()).rejects.toThrow("search failed");
    expect(connection.ended).toBe(2);
  });

  test("a connection error propagates", async () => {
    connection.connectError = new Error("Invalid credentials");
    await expect(ingest()).rejects.toThrow("Invalid credentials");
    expect(await items()).toHaveLength(0);
  });
});
