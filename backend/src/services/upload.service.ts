import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { storage, getActiveS3Client } from '../config/storage.js';
import { UploadRepository } from '../repositories/upload.repository.js';
import { FileRepository } from '../repositories/file.repository.js';
import { RoomService } from './room.service.js';
import { sanitizeUploadName, buildStorageKey } from '../utils/path.util.js';
import { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class UploadService {
  static async createSession(roomId: string, fileName: string, mimeType: string, fileSize: number, chunkSize: number) {
    // Validate that the total file size in the room does not exceed the allowed limit
    const currentTotalSize = await FileRepository.sumSizeByRoomId(roomId);
    if (currentTotalSize + fileSize > env.ROOM_UPLOAD_MAX_BYTES) {
      throw new Error('Room upload limit exceeded');
    }

    // Validate that the global storage limit (9.5 GB) is not exceeded
    const globalTotalSize = await FileRepository.sumAllSizes();
    if (globalTotalSize + fileSize > env.GLOBAL_STORAGE_MAX_BYTES) {
      throw new Error('Global upload quota exceeded');
    }

    // S3/R2 direct multipart uploads require a minimum part size of 5 MB (except for the last part)
    let finalChunkSize = chunkSize;
    if (env.STORAGE_PROVIDER === 's3' || env.STORAGE_PROVIDER === 'r2') {
      const minS3ChunkSize = 5 * 1024 * 1024; // 5 MB
      if (finalChunkSize < minS3ChunkSize) {
        finalChunkSize = minS3ChunkSize;
      }
    }

    const safeName = sanitizeUploadName(fileName);
    const uploadId = crypto.randomUUID();
    const tmpDir = path.join(env.UPLOAD_TMP_DIR, roomId, uploadId);
    
    // Only create local temp directory if we are using local storage provider
    if (env.STORAGE_PROVIDER === 'local') {
      await fs.promises.mkdir(tmpDir, { recursive: true });
    }
    
    const totalChunks = Math.max(1, Math.ceil(fileSize / finalChunkSize));
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    let s3UploadId: string | null = null;
    let s3Key: string | null = null;
    const presignedUrls: string[] = [];

    // If using S3/R2 storage provider, initiate Multipart Upload and generate presigned URLs
    if (env.STORAGE_PROVIDER === 's3' || env.STORAGE_PROVIDER === 'r2') {
      const { client, bucket } = getActiveS3Client();
      if (!client || !bucket) {
        throw new Error('Active storage provider is not properly configured');
      }

      const fileId = crypto.randomUUID();
      s3Key = buildStorageKey(roomId, fileId, safeName);

      const multipart = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: s3Key,
          ContentType: mimeType
        })
      );
      s3UploadId = multipart.UploadId ?? null;
      if (!s3UploadId) {
        throw new Error('Failed to initiate multipart upload session');
      }

      // Generate a presigned URL for each part
      for (let i = 1; i <= totalChunks; i++) {
        const url = await getSignedUrl(
          client,
          new UploadPartCommand({
            Bucket: bucket,
            Key: s3Key,
            UploadId: s3UploadId,
            PartNumber: i
          }),
          {
            expiresIn: 3600 * 24,
            unhoistableHeaders: new Set(['x-amz-checksum-crc32', 'x-amz-sdk-checksum-algorithm'])
          }
        );
        presignedUrls.push(url);
      }
    }

    const session = await UploadRepository.create({
      id: uploadId,
      roomId,
      fileName,
      safeName,
      mimeType,
      fileSize,
      chunkSize: finalChunkSize,
      totalChunks,
      tmpDir,
      expiresAt,
      s3UploadId,
      s3Key
    });

    RoomService.touchRoom(roomId);

    return {
      uploadId: session.id,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      expiresAt: session.expiresAt,
      storageProvider: env.STORAGE_PROVIDER,
      presignedUrls
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

  static async finalizeUpload(roomId: string, uploadId: string, parts?: { PartNumber: number; ETag: string }[]) {
    const session = await UploadRepository.findById(uploadId);
    if (!session || session.roomId !== roomId) {
      throw new Error('Upload session not found');
    }

    if (Date.now() > session.expiresAt.getTime()) {
      throw new Error('Upload session expired');
    }

    let fileId: string = crypto.randomUUID();
    let storageKey = '';

    if (env.STORAGE_PROVIDER === 's3' || env.STORAGE_PROVIDER === 'r2') {
      if (!session.s3UploadId || !session.s3Key || !parts || parts.length === 0) {
        throw new Error('Missing multipart upload session data');
      }

      const { client, bucket } = getActiveS3Client();
      if (!client || !bucket) {
        throw new Error('Active storage provider is not properly configured');
      }

      // Complete the multipart upload on S3/R2
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: session.s3Key,
          UploadId: session.s3UploadId,
          MultipartUpload: {
            Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber)
          }
        })
      );

      // Parse fileId from the storageKey
      storageKey = session.s3Key;
      // Key format is: `${roomId}/${fileId}-${fileName}`
      const keyParts = storageKey.split('/');
      const fileNamePart = keyParts[keyParts.length - 1];
      if (fileNamePart && fileNamePart.includes('-')) {
        fileId = fileNamePart.split('-')[0] || fileId;
      }
    } else {
      // Local disk fallback
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

      storageKey = buildStorageKey(roomId, fileId, session.safeName);
      await storage.saveFile(assembledPath, { key: storageKey, mimeType: session.mimeType });
      await fs.promises.rm(session.tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }

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
    await RoomService.touchRoom(roomId);

    return file;
  }

  static async cancelUpload(roomId: string, uploadId: string) {
    const session = await UploadRepository.findById(uploadId);
    if (!session || session.roomId !== roomId) {
      throw new Error('Upload session not found');
    }

    if (env.STORAGE_PROVIDER === 's3' || env.STORAGE_PROVIDER === 'r2') {
      if (session.s3UploadId && session.s3Key) {
        const { client, bucket } = getActiveS3Client();
        if (client && bucket) {
          await client.send(
            new AbortMultipartUploadCommand({
              Bucket: bucket,
              Key: session.s3Key,
              UploadId: session.s3UploadId
            })
          ).catch((err) => {
            console.error('Failed to abort S3/R2 multipart upload:', err);
          });
        }
      }
    } else {
      // Local storage: remove temp chunks directory
      await fs.promises.rm(session.tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }

    await UploadRepository.delete(session.id);
    await RoomService.touchRoom(roomId);
  }

  static async deleteFile(roomId: string, fileId: string) {
    const file = await FileRepository.findById(fileId);
    if (!file || file.roomId !== roomId) {
      throw new Error('File not found');
    }

    // Delete from storage adapter
    await storage.deleteFile(file.storageKey).catch((err) => {
      console.error('Failed to delete file from storage adapter:', err);
    });

    // Delete from database
    await FileRepository.delete(fileId);
    await RoomService.touchRoom(roomId);
  }
}
