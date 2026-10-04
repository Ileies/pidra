import type { Context, ErrorHandler, MiddlewareHandler } from "hono";
import { HttpError } from "../util/errors";
import { isUuid } from "../util/ids";

/** The JSON body, or `{}` when it is missing or malformed, so a handler reports the missing field instead of a parse error. */
export async function bodyOf<T extends object>(c: Context): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
}

/** Rejects a request whose path parameter is not a UUID before the handler runs. */
export const uuidParam = (name = "id"): MiddlewareHandler => async (c, next) => {
  if (!isUuid(c.req.param(name))) return c.json({ error: "Invalid id" }, 400);
  await next();
};

/** A store's `HttpError` surfaces as its own status; anything else is a 500, as Hono's default. */
export const onError: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.text("Internal Server Error", 500);
};
