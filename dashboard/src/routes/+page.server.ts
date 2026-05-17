import { redirect } from "@sveltejs/kit";

export function load() {
  const today = new Date().toLocaleDateString("sv-SE");
  redirect(307, `/${today}`);
}
