import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { storage } from '../config/storage.js';
import { UploadRepository } from '../repositories/upload.repository.js';
import { FileRepository } from '../repositories/file.repository.js';
import { RoomService } from './room.service.js';
import { sanitizeUploadName, buildStorageKey } from '../utils/path.util.js';

export class UploadService {
  static async createSession(roomId: string, fileName: string, mimeType: string, fileSize: number, chunkSize: number) {
    // Validate that the total file size in the room does not exceed the allowed limit
    const currentTotalSize = await FileRepository.sumSizeByRoomId(roomId);
    if (currentTotalSize + fileSize > env.ROOM_UPLOAD_MAX_BYTES) {
      throw new Error('Room upload limit exceeded');
    }

    const safeName = sanitizeUploadName(fileName);
    const uploadId = crypto.randomUUID();
    const tmpDir = path.join(env.UPLOAD_TMP_DIR, roomId, uploadId);
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize));
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const session = await UploadRepository.create({
      id: uploadId,
      roomId,
      fileName,
      safeName,
      mimeType,
      fileSize,
      chunkSize,
      totalChunks,
      tmpDir,
      expiresAt
    });

    RoomService.touchRoom(roomId);

    return {
      uploadId: session.id,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      expiresAt: session.expiresAt
    };
  }

  static async getSession(roomId: string, uploadId: string) {
    const session = await UploadRepository.findById(uploadId);
    if (!session || session.roomId !== roomId) {
      throw new Error('Upload session not found');
    }

    const files = await fs.promises.readdir(session.tmpDir).catch(() => []);
    const receivedChunks = files.filter((file) => file.endsWith('.part')).length;

    return {
      uploadId: session.id,
      totalChunks: session.totalChunks,
      receivedChunks,
      status: session.status,
      expiresAt: session.expiresAt
    };
  }

  static async saveChunk(roomId: string, uploadId: string, chunkIndex: number, body: Buffer) {
    const session = await UploadRepository.findById(uploadId);
    if (!session || session.roomId !== roomId) {
      throw new Error('Upload session not found');
    }

    if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      throw new Error('Invalid chunk index');
    }

    if (Date.now() > session.expiresAt.getTime()) {
      throw new Error('Upload session expired');
    }

    if (body.length > session.chunkSize) {
      throw new Error('Chunk size exceeds session limit');
    }

    await fs.promises.mkdir(session.tmpDir, { recursive: true });
    const chunkPath = path.join(session.tmpDir, `${chunkIndex}.part`);
    await fs.promises.writeFile(chunkPath, body);

    RoomService.touchRoom(roomId);

    return {
      uploadId: session.id,
      chunkIndex,
      received: true
    };
  }

  static async finalizeUpload(roomId: string, uploadId: string) {
    const session = await UploadRepository.findById(uploadId);
    if (!session || session.roomId !== roomId) {
      throw new Error('Upload session not found');
    }

    if (Date.now() > session.expiresAt.getTime()) {
      throw new Error('Upload session expired');
    }

    const chunkPaths = Array.from({ length: session.totalChunks }, (_, index) =>
      path.join(session.tmpDir, `${index}.part`)
    );

    for (const chunkPath of chunkPaths) {
      if (!fs.existsSync(chunkPath)) {
        throw new Error('Missing uploaded chunks');
      }
    }

    const assembledPath = path.join(session.tmpDir, `${session.id}.assembled`);
    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(assembledPath);
      let currentIndex = 0;
      const appendNext = () => {
        if (currentIndex >= chunkPaths.length) {
          writeStream.end();
          resolve();
          return;
        }
        const chunkPath = chunkPaths[currentIndex];
        if (!chunkPath) {
          reject(new Error('Missing chunk path'));
          return;
        }

        const readStream = fs.createReadStream(chunkPath);
        readStream.on('error', reject);
        readStream.on('end', () => {
          currentIndex += 1;
          appendNext();
        });
        readStream.pipe(writeStream, { end: false });
      };
      writeStream.on('error', reject);
      appendNext();
    });

    const stats = await fs.promises.stat(assembledPath);
    if (stats.size !== session.fileSize) {
      await fs.promises.rm(session.tmpDir, { recursive: true, force: true }).catch(() => undefined);
      throw new Error('Assembled file size does not match session file size');
    }

    const fileId = crypto.randomUUID();
    const storageKey = buildStorageKey(roomId, fileId, session.safeName);
    await storage.saveFile(assembledPath, { key: storageKey, mimeType: session.mimeType });

    const file = await FileRepository.create({
      id: fileId,
      roomId,
      originalName: session.fileName,
      safeName: session.safeName,
      mimeType: session.mimeType,
      size: session.fileSize,
      storageKey
    });

    await UploadRepository.delete(session.id);
    await fs.promises.rm(session.tmpDir, { recursive: true, force: true }).catch(() => undefined);
    await RoomService.touchRoom(roomId);

    return file;
  }
}
