import mongoose from 'mongoose';
import { Notification, INotification } from '../infrastructure/models/notification.model';
import { NotificationGateway } from '../presentation/notification.gateway';
import { logger } from '../../../shared/utils/logger';

export interface CreateNotificationInput {
    user_id: string | mongoose.Types.ObjectId;
    title: string;
    content: string;
    type: 'ORDER_UPDATE' | 'LOW_STOCK' | 'ANALYTICS_ALERT' | 'PROMOTION' | 'NEW_MESSAGE' | 'PRODUCT_UNPUBLISHED' | 'PRODUCT_REPUBLISHED' | 'SELLER_APPLICATION_APPROVED' | 'SELLER_APPLICATION_REJECTED';
    link?: string;
    metadata?: Record<string, any>;
}

export interface GetNotificationsQuery {
    page?: number;
    limit?: number;
    unreadOnly?: boolean;
    type?: string;
}

export class NotificationService {
    /**
     * Tạo mới một thông báo, lưu vào DB và phát realtime qua Socket.IO tới người dùng
     */
    async createNotification(input: CreateNotificationInput): Promise<INotification> {
        const userId = typeof input.user_id === 'string' ? new mongoose.Types.ObjectId(input.user_id) : input.user_id;

        const doc = await Notification.create({
            user_id: userId,
            title: input.title,
            content: input.content,
            type: input.type,
            link: input.link,
            metadata: input.metadata,
            is_read: false
        });

        // Tính toán số lượng chưa đọc mới nhất
        const unreadCount = await this.getUnreadCount(userId.toString());

        // Phát realtime tới phòng cá nhân của user (chỉ phát cho thông báo chung, tin nhắn đã có Chat Socket)
        if (doc.type !== 'NEW_MESSAGE') {
            NotificationGateway.sendNotification(userId.toString(), {
                id: doc._id.toString(),
                _id: doc._id.toString(),
                user_id: userId.toString(),
                title: doc.title,
                content: doc.content,
                type: doc.type,
                link: doc.link,
                metadata: doc.metadata,
                is_read: doc.is_read,
                created_at: doc.created_at
            }, unreadCount);
        }

        return doc;
    }

    /**
     * Lấy danh sách thông báo phân trang của người dùng
     */
    async getUserNotifications(userId: string, query: GetNotificationsQuery = {}) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const filter: any = {
            user_id: new mongoose.Types.ObjectId(userId)
        };

        if (query.unreadOnly) {
            filter.is_read = false;
        }

        if (query.type) {
            filter.type = query.type;
        } else {
            // Mặc định ngoại trừ tin nhắn chat (vì chat đã có icon riêng bên cạnh)
            filter.type = { $ne: 'NEW_MESSAGE' };
        }

        const [items, total, unreadCount] = await Promise.all([
            Notification.find(filter)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Notification.countDocuments(filter),
            this.getUnreadCount(userId)
        ]);

        const formatted = items.map(it => ({
            id: it._id.toString(),
            _id: it._id.toString(),
            user_id: it.user_id.toString(),
            title: it.title,
            content: it.content,
            type: it.type,
            link: it.link,
            metadata: it.metadata,
            is_read: it.is_read,
            created_at: it.created_at
        }));

        return {
            items: formatted,
            total,
            unreadCount,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        };
    }

    /**
     * Lấy số lượng thông báo chưa đọc của người dùng (ngoại trừ tin nhắn chat)
     */
    async getUnreadCount(userId: string): Promise<number> {
        try {
            return await Notification.countDocuments({
                user_id: new mongoose.Types.ObjectId(userId),
                is_read: false,
                type: { $ne: 'NEW_MESSAGE' }
            });
        } catch (err: any) {
            logger.error(`Lỗi tính unreadCount thông báo: ${err.message}`);
            return 0;
        }
    }

    /**
     * Đánh dấu 1 thông báo là đã đọc
     */
    async markAsRead(notificationId: string, userId: string): Promise<boolean> {
        if (!mongoose.Types.ObjectId.isValid(notificationId)) {
            return false;
        }

        const res = await Notification.updateOne(
            {
                _id: new mongoose.Types.ObjectId(notificationId),
                user_id: new mongoose.Types.ObjectId(userId)
            },
            { $set: { is_read: true } }
        );

        if (res.modifiedCount > 0) {
            const unreadCount = await this.getUnreadCount(userId);
            NotificationGateway.sendUnreadCount(userId, unreadCount);
            return true;
        }

        return false;
    }

    /**
     * Đánh dấu tất cả thông báo của người dùng là đã đọc (ngoại trừ tin nhắn chat)
     */
    async markAllAsRead(userId: string): Promise<number> {
        const res = await Notification.updateMany(
            {
                user_id: new mongoose.Types.ObjectId(userId),
                is_read: false,
                type: { $ne: 'NEW_MESSAGE' }
            },
            { $set: { is_read: true } }
        );

        NotificationGateway.sendUnreadCount(userId, 0);
        return res.modifiedCount;
    }

    /**
     * Xoá một thông báo
     */
    async deleteNotification(notificationId: string, userId: string): Promise<boolean> {
        if (!mongoose.Types.ObjectId.isValid(notificationId)) {
            return false;
        }

        const res = await Notification.deleteOne({
            _id: new mongoose.Types.ObjectId(notificationId),
            user_id: new mongoose.Types.ObjectId(userId)
        });

        if (res.deletedCount > 0) {
            const unreadCount = await this.getUnreadCount(userId);
            NotificationGateway.sendUnreadCount(userId, unreadCount);
            return true;
        }

        return false;
    }
}

export const notificationService = new NotificationService();
