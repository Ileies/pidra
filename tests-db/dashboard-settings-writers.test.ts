// The online-only settings writers against real SQL: email accounts (passwords encrypted at rest and
// never read back), RSS feeds (what URL may be polled) and newsletter sender rules, each through the
// form actions that call them.
import { createDecipheriv } from "node:crypto";
import { beforeEach, describe, expect, test } from "bun:test";
import { makeEvent, setPrivateEnv } from "./fixtures/dashboard";
import { useTestDatabase } from "./fixtures/database";

const KEY_HEX = "ab".repeat(32);
const database = await useTestDatabase();
setPrivateEnv({ CONFIG_ENCRYPTION_KEY: KEY_HEX });
const accounts = await import("../dashboard/src/lib/server/emailAccounts");
const newsletters = await import("../dashboard/src/lib/server/newsletters");
const accountPage = await import("../dashboard/src/routes/settings/email-accounts/+page.server");
const feedPage = await import("../dashboard/src/routes/settings/newsletters/+page.server");
const rulePage = await import("../dashboard/src/routes/settings/newsletters/rules/+page.server");

beforeEach(async () => {
  setPrivateEnv({ CONFIG_ENCRYPTION_KEY: KEY_HEX });
  await database.sql`truncate email_accounts, rss_feeds, newsletter_sender_rules cascade`;
});

/** Mirrors the layout `crypto.ts` writes: iv(12) + auth tag(16) + ciphertext, base64. */
function decrypt(stored: string): string {
  const raw = Buffer.from(stored, "base64");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(KEY_HEX, "hex"), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf-8");
}

const account = (over: Partial<Parameters<typeof accounts.createEmailAccount>[0]> = {}) => ({
  label: "Work", host: "imap.example.test", user: "user@example.test", password: "hunter2-secret", folder: "", isNewsAccount: false,
  customInstructions: null, aliases: [], ignore: [], smtpHost: null, smtpPort: null, smtpSecure: false, ...over,
});
const stored = async () => (await database.sql`select * from email_accounts order by created_at`) as Record<string, any>[];
const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [k, v] of Object.entries(fields)) data.set(k, v); return makeEvent({ body: data }) as any; };
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (err) { return err as Error; } throw new Error("expected a rejection"); };

describe("email accounts", () => {
  test("the password is stored as AES-GCM ciphertext with a fresh IV each time, and never in the clear", async () => {
    await accounts.createEmailAccount(account({ label: "A" }));
    await accounts.createEmailAccount(account({ label: "B" }));
    const rows = await stored();
    expect(JSON.stringify(rows)).not.toContain("hunter2-secret");
    expect(rows.map((r) => decrypt(r.password))).toEqual(["hunter2-secret", "hunter2-secret"]);
    expect(rows[0]!.password).not.toBe(rows[1]!.password);
  });

  test("with no usable key nothing is stored, not even a plaintext fallback", async () => {
    for (const key of [undefined, "", "abcd", "zz".repeat(32), "ab".repeat(31)]) {
      setPrivateEnv({ CONFIG_ENCRYPTION_KEY: key });
      await rejects(() => accounts.createEmailAccount(account()));
    }
    expect(await stored()).toEqual([]);
  });

  test("the list and the load never carry the password, and the other fields are cleaned up", async () => {
    await accounts.createEmailAccount(account({ label: " Work ", user: " me@example.test ", folder: "  ", customInstructions: "   ", aliases: [" a@example.test ", "", "b@example.test"], ignore: [" "], smtpHost: " ", smtpPort: 465, smtpSecure: true }));
    const [row] = await accounts.listEmailAccounts();
    expect(row).toMatchObject({ label: "Work", user: "me@example.test", folder: "INBOX", customInstructions: null, aliases: ["a@example.test", "b@example.test"], ignore: [], smtpHost: null, smtpPort: 465, smtpSecure: true });
    expect(Object.keys(row!)).not.toContain("password");
    expect(JSON.stringify(row)).not.toContain("hunter2");
  });

  test("a label, host, user and password are required, and the SMTP port must be a real port", async () => {
    for (const bad of [{ label: " " }, { host: "" }, { user: "  " }, { password: "   " }, { smtpPort: 0 }, { smtpPort: 65536 }, { smtpPort: 25.5 }, { smtpPort: NaN }]) {
      expect(await rejects(() => accounts.createEmailAccount(account(bad)))).toBeInstanceOf(accounts.EmailAccountError);
    }
    expect(await stored()).toEqual([]);
  });

  test("an update with a blank password keeps the old one, a new password replaces it, an unknown id is an error", async () => {
    const { id } = await accounts.createEmailAccount(account());
    const before = (await stored())[0]!.password;

    await accounts.updateEmailAccount(id, account({ label: "Renamed", password: "   " }));
    let [row] = await stored();
    expect([row!.label, row!.password]).toEqual(["Renamed", before]);

    await accounts.updateEmailAccount(id, account({ password: "a-new-password" }));
    [row] = await stored();
    expect(decrypt(row!.password)).toBe("a-new-password");
    expect(await rejects(() => accounts.updateEmailAccount("00000000-0000-4000-8000-000000000000", account()))).toBeInstanceOf(accounts.EmailAccountError);
  });

  test("the form actions turn the fields into an account and report a validation problem as a 400", async () => {
    const fields = { label: "Private", host: "imap.example.test", user: "me@example.test", password: "pw-123", isNewsAccount: "on", aliases: "a@example.test, b@example.test,", ignore: "", smtpPort: "587" };
    expect(await accountPage.actions.create(form(fields))).toEqual({ ok: true, message: "Account added." });
    const [row] = await accounts.listEmailAccounts();
    expect(row).toMatchObject({ isNewsAccount: true, aliases: ["a@example.test", "b@example.test"], smtpPort: 587, smtpSecure: false });

    expect(await accountPage.actions.create(form({ ...fields, password: "" }))).toMatchObject({ status: 400, data: { error: "A password is required." } });
    expect(await accountPage.actions.update(form({ ...fields, id: "" }))).toMatchObject({ status: 400, data: { error: "Missing account id" } });
    expect(await accountPage.actions.update(form({ ...fields, id: row!.id, password: "", isNewsAccount: "" }))).toEqual({ ok: true, message: "Account updated." });
    expect((await accounts.listEmailAccounts())[0]!.isNewsAccount).toBe(false);
    expect(await accountPage.actions.delete(form({ id: "" }))).toMatchObject({ status: 400 });
    expect(await accountPage.actions.delete(form({ id: row!.id }))).toEqual({ ok: true, message: "Account deleted." });
    expect(await stored()).toEqual([]);
  });
});

describe("RSS feeds", () => {
  const feeds = async () => (await database.sql`select source_name, url from rss_feeds order by source_name`) as Record<string, any>[];

  test("only a public https URL without credentials may be polled", async () => {
    const refused = [
      "http://example.com/feed", "ftp://example.com/feed", "javascript:alert(1)", "example.com/feed", "", "https://user:pw@example.com/feed", "https://user@example.com/feed",
      "https://localhost/feed", "https://app.localhost/feed", "https://printer.local/feed", "https://metadata.internal/latest", "https://intranet/feed",
      "https://127.0.0.1/feed", "https://127.1/feed", "https://0x7f.0.0.1/feed", "https://2130706433/feed", "https://192.168.1.10/feed", "https://169.254.169.254/latest", "https://[::1]/feed", "https://[::ffff:127.0.0.1]/feed",
      "https://localhost./feed", "https://metadata.internal./latest", "https://printer.local./feed", "https://127.0.0.1./feed", "https://localhost.../feed", "https://[::1]./feed",
    ];
    for (const url of refused) {
      expect(await rejects(() => newsletters.createFeed("Source", url)), url).toBeInstanceOf(newsletters.NewsletterSettingsError);
    }
    expect(await feeds()).toEqual([]);
    expect((await newsletters.createFeed(" Source ", "https://Example.com/feed.xml?x=1")).url).toBe("https://example.com/feed.xml?x=1");
  });

  test("a source name is required, at most 120 characters, and one feed each", async () => {
    for (const name of ["", "   ", "x".repeat(121)]) expect(await rejects(() => newsletters.createFeed(name, "https://example.com/f"))).toBeInstanceOf(newsletters.NewsletterSettingsError);
    await newsletters.createFeed("x".repeat(120), "https://example.com/f");
    expect(await rejects(() => newsletters.createFeed("x".repeat(120), "https://example.com/other"))).toMatchObject({ message: "That source already has an RSS feed." });
  });

  test("an update renames or re-points the feed and clears its last error; an unknown feed is an error", async () => {
    await newsletters.createFeed("Old", "https://example.com/old");
    await database.sql`update rss_feeds set last_error = 'boom', last_error_at = now(), last_success_at = now()`;
    await newsletters.updateFeed("Old", "New", "https://example.com/new");
    expect(await database.sql`select source_name, url, last_error, last_error_at, last_success_at from rss_feeds`).toEqual([{ source_name: "New", url: "https://example.com/new", last_error: null, last_error_at: null, last_success_at: null }]);
    expect(await rejects(() => newsletters.updateFeed("Gone", "X", "https://example.com/x"))).toMatchObject({ message: "Feed no longer exists. Reload the page." });
    expect(await rejects(() => newsletters.updateFeed("New", "New", "http://example.com/x"))).toBeInstanceOf(newsletters.NewsletterSettingsError);
  });

  test("the form actions report each problem as a 400, including renaming onto a name that is taken", async () => {
    expect(await feedPage.actions.createFeed(form({ sourceName: "A", url: "https://example.com/a" }))).toMatchObject({ message: "Feed added." });
    await feedPage.actions.createFeed(form({ sourceName: "B", url: "https://example.com/b" }));
    expect(await feedPage.actions.createFeed(form({ sourceName: "C", url: "http://example.com/c" }))).toMatchObject({ status: 400, data: { error: "Use a public HTTPS feed URL without credentials." } });
    expect(await feedPage.actions.updateFeed(form({ oldName: "B", sourceName: "A", url: "https://example.com/b" }))).toMatchObject({ status: 400, data: { error: "That source already has an RSS feed." } });
    expect(await feedPage.actions.deleteFeed(form({ sourceName: "A" }))).toMatchObject({ message: expect.stringContaining("removed") });
    expect((await feeds()).map((f) => f.source_name)).toEqual(["B"]);
  });
});

describe("newsletter sender rules", () => {
  const rules = async () => (await database.sql`select match_kind, pattern, source_name from newsletter_sender_rules order by pattern`) as Record<string, any>[];

  test("a domain or an exact address, lower-cased, an address needing a source name", async () => {
    await newsletters.createSenderRule("domain", " News.Example.COM ", "");
    await newsletters.createSenderRule("address", "Editor@Example.com", "The Daily");
    expect(await rules()).toEqual([{ match_kind: "address", pattern: "editor@example.com", source_name: "The Daily" }, { match_kind: "domain", pattern: "news.example.com", source_name: "" }]);

    const refused: [string, string, string][] = [
      ["regex", "x.com", "S"], ["domain", "", "S"], ["domain", "nodot", "S"], ["domain", "a@b.com", "S"], ["domain", "x.c", "S"], ["domain", "evil .com", "S"],
      ["address", "domain.com", "S"], ["address", "a b@c.com", "S"], ["address", "a@b", "S"], ["address", "a@b.com", ""], ["address", "a@b.com", "x".repeat(121)],
    ];
    for (const [kind, pattern, name] of refused) {
      expect(await rejects(() => newsletters.createSenderRule(kind, pattern, name)), `${kind} ${pattern}`).toBeInstanceOf(newsletters.NewsletterSettingsError);
    }
    expect(await rules()).toHaveLength(2);
  });

  test("a rule is unique, can be updated and deleted, and an unknown id is an error", async () => {
    await newsletters.createSenderRule("domain", "news.example.com", "");
    expect(await rejects(() => newsletters.createSenderRule("domain", "NEWS.example.com", ""))).toMatchObject({ message: "That sender rule already exists." });

    const [{ id }] = await newsletters.listSenderRules();
    await newsletters.updateSenderRule(id, "address", "a@example.com", "Named");
    expect(await rules()).toEqual([{ match_kind: "address", pattern: "a@example.com", source_name: "Named" }]);
    expect(await rejects(() => newsletters.updateSenderRule("00000000-0000-4000-8000-000000000000", "domain", "x.com", ""))).toMatchObject({ message: "Sender rule no longer exists. Reload the page." });
    await newsletters.deleteSenderRule(id);
    expect(await rules()).toEqual([]);
  });

  test("the form actions map a bad rule and a duplicate to a 400", async () => {
    expect(await rulePage.actions.createRule(form({ matchKind: "domain", pattern: "news.example.com", sourceName: "" }))).toEqual({ message: "Sender rule added." });
    expect(await rulePage.actions.createRule(form({ matchKind: "domain", pattern: "news.example.com", sourceName: "" }))).toMatchObject({ status: 400, data: { error: "That sender rule already exists." } });
    expect(await rulePage.actions.createRule(form({ matchKind: "domain", pattern: "nonsense", sourceName: "" }))).toMatchObject({ status: 400 });
    expect(await rulePage.actions.createRule(form({ matchKind: "domain", pattern: "other.example.com", sourceName: "" }))).toEqual({ message: "Sender rule added." });
    const [first, second] = await newsletters.listSenderRules();
    expect(await rulePage.actions.updateRule(form({ id: first!.id, matchKind: "domain", pattern: second!.pattern, sourceName: "" }))).toMatchObject({ status: 400, data: { error: "That sender rule already exists." } });
    expect(await rulePage.actions.deleteRule(form({ id: first!.id }))).toEqual({ message: "Sender rule removed." });
  });
});
