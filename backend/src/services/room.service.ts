import fs from 'node:fs';
import { RoomRepository } from '../repositories/room.repository.js';
import { FileRepository } from '../repositories/file.repository.js';
import { UploadRepository } from '../repositories/upload.repository.js';
import { storage } from '../config/storage.js';
import { YjsRoomManager } from './yjs.manager.js';
import {
  createSalt,
  hashRoomKey,
  compareRoomKey,
  signAccessToken,
  starterDocument
} from '../utils/security.util.js';

export class RoomService {
  static activeRooms = new Map<string, Set<string>>();

  static getPresenceCount(roomId: string): number {
    return this.activeRooms.get(roomId)?.size ?? 0;
  }

  static ensureActiveSet(roomId: string): Set<string> {
    let activeSet = this.activeRooms.get(roomId);
    if (!activeSet) {
      activeSet = new Set();
      this.activeRooms.set(roomId, activeSet);
    }
    return activeSet;
  }

  static removeActiveRoom(roomId: string) {
    this.activeRooms.delete(roomId);
  }

  static touchRoom(roomId: string) {
    void RoomRepository.update(roomId, { lastActivityAt: new Date() }).catch(() => undefined);
  }

  static async exists(roomId: string): Promise<boolean> {
    const room = await RoomRepository.findByIdSelectId(roomId);
    return Boolean(room);
  }

  static async createRoom(roomId: string, privateRoom: boolean, roomKey?: string) {
    const existing = await RoomRepository.findById(roomId);
    if (existing) {
      throw new Error('Room already exists');
    }

    if (privateRoom && !roomKey) {
      throw new Error('Private rooms require a room key');
    }

    const roomKeySalt = privateRoom ? createSalt() : null;
    const roomKeyHash = privateRoom && roomKey ? hashRoomKey(roomKey, roomKeySalt!) : null;

    const room = await RoomRepository.create({
      id: roomId,
      isPrivate: privateRoom,
      roomKeySalt,
      roomKeyHash,
      documentJson: starterDocument,
      documentVersion: 1,
      lastActivityAt: new Date()
    });

    const accessToken = signAccessToken(room.id);
    return {
      roomId: room.id,
      accessToken,
      isPrivate: room.isPrivate,
      createdAt: room.createdAt
    };
  }

  static async joinRoom(roomId: string, roomKey?: string) {
    const room = await RoomRepository.findById(roomId);
    if (!room) {
      throw new Error('Room does not exist.');
    }

    if (room.isPrivate) {
      if (!roomKey || !room.roomKeyHash || !room.roomKeySalt) {
        throw new Error('Room key required.');
      }
      if (!compareRoomKey(roomKey, room.roomKeySalt, room.roomKeyHash)) {
        throw new Error('Invalid room key.');
      }
    }

    await RoomRepository.update(roomId, { lastActivityAt: new Date() });
    const accessToken = signAccessToken(room.id);

    return {
      roomId: room.id,
      accessToken,
      isPrivate: room.isPrivate,
      createdAt: room.createdAt
    };
  }

  static async getRoomState(roomId: string) {
    const room = await RoomRepository.findById(roomId);
    if (!room) {
      throw new Error('Room does not exist');
    }

    this.touchRoom(room.id);
    const files = await FileRepository.findByRoomId(room.id);

    return {
      roomId: room.id,
      isPrivate: room.isPrivate,
      documentJson: room.documentJson,
      documentVersion: room.documentVersion,
      lastActivityAt: room.lastActivityAt,
      presenceCount: this.getPresenceCount(room.id),
      files
    };
  }

  static async updateContent(roomId: string, documentJson: any) {
    const documentJsonString = JSON.stringify(documentJson);
    if (documentJsonString.length > 1_000_000) {
      throw new Error('Document is too large');
    }

    if (
      documentJson &&
      typeof documentJson === 'object' &&
      documentJson.type === 'yjs'
    ) {
      YjsRoomManager.removeDoc(roomId);
    }

    const updated = await RoomRepository.update(roomId, {
      documentJson,
      documentVersion: { increment: 1 },
      lastActivityAt: new Date()
    });

    return updated;
  }

  static async deleteRoom(roomId: string) {
    const files = await FileRepository.findByRoomId(roomId);
    const uploads = await UploadRepository.findByRoomId(roomId);

    await Promise.all(
      files.map((file) => storage.deleteFile(file.storageKey).catch(() => undefined))
    );
    await Promise.all(
      uploads.map((upload) =>
        fs.promises.rm(upload.tmpDir, { recursive: true, force: true }).catch(() => undefined)
      )
    );

    await RoomRepository.delete(roomId).catch(() => undefined);
    this.removeActiveRoom(roomId);
  }
}
