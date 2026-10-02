/**
 * Whether PIDRA is installed on this device and what the browser lets us do about it.
 *
 * Started once from the root layout: Chromium fires `beforeinstallprompt` shortly after load,
 * usually before the user has opened Settings, so a listener registered by the settings page would
 * miss it. The platform gives us less than the UI might suggest, and each limit decides what
 * `InstallApp` may offer:
 *
 * - Running as the installed app is detectable everywhere (`display-mode`, iOS `navigator.standalone`).
 * - Installed-but-viewing-in-a-browser is detectable only through `getInstalledRelatedApps()`
 *   (Chromium: Android, and desktop from 140; needs the `related_applications` manifest entry).
 * - Installing from a button needs `beforeinstallprompt` (Chromium only). iOS has no such API.
 * - There is no API to uninstall, anywhere, so no uninstall control exists.
 * - There is no API to launch the app from a tab. On desktop Chromium a new top-level navigation to
 *   an in-scope URL is captured into the installed app; that is the only "open" that exists.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface NavigatorExtras {
  standalone?: boolean;
  userAgentData?: { mobile?: boolean };
  getInstalledRelatedApps?: () => Promise<unknown[]>;
}

class PwaState {
  /** True when this page is running inside the installed app's own window. */
  inApp = $state(false);
  /** Whether the browser confirmed the app is installed while we are in a normal tab. */
  installedInBrowser = $state(false);
  /** Whether `refresh()` has settled (answered, failed or timed out), so the card can stop waiting. */
  detected = $state(false);
  /** Whether `getInstalledRelatedApps` exists at all. */
  canDetectInstalled = $state(false);
  /** True once the browser has offered an install prompt we can trigger from a button. */
  canPrompt = $state(false);
  /** Whether this browser has an install prompt at all (Chromium). */
  promptSupported = $state(false);
  /** True once the browser has had its 3 s to offer the prompt. */
  promptWaitOver = $state(false);
  /** The user closed the install dialog; the browser offers a new prompt only after a reload. */
  dismissed = $state(false);
  ios = $state(false);
  /** Desktop Chromium: the only place a navigation from a tab is captured into the installed app. */
  desktopChromium = $state(false);

  #prompt: BeforeInstallPromptEvent | null = null;
  #started = false;

  get installed(): boolean {
    return this.inApp || this.installedInBrowser;
  }

  start(): void {
    if (this.#started || typeof window === "undefined") return;
    this.#started = true;

    const nav = navigator as Navigator & NavigatorExtras;
    const mq = window.matchMedia("(display-mode: standalone)");
    const readInApp = () => {
      this.inApp = mq.matches || nav.standalone === true;
    };
    readInApp();
    mq.addEventListener("change", readInApp);

    this.ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    this.canDetectInstalled = typeof nav.getInstalledRelatedApps === "function";
    this.desktopChromium = this.canDetectInstalled && nav.userAgentData?.mobile === false;

    // Chromium exposes this constructor, Safari and Firefox do not: the only way to tell "this
    // browser has no install prompt" from "it has not fired yet".
    this.promptSupported = "BeforeInstallPromptEvent" in window;

    const take = (e: Event) => {
      e.preventDefault();
      this.#prompt = e as BeforeInstallPromptEvent;
      this.canPrompt = true;
      this.dismissed = false;
    };
    // `app.html` stashes the event before hydration; this listener catches any later one.
    const early = (window as unknown as { __pidraInstallPrompt?: Event }).__pidraInstallPrompt;
    if (early) take(early);
    window.addEventListener("beforeinstallprompt", take);
    window.addEventListener("appinstalled", () => {
      this.#prompt = null;
      this.canPrompt = false;
      void this.refresh();
    });

    // Chrome offers the prompt shortly after load, or not at all (incognito, already installed,
    // not installable). Give it until 3 s into the page's life before calling it "not offered".
    const left = Math.max(0, 3000 - performance.now());
    if (left === 0) this.promptWaitOver = true;
    else setTimeout(() => (this.promptWaitOver = true), left);
  }

  /**
   * Asks the browser whether the app is installed. Only the settings card calls this, and not while
   * offline: the browser fetches the manifest itself to answer, a request with no abort signal that
   * can stall on a dead connection, so it is neither made on every page nor waited on past 3 s.
   */
  async refresh(): Promise<void> {
    const nav = navigator as Navigator & NavigatorExtras;
    if (!nav.getInstalledRelatedApps) {
      this.detected = true;
      return;
    }
    try {
      const apps = await Promise.race([
        nav.getInstalledRelatedApps(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
      ]);
      this.installedInBrowser = apps.length > 0;
    } catch {
      // Unknown, not "absent": the card falls back to what it can tell without this answer.
    } finally {
      this.detected = true;
    }
  }

  /** Shows the browser's own install dialog. Resolves to whether the user accepted. */
  async install(): Promise<boolean> {
    const event = this.#prompt;
    if (!event) return false;
    this.#prompt = null;
    this.canPrompt = false;
    await event.prompt();
    const { outcome } = await event.userChoice;
    this.dismissed = outcome !== "accepted";
    return outcome === "accepted";
  }
}

export const pwa = new PwaState();
