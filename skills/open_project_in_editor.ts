import type { Skill } from "../src/skills/loader";
import { resolve, isAbsolute } from "node:path";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";

// Same allowed roots as create_file - a dev action, not a way to pop open an editor on
// arbitrary paths on the host.
const ALLOWED_ROOTS = [
  resolve(homedir(), "Documents"),
  resolve(homedir(), "notes"),
  resolve(homedir(), "projects"),
];

function isPathAllowed(absPath: string): boolean {
  return ALLOWED_ROOTS.some((root) => absPath.startsWith(root + "/") || absPath === root);
}

const skill: Skill = {
  name: "open_project_in_editor",
  description:
    "Open a project directory in the configured code editor on this machine. Restricted to " +
    "allowed directories (~/Documents, ~/notes, ~/projects).",
  risk_level: "medium",
  parameters: {
    path: { type: "string", required: true, description: "Absolute path to the project directory" },
    file: { type: "string", required: false, description: "A file inside the project to open too, relative to path. Default: just the project" },
    new_window: { type: "boolean", required: false, description: "Open in a new editor window (passes -n; VS Code family and Zed). Default: false" },
  },
  execute: async (params) => {
    const rawPath = String(params.path ?? "").trim();
    if (!rawPath) throw new Error("path is required");
    if (!isAbsolute(rawPath)) throw new Error("path must be absolute");

    const absPath = resolve(rawPath);
    if (!isPathAllowed(absPath)) {
      throw new Error(`Path not allowed. Must be under one of: ${ALLOWED_ROOTS.join(", ")}`);
    }
    if (!existsSync(absPath) || !statSync(absPath).isDirectory()) {
      throw new Error(`Not a directory: ${absPath}`);
    }

    const relativeFile = String(params.file ?? "").trim();
    let target: string | null = null;
    if (relativeFile) {
      target = resolve(absPath, relativeFile);
      if (!target.startsWith(absPath + "/")) throw new Error(`file must be inside ${absPath}`);
      if (!existsSync(target) || !statSync(target).isFile()) throw new Error(`Not a file: ${target}`);
    }
    const newWindow = params.new_window === true || String(params.new_window).toLowerCase() === "true";

    const editorCmd = process.env.SKILLS_EDITOR_COMMAND?.trim() || "cursor";
    const args = [editorCmd, ...(newWindow ? ["-n"] : []), absPath, ...(target ? [target] : [])];
    const proc = Bun.spawn(args, { stdio: ["ignore", "ignore", "ignore"] });
    proc.unref();

    return `Opened ${target ?? absPath} in ${editorCmd}${newWindow ? " (new window)" : ""}`;
  },
};

export default skill;
