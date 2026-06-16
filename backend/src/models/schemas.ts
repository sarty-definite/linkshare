import { z } from 'zod';
import { env } from '../config/env.js';

export const roomAccessToken = z.string().min(10);
export const roomIdSchema = z.string().trim().regex(/^[a-zA-Z0-9_-]{3,64}$/);

export const createRoomSchema = z.object({
  roomId: roomIdSchema,
  privateRoom: z.boolean(),
  roomKey: z.string().min(4).max(256).optional()
});

export const joinRoomSchema = z.object({
  roomId: roomIdSchema,
  roomKey: z.string().min(1).max(256).optional()
});

export const contentUpdateSchema = z.object({
  documentJson: z.any(),
  clientVersion: z.number().int().nonnegative().optional()
});

export const uploadCreateSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  fileSize: z.number().int().positive().max(env.FILE_UPLOAD_MAX_BYTES),
  chunkSize: z.number().int().positive().max(10 * 1024 * 1024).default(5 * 1024 * 1024)
});
