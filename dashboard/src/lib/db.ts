import { DATABASE_URL } from "$app/env/private";
import postgres from "postgres";

let _sql: ReturnType<typeof postgres> | null = null;

export function sql() {
  if (!_sql) {
    if (!DATABASE_URL) throw new Error("DATABASE_URL not set");
    _sql = postgres(DATABASE_URL, { max: 5 });
  }
  return _sql;
}
