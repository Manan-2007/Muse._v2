/**
 * Thrown by services to signal an expected failure with a status code.
 * The error middleware turns these into JSON; anything else becomes a 500.
 */
export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }

  static badRequest(message: string) {
    return new HttpError(400, message)
  }
  static unauthorized(message = 'Not signed in') {
    return new HttpError(401, message)
  }
  static forbidden(message: string) {
    return new HttpError(403, message)
  }
  static notFound(message: string) {
    return new HttpError(404, message)
  }
  static conflict(message: string) {
    return new HttpError(409, message)
  }
  static tooMany(message: string) {
    return new HttpError(429, message)
  }
  /** An upstream service answered, but not usefully. */
  static badGateway(message: string) {
    return new HttpError(502, message)
  }
  /** A dependency this server needs is missing or unreachable — not a bug
      here, so it must not read as one to whoever hits it. */
  static unavailable(message: string) {
    return new HttpError(503, message)
  }
}
