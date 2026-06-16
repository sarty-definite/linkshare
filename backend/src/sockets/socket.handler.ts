import type { Server as SocketIOServer } from 'socket.io';
import { verifyAccessToken } from '../utils/security.util.js';
import { RoomService } from '../services/room.service.js';
import { RoomRepository } from '../repositories/room.repository.js';
import { CleanupService } from '../services/cleanup.service.js';
import { contentUpdateSchema } from '../models/schemas.js';
import { env } from '../config/env.js';

export function initializeSockets(io: SocketIOServer) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.['token'];
      const roomId = socket.handshake.auth?.['roomId'];
      if (typeof token !== 'string' || typeof roomId !== 'string') {
        throw new Error('Missing socket auth');
      }
      const verifiedRoomId = verifyAccessToken(token);
      if (verifiedRoomId !== roomId) {
        throw new Error('Socket room mismatch');
      }
      const room = await RoomRepository.findById(roomId);
      if (!room) {
        throw new Error('Room no longer exists');
      }
      socket.data['roomId'] = roomId;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error('Socket authorization failed'));
    }
  });

  io.on('connection', async (socket) => {
    const roomId = socket.data['roomId'] as string;
    const activeSet = RoomService.ensureActiveSet(roomId);

    if (activeSet.size >= env.ROOM_MAX_SESSIONS) {
      socket.emit('room:error', { message: 'Maximum sessions limit reached for this room.' });
      socket.disconnect(true);
      return;
    }

    await socket.join(roomId);
    activeSet.add(socket.id);

    const room = await RoomRepository.findById(roomId);
    if (room) {
      await RoomRepository.update(roomId, { lastActivityAt: new Date() });
    }

    io.to(roomId).emit('room:presence', { roomId, presenceCount: activeSet.size });
    CleanupService.scheduleRoomCleanup(roomId, room?.lastActivityAt ?? new Date());

    socket.on('room:content:update', async (payload) => {
      try {
        const parsed = contentUpdateSchema.parse(payload);
        const serialized = JSON.stringify(parsed.documentJson);
        if (serialized.length > 1_000_000) {
          return socket.emit('room:error', { message: 'Document is too large' });
        }
        
        const updated = await RoomService.updateContent(roomId, parsed.documentJson);

        io.to(roomId).emit('room:content:updated', {
          roomId,
          documentJson: updated.documentJson,
          documentVersion: updated.documentVersion,
          lastActivityAt: updated.lastActivityAt
        });
      } catch (error) {
        socket.emit('room:error', {
          message: error instanceof Error ? error.message : 'Invalid room content update'
        });
      }
    });

    socket.on('disconnect', async () => {
      const roomSockets = RoomService.activeRooms.get(roomId);
      roomSockets?.delete(socket.id);
      if (!roomSockets || roomSockets.size === 0) {
        RoomService.removeActiveRoom(roomId);
        const lastActivityAt = new Date();
        await RoomRepository.update(roomId, { lastActivityAt }).catch(() => undefined);
        CleanupService.scheduleRoomCleanup(roomId, lastActivityAt);
      }
      io.to(roomId).emit('room:presence', { roomId, presenceCount: RoomService.getPresenceCount(roomId) });
    });
  });
}
