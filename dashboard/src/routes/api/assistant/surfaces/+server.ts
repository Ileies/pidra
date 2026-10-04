import type { RequestHandler } from "./$types";
import { bridgeProxy } from "#lib/server/bridge.js";

// Fetched when the widget is first opened rather than in a layout load: the surface registry is
// nice to have, and a dead bridge must not take every dashboard page down with it.
export const GET: RequestHandler = () => bridgeProxy("/api/assistant/surfaces");
