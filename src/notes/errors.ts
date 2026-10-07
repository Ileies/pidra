import { HttpError } from "../util/errors";

/** "not found" messages surface as 404, every other validation failure as 400. Re-exported by `store.ts`. */
export class NoteError extends HttpError {
  constructor(message: string) {
    super(message, message.includes("not found") ? 404 : 400);
  }
}
