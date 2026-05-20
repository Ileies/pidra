import type { Skill } from "../src/skills/loader";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";

// Allowed root directories — never write outside these
const ALLOWED_ROOTS = [
  resolve(homedir(), "Documents"),
  resolve(homedir(), "notes"),
  resolve(homedir(), "projects"),
  "/tmp",
];

function isPathAllowed(absPath: string): boolean {
  return ALLOWED_ROOTS.some((root) => absPath.startsWith(root + "/") || absPath === root);
}

const skill: Skill = {
  name: "create_file",
  description: "Create a file at a given path with specified content. Restricted to allowed directories (~/Documents, ~/notes, ~/projects, /tmp).",
  risk_level: "medium",
  parameters: {
    path: { type: "string", required: true, description: "Absolute file path to create" },
    content: { type: "string", required: true, description: "File content" },
    overwrite: { type: "boolean", required: false, description: "Whether to overwrite if file exists (default: false)" },
  },
  execute: async (params) => {
    const rawPath = String(params.path ?? "").trim();
    if (!rawPath) throw new Error("path is required");
    if (!isAbsolute(rawPath)) throw new Error("path must be absolute");

    const absPath = resolve(rawPath);
    if (!isPathAllowed(absPath)) {
      throw new Error(`Path not allowed. Must be under one of: ${ALLOWED_ROOTS.join(", ")}`);
    }

    const content = String(params.content ?? "");
    const overwrite = params.overwrite === true || params.overwrite === "true";

    if (!overwrite) {
      const { existsSync } = await import("node:fs");
      if (existsSync(absPath)) throw new Error(`File already exists: ${absPath}. Set overwrite=true to replace.`);
    }

    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, content, "utf-8");
    return `File created: ${absPath} (${content.length} chars)`;
  },
};

export default skill;
