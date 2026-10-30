// Google's Android auth endpoint, as used by Keep: web oauth_token cookie -> master token, master token
// -> short-lived OAuth token. A port of the parts of gpsoauth 2.0 that gkeepapi relies on; the request
// shapes are what the endpoint accepts and should not be "tidied".

export const AUTH_URL = "https://android.clients.google.com/auth";
export const KEEP_SCOPES = "oauth2:https://www.googleapis.com/auth/memento https://www.googleapis.com/auth/reminders";
const KEEP_APP = "com.google.android.keep";
/** The Android client signature of the real Keep app; the endpoint checks it against `app`. */
const KEEP_CLIENT_SIG = "38918a453d07199354f8b19af05ec6562ced5788";

export class KeepLoginError extends Error {}

/** Injectable for tests; production uses the global fetch. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** The endpoint answers `Key=value` lines, not JSON. A value may itself contain `=`. */
export function parseAuthResponse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq < 0) out[line] = "";
    else out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

async function authRequest(data: Record<string, string | number>, http: Fetcher): Promise<Record<string, string>> {
  const res = await http(AUTH_URL, {
    method: "POST",
    headers: {
      "Accept-Encoding": "identity",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "GoogleAuth/1.4",
    },
    body: new URLSearchParams(Object.entries(data).map(([k, v]) => [k, String(v)])),
  });
  // The status is deliberately not checked: failures arrive as `Error=...` in a 403 body, which is the
  // part callers report. A body with neither Error nor a token is reported with the status instead.
  const parsed = parseAuthResponse(await res.text());
  if (!parsed.Error && !parsed.Auth && !parsed.Token) parsed.Error = `HTTP ${res.status} without a token`;
  return parsed;
}

/** Fields shared by every call; only the secret and the service differ. */
function baseData(email: string, androidId: string): Record<string, string | number> {
  return {
    accountType: "HOSTED_OR_GOOGLE",
    Email: email,
    has_permission: 1,
    source: "android",
    androidId,
    device_country: "us",
    operatorCountry: "us",
    lang: "en",
    sdk_version: 17,
    google_play_services_version: 240913000,
  };
}

/** Result has `Token` (the master token, `aas_et/...`) on success, `Error` otherwise. */
export function exchangeToken(email: string, oauthToken: string, androidId: string, http: Fetcher = fetch): Promise<Record<string, string>> {
  return authRequest({
    ...baseData(email, androidId),
    add_account: 1,
    ACCESS_TOKEN: 1,
    Token: oauthToken,
    service: "ac2dm",
    client_sig: KEEP_CLIENT_SIG,
    callerSig: KEEP_CLIENT_SIG,
    droidguard_results: "dummy123",
  }, http);
}

/** A bearer token for the Keep API (`Authorization: OAuth <token>`). Throws KeepLoginError without one. */
export async function fetchKeepAccessToken(email: string, masterToken: string, androidId: string, http: Fetcher = fetch): Promise<string> {
  const res = await authRequest({
    ...baseData(email, androidId),
    EncryptedPasswd: masterToken,
    service: KEEP_SCOPES,
    app: KEEP_APP,
    client_sig: KEEP_CLIENT_SIG,
  }, http);
  if (!res.Auth) throw new KeepLoginError(`Keep login failed: ${res.Error ?? "no Auth token in the response"}`);
  return res.Auth;
}
