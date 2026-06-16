import type { Request, Response, NextFunction } from 'express';

export function validateUploadChunk(req: Request, res: Response, next: NextFunction) {
  if (Buffer.isBuffer(req.body)) {
    return next();
  }
  res.status(400).json({ error: 'Chunk upload body must be binary' });
}
