import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import { chatService } from '../application/chat.service';

const router = Router();

router.use(authenticate);

// Lấy danh sách cuộc hội thoại của người dùng hiện tại
router.get('/conversations', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const conversations = await chatService.getUserConversations(userId);
        res.json({ success: true, data: conversations });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Bắt đầu hoặc mở cuộc hội thoại với Seller hoặc User
router.post('/conversations', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { partnerId, shopId, initialMessage, productWidget } = req.body;

        const conversation = await chatService.getOrCreateConversation(
            userId,
            partnerId,
            shopId,
            productWidget
        );

        // Nếu có initialMessage hoặc productWidget kèm theo, tự động gửi tin nhắn đầu tiên
        if (initialMessage || productWidget) {
            await chatService.saveMessage({
                senderId: userId,
                receiverId: conversation.partner.id,
                roomId: conversation.conversation_id,
                messageText: initialMessage || '',
                productWidget: productWidget
            });
        }

        res.status(201).json({ success: true, data: conversation });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Lấy danh sách tin nhắn của cuộc hội thoại
router.get('/conversations/:id/messages', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const conversationId = req.params.id;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
        const before = req.query.before ? new Date(req.query.before as string) : undefined;

        const messages = await chatService.getMessages(conversationId, userId, limit, before);

        // Tự động đánh dấu đã đọc các tin nhắn gửi tới user hiện tại
        await chatService.markAsRead(conversationId, userId);

        res.json({ success: true, data: messages });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Gửi tin nhắn qua REST API
router.post('/conversations/:id/messages', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const conversationId = req.params.id;
        const { receiver_id, message_text, attachments, product_widget, custom_quotation } = req.body;

        const message = await chatService.saveMessage({
            senderId: userId,
            receiverId: receiver_id,
            roomId: conversationId,
            messageText: message_text,
            attachments,
            productWidget: product_widget,
            customQuotation: custom_quotation
        });

        res.status(201).json({ success: true, data: message });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Đánh dấu đã đọc cuộc hội thoại
router.put('/conversations/:id/read', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const conversationId = req.params.id;
        await chatService.markAsRead(conversationId, userId);
        res.json({ success: true, message: 'Đã cập nhật trạng thái đọc' });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Lấy tổng số tin nhắn chưa đọc của người dùng
router.get('/unread-count', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const count = await chatService.getTotalUnreadCount(userId);
        res.json({ success: true, count });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
