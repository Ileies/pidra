/**
 * The `/login` URL for a reader bounced from `pathname`. Shared by the auth gate and the service
 * worker so both agree: the root carries no `?redirect=`, since `/` is where login lands anyway.
 */
export function loginUrl(pathname: string): string {
  return pathname === "/" ? "/login" : `/login?redirect=${encodeURIComponent(pathname)}`;
}
