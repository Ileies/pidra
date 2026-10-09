import { untrack } from "svelte";
import { page } from "$app/state";
import { replaceState } from "$app/navigation";
import { offline } from "#lib/offline/state.svelte.js";
import { reportPlayer } from "#lib/report/player.svelte.js";

/**
 * The notification's "Play briefing" button opens `/<date>?play=1`: start the player once, then drop
 * the param so a reload or back-navigation does not start it again. Call during component init.
 * Offline, or with no structured body, it only drops the param (speaking a chapter the first time
 * needs the server). If the browser refuses autoplay the player is already open, and one tap on its
 * play control continues.
 */
export function usePlayParam(args: () => { date: string; structured: boolean }) {
  $effect(() => {
    if (page.url.searchParams.get("play") !== "1") return;
    const { date, structured } = args();
    const url = new URL(page.url.href);
    url.searchParams.delete("play");
    if (structured && !offline.isOffline) untrack(() => reportPlayer.start(date));
    replaceState(url, page.state);
  });
}
