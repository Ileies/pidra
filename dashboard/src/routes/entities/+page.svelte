<script lang="ts">
  import type { PageData } from "./$types";
  export let data: PageData;

  const navBtn = "px-3 py-1 rounded text-xs bg-surface-950 border transition-colors no-underline";

  const STATUS_CLASS: Record<string, string> = {
    active: "text-success-400 bg-success-950 border-success-700",
    dormant: "text-surface-500 bg-surface-900 border-surface-700",
    archived: "text-surface-600 bg-surface-900 border-surface-800",
  };

  const IMPORTANCE_CLASS: Record<string, string> = {
    high: "text-warning-400",
    medium: "text-surface-300",
    low: "text-surface-500",
  };

  function fmtDate(s: string | null) {
    if (!s) return "—";
    return new Date(s + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
  }
</script>

<svelte:head>
  <title>PIDRA — Entities</title>
</svelte:head>

<div class="flex flex-col min-h-screen">
  <header class="flex items-center justify-between px-8 py-3 bg-surface-900 border-b border-surface-700 sticky top-0 z-10">
    <div class="flex items-baseline gap-4">
      <span class="font-bold tracking-widest text-surface-50">PIDRA</span>
      <span class="text-surface-500 text-sm">Entity Graph</span>
    </div>
    <nav class="flex items-center gap-2">
      <a href="/" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">← Heute</a>
    </nav>
  </header>

  <main class="flex-1 max-w-5xl w-full mx-auto px-8 py-6 pb-16">
    <form method="GET" class="flex flex-wrap gap-3 mb-6">
      <input
        type="text"
        name="q"
        value={data.search}
        placeholder="Suche…"
        class="flex-1 min-w-48 px-3 py-1.5 rounded text-sm bg-surface-900 border border-surface-700 text-surface-100 placeholder-surface-600 focus:outline-none focus:border-surface-500"
      />

      <select name="status" class="px-3 py-1.5 rounded text-sm bg-surface-900 border border-surface-700 text-surface-200 focus:outline-none focus:border-surface-500">
        <option value="all" selected={data.statusFilter === "all"}>Alle Status</option>
        <option value="active" selected={data.statusFilter === "active"}>Aktiv</option>
        <option value="dormant" selected={data.statusFilter === "dormant"}>Dormant</option>
        <option value="archived" selected={data.statusFilter === "archived"}>Archiviert</option>
      </select>

      {#if data.types.length > 0}
        <select name="type" class="px-3 py-1.5 rounded text-sm bg-surface-900 border border-surface-700 text-surface-200 focus:outline-none focus:border-surface-500">
          <option value="" selected={data.typeFilter === ""}>Alle Typen</option>
          {#each data.types as t}
            <option value={t} selected={data.typeFilter === t}>{t}</option>
          {/each}
        </select>
      {/if}

      <button type="submit" class="px-3 py-1.5 rounded text-sm bg-surface-800 border border-surface-600 text-surface-200 hover:bg-surface-700 cursor-pointer">Filter</button>
    </form>

    {#if data.entities.length === 0}
      <p class="text-surface-400 text-sm text-center py-16">Keine Entities gefunden.</p>
    {:else}
      <div class="text-xs text-surface-600 mb-3">{data.entities.length} Einträge</div>
      <div class="overflow-x-auto rounded-lg border border-surface-700">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-700 bg-surface-900">
              <th class="text-left px-4 py-2.5 text-surface-400 font-medium">Name</th>
              <th class="text-left px-4 py-2.5 text-surface-400 font-medium">Typ</th>
              <th class="text-left px-4 py-2.5 text-surface-400 font-medium hidden sm:table-cell">Domain</th>
              <th class="text-right px-4 py-2.5 text-surface-400 font-medium">Erwähnungen</th>
              <th class="text-left px-4 py-2.5 text-surface-400 font-medium">Status</th>
              <th class="text-left px-4 py-2.5 text-surface-400 font-medium hidden md:table-cell">Wichtigkeit</th>
              <th class="text-right px-4 py-2.5 text-surface-400 font-medium hidden lg:table-cell">Zuletzt</th>
            </tr>
          </thead>
          <tbody>
            {#each data.entities as entity}
              <tr class="border-b border-surface-800 hover:bg-surface-900/50 transition-colors">
                <td class="px-4 py-2.5">
                  <div class="font-medium text-surface-100">{entity.name}</div>
                  {#if entity.aliases && entity.aliases.length > 0}
                    <div class="text-xs text-surface-600 mt-0.5">{entity.aliases.slice(0, 3).join(", ")}</div>
                  {/if}
                  {#if entity.summary}
                    <div class="text-xs text-surface-500 mt-0.5 max-w-xs truncate">{entity.summary}</div>
                  {/if}
                </td>
                <td class="px-4 py-2.5 text-surface-400 whitespace-nowrap">{entity.type ?? "—"}</td>
                <td class="px-4 py-2.5 text-surface-500 hidden sm:table-cell">{entity.domain ?? "—"}</td>
                <td class="px-4 py-2.5 text-right tabular-nums text-surface-200">{entity.mention_count ?? 0}</td>
                <td class="px-4 py-2.5">
                  <span class="badge text-xs border {STATUS_CLASS[entity.status ?? ''] ?? 'text-surface-500 bg-surface-900 border-surface-700'}">
                    {entity.status ?? "—"}
                  </span>
                </td>
                <td class="px-4 py-2.5 hidden md:table-cell">
                  <span class="{IMPORTANCE_CLASS[entity.importance ?? ''] ?? 'text-surface-600'} text-xs">
                    {entity.importance ?? "—"}
                  </span>
                </td>
                <td class="px-4 py-2.5 text-right text-surface-500 text-xs whitespace-nowrap hidden lg:table-cell">{fmtDate(entity.last_mentioned)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </main>
</div>
