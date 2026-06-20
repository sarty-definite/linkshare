import type { Server as SocketIOServer } from 'socket.io';
import * as Y from 'yjs';
import { verifyAccessToken } from '../utils/security.util.js';
import { RoomService } from '../services/room.service.js';
import { RoomRepository } from '../repositories/room.repository.js';
import { CleanupService } from '../services/cleanup.service.js';
import { YjsRoomManager } from '../services/yjs.manager.js';
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

    // Load or initialize the master Yjs document in memory
    const serverDoc = await YjsRoomManager.loadRoom(roomId, room?.documentJson);

    // Send the server's state vector (Sync Step 1) to the newly connected client
    const serverStateVector = Y.encodeStateVector(serverDoc);
    socket.emit('yjs:sync:request', Buffer.from(serverStateVector));

    // Handle client's sync request (client sends their state vector)
    socket.on('yjs:sync:request', (clientStateVectorBuffer: Buffer) => {
      const clientStateVector = new Uint8Array(clientStateVectorBuffer);
      const update = Y.encodeStateAsUpdate(serverDoc, clientStateVector);
      socket.emit('yjs:sync:reply', Buffer.from(update));
    });

    // Handle client's sync response (client sends updates missing on the server)
    socket.on('yjs:sync:reply', (clientUpdateBuffer: Buffer) => {
      const clientUpdate = new Uint8Array(clientUpdateBuffer);
      Y.applyUpdate(serverDoc, clientUpdate);
      socket.to(roomId).emit('yjs:update', clientUpdateBuffer);
      YjsRoomManager.debouncedPersist(roomId);
    });

    // Handle incremental collaborative updates from this client
    socket.on('yjs:update', (updateBuffer: Buffer) => {
      const update = new Uint8Array(updateBuffer);
      Y.applyUpdate(serverDoc, update);
      socket.to(roomId).emit('yjs:update', updateBuffer);
      YjsRoomManager.debouncedPersist(roomId);
    });

    socket.on('disconnect', async () => {
      const roomSockets = RoomService.activeRooms.get(roomId);
      roomSockets?.delete(socket.id);
      if (!roomSockets || roomSockets.size === 0) {
        RoomService.removeActiveRoom(roomId);
        
        // Force persist the final state and remove from memory cache when the last user disconnects
        await YjsRoomManager.forcePersistAndCleanup(roomId).catch(() => undefined);
        
        const lastActivityAt = new Date();
        await RoomRepository.update(roomId, { lastActivityAt }).catch(() => undefined);
        CleanupService.scheduleRoomCleanup(roomId, lastActivityAt);
      }
      io.to(roomId).emit('room:presence', { roomId, presenceCount: RoomService.getPresenceCount(roomId) });
    });
  });
}
