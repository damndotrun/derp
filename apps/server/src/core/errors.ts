export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const notFound = (message = 'Nem található') => new HttpError(404, 'not_found', message);
export const unauthorized = (message = 'Bejelentkezés szükséges') => new HttpError(401, 'unauthorized', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);
export const forbidden = (message = 'Nincs jogosultság') => new HttpError(403, 'forbidden', message);
