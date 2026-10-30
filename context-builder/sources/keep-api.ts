// Keep's private notes API, read side only: pages through `changes` into a KeepTree. A port of the
// request shapes of gkeepapi 0.17.1 (it mimics the Android app); nothing here writes to Keep.
import { networkInterfaces } from "node:os";
import { fetchKeepAccessToken, type Fetcher } from "./keep-google-auth";
import { KeepTree, type KeepNote, type RawLabel, type RawNode } from "./keep-tree";

const CHANGES_URL = "https://www.googleapis.com/notes/v1/changes";
const USER_AGENT = "x-gkeepapi/0.17.1 (https://github.com/kiwiz/gkeepapi)";
const MAX_PAGES = 1000;
const MAX_TOKEN_REFRESHES = 2;
const MAX_RATE_LIMIT_WAITS = 6;
/** What the Android app announces; the server tailors its response to these. */
const CAPABILITIES = ["NC", "PI", "LB", "AN", "SH", "DR", "TR", "IN", "SNB", "MI", "CO"].map((type) => ({ type }));

export class KeepApiError extends Error {
  constructor(readonly code: number, detail: unknown) {
    super(`Keep API error ${code}: ${JSON.stringify(detail)}`);
  }
}

export interface KeepCredentials {
  email: string;
  masterToken: string;
}

export interface KeepClientOptions {
  fetch?: Fetcher;
  sleep?: (ms: number) => Promise<void>;
}

interface ChangesResponse {
  error?: { code: number };
  forceFullResync?: boolean;
  upgradeRecommended?: boolean;
  userInfo?: { labels?: RawLabel[] };
  nodes?: RawNode[];
  toVersion: string;
  truncated?: boolean;
}

/** Stable per machine, like gkeepapi's MAC-derived id (hex, no leading zeros); a constant if no MAC. */
export function defaultDeviceId(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (!a.internal && a.mac !== "00:00:00:00:00:00") return BigInt(`0x${a.mac.replaceAll(":", "")}`).toString(16);
    }
  }
  return "aabbccddeeff";
}

/** `2026-10-30T12:00:00.123456Z`: the timestamp shape the endpoint expects, microsecond-padded. */
function clientTimestamp(now: number): string {
  return new Date(now).toISOString().replace("Z", "000Z");
}

/** Pulls every note and list in the account. Throws on any failure; the caller decides what that means. */
export async function syncKeepNotes(creds: KeepCredentials, opts: KeepClientOptions = {}): Promise<KeepNote[]> {
  const http = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? Bun.sleep;
  const deviceId = defaultDeviceId();
  const sessionId = `s--${Date.now()}--${1_000_000_000 + Math.floor(Math.random() * 9_000_000_000)}`;
  let token = await fetchKeepAccessToken(creds.email, creds.masterToken, deviceId, http);

  async function changes(targetVersion: string | undefined): Promise<ChangesResponse> {
    const body = {
      nodes: [],
      clientTimestamp: clientTimestamp(Date.now()),
      requestHeader: {
        clientSessionId: sessionId,
        clientPlatform: "ANDROID",
        clientVersion: { major: "9", minor: "9", build: "9", revision: "9" },
        capabilities: CAPABILITIES,
      },
      ...(targetVersion === undefined ? {} : { targetVersion }),
    };
    let refreshes = 0;
    let rateLimited = 0;
    let delay = 2000;
    for (;;) {
      const res = await http(CHANGES_URL, {
        method: "POST",
        headers: { Authorization: `OAuth ${token}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as ChangesResponse;
      if (!json.error) return json;
      if (json.error.code === 429 && rateLimited++ < MAX_RATE_LIMIT_WAITS) {
        await sleep(delay);
        delay = Math.min(delay * 2, 60_000);
        continue;
      }
      // Access tokens last hours, so a 401 mid-sync means it expired: get a fresh one.
      if (json.error.code !== 401 || refreshes++ >= MAX_TOKEN_REFRESHES) throw new KeepApiError(json.error.code, json.error);
      token = await fetchKeepAccessToken(creds.email, creds.masterToken, deviceId, http);
    }
  }

  const tree = new KeepTree();
  let version: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await changes(version);
    if (res.forceFullResync) throw new KeepApiError(0, "Full resync required");
    if (res.upgradeRecommended) throw new KeepApiError(0, "Upgrade recommended");
    if (res.userInfo) tree.setLabels(res.userInfo.labels ?? []);
    if (res.nodes) tree.applyNodes(res.nodes);
    version = res.toVersion;
    if (!res.truncated) return tree.notes();
  }
  // A truncated tree would silently drop notes, so running out of pages is a failure, not a result.
  throw new KeepApiError(0, `Sync did not finish within ${MAX_PAGES} pages`);
}
