import { Router } from 'express';
import { RoomController } from '../controllers/room.controller.js';
import { authLimiter } from '../middleware/rate-limiter.middleware.js';

const router = Router();

router.get('/:roomId/exists', RoomController.checkExists);
router.post('/create', authLimiter, RoomController.create);
router.post('/join', authLimiter, RoomController.join);
router.get('/:roomId/state', RoomController.getState);
router.post('/:roomId/content', authLimiter, RoomController.updateContent);

export default router;
