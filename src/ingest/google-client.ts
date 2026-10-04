import { google } from "googleapis";

/** An OAuth client holding the owner's refresh token, for Calendar, Tasks and Gmail-adjacent calls. */
export function googleAuth() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}
