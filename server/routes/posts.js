import express from 'express';
import {
  getPosts,
  getPostBySlug,
  createPost,
  recordPostView,
  updatePost,
  deletePost,
  getPostRevisions,
  getPostRevision,
  restorePostRevision,
  getTrash,
  restoreTrashedPost,
  permanentlyDeletePost
} from '../controllers/postController.js';

import { attachOptionalUser, authenticateToken } from '../middleware/auth.js';
import { requireTrustedOrigin } from '../middleware/trustedOrigin.js';
import { viewRateLimiter } from '../middleware/rateLimit.js';
import {
  adminContentBodyParsers,
  publicBodyParsers
} from '../middleware/bodyParser.js';

const router = express.Router();

router.get('/', attachOptionalUser, getPosts);
router.get('/trash/list', authenticateToken, getTrash);
router.post('/:id/trash/restore', authenticateToken, requireTrustedOrigin, ...publicBodyParsers, restoreTrashedPost);
router.delete('/:id/permanent', authenticateToken, requireTrustedOrigin, ...publicBodyParsers, permanentlyDeletePost);
router.post('/', authenticateToken, requireTrustedOrigin, ...adminContentBodyParsers, createPost);
router.post('/:slug/view', viewRateLimiter, requireTrustedOrigin, ...publicBodyParsers, recordPostView);
router.get('/:id/revisions', authenticateToken, getPostRevisions);
router.get('/:id/revisions/:revisionId', authenticateToken, getPostRevision);
router.post('/:id/revisions/:revisionId/restore', authenticateToken, requireTrustedOrigin, ...publicBodyParsers, restorePostRevision);
router.put('/:id', authenticateToken, requireTrustedOrigin, ...adminContentBodyParsers, updatePost);
router.delete('/:id', authenticateToken, requireTrustedOrigin, deletePost);
router.get('/:slug', getPostBySlug);

export const postRouter = router;
