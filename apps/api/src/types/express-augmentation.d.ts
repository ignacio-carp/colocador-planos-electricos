/// <reference types="express" />

declare global {
  namespace Express {
    interface Request {
      /** Set by `correlationMiddleware` before route handlers run. */
      correlationId: string
    }
  }
}

export {}
