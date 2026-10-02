import { createHash, timingSafeEqual } from "node:crypto";

/** Fails closed: with no configured secret nothing is authorized. Hashing first makes both sides
 *  the same length, so the compare leaks neither content nor length. */
export function smsSecretAuthorized(configured: string | undefined, supplied: string | undefined): boolean {
  if (!configured || !supplied) return false;
  const a = createHash("sha256").update(configured).digest();
  const b = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(a, b);
}
