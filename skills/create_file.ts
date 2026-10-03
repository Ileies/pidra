import type { Skill } from "../src/skills/loader";
import { appendFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";

// Allowed root directories - never write outside these
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
    append: { type: "boolean", required: false, description: "Add content to the end of the file, creating it if missing; overwrite is not needed. Default: false" },
    create_dirs: { type: "boolean", required: false, description: "Create missing parent directories. Default: true" },
    final_newline: { type: "boolean", required: false, description: "Make sure the written content ends with a newline. Default: false" },
  },
  execute: async (params) => {
    const rawPath = String(params.path ?? "").trim();
    if (!rawPath) throw new Error("path is required");
    if (!isAbsolute(rawPath)) throw new Error("path must be absolute");

    const absPath = resolve(rawPath);
    if (!isPathAllowed(absPath)) {
      throw new Error(`Path not allowed. Must be under one of: ${ALLOWED_ROOTS.join(", ")}`);
    }

    const flag = (value: unknown, fallback: boolean) =>
      value === undefined || value === null || value === "" ? fallback : value === true || String(value).toLowerCase() === "true";

    let content = String(params.content ?? "");
    if (flag(params.final_newline, false) && !content.endsWith("\n")) content += "\n";
    const overwrite = flag(params.overwrite, false);
    const append = flag(params.append, false);

    const { existsSync } = await import("node:fs");
    const existed = existsSync(absPath);
    if (!overwrite && !append && existed) throw new Error(`File already exists: ${absPath}. Set overwrite=true to replace or append=true to add to it.`);

    if (flag(params.create_dirs, true)) {
      await mkdir(dirname(absPath), { recursive: true });
    } else if (!existsSync(dirname(absPath))) {
      throw new Error(`Directory does not exist: ${dirname(absPath)}. Set create_dirs=true to create it.`);
    }

    if (append) {
      await appendFile(absPath, content, "utf-8");
      return `${existed ? "Appended to" : "File created"}: ${absPath} (${content.length} chars)`;
    }
    await writeFile(absPath, content, "utf-8");
    return `File created: ${absPath} (${content.length} chars)`;
  },
};

export default skill;
