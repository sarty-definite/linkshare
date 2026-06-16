import { Router } from 'express';
import { DownloadController } from '../controllers/download.controller.js';

const router = Router();

router.post('/rooms/:roomId/files/:fileId/download-url', DownloadController.getUrl);
router.get('/rooms/:roomId/files/:fileId/download', DownloadController.downloadDirect);
router.get('/download/:token', DownloadController.downloadByToken);

export default router;
