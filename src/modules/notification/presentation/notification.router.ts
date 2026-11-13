import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { notificationService } from '../application/notification.service';

const router = Router();

// Tất cả các route thông báo đều yêu cầu đăng nhập
router.use(authenticate);

/**
 * GET /api/notifications
 * Lấy danh sách thông báo của người dùng hiện tại
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
        const unreadOnly = req.query.unreadOnly === 'true';
        const type = req.query.type as string | undefined;

        const data = await notificationService.getUserNotifications(userId, {
            page,
            limit,
            unreadOnly,
            type
        });

        res.json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/notifications/unread-count
 * Lấy tổng số thông báo chưa đọc của người dùng hiện tại
 */
router.get('/unread-count', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const unreadCount = await notificationService.getUnreadCount(userId);
        res.json({ success: true, data: { unreadCount } });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH /api/notifications/read-all
 * Đánh dấu toàn bộ thông báo của người dùng là đã đọc
 */
router.patch('/read-all', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const updatedCount = await notificationService.markAllAsRead(userId);
        res.json({ success: true, data: { updatedCount } });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH /api/notifications/:id/read
 * Đánh dấu 1 thông báo cụ thể là đã đọc
 */
router.patch('/:id/read', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const notificationId = req.params.id;
        const success = await notificationService.markAsRead(notificationId, userId);

        if (!success) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy thông báo hoặc đã đọc' });
        }

        res.json({ success: true, message: 'Đã đánh dấu đã đọc' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/notifications/:id
 * Xoá một thông báo
 */
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const notificationId = req.params.id;
        const success = await notificationService.deleteNotification(notificationId, userId);

        if (!success) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy thông báo cần xoá' });
        }

        res.json({ success: true, message: 'Đã xoá thông báo' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/notifications/test
 * Tạo một thông báo thử nghiệm (dành cho kiểm thử hoặc dev)
 */
router.post('/test', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { title, content, type, link, metadata } = req.body;

        const doc = await notificationService.createNotification({
            user_id: userId,
            title: title || 'Thông báo thử nghiệm',
            content: content || 'Đây là nội dung thông báo thời gian thực thử nghiệm trên VietCraft.',
            type: type || 'PROMOTION',
            link,
            metadata
        });

        res.json({ success: true, data: doc });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export const notificationRouter = router;
