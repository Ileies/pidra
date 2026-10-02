/**
 * Listening to a report: one audio element playing one chapter at a time.
 *
 * The server splits the report into chapters (a group each: an urgency level, a news group, a
 * briefing domain) and speaks a chapter the first time somebody asks for it, then serves it from
 * the database. So this asks only for the chapter being played and, once that is playing, the
 * next one: skipping around never pays for the chapters it jumps over.
 *
 * Audio arrives through `net()` as a blob, never as an `<audio src>` URL. Every request then has
 * a budget and the reachability logic sees it, and Safari's insistence on range requests for
 * media elements stops being a server concern.
 *
 * Online only by design: a chapter that has not been spoken yet does not exist anywhere else.
 */

import { browser } from "$app/env";
import { net, netJson } from "#lib/offline/net.js";

export interface PlayerChapter {
  key: string;
  section: string;
  title: string;
  /** Milliseconds. An estimate until the chapter has been spoken, exact after. */
  durationMs: number;
}

/** Generating a long chapter takes a few seconds, not the 15 an ordinary tap is allowed. */
const AUDIO_BUDGET_MS = 120_000;
export const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const;
const BACK_SECONDS = 15;
const FORWARD_SECONDS = 30;
/** Previous restarts the chapter unless it has only just begun. */
const RESTART_AFTER_SECONDS = 3;

/** A tenth of a second of silence. Playing it inside the tap unlocks the element on iOS, where a `play()` after an await is refused. */
function silentClip(): string {
  const samples = 800;
  const bytes = new Uint8Array(44 + samples).fill(0x80);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, samples, true);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

class ReportPlayer {
  open = $state(false);
  date = $state("");
  chapters = $state<PlayerChapter[]>([]);
  current = $state(0);
  /** Seconds into the current chapter. */
  position = $state(0);
  playing = $state(false);
  /** A chapter is being spoken or downloaded. */
  buffering = $state(false);
  error = $state<string | null>(null);
  speed = $state<number>(1);

  #audio: HTMLAudioElement | null = null;
  #urls = new Map<string, string>();
  #downloads = new Map<string, Promise<string>>();
  /** Bumped by every navigation of the queue; a load that finishes under an older one is dropped. */
  #ticket = 0;
  #unlock: string | null = null;

  /** Length of everything before the current chapter, plus how far into this one. */
  get elapsedMs(): number {
    return this.chapters.slice(0, this.current).reduce((sum, c) => sum + c.durationMs, 0) + this.position * 1000;
  }

  get totalMs(): number {
    return this.chapters.reduce((sum, c) => sum + c.durationMs, 0);
  }

  get chapter(): PlayerChapter | undefined {
    return this.chapters[this.current];
  }

  /** Called from the tap itself: the unlock has to happen before the first await. */
  async start(date: string): Promise<void> {
    if (!browser) return;
    this.#reset();
    this.open = true;
    this.date = date;
    this.buffering = true;

    const audio = this.#element();
    this.#unlock = silentClip();
    audio.src = this.#unlock;
    void audio.play().catch(() => {});

    const ticket = ++this.#ticket;
    try {
      const manifest = await netJson<{ chapters: PlayerChapter[] }>(`/api/report-audio/${date}`);
      if (ticket !== this.#ticket) return;
      if (manifest.chapters.length === 0) throw new Error("This report has nothing to read aloud.");
      this.chapters = manifest.chapters;
      await this.go(0);
    } catch (err) {
      if (ticket !== this.#ticket) return;
      this.#fail(err);
    }
  }

  close(): void {
    this.#ticket++;
    this.#reset();
    this.open = false;
    this.date = "";
  }

  toggle(): void {
    const audio = this.#audio;
    if (!audio) return;
    if (!audio.src || audio.src === this.#unlock || this.error) {
      void this.go(this.current, { seconds: this.position });
    } else if (audio.paused) {
      void audio.play().catch((err) => this.#fail(err));
    } else {
      audio.pause();
    }
  }

  /** Jump into a chapter, at a fraction of its length or at a number of seconds. */
  async go(index: number, at: { fraction?: number; seconds?: number } = {}): Promise<void> {
    const chapter = this.chapters[index];
    if (!chapter) return;
    const audio = this.#element();
    const ticket = ++this.#ticket;

    // Inside the chapter that is already loaded: a plain seek.
    if (index === this.current && this.#urls.has(chapter.key) && audio.src === this.#urls.get(chapter.key)) {
      const length = Number.isFinite(audio.duration) ? audio.duration : chapter.durationMs / 1000;
      audio.currentTime = Math.min(at.fraction != null ? at.fraction * length : (at.seconds ?? 0), Math.max(0, length - 0.05));
      this.position = audio.currentTime;
      if (audio.paused) void audio.play().catch((err) => this.#fail(err));
      return;
    }

    this.current = index;
    this.position = at.seconds ?? (at.fraction != null ? at.fraction * (chapter.durationMs / 1000) : 0);
    this.error = null;
    this.buffering = true;
    audio.pause();

    try {
      const url = await this.#download(chapter);
      if (ticket !== this.#ticket) return;
      audio.src = url;
      audio.playbackRate = this.speed;
      await new Promise<void>((resolve, reject) => {
        audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
        audio.addEventListener("error", () => reject(new Error("The audio could not be played.")), { once: true });
      });
      if (ticket !== this.#ticket) return;
      const length = Number.isFinite(audio.duration) ? audio.duration : chapter.durationMs / 1000;
      const start = at.fraction != null ? at.fraction * length : (at.seconds ?? 0);
      audio.currentTime = Math.min(start, Math.max(0, length - 0.05));
      this.position = audio.currentTime;
      await audio.play();
      this.buffering = false;
      this.#publish();
      // Only now that this one plays: the next chapter is paid for only if somebody keeps listening.
      const next = this.chapters[index + 1];
      if (next) void this.#download(next).catch(() => {});
    } catch (err) {
      if (ticket !== this.#ticket) return;
      this.#fail(err);
    }
  }

  next(): void {
    if (this.current + 1 < this.chapters.length) void this.go(this.current + 1);
    else this.#finish();
  }

  previous(): void {
    if (this.position > RESTART_AFTER_SECONDS || this.current === 0) void this.go(this.current);
    else void this.go(this.current - 1);
  }

  back(): void {
    this.#skip(-BACK_SECONDS);
  }

  forward(): void {
    this.#skip(FORWARD_SECONDS);
  }

  cycleSpeed(): void {
    this.speed = SPEEDS[(SPEEDS.indexOf(this.speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length];
    if (this.#audio) this.#audio.playbackRate = this.speed;
  }

  #skip(seconds: number): void {
    const chapter = this.chapter;
    if (!chapter) return;
    const length = this.#audio && Number.isFinite(this.#audio.duration) ? this.#audio.duration : chapter.durationMs / 1000;
    const target = this.position + seconds;
    if (target >= 0 && target < length) {
      void this.go(this.current, { seconds: target });
    } else if (target < 0 && this.current > 0) {
      const before = this.chapters[this.current - 1];
      void this.go(this.current - 1, { seconds: Math.max(0, before.durationMs / 1000 + target) });
    } else if (target < 0) {
      void this.go(0, { seconds: 0 });
    } else {
      this.next();
    }
  }

  #finish(): void {
    this.#audio?.pause();
    this.playing = false;
    this.current = 0;
    this.position = 0;
    if (this.#audio && this.chapters[0]) {
      const url = this.#urls.get(this.chapters[0].key);
      if (url) this.#audio.src = url;
    }
  }

  async #download(chapter: PlayerChapter): Promise<string> {
    const known = this.#urls.get(chapter.key);
    if (known) return known;
    let pending = this.#downloads.get(chapter.key);
    if (!pending) {
      const date = this.date;
      pending = (async () => {
        const res = await net(`/api/report-audio/${date}/${chapter.key}`, { method: "POST" }, { budgetMs: AUDIO_BUDGET_MS });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `The voice could not be loaded (${res.status}).`);
        }
        const exact = Number(res.headers.get("X-Audio-Duration-Ms"));
        const url = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: "audio/mpeg" }));
        if (date !== this.date) {
          URL.revokeObjectURL(url);
          throw new Error("closed");
        }
        this.#urls.set(chapter.key, url);
        const at = this.chapters.findIndex((c) => c.key === chapter.key);
        if (at >= 0 && exact > 0) this.chapters[at].durationMs = exact;
        return url;
      })().finally(() => this.#downloads.delete(chapter.key));
      this.#downloads.set(chapter.key, pending);
    }
    return pending;
  }

  #element(): HTMLAudioElement {
    if (this.#audio) return this.#audio;
    const audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("timeupdate", () => {
      if (audio.src !== this.#unlock) this.position = audio.currentTime;
    });
    audio.addEventListener("play", () => {
      if (audio.src !== this.#unlock) this.playing = true;
    });
    audio.addEventListener("pause", () => {
      if (!audio.ended) this.playing = false;
    });
    audio.addEventListener("playing", () => (this.buffering = false));
    audio.addEventListener("waiting", () => {
      if (!audio.paused) this.buffering = true;
    });
    audio.addEventListener("ended", () => {
      if (audio.src !== this.#unlock) this.next();
    });
    this.#audio = audio;
    return audio;
  }

  #fail(err: unknown): void {
    if (err instanceof Error && err.message === "closed") return;
    this.buffering = false;
    this.playing = false;
    this.error = err instanceof Error ? err.message : "Playback failed.";
  }

  #reset(): void {
    if (this.#audio) {
      this.#audio.pause();
      this.#audio.removeAttribute("src");
      this.#audio.load();
    }
    for (const url of this.#urls.values()) URL.revokeObjectURL(url);
    if (this.#unlock) URL.revokeObjectURL(this.#unlock);
    this.#urls.clear();
    this.#downloads.clear();
    this.#unlock = null;
    this.chapters = [];
    this.current = 0;
    this.position = 0;
    this.playing = false;
    this.buffering = false;
    this.error = null;
    if (browser && "mediaSession" in navigator) navigator.mediaSession.metadata = null;
  }

  /** Lock screen and headset controls, and the title they show. */
  #publish(): void {
    if (!browser || !("mediaSession" in navigator)) return;
    const chapter = this.chapter;
    if (!chapter) return;
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({ title: chapter.title, artist: chapter.section, album: `PIDRA ${this.date}` });
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => this.toggle()],
      ["pause", () => this.toggle()],
      ["previoustrack", () => this.previous()],
      ["nexttrack", () => this.next()],
      ["seekbackward", () => this.back()],
      ["seekforward", () => this.forward()],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // An action this browser does not offer.
      }
    }
  }
}

export const reportPlayer = new ReportPlayer();
