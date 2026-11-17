import express from 'express';
import {
  deleteUnusedUploadFiles,
  getUnusedUploads,
  uploadImage
} from '../controllers/uploadController.js';

import { authenticateToken } from '../middleware/auth.js';
import { uploadRateLimiter } from '../middleware/rateLimit.js';
import { requireTrustedOrigin } from '../middleware/trustedOrigin.js';
import {
  imageUploadBodyParsers,
  publicBodyParsers
} from '../middleware/bodyParser.js';

const router = express.Router();

router.get('/unused', authenticateToken, getUnusedUploads);
router.post('/unused/scan', authenticateToken, requireTrustedOrigin, ...publicBodyParsers, getUnusedUploads);
router.delete('/unused', authenticateToken, requireTrustedOrigin, ...publicBodyParsers, deleteUnusedUploadFiles);
router.post('/', authenticateToken, uploadRateLimiter, requireTrustedOrigin, ...imageUploadBodyParsers, uploadImage);

export const uploadRouter = router;
