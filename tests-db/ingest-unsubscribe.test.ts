// src/ingest/unsubscribe.ts `findUnsubscribeLink` on really parsed mail: the List-Unsubscribe header
// first, then a visible body link, then the AI scan. The header step used to read a key mailparser
// never sets, so every lookup fell through to the body and the model.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { simpleParser } from "mailparser";

const scans: string[] = [];
let scanResult: { unsubscribeUrl: string | null } | Error = { unsubscribeUrl: null };
mock.module("../src/ai/openai", () => ({
  extractJson: async (_prompt: string, input: string) => {
    scans.push(input);
    if (scanResult instanceof Error) throw scanResult;
    return scanResult;
  },
}));

const { findUnsubscribeLink } = await import("../src/ingest/unsubscribe");

const parse = (headers: string[], html?: string) =>
  simpleParser([
    "Message-ID: <a@example.com>", "From: A <a@example.com>", "Subject: s", ...headers,
    `Content-Type: ${html ? "text/html" : "text/plain"}; charset=utf-8`, "", html ?? "plain body",
  ].join("\r\n"));

beforeEach(() => {
  scans.length = 0;
  scanResult = { unsubscribeUrl: null };
});

describe("findUnsubscribeLink", () => {
  test("the https URL of a List-Unsubscribe header wins, without reading the body or calling the model", async () => {
    const parsed = await parse(["List-Unsubscribe: <mailto:u@example.com>, <https://example.com/unsub?id=1>"], `<a href="https://other.example.com/unsubscribe">Unsubscribe</a>`);
    expect(await findUnsubscribeLink(parsed)).toBe("https://example.com/unsub?id=1");
    expect(scans).toHaveLength(0);
  });

  test("a mailto-only header is no link, so the body is tried next", async () => {
    const parsed = await parse(["List-Unsubscribe: <mailto:u@example.com>"], `<p>Bye</p><a href="https://example.com/leave">Click to unsubscribe here</a>`);
    expect(await findUnsubscribeLink(parsed)).toBe("https://example.com/leave");
    expect(scans).toHaveLength(0);
  });

  test("an href that says unsubscribe is found even when the link text does not", async () => {
    const parsed = await parse([], `<a href="https://example.com/unsubscribe/abc"><img alt="x"></a>`);
    expect(await findUnsubscribeLink(parsed)).toBe("https://example.com/unsubscribe/abc");
  });

  test("a non-http body link is ignored", async () => {
    const parsed = await parse([], `<a href="mailto:stop@example.com">unsubscribe</a>`);
    expect(await findUnsubscribeLink(parsed)).toBeNull();
  });

  test("with no header and no obvious link the model is asked, and only an http answer is kept", async () => {
    const html = `<a href="https://example.com/p/9">Manage</a>`;
    scanResult = { unsubscribeUrl: "https://example.com/p/9" };
    expect(await findUnsubscribeLink(await parse([], html))).toBe("https://example.com/p/9");
    expect(scans).toEqual([html]);

    scanResult = { unsubscribeUrl: "javascript:alert(1)" };
    expect(await findUnsubscribeLink(await parse([], html))).toBeNull();
  });

  test("a failing model call, or a mail with no html, gives null instead of throwing", async () => {
    scanResult = new Error("rate limited");
    expect(await findUnsubscribeLink(await parse([], `<p>nothing</p>`))).toBeNull();
    scans.length = 0;
    expect(await findUnsubscribeLink(await parse([]))).toBeNull();
    expect(scans).toHaveLength(0);
  });
});
