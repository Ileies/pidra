import { env } from "$env/dynamic/private";
import postgres from "postgres";

let _sql: ReturnType<typeof postgres> | null = null;

export function sql() {
  if (!_sql) {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    _sql = postgres(env.DATABASE_URL, { max: 5 });
  }
  return _sql;
}
