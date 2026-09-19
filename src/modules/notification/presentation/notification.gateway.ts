import { Server as SocketIOServer } from 'socket.io';
import { logger } from '../../../shared/utils/logger';

let ioInstance: SocketIOServer | null = null;

export class NotificationGateway {
    static setIO(io: SocketIOServer) {
        ioInstance = io;
        logger.info('NotificationGateway: Socket.IO instance đã được đăng ký thành công.');
    }

    static getIO(): SocketIOServer | null {
        return ioInstance;
    }

    static sendNotification(userId: string, notification: any, unreadCount: number) {
        if (!ioInstance) {
            logger.warn(`NotificationGateway: Socket.IO chưa được thiết lập, bỏ qua emit cho user ${userId}`);
            return;
        }
        const roomId = `user_${userId}`;
        ioInstance.to(roomId).emit('notification_received', notification);
        ioInstance.to(roomId).emit('notification_unread_count', { unreadCount });
        logger.info(`NotificationGateway: Đã phát thông báo realtime tới phòng ${roomId} (${notification.title})`);
    }

    static sendUnreadCount(userId: string, unreadCount: number) {
        if (!ioInstance) return;
        const roomId = `user_${userId}`;
        ioInstance.to(roomId).emit('notification_unread_count', { unreadCount });
    }
}
