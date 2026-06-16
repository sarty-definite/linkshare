import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server as SocketIOServer } from 'socket.io';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from './config.js';
import { prisma } from './db.js';
import {
  buildStorageKey,
  compareRoomKey,
  createSalt,
  hashRoomKey,
  isValidRoomId,
  normalizeRoomId,
  sanitizeUploadName,
  signAccessToken,
  starterDocument,
  verifyAccessToken,
  createDownloadToken,
  verifyDownloadToken
} from './security.js';
import { storage } from './storage.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 200, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const uploadLimiter = rateLimit({ windowMs: 60_000, limit: 80, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);

const roomAccessToken = z.string().min(10);
const roomIdSchema = z.string().trim().regex(/^[a-zA-Z0-9_-]{3,64}$/);
const createRoomSchema = z.object({
  roomId: roomIdSchema,
  privateRoom: z.boolean(),
  roomKey: z.string().min(16).max(256).optional()
});
const joinRoomSchema = z.object({
  roomId: roomIdSchema,
  roomKey: z.string().min(1).max(256).optional()
});
const contentUpdateSchema = z.object({
  documentJson: z.any(),
  clientVersion: z.number().int().nonnegative().optional()
});
const uploadCreateSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  fileSize: z.number().int().positive().max(env.FILE_UPLOAD_MAX_BYTES),
  chunkSize: z.number().int().positive().max(10 * 1024 * 1024).default(5 * 1024 * 1024)
});

const activeRooms = new Map<string, Set<string>>();
const pendingCleanup = new Map<string, NodeJS.Timeout>();

function blankDocumentJson(): Prisma.InputJsonValue {
  return starterDocument;
}

function getBearerToken(req: Request) {
  const header = req.get('authorization');
  if (!header) {
    throw new Error('Missing authorization header');
  }
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new Error('Invalid authorization header');
  }
  return token;
}

async function requireRoomAuth(req: Request, expectedRoomId?: string) {
  const token = getBearerToken(req);
  const tokenRoomId = verifyAccessToken(token);
  if (expectedRoomId && tokenRoomId !== expectedRoomId) {
    throw new Error('Room token does not match the requested room');
  }
  const room = await prisma.room.findUnique({ where: { id: tokenRoomId } });
  if (!room) {
    throw new Error('Room no longer exists');
  }
  return room;
}

function roomPresenceCount(roomId: string) {
  return activeRooms.get(roomId)?.size ?? 0;
}

function touchRoom(roomId: string) {
  void prisma.room.update({ where: { id: roomId }, data: { lastActivityAt: new Date() } }).catch(() => undefined);
}

function ensureActiveSet(roomId: string) {
  if (!activeRooms.has(roomId)) {
    activeRooms.set(roomId, new Set());
  }
  return activeRooms.get(roomId)!;
}

async function deleteRoom(roomId: string) {
  const files = await prisma.fileAsset.findMany({ where: { roomId } });
  const uploads = await prisma.uploadSession.findMany({ where: { roomId } });
  await Promise.all(files.map((file: { storageKey: string }) => storage.deleteFile(file.storageKey).catch(() => undefined)));
  await Promise.all(
    uploads.map((upload: { tmpDir: string }) => fs.promises.rm(upload.tmpDir, { recursive: true, force: true }).catch(() => undefined))
  );
  await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
  activeRooms.delete(roomId);
}

function scheduleCleanup(roomId: string, lastActivityAt: Date) {
  const existing = pendingCleanup.get(roomId);
  if (existing) {
    clearTimeout(existing);
  }
  const elapsed = Date.now() - lastActivityAt.getTime();
  const delay = Math.max(env.ROOM_CLEANUP_MINUTES * 60_000 - elapsed, 5_000);
  const timeout = setTimeout(async () => {
    pendingCleanup.delete(roomId);
    const activeCount = roomPresenceCount(roomId);
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      return;
    }
    const minutesIdle = (Date.now() - room.lastActivityAt.getTime()) / 60_000;
    if (activeCount === 0 && minutesIdle >= env.ROOM_CLEANUP_MINUTES) {
      await deleteRoom(roomId);
    }
  }, delay);
  pendingCleanup.set(roomId, timeout);
}

async function validateUploadChunk(req: Request, res: Response, next: NextFunction) {
  if (Buffer.isBuffer(req.body)) {
    return next();
  }
  res.status(400).json({ error: 'Chunk upload body must be binary' });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/rooms/:roomId/exists', async (req, res, next) => {
  try {
    const roomId = normalizeRoomId(req.params.roomId);
    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: 'Invalid room ID' });
    }
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
    res.json({ exists: Boolean(room) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/rooms/create', authLimiter, async (req, res, next) => {
  try {
    const parsed = createRoomSchema.parse(req.body);
    const roomId = normalizeRoomId(parsed.roomId);
    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: 'Room ID must be 3-64 characters and use letters, numbers, hyphen, or underscore' });
    }
    const existing = await prisma.room.findUnique({ where: { id: roomId } });
    if (existing) {
      return res.status(409).json({ error: 'Room already exists' });
    }
    const privateRoom = parsed.privateRoom;
    if (privateRoom && !parsed.roomKey) {
      return res.status(400).json({ error: 'Private rooms require a room key' });
    }
    const roomKeySalt = privateRoom ? createSalt() : null;
    const roomKeyHash = privateRoom && parsed.roomKey ? hashRoomKey(parsed.roomKey, roomKeySalt!) : null;
    const room = await prisma.room.create({
      data: {
        id: roomId,
        isPrivate: privateRoom,
        roomKeySalt,
        roomKeyHash,
        documentJson: blankDocumentJson(),
        documentVersion: 1,
        lastActivityAt: new Date()
      }
    });
    const accessToken = signAccessToken(room.id);
    res.status(201).json({
      roomId: room.id,
      accessToken,
      isPrivate: room.isPrivate,
      createdAt: room.createdAt
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/rooms/join', authLimiter, async (req, res, next) => {
  try {
    const parsed = joinRoomSchema.parse(req.body);
    const roomId = normalizeRoomId(parsed.roomId);
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      return res.status(404).json({ error: 'Room does not exist' });
    }
    if (room.isPrivate) {
      if (!parsed.roomKey || !room.roomKeyHash || !room.roomKeySalt) {
        return res.status(403).json({ error: 'Room key required' });
      }
      if (!compareRoomKey(parsed.roomKey, room.roomKeySalt, room.roomKeyHash)) {
        return res.status(403).json({ error: 'Invalid room key' });
      }
    }
    await prisma.room.update({ where: { id: roomId }, data: { lastActivityAt: new Date() } });
    const accessToken = signAccessToken(room.id);
    res.json({
      roomId: room.id,
      accessToken,
      isPrivate: room.isPrivate,
      createdAt: room.createdAt
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/rooms/:roomId/state', async (req, res, next) => {
  try {
    const roomId = normalizeRoomId(req.params.roomId);
    const room = await requireRoomAuth(req, roomId);
    touchRoom(room.id);
    res.json({
      roomId: room.id,
      isPrivate: room.isPrivate,
      documentJson: room.documentJson,
      documentVersion: room.documentVersion,
      lastActivityAt: room.lastActivityAt,
      presenceCount: roomPresenceCount(room.id),
      files: await prisma.fileAsset.findMany({ where: { roomId: room.id }, orderBy: { createdAt: 'desc' } })
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/rooms/:roomId/content', authLimiter, async (req, res, next) => {
  try {
    const roomId = normalizeRoomId(String(req.params.roomId));;
    const room = await requireRoomAuth(req, roomId);
    const parsed = contentUpdateSchema.parse(req.body);
    const documentJsonString = JSON.stringify(parsed.documentJson);
    if (documentJsonString.length > 1_000_000) {
      return res.status(413).json({ error: 'Document is too large' });
    }
    const updated = await prisma.room.update({
      where: { id: room.id },
      data: {
        documentJson: parsed.documentJson as any,
        documentVersion: { increment: 1 },
        lastActivityAt: new Date()
      }
    });
    io.to(room.id).emit('room:content:updated', {
      roomId: room.id,
      documentJson: updated.documentJson,
      documentVersion: updated.documentVersion,
      lastActivityAt: updated.lastActivityAt
    });
    res.json({
      roomId: room.id,
      documentVersion: updated.documentVersion,
      lastActivityAt: updated.lastActivityAt
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/rooms/:roomId/uploads', uploadLimiter, async (req, res, next) => {
  try {
    const roomId = normalizeRoomId(String(req.params.roomId));
    const room = await requireRoomAuth(req, roomId);
    const parsed = uploadCreateSchema.parse(req.body);
    const safeName = sanitizeUploadName(parsed.fileName);
    const uploadId = crypto.randomUUID();
    const tmpDir = path.join(env.UPLOAD_TMP_DIR, room.id, uploadId);
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const totalChunks = Math.max(1, Math.ceil(parsed.fileSize / parsed.chunkSize));
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const session = await prisma.uploadSession.create({
      data: {
        id: uploadId,
        roomId: room.id,
        fileName: parsed.fileName,
        safeName,
        mimeType: parsed.mimeType,
        fileSize: parsed.fileSize,
        chunkSize: parsed.chunkSize,
        totalChunks,
        tmpDir,
        expiresAt
      }
    });
    touchRoom(room.id);
    res.status(201).json({
      uploadId: session.id,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      expiresAt: session.expiresAt
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/rooms/:roomId/uploads/:uploadId', async (req, res, next) => {
  try {
    const roomId = normalizeRoomId(String(req.params.roomId));
    await requireRoomAuth(req, roomId);
    const session = await prisma.uploadSession.findUnique({ where: { id: String(req.params.uploadId) } });
    if (!session || session.roomId !== roomId) {
      return res.status(404).json({ error: 'Upload session not found' });
    }
    const files = await fs.promises.readdir(session.tmpDir).catch(() => []);
    const receivedChunks = files.filter((file) => file.endsWith('.part')).length;
    res.json({
      uploadId: session.id,
      totalChunks: session.totalChunks,
      receivedChunks,
      status: session.status,
      expiresAt: session.expiresAt
    });
  } catch (error) {
    next(error);
  }
});

app.put(
  '/api/rooms/:roomId/uploads/:uploadId/chunks/:chunkIndex',
  uploadLimiter,
  express.raw({ type: 'application/octet-stream', limit: '20mb' }),
  validateUploadChunk,
  async (req, res, next) => {
    try {
      const roomId = normalizeRoomId(String(req.params.roomId));
      await requireRoomAuth(req, roomId);
      const session = await prisma.uploadSession.findUnique({ where: { id: String(req.params.uploadId) } });
      if (!session || session.roomId !== roomId) {
        return res.status(404).json({ error: 'Upload session not found' });
      }
      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: 'Missing chunk body' });
      }
      const chunkIndex = Number(String(req.params.chunkIndex));
      if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
        return res.status(400).json({ error: 'Invalid chunk index' });
      }
      if (Date.now() > session.expiresAt.getTime()) {
        return res.status(410).json({ error: 'Upload session expired' });
      }
      await fs.promises.mkdir(session.tmpDir, { recursive: true });
      const chunkPath = path.join(session.tmpDir, `${chunkIndex}.part`);
      await fs.promises.writeFile(chunkPath, req.body);
      touchRoom(roomId);
      res.json({ uploadId: session.id, chunkIndex, received: true });
    } catch (error) {
      next(error);
    }
  }
);

app.post('/api/rooms/:roomId/uploads/:uploadId/finalize', uploadLimiter, async (req, res, next) => {
  try {
    const roomId = normalizeRoomId(String(req.params.roomId));
    const room = await requireRoomAuth(req, roomId);
    const session = await prisma.uploadSession.findUnique({ where: { id: String(req.params.uploadId) } });
    if (!session || session.roomId !== roomId) {
      return res.status(404).json({ error: 'Upload session not found' });
    }
    if (Date.now() > session.expiresAt.getTime()) {
      return res.status(410).json({ error: 'Upload session expired' });
    }
    const chunkPaths = Array.from({ length: session.totalChunks }, (_, index) => path.join(session.tmpDir, `${index}.part`));
    for (const chunkPath of chunkPaths) {
      if (!fs.existsSync(chunkPath)) {
        return res.status(400).json({ error: 'Missing uploaded chunks' });
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
    const fileId = crypto.randomUUID();
    const storageKey = buildStorageKey(room.id, fileId, session.safeName);
    await storage.saveFile(assembledPath, { key: storageKey, mimeType: session.mimeType });
    const file = await prisma.fileAsset.create({
      data: {
        id: fileId,
        roomId: room.id,
        originalName: session.fileName,
        safeName: session.safeName,
        mimeType: session.mimeType,
        size: session.fileSize,
        storageKey
      }
    });
    await prisma.uploadSession.delete({ where: { id: session.id } });
    await fs.promises.rm(session.tmpDir, { recursive: true, force: true });
    await prisma.room.update({ where: { id: room.id }, data: { lastActivityAt: new Date() } });
    io.to(room.id).emit('room:file:created', file);
    res.status(201).json(file);
  } catch (error) {
    next(error);
  }
});

app.post(
  '/api/rooms/:roomId/files/:fileId/download-url',
  async (req, res, next) => {
    try {
      const roomId = normalizeRoomId(req.params.roomId);

      await requireRoomAuth(req, roomId);

      const file = await prisma.fileAsset.findUnique({
        where: {
          id: req.params.fileId
        }
      });

      if (!file || file.roomId !== roomId) {
        return res.status(404).json({
          error: 'File not found'
        });
      }

      const token = createDownloadToken(
        roomId,
        file.id
      );

      res.json({
        url: `${env.API_URL}/api/download/${token}`
      });
    } catch (error) {
      next(error);
    }
  }
);


app.get('/api/rooms/:roomId/files/:fileId/download', async (req, res, next) => {
  try {
    const roomId = normalizeRoomId(req.params.roomId);
    await requireRoomAuth(req, roomId);
    const file = await prisma.fileAsset.findUnique({ where: { id: req.params.fileId } });
    if (!file || file.roomId !== roomId) {
      return res.status(404).json({ error: 'File not found' });
    }
    const stream = await storage.createReadStream(file.storageKey);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    stream.on('error', next);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});


app.get(
  '/api/download/:token',
  async (req, res, next) => {
    try {
      const {
        roomId,
        fileId
      } = verifyDownloadToken(
        req.params.token
      );

      const file =
        await prisma.fileAsset.findUnique({
          where: {
            id: fileId
          }
        });

      if (
        !file ||
        file.roomId !== roomId
      ) {
        return res.status(404).json({
          error: 'File not found'
        });
      }

      const stream =
        await storage.createReadStream(
          file.storageKey
        );

      res.setHeader(
        'Content-Type',
        file.mimeType
      );

      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(
          file.originalName
        )}`
      );

      stream.on('error', next);
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  }
);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  const status =
    message.includes('authorization') || message.includes('token') ? 401 :
    message.includes('Room does not exist') ? 404 :
    message.includes('Invalid room key') ? 403 :
    message.includes('required') ? 400 :
    500;
  res.status(status).json({ error: message });
});

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: env.CLIENT_ORIGIN,
    credentials: true
  }
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const roomId = socket.handshake.auth?.roomId;
    if (typeof token !== 'string' || typeof roomId !== 'string') {
      throw new Error('Missing socket auth');
    }
    const verifiedRoomId = verifyAccessToken(token);
    if (verifiedRoomId !== roomId) {
      throw new Error('Socket room mismatch');
    }
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new Error('Room no longer exists');
    }
    socket.data.roomId = roomId;
    next();
  } catch (error) {
    next(error instanceof Error ? error : new Error('Socket authorization failed'));
  }
});

io.on('connection', async (socket) => {
  const roomId = socket.data.roomId as string;
  await socket.join(roomId);
  const activeSet = ensureActiveSet(roomId);
  activeSet.add(socket.id);
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { lastActivityAt: true, isPrivate: true, documentVersion: true }
  });
  if (room) {
    await prisma.room.update({ where: { id: roomId }, data: { lastActivityAt: new Date() } });
  }
  io.to(roomId).emit('room:presence', { roomId, presenceCount: activeSet.size });
  scheduleCleanup(roomId, room?.lastActivityAt ?? new Date());

  socket.on('room:content:update', async (payload) => {
    try {
      const parsed = contentUpdateSchema.parse(payload);
      const serialized = JSON.stringify(parsed.documentJson);
      if (serialized.length > 1_000_000) {
        return socket.emit('room:error', { message: 'Document is too large' });
      }
      const updated = await prisma.room.update({
        where: { id: roomId },
        data: {
          documentJson: parsed.documentJson as any,
          documentVersion: { increment: 1 },
          lastActivityAt: new Date()
        }
      });
      io.to(roomId).emit('room:content:updated', {
        roomId,
        documentJson: updated.documentJson,
        documentVersion: updated.documentVersion,
        lastActivityAt: updated.lastActivityAt
      });
    } catch (error) {
      socket.emit('room:error', { message: error instanceof Error ? error.message : 'Invalid room content update' });
    }
  });

  socket.on('disconnect', async () => {
    const roomSockets = activeRooms.get(roomId);
    roomSockets?.delete(socket.id);
    if (!roomSockets || roomSockets.size === 0) {
      activeRooms.delete(roomId);
      const lastActivityAt = new Date();
      await prisma.room.update({ where: { id: roomId }, data: { lastActivityAt } }).catch(() => undefined);
      scheduleCleanup(roomId, lastActivityAt);
    }
    io.to(roomId).emit('room:presence', { roomId, presenceCount: roomPresenceCount(roomId) });
  });
});

async function pruneExpiredUploadSessions() {
  const expired = await prisma.uploadSession.findMany({ where: { expiresAt: { lt: new Date() } } });
  for (const session of expired) {
    await fs.promises.rm(session.tmpDir, { recursive: true, force: true }).catch(() => undefined);
    await prisma.uploadSession.delete({ where: { id: session.id } }).catch(() => undefined);
  }
}

async function runRoomCleanup() {
  const cutoff = new Date(Date.now() - env.ROOM_CLEANUP_MINUTES * 60_000);
  const rooms = await prisma.room.findMany({
    where: { lastActivityAt: { lt: cutoff } },
    select: { id: true, lastActivityAt: true }
  });
  for (const room of rooms) {
    if (roomPresenceCount(room.id) === 0) {
      await deleteRoom(room.id);
    }
  }
  await pruneExpiredUploadSessions();
}

setInterval(() => {
  void runRoomCleanup().catch(() => undefined);
}, 5 * 60_000);

server.listen(env.PORT, () => {
  void runRoomCleanup().catch(() => undefined);
  console.log(`Link Share backend running on port ${env.PORT}`);
});
