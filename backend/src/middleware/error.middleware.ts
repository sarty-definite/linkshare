import type { Request, Response, NextFunction } from 'express';

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  const status =
    message.includes('authorization') || message.includes('token') ? 401 :
    message.includes('Room does not exist') ? 404 :
    message.includes('Invalid room key') ? 403 :
    message.includes('required') ? 400 :
    500;
  res.status(status).json({ error: message });
}
