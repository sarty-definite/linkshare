import { prisma } from "../config/db.js";
import type { Prisma } from "@prisma/client";

export class UploadRepository {
  static async findById(id: string) {
    return prisma.uploadSession.findUnique({
      where: { id },
    });
  }

  static async findByRoomId(roomId: string) {
    return prisma.uploadSession.findMany({
      where: { roomId },
    });
  }

  static async create(data: Prisma.UploadSessionUncheckedCreateInput) {
    return prisma.uploadSession.create({
      data,
    });
  }

  static async delete(id: string) {
    return prisma.uploadSession.delete({
      where: { id },
    });
  }

  static async findExpiredSessions(now: Date) {
    return prisma.uploadSession.findMany({
      where: { expiresAt: { lt: now } },
    });
  }
}
