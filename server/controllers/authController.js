import { createHash, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { ADMIN_PASSWORD, AUTH_MODE, JWT_SECRET } from '../config/auth.js';
import { buildClearCookieOptions, buildCookieOptions } from '../config/cookies.js';

const AUTH_COOKIE_MAX_AGE = 24 * 60 * 60 * 1000;

// Hashing both sides gives equal-length buffers, so the comparison time does
// not reveal how much of the password matched or how long it is.
const digest = (value) => createHash('sha256').update(value, 'utf8').digest();
const ADMIN_PASSWORD_DIGEST = digest(ADMIN_PASSWORD);

const isAdminPassword = (password) => (
    typeof password === 'string' && timingSafeEqual(digest(password), ADMIN_PASSWORD_DIGEST)
);

export const login = (req, res) => {
    if (AUTH_MODE === 'cloudflare-access') {
        return res.status(403).json({ message: '비밀번호 로그인은 비활성화되어 있습니다. Cloudflare Access를 이용해주세요.' });
    }
    const { password } = req.body ?? {};

    if (!isAdminPassword(password)) {
        return res.status(401).json({ message: '비밀번호가 올바르지 않습니다.' });
    }

    // Role is simple: 'admin'
    const user = { role: 'admin' };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '24h' });
    const cookieOptions = buildCookieOptions(req, AUTH_COOKIE_MAX_AGE);

    res.cookie('token', token, cookieOptions);

    res.json({ message: '로그인 성공', user });
};

export const logout = (req, res) => {
    res.clearCookie('token', buildClearCookieOptions(req));
    res.json({
        message: '로그아웃 성공',
        ...(AUTH_MODE === 'cloudflare-access' ? { redirectTo: '/cdn-cgi/access/logout' } : {})
    });
};

export const getAuthConfig = (_req, res) => {
    res.json({ mode: AUTH_MODE });
};

export const me = (req, res) => {
    // If request reached here, middleware passed, so user is authenticated
    res.json({ user: req.user });
};
