import { prisma } from '../config/db.js';
import type { Prisma } from '@prisma/client';

export class FileRepository {
  static async findById(id: string) {
    return prisma.fileAsset.findUnique({
      where: { id }
    });
  }

  static async findByRoomId(roomId: string) {
    return prisma.fileAsset.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' }
    });
  }

  static async create(data: Prisma.FileAssetUncheckedCreateInput) {
    return prisma.fileAsset.create({
      data
    });
  }
}
