import { FileRepository } from "../repositories/file.repository.js";
import { storage } from "../config/storage.js";
import {
  createDownloadToken,
  verifyDownloadToken,
} from "../utils/security.util.js";
import { env } from "../config/env.js";

export class DownloadService {
  static async generateDownloadUrl(
    roomId: string,
    fileId: string,
  ): Promise<string> {
    const file = await FileRepository.findById(fileId);
    if (!file || file.roomId !== roomId) {
      throw new Error("File not found");
    }

    const token = createDownloadToken(roomId, file.id);
    return `${env.API_URL}/api/download/${token}`;
  }

  static async getFileForRoom(roomId: string, fileId: string) {
    const file = await FileRepository.findById(fileId);
    if (!file || file.roomId !== roomId) {
      throw new Error("File not found");
    }

    const stream = await storage.createReadStream(file.storageKey);
    return { file, stream };
  }

  static async getFileByToken(token: string) {
    const { roomId, fileId } = verifyDownloadToken(token);
    const file = await FileRepository.findById(fileId);
    if (!file || file.roomId !== roomId) {
      throw new Error("File not found");
    }

    const stream = await storage.createReadStream(file.storageKey);
    return { file, stream };
  }
}
