import { prisma } from '../config/db.js';
import type { Prisma } from '@prisma/client';

export class RoomRepository {
  static async findById(id: string) {
    return prisma.room.findUnique({
      where: { id }
    });
  }

  static async findByIdSelectId(id: string) {
    return prisma.room.findUnique({
      where: { id },
      select: { id: true }
    });
  }

  static async create(data: Prisma.RoomCreateInput) {
    return prisma.room.create({
      data
    });
  }

  static async update(id: string, data: Prisma.RoomUpdateInput) {
    return prisma.room.update({
      where: { id },
      data
    });
  }

  static async delete(id: string) {
    return prisma.room.delete({
      where: { id }
    });
  }

  static async findIdleRooms(cutoff: Date) {
    return prisma.room.findMany({
      where: { lastActivityAt: { lt: cutoff } },
      select: { id: true, lastActivityAt: true }
    });
  }
}
