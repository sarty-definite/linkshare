import type { Request, Response, NextFunction } from 'express';
import { RoomService } from '../services/room.service.js';
import { requireRoomAuth } from '../middleware/auth.middleware.js';
import { createRoomSchema, joinRoomSchema, contentUpdateSchema } from '../models/schemas.js';
import { normalizeRoomId, isValidRoomId } from '../utils/path.util.js';
import type { Server as SocketIOServer } from 'socket.io';

export class RoomController {
  static async checkExists(req: Request, res: Response, next: NextFunction) {
    try {
      const roomId = normalizeRoomId(String(req.params['roomId'] || ''));
      if (!isValidRoomId(roomId)) {
        return res.status(400).json({ error: 'Invalid room ID' });
      }
      const exists = await RoomService.exists(roomId);
      res.json({ exists });
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createRoomSchema.parse(req.body);
      const roomId = normalizeRoomId(parsed.roomId);
      if (!isValidRoomId(roomId)) {
        return res.status(400).json({ error: 'Room ID must be 3-64 characters and use letters, numbers, hyphen, or underscore' });
      }

      const result = await RoomService.createRoom(roomId, parsed.privateRoom, parsed.roomKey);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async join(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = joinRoomSchema.parse(req.body);
      const roomId = normalizeRoomId(parsed.roomId);

      const result = await RoomService.joinRoom(roomId, parsed.roomKey);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getState(req: Request, res: Response, next: NextFunction) {
    try {
      const roomId = normalizeRoomId(String(req.params['roomId'] || ''));
      const room = await requireRoomAuth(req, roomId);
      const state = await RoomService.getRoomState(room.id);
      res.json(state);
    } catch (error) {
      next(error);
    }
  }

  static async updateContent(req: Request, res: Response, next: NextFunction) {
    try {
      const roomId = normalizeRoomId(String(req.params['roomId'] || ''));
      const room = await requireRoomAuth(req, roomId);
      const parsed = contentUpdateSchema.parse(req.body);

      const updated = await RoomService.updateContent(room.id, parsed.documentJson);

      const io = req.app.get('io') as SocketIOServer | undefined;
      if (io) {
        io.to(room.id).emit('room:content:updated', {
          roomId: room.id,
          documentJson: updated.documentJson,
          documentVersion: updated.documentVersion,
          lastActivityAt: updated.lastActivityAt
        });
      }

      res.json({
        roomId: room.id,
        documentVersion: updated.documentVersion,
        lastActivityAt: updated.lastActivityAt
      });
    } catch (error) {
      next(error);
    }
  }
}
