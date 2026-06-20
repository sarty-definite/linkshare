import express, { Router } from 'express';
import { env } from '../config/env.js';
import { UploadController } from '../controllers/upload.controller.js';
import { uploadLimiter, fileInitiateLimiter } from '../middleware/rate-limiter.middleware.js';
import { validateUploadChunk } from '../middleware/validation.middleware.js';

const router = Router();

router.post('/:roomId/uploads', fileInitiateLimiter, UploadController.initiate);
router.get('/:roomId/uploads/:uploadId', UploadController.getStatus);
router.put(
  '/:roomId/uploads/:uploadId/chunks/:chunkIndex',
  uploadLimiter,
  express.raw({ type: 'application/octet-stream', limit: env.EXPRESS_RAW_LIMIT }),
  validateUploadChunk,
  UploadController.uploadChunk
);
router.post('/:roomId/uploads/:uploadId/finalize', uploadLimiter, UploadController.finalize);

export default router;
