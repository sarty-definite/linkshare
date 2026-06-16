import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

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

export function createDownloadToken(
  roomId: string,
  fileId: string
) {
  return jwt.sign(
    {
      roomId,
      fileId,
      purpose: 'download'
    },
    env.JWT_SECRET,
    {
      expiresIn: '10m'
    }
  );
}

export function verifyDownloadToken(token: string) {
  const payload = jwt.verify(token, env.JWT_SECRET);

  if (
    typeof payload === 'string' ||
    payload.purpose !== 'download'
  ) {
    throw new Error('Invalid download token');
  }

  return payload as {
    roomId: string;
    fileId: string;
    purpose: 'download';
  };
}
