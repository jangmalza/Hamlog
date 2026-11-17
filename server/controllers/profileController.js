import { readProfile, writeProfile } from '../models/profileModel.js';
import { mergeProfile } from '../utils/normalizers/profileNormalizers.js';
import { runWithDataStoreLock } from '../utils/storeLock.js';
import { toPublicProfile } from '../utils/publicProfile.js';

export const getProfile = async (req, res) => {
    try {
        const profile = await readProfile();
        res.json({ profile: req.user ? profile : toPublicProfile(profile) });
    } catch (error) {
        console.error('Failed to fetch profile', error);
        res.status(500).json({ message: '프로필을 불러오지 못했습니다.' });
    }
};

export const updateProfile = async (req, res) => {
    try {
        const saved = await runWithDataStoreLock(async () => {
            const profile = await readProfile();
            const next = mergeProfile(profile, req.body ?? {});
            return writeProfile(next);
        });
        res.json({ profile: saved });
    } catch (error) {
        console.error('Failed to update profile', error);
        res.status(500).json({ message: '프로필 저장에 실패했습니다.' });
    }
};
