import { Router } from 'express';
import roomRoutes from './room.routes.js';
import uploadRoutes from './upload.routes.js';
import downloadRoutes from './download.routes.js';

const apiRouter = Router();

// Health check endpoint
apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Room and Upload routes are nested under /rooms
apiRouter.use('/rooms', roomRoutes);
apiRouter.use('/rooms', uploadRoutes);

// Download routes map directly under the root /api path
apiRouter.use('/', downloadRoutes);

export default apiRouter;
