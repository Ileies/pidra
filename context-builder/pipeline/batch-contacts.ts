import type { EmailExtraction } from "./extract-email";

export interface ContactProfile {
  email: string;
  name: string;
  emailCount: number;
  categories: string[];
  importance: "high" | "medium" | "low";
  entities: string[];
  lastSeen: string;
  actionCount: number;
}

export function batchContacts(extractions: EmailExtraction[]): ContactProfile[] {
  const byEmail = new Map<string, EmailExtraction[]>();

  for (const ext of extractions) {
    const key = ext.from.toLowerCase();
    const arr = byEmail.get(key) ?? [];
    arr.push(ext);
    byEmail.set(key, arr);
  }

  return Array.from(byEmail.entries()).map(([email, items]) => {
    const categories = [...new Set(items.map((i) => i.category))];
    const entities = [...new Set(items.flatMap((i) => i.entities))].slice(0, 10);
    const actionCount = items.filter((i) => i.actionRequired).length;
    const highCount = items.filter((i) => i.importance === "high").length;
    const mediumCount = items.filter((i) => i.importance === "medium").length;
    const importance: "high" | "medium" | "low" =
      highCount >= 2 || (highCount >= 1 && items.length >= 5) ? "high"
      : mediumCount >= 3 ? "medium"
      : "low";
    const lastName = items.sort((a, b) => b.date.localeCompare(a.date))[0];

    return {
      email,
      name: lastName.fromName || email,
      emailCount: items.length,
      categories,
      importance,
      entities,
      lastSeen: lastName.date,
      actionCount,
    };
  }).sort((a, b) => b.emailCount - a.emailCount);
}
