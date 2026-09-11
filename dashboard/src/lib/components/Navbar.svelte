<script lang="ts">
  // The one navbar. It is mounted once by the root layout and survives every client-side
  // navigation, so clicking a link swaps only the page below it - the header itself is never torn
  // down and rebuilt. Anything route-dependent is derived from `page`, never passed in as a prop:
  // a prop would mean each page gets to decide what the navbar looks like, which is the problem
  // this component exists to remove.
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { env } from "$env/dynamic/public";

  const LINKS = [
    { href: "/sources", label: "Quellen" },
    { href: "/entities", label: "Entities" },
    { href: "/notes", label: "Notes" },
    { href: "/skills", label: "Skills" },
    { href: "/prompts", label: "Prompts" },
    { href: "/context-builder", label: "Context Builder" },
    { href: "/chat", label: "Chat" },
  ];

  const SUBTITLES: Record<string, string> = {
    "/[date]/detail/[ids]": "Quellen-Detail",
    "/sources": "Quellenbewertung",
    "/sources/[name]": "Quellen-Beiträge",
    "/entities": "Entity Graph",
    "/notes": "Notes",
    "/skills": "Skills",
    "/prompts": "Prompt Versions",
    "/questions": "Question Gate",
    "/context-builder": "Context Builder",
    "/chat": "Assistent",
  };

  const routeId = $derived(page.route.id ?? "");
  const path = $derived(page.url.pathname);
  // Two routes name the thing on screen better than a static label does: the report is its date,
  // the source detail is the source.
  const subtitle = $derived(
    routeId === "/[date]"
      ? (page.params.date ?? "")
      : routeId === "/sources/[name]" && page.params.name
        ? decodeURIComponent(page.params.name)
        : (SUBTITLES[routeId] ?? ""),
  );

  // "Heute" owns every /YYYY-MM-DD route, including the item detail pages below it.
  const onReport = $derived(routeId === "/[date]" || routeId === "/[date]/detail/[ids]");
  const hasPendingQuestions = $derived(!!page.data.hasPendingQuestions);

  // Day stepping belongs to the navbar, not to the report page: it is the navbar's behaviour on a
  // report route. The report's load function is what knows which days exist.
  const prevDate = $derived(routeId === "/[date]" ? (page.data.prevDate as string | null) : null);
  const nextDate = $derived(routeId === "/[date]" ? (page.data.nextDate as string | null) : null);

  function isActive(href: string): boolean {
    return path === href || path.startsWith(`${href}/`);
  }

  // "checking" and "busy" render an inert button of the same width as the real one, so resolving
  // the push subscription never resizes the button row after paint.
  type NotifState = "checking" | "unsupported" | "denied" | "unsubscribed" | "subscribed" | "busy";
  let notifState = $state<NotifState>("checking");

  onMount(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { notifState = "unsupported"; return; }
    if (Notification.permission === "denied") { notifState = "denied"; return; }
    const sw = await navigator.serviceWorker.ready;
    const sub = await sw.pushManager.getSubscription();
    notifState = sub ? "subscribed" : "unsubscribed";
  });

  function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
    const padding = "=".repeat((4 - (b64.length % 4)) % 4);
    const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  async function toggleNotifications() {
    notifState = "busy";
    try {
      const sw = await navigator.serviceWorker.ready;
      const existing = await sw.pushManager.getSubscription();

      if (existing) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        await existing.unsubscribe();
        notifState = "unsubscribed";
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") { notifState = "denied"; return; }

      const sub = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(env.PUBLIC_VAPID_KEY),
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });

      notifState = "subscribed";
    } catch (e) {
      console.error("[push]", e);
      notifState = "unsubscribed";
    }
  }
</script>

<header
  class="flex items-center justify-between gap-4 px-8 py-2 bg-surface-900 border-b border-surface-700 sticky top-0 z-10"
>
  <div class="flex items-center gap-4 shrink-0">
    <a href="/" class="flex items-center gap-1.5 no-underline hover:opacity-90 transition-opacity">
      <img src="/icons/icon.svg" alt="" class="h-8 w-8 drop-shadow-[0_0_3px_rgba(120,157,104,0.55)]" />
      <span class="font-bold tracking-widest text-lg text-surface-50">PIDRA</span>
    </a>
    {#if subtitle}
      <span class="text-surface-500 text-sm">{subtitle}</span>
    {/if}
  </div>

  <nav class="flex items-center justify-end gap-2 flex-wrap">
    {#if routeId === "/[date]/detail/[ids]"}
      <a href="/{page.params.date}" class="nav-btn nav-btn-idle">← {page.params.date}</a>
    {/if}

    {#if routeId === "/sources/[name]"}
      <a href="/sources" class="nav-btn nav-btn-idle">← Quellen</a>
    {/if}

    {#if routeId === "/[date]"}
      {#if prevDate}
        <a href="/{prevDate}" class="nav-btn nav-btn-idle">← {prevDate}</a>
      {:else}
        <span class="nav-btn nav-btn-disabled">←</span>
      {/if}
      {#if nextDate}
        <a href="/{nextDate}" class="nav-btn nav-btn-idle">{nextDate} →</a>
      {:else}
        <span class="nav-btn nav-btn-disabled">→</span>
      {/if}
    {/if}

    <a href="/" class="nav-btn {onReport ? 'nav-btn-active' : 'nav-btn-idle'}">Heute</a>

    {#each LINKS as link (link.href)}
      <a href={link.href} class="nav-btn {isActive(link.href) ? 'nav-btn-active' : 'nav-btn-idle'}">
        {link.label}
      </a>
    {/each}

    {#if hasPendingQuestions}
      <a href="/questions" class="nav-btn border-warning-700 text-warning-400 hover:bg-surface-800 animate-pulse">
        ⚠ Questions
      </a>
    {:else}
      <a href="/questions" class="nav-btn {isActive('/questions') ? 'nav-btn-active' : 'nav-btn-muted'}">
        Questions
      </a>
    {/if}

    {#if notifState === "unsubscribed"}
      <button onclick={toggleNotifications} class="nav-btn nav-btn-muted cursor-pointer">Notify</button>
    {:else if notifState === "subscribed"}
      <button onclick={toggleNotifications} class="nav-btn border-success-700 text-success-400 hover:bg-surface-800 cursor-pointer">Notify ✓</button>
    {:else if notifState === "checking" || notifState === "busy"}
      <span class="nav-btn nav-btn-muted opacity-50 select-none">Notify</span>
    {/if}
  </nav>
</header>
