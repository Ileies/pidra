// A stand-in for the `googleapis` package, so src/ingest/google.ts runs for real with no network.
// `mock.module("googleapis", () => googleapisModule)`, then drive `googleState`. Bun fixes a module's
// export names the first time it is mocked, so every test mocking googleapis must use this module.
export const googleState = {
  /** What `events.list` returns, as Calendar API items. */
  events: [] as Record<string, unknown>[],
  /** Set to make `events.list` reject. */
  eventsError: null as Error | null,
  listCalls: [] as Record<string, unknown>[],
  /** What `tasklists.list` returns. */
  taskLists: [] as { id?: string; title?: string }[],
  /** Task pages per tasklist id; page `n` is served for page token `p<n>` (none means page 0). */
  taskPages: {} as Record<string, Record<string, unknown>[][]>,
  taskListCalls: 0,
  taskCalls: [] as Record<string, unknown>[],
};

export function resetGoogleState() {
  googleState.events = [];
  googleState.eventsError = null;
  googleState.listCalls = [];
  googleState.taskLists = [];
  googleState.taskPages = {};
  googleState.taskListCalls = 0;
  googleState.taskCalls = [];
}

class OAuth2 {
  setCredentials() {}
}

export const googleapisModule = {
  google: {
    auth: { OAuth2 },
    calendar: () => ({
      events: {
        list: async (params: Record<string, unknown>) => {
          googleState.listCalls.push(params);
          if (googleState.eventsError) throw googleState.eventsError;
          return { data: { items: googleState.events } };
        },
      },
      calendars: { get: async () => ({ data: { timeZone: "Europe/Zurich" } }) },
    }),
    tasks: () => ({
      tasklists: {
        list: async () => {
          googleState.taskListCalls++;
          return { data: { items: googleState.taskLists } };
        },
      },
      tasks: {
        list: async (params: Record<string, unknown>) => {
          googleState.taskCalls.push(params);
          const pages = googleState.taskPages[String(params.tasklist)] ?? [];
          const index = typeof params.pageToken === "string" ? Number(params.pageToken.slice(1)) : 0;
          return { data: { items: pages[index] ?? [], nextPageToken: index + 1 < pages.length ? `p${index + 1}` : undefined } };
        },
      },
    }),
  },
};
