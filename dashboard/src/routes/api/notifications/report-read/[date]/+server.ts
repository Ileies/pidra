import { isDateKey } from "$pipeline/util/ids";
import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { acknowledgeNotification, reportNotificationKey } from "#lib/server/notifications.js";

export const POST: RequestHandler = async ({ params }) => {
  if (!isDateKey(params.date)) error(400, "Invalid report date.");
  await acknowledgeNotification(reportNotificationKey(params.date));
  return new Response(null, { status: 204 });
};
