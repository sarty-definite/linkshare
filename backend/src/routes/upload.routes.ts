import express, { Router } from 'express';
import { UploadController } from '../controllers/upload.controller.js';
import { uploadLimiter } from '../middleware/rate-limiter.middleware.js';
import { validateUploadChunk } from '../middleware/validation.middleware.js';

const router = Router();

router.post('/:roomId/uploads', uploadLimiter, UploadController.initiate);
router.get('/:roomId/uploads/:uploadId', UploadController.getStatus);
router.put(
  '/:roomId/uploads/:uploadId/chunks/:chunkIndex',
  uploadLimiter,
  express.raw({ type: 'application/octet-stream', limit: '20mb' }),
  validateUploadChunk,
  UploadController.uploadChunk
);
router.post('/:roomId/uploads/:uploadId/finalize', uploadLimiter, UploadController.finalize);

export default router;
