import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './config/env.js';
import apiRouter from './routes/index.js';
import { initializeSockets } from './sockets/socket.handler.js';
import { CleanupService } from './services/cleanup.service.js';
import { errorHandler } from './middleware/error.middleware.js';
import { apiLimiter } from './middleware/rate-limiter.middleware.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Mount root API router
app.use('/api', apiLimiter, apiRouter);

// Global Error Handler Middleware
app.use(errorHandler);

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: env.CLIENT_ORIGIN,
    credentials: true
  }
});

// Set Socket.io server instance on the app for access in controllers
app.set('io', io);

// Initialize socket handlers
initializeSockets(io);

// Start room & upload sessions cleanup interval task
CleanupService.startCleanupInterval();

server.listen(env.PORT, () => {
  void CleanupService.runRoomCleanup().catch(() => undefined);
  console.log(`Link Share backend running on port ${env.PORT}`);
});
export { app, server };
