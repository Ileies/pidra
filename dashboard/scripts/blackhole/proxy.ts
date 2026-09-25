/**
 * The network between the phone and pronix, as the suite needs it: one origin per lane, in front
 * of the production build, switchable between the ways that network actually fails.
 *
 * - `forward`: pronix reachable. The snapshot is the fixture and every write is a recorded
 *   stand-in, so no request of the suite reaches a database or the skills bridge.
 * - `blackhole`: every request is accepted and never answered - the VPN app up with no network
 *   under it, or `10.200.200.1` on a network where nobody answers for it. What DevTools' offline
 *   mode cannot give, and the case the whole offline layer is built for.
 * - `gated`: every request answered by something that is not the app - nginx's 403 from the
 *   public path when DNS still resolves.
 * - `refused`: nothing listens, so every connection fails at once.
 *
 * Every request is tracked from arrival to answer or abort, so the suite can assert the rule of
 * the offline layer: no request, from any caller - page, SvelteKit or service worker -
 * outlives a fixed budget.
 */

import { ETAG, SNAPSHOT } from "./fixture.ts";

export type Mode = "forward" | "blackhole" | "gated" | "refused";

export interface Tracked {
  method: string;
  path: string;
  mode: Mode;
  startedAt: number;
  endedAt: number | null;
}

/** A write the outbox delivered, as the stand-in received it. */
export interface Delivered {
  method: string;
  path: string;
  body: unknown;
}

const NGINX_403 =
  "<html>\r\n<head><title>403 Forbidden</title></head>\r\n<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n";

/** The outbox's endpoints (`intents.ts`), answered here so a replay never reaches a real writer. */
const WRITE = /^\/api\/(notes(\/[^/]+(\/restore)?)?|feedback|rules(\/[^/]+)?)$/;

export class LaneProxy {
  /** Picked by the OS on the first listen and kept, so a refusal can end and the origin stays. */
  private port = 0;
  readonly origin: string;
  mode: Mode = "forward";
  readonly tracked: Tracked[] = [];
  readonly delivered: Delivered[] = [];
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(private readonly upstream: string) {
    this.listen();
    this.origin = `http://127.0.0.1:${this.port}`;
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    const was = this.mode;
    this.mode = mode;
    if (was === "blackhole") {
      // The network coming back does not revive a request it swallowed; the connection is dead.
      // Without this a hang the app failed to abort would be answered late and look harmless.
      void this.server?.stop(true);
      this.server = null;
    }
    if (mode === "refused") {
      // Closes the listener and every open connection, so a kept-alive socket cannot carry the
      // next request past the refusal.
      void this.server?.stop(true);
      this.server = null;
    } else if (!this.server) {
      this.listen();
    }
  }

  /** Requests still unanswered and not aborted. */
  pending(): Tracked[] {
    return this.tracked.filter((t) => t.endedAt === null);
  }

  stop(): void {
    void this.server?.stop(true);
    this.server = null;
  }

  private listen(): void {
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: this.port,
      // Never time a connection out from this side: a hang the app does not end itself must stay
      // visible as a hang, not be cut short here and look bounded.
      idleTimeout: 0,
      fetch: (req) => this.handle(req),
    });
    this.port = this.server.port ?? this.port;
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const entry: Tracked = { method: req.method, path: url.pathname + url.search, mode: this.mode, startedAt: performance.now(), endedAt: null };
    this.tracked.push(entry);
    const end = () => {
      entry.endedAt ??= performance.now();
    };
    req.signal.addEventListener("abort", end);

    if (this.mode === "blackhole") return new Promise<Response>(() => {});
    if (this.mode === "gated") {
      end();
      return new Response(NGINX_403, { status: 403, headers: { "Content-Type": "text/html", Server: "nginx", Connection: "close" } });
    }

    try {
      return await this.forward(req, url);
    } finally {
      end();
    }
  }

  private async forward(req: Request, url: URL): Promise<Response> {
    const stamp = { "x-pidra": "1", "Cache-Control": "no-store" };

    if (url.pathname === "/api/offline/snapshot") {
      if ((req.headers.get("if-none-match") ?? "").includes(ETAG)) return new Response(null, { status: 304, headers: { ...stamp, ETag: `"${ETAG}"` } });
      return Response.json(SNAPSHOT, { headers: { ...stamp, ETag: `"${ETAG}"` } });
    }
    if (req.method !== "GET" && WRITE.test(url.pathname)) {
      const text = await req.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // kept as text
      }
      this.delivered.push({ method: req.method, path: url.pathname, body });
      const id = (body as { id?: string } | null)?.id ?? url.pathname.split("/")[3] ?? crypto.randomUUID();
      return Response.json({ id, ok: true }, { status: req.method === "POST" ? 201 : 200, headers: stamp });
    }
    if (url.pathname === "/api/nav-badges") return Response.json({ navBadges: {} }, { headers: stamp });
    if (url.pathname.endsWith("/__data.json")) {
      // An online-only page's server load. The server has no database here, and under concurrent
      // requests its Postgres client stops answering altogether; the suite only needs to see that
      // the app goes back to the server, so the server's "answered but failed" is stood in for.
      return Response.json({ message: "Stand-in: the blackhole suite runs without a database." }, { status: 503, headers: stamp });
    }

    const headers = new Headers(req.headers);
    // The app must see the lane's own origin: SvelteKit checks a form POST's Origin against it.
    headers.set("host", url.host);
    // Uncompressed, so the body passes through unchanged whatever the runtime's fetch decodes.
    headers.set("accept-encoding", "identity");
    const upstream = await fetch(this.upstream + url.pathname + url.search, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
      // A pooled connection the server had already closed left a forwarded request hanging, which
      // looked like the app not coming back online. One connection per request.
      keepalive: false,
    });
    const out = new Headers(upstream.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
  }
}
