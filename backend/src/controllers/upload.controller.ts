import type { Request, Response, NextFunction } from 'express';
import { UploadService } from '../services/upload.service.js';
import { requireRoomAuth } from '../middleware/auth.middleware.js';
import { uploadCreateSchema } from '../models/schemas.js';
import { normalizeRoomId } from '../utils/path.util.js';
import type { Server as SocketIOServer } from 'socket.io';

export class UploadController {
  static async initiate(req: Request, res: Response, next: NextFunction) {
    try {
      const roomId = normalizeRoomId(String(req.params['roomId'] || ''));
      const room = await requireRoomAuth(req, roomId);
      const parsed = uploadCreateSchema.parse(req.body);

      const session = await UploadService.createSession(
        room.id,
        parsed.fileName,
        parsed.mimeType,
        parsed.fileSize,
        parsed.chunkSize
      );

      res.status(201).json(session);
    } catch (error) {
      next(error);
    }
  }

  static async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const roomId = normalizeRoomId(String(req.params['roomId'] || ''));
      const room = await requireRoomAuth(req, roomId);
      const uploadId = String(req.params.uploadId || '');

      const status = await UploadService.getSession(room.id, uploadId);
      res.json(status);
    } catch (error) {
      next(error);
    }
  }

  static async uploadChunk(req: Request, res: Response, next: NextFunction) {
    try {
      const roomId = normalizeRoomId(String(req.params['roomId'] || ''));
      const room = await requireRoomAuth(req, roomId);
      const uploadId = String(req.params.uploadId || '');

      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: 'Missing chunk body' });
      }

      const chunkIndex = Number(req.params.chunkIndex);
      const result = await UploadService.saveChunk(room.id, uploadId, chunkIndex, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  static async finalize(req: Request, res: Response, next: NextFunction) {
    try {
      const roomId = normalizeRoomId(String(req.params['roomId'] || ''));
      const room = await requireRoomAuth(req, roomId);
      const uploadId = String(req.params.uploadId || '');

      const file = await UploadService.finalizeUpload(room.id, uploadId, req.body.parts);

      const io = req.app.get('io') as SocketIOServer | undefined;
      if (io) {
        io.to(room.id).emit('room:file:created', file);
      }

      res.status(201).json(file);
    } catch (error) {
      next(error);
    }
  }
}
