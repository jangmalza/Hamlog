import express from 'express';
import { getProfile, updateProfile } from '../controllers/profileController.js';

import { attachOptionalUser, authenticateToken } from '../middleware/auth.js';
import { requireTrustedOrigin } from '../middleware/trustedOrigin.js';
import { adminContentBodyParsers } from '../middleware/bodyParser.js';

const router = express.Router();

// Signed-in admins get the full profile; readers get hidden fields removed.
router.get('/', attachOptionalUser, getProfile);
router.put('/', authenticateToken, requireTrustedOrigin, ...adminContentBodyParsers, updateProfile);

export const profileRouter = router;
