/** A `RequestInit` for a JSON request: the method, and a body with its Content-Type when there is one. */
export function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method };
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
