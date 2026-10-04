/** An error that knows the HTTP status it should surface as, so a route can map it in one place. */
export class HttpError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}
