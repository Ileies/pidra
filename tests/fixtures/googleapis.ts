// A stand-in for the `googleapis` package, so src/ingest/google.ts runs for real with no network.
// `mock.module("googleapis", () => googleapisModule)`, then drive `googleState`. Bun fixes a module's
// export names the first time it is mocked, so every test mocking googleapis must use this module.
export const googleState = {
  /** What `events.list` returns, as Calendar API items. */
  events: [] as Record<string, unknown>[],
  /** Set to make `events.list` reject. */
  eventsError: null as Error | null,
  listCalls: [] as Record<string, unknown>[],
};

export function resetGoogleState() {
  googleState.events = [];
  googleState.eventsError = null;
  googleState.listCalls = [];
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
    tasks: () => ({}),
  },
};
