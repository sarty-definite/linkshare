import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import sanitizeFilename from 'sanitize-filename';
import { env } from './config.js';

export const starterDocument = {
  type: 'doc',
  content: [{ type: 'paragraph' }]
};

export function createSalt() {
  return crypto.randomBytes(16).toString('hex');
}

export function hashRoomKey(roomKey: string, salt: string) {
  return crypto.createHash('sha256').update(`${salt}:${roomKey}`).digest('hex');
}

export function compareRoomKey(roomKey: string, salt: string, expectedHash: string) {
  const actualHash = hashRoomKey(roomKey, salt);
  const actualBuffer = Buffer.from(actualHash, 'hex');
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function signAccessToken(roomId: string) {
  return jwt.sign({ roomId }, env.JWT_SECRET, { expiresIn: '30d' });
}

export function verifyAccessToken(token: string) {
  const payload = jwt.verify(token, env.JWT_SECRET);
  if (!payload || typeof payload === 'string' || !('roomId' in payload)) {
    throw new Error('Invalid access token');
  }
  if (typeof payload.roomId !== 'string') {
    throw new Error('Invalid access token');
  }
  return payload.roomId;
}

export function normalizeRoomId(roomId: string) {
  return roomId.trim();
}

export function isValidRoomId(roomId: string) {
  return /^[a-zA-Z0-9_-]{3,64}$/.test(roomId);
}

export function sanitizeUploadName(fileName: string) {
  const base = sanitizeFilename(fileName) || 'file';
  return base.replace(/\s+/g, '-');
}

export function buildStorageKey(roomId: string, fileId: string, safeName: string) {
  return `${roomId}/${fileId}/${safeName}`;
}
