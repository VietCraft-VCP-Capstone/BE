import { Router, Response } from 'express';
import { AuthService, AuthError } from '../application/auth.service';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

function friendlyError(err: any): string {
    const msg: string = err?.message || '';
    if (msg.includes('buffering timed out') || msg.includes('ECONNREFUSED') || msg.includes('connect')) {
        return 'Máy chủ cơ sở dữ liệu đang bận hoặc mất kết nối. Vui lòng thử lại sau ít phút.';
    }
    if (msg.includes('duplicate') || msg.includes('E11000')) {
        return 'Email này đã được đăng ký. Vui lòng dùng email khác hoặc đăng nhập.';
    }
    return msg || 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}

function sendAuthError(res: Response, error: any, defaultStatus = 400) {
    const status = error instanceof AuthError ? error.statusCode : (error.statusCode || defaultStatus);
    const code = error instanceof AuthError ? error.code : (error.code || 'AUTH_ERROR');
    const msg = friendlyError(error);
    const errors = error.errors && Array.isArray(error.errors) ? error.errors : [msg];

    return res.status(status).json({
        error: msg,
        errors,
        code
    });
}

router.post('/signup', async (req, res) => {
    try {
        const { email, password, name, role } = req.body || {};
        const errors: string[] = [];

        if (!name || !String(name).trim()) {
            errors.push('Vui lòng nhập họ và tên.');
        } else if (String(name).trim().length < 2) {
            errors.push('Họ và tên phải có ít nhất 2 ký tự.');
        }

        if (!email || !String(email).trim()) {
            errors.push('Vui lòng nhập địa chỉ email.');
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
            errors.push('Email không đúng định dạng (ví dụ: name@example.com).');
        }

        if (!password) {
            errors.push('Vui lòng tạo mật khẩu.');
        } else if (String(password).length < 8) {
            errors.push('Mật khẩu phải có ít nhất 8 ký tự.');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                error: errors[0],
                errors,
                code: 'VALIDATION_ERROR'
            });
        }

        const result = await AuthService.register({ email, password, name, role });
        res.status(201).json(result);
    } catch (error: any) {
        sendAuthError(res, error, 400);
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        const errors: string[] = [];

        if (!email || !String(email).trim()) {
            errors.push('Vui lòng nhập địa chỉ email.');
        }
        if (!password) {
            errors.push('Vui lòng nhập mật khẩu.');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                error: errors[0],
                errors,
                code: 'VALIDATION_ERROR'
            });
        }

        const result = await AuthService.login({ email, password });
        res.status(200).json(result);
    } catch (error: any) {
        sendAuthError(res, error, 401);
    }
});

router.post('/verify-otp', async (req, res) => {
    try {
        const { email, code } = req.body || {};
        const errors: string[] = [];

        if (!email || !String(email).trim()) {
            errors.push('Vui lòng cung cấp email xác thực.');
        }
        if (!code || !String(code).trim()) {
            errors.push('Vui lòng nhập mã OTP.');
        } else if (String(code).trim().length !== 6) {
            errors.push('Mã OTP phải có đúng 6 chữ số.');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                error: errors[0],
                errors,
                code: 'VALIDATION_ERROR'
            });
        }

        const result = await AuthService.verifyOtp(email, code);
        res.status(200).json(result);
    } catch (error: any) {
        sendAuthError(res, error, 400);
    }
});

router.post('/resend-otp', async (req, res) => {
    try {
        const { email } = req.body || {};
        if (!email || !String(email).trim()) {
            return res.status(400).json({
                error: 'Vui lòng cung cấp địa chỉ email.',
                errors: ['Vui lòng cung cấp địa chỉ email.'],
                code: 'VALIDATION_ERROR'
            });
        }
        const result = await AuthService.resendOtp(email);
        res.status(200).json(result);
    } catch (error: any) {
        sendAuthError(res, error, 400);
    }
});

router.post('/google', async (req, res) => {
    try {
        const { accessToken } = req.body || {};
        if (!accessToken || !String(accessToken).trim()) {
            return res.status(400).json({
                error: 'Thiếu access token xác thực từ Google.',
                errors: ['Thiếu access token xác thực từ Google.'],
                code: 'VALIDATION_ERROR'
            });
        }
        const result = await AuthService.googleAuth(accessToken);
        res.status(200).json(result);
    } catch (error: any) {
        sendAuthError(res, error, 401);
    }
});

router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body || {};
        if (!email || !String(email).trim()) {
            return res.status(400).json({
                error: 'Vui lòng nhập địa chỉ email.',
                errors: ['Vui lòng nhập địa chỉ email.'],
                code: 'VALIDATION_ERROR'
            });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
            return res.status(400).json({
                error: 'Email không đúng định dạng (ví dụ: name@example.com).',
                errors: ['Email không đúng định dạng (ví dụ: name@example.com).'],
                code: 'VALIDATION_ERROR'
            });
        }
        const result = await AuthService.forgotPassword(email);
        res.status(200).json(result);
    } catch (error: any) {
        sendAuthError(res, error, 400);
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { email, code, newPassword } = req.body || {};
        const errors: string[] = [];

        if (!email || !String(email).trim()) {
            errors.push('Vui lòng nhập địa chỉ email.');
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
            errors.push('Email không đúng định dạng (ví dụ: name@example.com).');
        }

        if (!code || !String(code).trim()) {
            errors.push('Vui lòng nhập mã OTP.');
        } else if (String(code).trim().length !== 6) {
            errors.push('Mã OTP phải có đúng 6 chữ số.');
        }

        if (!newPassword) {
            errors.push('Vui lòng nhập mật khẩu mới.');
        } else if (String(newPassword).length < 8) {
            errors.push('Mật khẩu mới phải có ít nhất 8 ký tự.');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                error: errors[0],
                errors,
                code: 'VALIDATION_ERROR'
            });
        }

        const result = await AuthService.resetPassword({ email, code, newPassword });
        res.status(200).json(result);
    } catch (error: any) {
        sendAuthError(res, error, 400);
    }
});

// --- Quản trị người dùng: chỉ admin ---

router.get('/users', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const users = await AuthService.getAllUsers();
        res.status(200).json(users);
    } catch (error: any) {
        sendAuthError(res, error, 400);
    }
});

router.patch('/users/:id/toggle-lock', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        // Chặn admin tự khoá chính mình 
        if (id === req.user!.id) {
            return res.status(400).json({
                error: 'Không thể tự khoá tài khoản của chính mình.',
                errors: ['Không thể tự khoá tài khoản của chính mình.'],
                code: 'CANNOT_LOCK_SELF'
            });
        }
        const result = await AuthService.toggleLockUser(id);
        res.status(200).json(result);
    } catch (error: any) {
        sendAuthError(res, error, 400);
    }
});

export const authRouter = router;
export default authRouter;
