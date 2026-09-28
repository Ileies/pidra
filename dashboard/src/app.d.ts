declare global {
  namespace App {
    interface Error {
      /**
       * Set when the request behind the error never reached pronix. Comes
       * from `net.ts`, either as a field of a synthetic `__data.json` answer or through
       * `handleError` in `hooks.client.ts`, and is what `+error.svelte` branches on.
       */
      offline?: boolean;
    }
    interface Locals {
      /** Set by the auth gate in `hooks.server.ts`. Null on every publicly-allowlisted path. */
      session: { id: string } | null;
    }
  }
}

export {};
