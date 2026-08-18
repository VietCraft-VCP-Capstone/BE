import { Router } from 'express';
import { AuthService } from '../application/auth.service';

const router = Router();

function friendlyError(err: any): string {
    const msg: string = err?.message || '';
    if (msg.includes('buffering timed out') || msg.includes('ECONNREFUSED') || msg.includes('connect')) {
        return 'Máy chủ đang bận, vui lòng thử lại sau ít phút.';
    }
    if (msg.includes('duplicate') || msg.includes('E11000')) {
        return 'Email này đã được đăng ký. Vui lòng dùng email khác hoặc đăng nhập.';
    }
    return msg || 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}

router.post('/signup', async (req, res) => {
    try {
        const result = await AuthService.register(req.body);
        res.status(201).json(result);
    } catch (error: any) {
        res.status(400).json({ error: friendlyError(error) });
    }
});

router.post('/login', async (req, res) => {
    try {
        const result = await AuthService.login(req.body);
        res.status(200).json(result);
    } catch (error: any) {
        res.status(401).json({
            error: friendlyError(error),
            code: error.code,
        });
    }
});

router.post('/verify-otp', async (req, res) => {
    try {
        const { email, code } = req.body;
        const result = await AuthService.verifyOtp(email, code);
        res.status(200).json(result);
    } catch (error: any) {
        res.status(400).json({ error: friendlyError(error) });
    }
});

router.post('/resend-otp', async (req, res) => {
    try {
        const { email } = req.body;
        const result = await AuthService.resendOtp(email);
        res.status(200).json(result);
    } catch (error: any) {
        res.status(400).json({ error: friendlyError(error) });
    }
});

router.post('/google', async (req, res) => {
    try {
        const { accessToken } = req.body;
        if (!accessToken) { res.status(400).json({ error: 'Thiếu access token Google.' }); return; }
        const result = await AuthService.googleAuth(accessToken);
        res.status(200).json(result);
    } catch (error: any) {
        res.status(401).json({ error: friendlyError(error) });
    }
});

router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const result = await AuthService.forgotPassword(email);
        res.status(200).json(result);
    } catch (error: any) {
        res.status(400).json({ error: friendlyError(error) });
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { email, code, newPassword } = req.body;
        const result = await AuthService.resetPassword({ email, code, newPassword });
        res.status(200).json(result);
    } catch (error: any) {
        res.status(400).json({ error: friendlyError(error) });
    }
});

router.get('/users', async (req, res) => {
    try {
        const users = await AuthService.getAllUsers();
        res.status(200).json(users);
    } catch (error: any) {
        res.status(400).json({ error: friendlyError(error) });
    }
});

router.patch('/users/:id/toggle-lock', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await AuthService.toggleLockUser(id);
        res.status(200).json(result);
    } catch (error: any) {
        res.status(400).json({ error: friendlyError(error) });
    }
});

export const authRouter = router;
export default authRouter;
