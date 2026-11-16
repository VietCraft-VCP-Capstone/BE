import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../../../app/config';
import { AuthUser, normalizeRole } from '../../../app/middleware/auth.middleware';
import { logger } from '../../../shared/utils/logger';
import { chatService, buildConversationId } from '../application/chat.service';

export { buildConversationId };

function isParticipant(user: AuthUser, roomId: string): boolean {
    if (normalizeRole(user.role) === 'admin') return true;
    return roomId.split('_').includes(user.id);
}

let chatIoInstance: SocketIOServer | null = null;

export class ChatGateway {
    private io: SocketIOServer;

    constructor(io: SocketIOServer) {
        this.io = io;
        chatIoInstance = io;
        this.initialize();
    }

    static getIO(): SocketIOServer | null {
        return chatIoInstance;
    }

    static async broadcastNewMessage(
        savedMessage: any,
        receiverId: string,
        senderId: string,
        roomId: string
    ) {
        if (!chatIoInstance) return;
        try {
            const receiverUnreadCount = await chatService.getTotalUnreadCount(receiverId);
            const senderUnreadCount = await chatService.getTotalUnreadCount(senderId);

            // 1. Gửi tới phòng hội thoại (cho client đang mở đúng phòng này)
            chatIoInstance.to(roomId).emit('message_received', savedMessage);

            // 2. Gửi trực tiếp tới phòng cá nhân người nhận (cho dù chưa join room vẫn nhận được tin nhắn realtime)
            chatIoInstance.to(`user_${receiverId}`).emit('message_received', savedMessage);
            chatIoInstance.to(`user_${receiverId}`).emit('new_message_notification', {
                message: savedMessage,
                unreadCount: receiverUnreadCount
            });

            // 3. Gửi tới phòng cá nhân người gửi (đồng bộ đa tab)
            chatIoInstance.to(`user_${senderId}`).emit('message_received', savedMessage);
            chatIoInstance.to(`user_${senderId}`).emit('unread_count_updated', {
                unreadCount: senderUnreadCount
            });
        } catch (error: any) {
            logger.error(`Lỗi broadcast tin nhắn: ${error.message}`);
        }
    }

    static async broadcastMessagesRead(roomId: string, readerId: string) {
        if (!chatIoInstance) return;
        try {
            chatIoInstance.to(roomId).emit('messages_read', { roomId, readerId });
            const unreadCount = await chatService.getTotalUnreadCount(readerId);
            chatIoInstance.to(`user_${readerId}`).emit('unread_count_updated', { unreadCount });
        } catch (error: any) {
            logger.error(`Lỗi broadcast đã đọc: ${error.message}`);
        }
    }

    private initialize() {
        // Middleware xác thực JWT cho kết nối WebSocket
        this.io.use((socket, next) => {
            const raw = String(
                socket.handshake.auth?.token
                || socket.handshake.headers.authorization
                || socket.handshake.query?.token
                || ''
            );
            const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
            if (!token) return next(new Error('Unauthorized: Missing token'));
            try {
                const decoded = jwt.verify(token, config.jwtSecret) as any;
                socket.data.user = { id: decoded.id, email: decoded.email, role: decoded.role } as AuthUser;
                next();
            } catch {
                next(new Error('Unauthorized: Invalid token'));
            }
        });

        this.io.on('connection', (socket: Socket) => {
            const user: AuthUser = socket.data.user;
            logger.info(`Client kết nối Chat: ${socket.id} (user ${user.id})`);

            // Tự động tham gia phòng thông báo cá nhân để nhận notification / badge unread
            socket.join(`user_${user.id}`);

            // Tham gia một phòng hội thoại cụ thể
            socket.on('join_room', (roomId: string) => {
                if (typeof roomId !== 'string' || !roomId.trim()) {
                    return socket.emit('error_message', { error: 'roomId không hợp lệ' });
                }
                if (!isParticipant(user, roomId)) {
                    logger.warn(`Socket ${socket.id} (user ${user.id}) bị từ chối vào phòng ${roomId}`);
                    return socket.emit('error_message', { error: 'Bạn không thuộc cuộc hội thoại này' });
                }
                socket.join(roomId);
                logger.info(`Socket ${socket.id} (user ${user.id}) joined room ${roomId}`);
                socket.to(roomId).emit('user_joined', { userId: user.id });
            });

            // Rời khỏi phòng hội thoại
            socket.on('leave_room', (roomId: string) => {
                if (typeof roomId === 'string' && roomId.trim()) {
                    socket.leave(roomId);
                    logger.info(`Socket ${socket.id} (user ${user.id}) left room ${roomId}`);
                }
            });

            // Gửi tin nhắn và lưu vào cơ sở dữ liệu MongoDB
            socket.on('send_message', async (data: {
                roomId?: string;
                receiverId?: string;
                message?: string;
                attachments?: string[];
                productWidget?: any;
                customQuotation?: any;
            }, callback?: (response: any) => void) => {
                try {
                    let roomId = data?.roomId;
                    let receiverId = data?.receiverId;
                    const messageText = data?.message ?? (data as any)?.message_text ?? (data as any)?.messageText ?? '';

                    if (!roomId && receiverId) {
                        roomId = buildConversationId(user.id, receiverId);
                    } else if (roomId && !receiverId) {
                        receiverId = roomId.split('_').find(id => id !== user.id);
                    }

                    if (!roomId || !receiverId) {
                        const errPayload = { error: 'Thiếu thông tin phòng hoặc người nhận' };
                        socket.emit('error_message', errPayload);
                        if (typeof callback === 'function') callback(errPayload);
                        return;
                    }

                    if (!isParticipant(user, roomId)) {
                        const errPayload = { error: 'Bạn không thuộc cuộc hội thoại này' };
                        socket.emit('error_message', errPayload);
                        if (typeof callback === 'function') callback(errPayload);
                        return;
                    }

                    if (!socket.rooms.has(roomId)) {
                        socket.join(roomId);
                    }

                    // Lưu tin nhắn vào MongoDB
                    const savedMessage = await chatService.saveMessage({
                        senderId: user.id,
                        receiverId: receiverId,
                        roomId: roomId,
                        messageText: messageText,
                        attachments: data.attachments,
                        productWidget: data.productWidget,
                        customQuotation: data.customQuotation
                    });

                    // Phát tin nhắn realtime tới cả phòng lẫn các user cá nhân
                    await ChatGateway.broadcastNewMessage(savedMessage, receiverId, user.id, roomId);

                    logger.info(`Tin nhắn trong phòng ${roomId} gửi bởi ${user.id}`);

                    if (typeof callback === 'function') {
                        callback({ success: true, data: savedMessage });
                    }
                } catch (error: any) {
                    logger.error(`Lỗi gửi tin nhắn socket: ${error.message}`);
                    const errPayload = { error: error.message || 'Không thể gửi tin nhắn' };
                    socket.emit('error_message', errPayload);
                    if (typeof callback === 'function') callback(errPayload);
                }
            });

            // Chỉ báo đang soạn tin nhắn (Typing Indicator)
            socket.on('typing', (data: { roomId: string }) => {
                if (data?.roomId && isParticipant(user, data.roomId)) {
                    socket.to(data.roomId).emit('user_typing', {
                        userId: user.id,
                        roomId: data.roomId,
                        isTyping: true
                    });
                }
            });

            socket.on('stop_typing', (data: { roomId: string }) => {
                if (data?.roomId && isParticipant(user, data.roomId)) {
                    socket.to(data.roomId).emit('user_typing', {
                        userId: user.id,
                        roomId: data.roomId,
                        isTyping: false
                    });
                }
            });

            // Đánh dấu đã đọc tin nhắn
            socket.on('mark_read', async (data: { roomId: string }) => {
                if (data?.roomId && isParticipant(user, data.roomId)) {
                    try {
                        await chatService.markAsRead(data.roomId, user.id);
                        await ChatGateway.broadcastMessagesRead(data.roomId, user.id);
                    } catch (error: any) {
                        logger.error(`Lỗi đánh dấu đã đọc socket: ${error.message}`);
                    }
                }
            });

            socket.on('disconnect', () => {
                logger.info(`Client đã ngắt kết nối: ${socket.id} (user ${user.id})`);
            });
        });
    }
}

export default ChatGateway;
