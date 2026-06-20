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

  /**
   * Computes the total size in bytes of all uploaded files in a given room.
   */
  static async sumSizeByRoomId(roomId: string): Promise<number> {
    const result = await prisma.fileAsset.aggregate({
      where: { roomId },
      _sum: {
        size: true
      }
    });
    return result._sum.size ?? 0;
  }

  /**
   * Computes the total size in bytes of all files stored across all rooms.
   */
  static async sumAllSizes(): Promise<number> {
    const result = await prisma.fileAsset.aggregate({
      _sum: {
        size: true
      }
    });
    return result._sum.size ?? 0;
  }
}
