import { DATABASE_URL } from "$app/env/private";
import postgres from "postgres";

/** The dashboard's lazily created Postgres client (pool of 5), shared by every `lib/server/*` module.
 *  `sql()` throws if `DATABASE_URL` is unset. Schema source of truth: `src/db/schema/`. */
let _sql: ReturnType<typeof postgres> | null = null;

export function sql() {
  if (!_sql) {
    if (!DATABASE_URL) throw new Error("DATABASE_URL not set");
    _sql = postgres(DATABASE_URL, { max: 5 });
  }
  return _sql;
}
