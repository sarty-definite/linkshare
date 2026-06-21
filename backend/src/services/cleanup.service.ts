import fs from "node:fs";
import { env } from "../config/env.js";
import { RoomRepository } from "../repositories/room.repository.js";
import { UploadRepository } from "../repositories/upload.repository.js";
import { RoomService } from "./room.service.js";

export class CleanupService {
  static pendingCleanup = new Map<string, NodeJS.Timeout>();

  static scheduleRoomCleanup(roomId: string, lastActivityAt: Date) {
    const existing = this.pendingCleanup.get(roomId);
    if (existing) {
      clearTimeout(existing);
    }

    const elapsed = Date.now() - lastActivityAt.getTime();
    const delay = Math.max(env.ROOM_CLEANUP_MINUTES * 60_000 - elapsed, 5_000);

    const timeout = setTimeout(async () => {
      this.pendingCleanup.delete(roomId);
      const activeCount = RoomService.getPresenceCount(roomId);
      const room = await RoomRepository.findById(roomId);
      if (!room) {
        return;
      }
      const minutesIdle = (Date.now() - room.lastActivityAt.getTime()) / 60_000;
      if (activeCount === 0 && minutesIdle >= env.ROOM_CLEANUP_MINUTES) {
        await RoomService.deleteRoom(roomId);
      }
    }, delay);

    this.pendingCleanup.set(roomId, timeout);
  }

  static async pruneExpiredUploadSessions() {
    const expired = await UploadRepository.findExpiredSessions(new Date());
    for (const session of expired) {
      await fs.promises
        .rm(session.tmpDir, { recursive: true, force: true })
        .catch(() => undefined);
      await UploadRepository.delete(session.id).catch(() => undefined);
    }
  }

  static async runRoomCleanup() {
    const cutoff = new Date(Date.now() - env.ROOM_CLEANUP_MINUTES * 60_000);
    const rooms = await RoomRepository.findIdleRooms(cutoff);
    for (const room of rooms) {
      if (RoomService.getPresenceCount(room.id) === 0) {
        await RoomService.deleteRoom(room.id);
      }
    }
    await this.pruneExpiredUploadSessions();
  }

  static startCleanupInterval() {
    setInterval(() => {
      void this.runRoomCleanup().catch(() => undefined);
    }, 5 * 60_000);
  }
}
