import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../../../app/config';
import { AuthUser, normalizeRole } from '../../../app/middleware/auth.middleware';
import { logger } from '../../../shared/utils/logger';

export function buildConversationId(userA: string, userB: string): string {
    return [userA, userB].sort().join('_');
}

function isParticipant(user: AuthUser, roomId: string): boolean {
    if (normalizeRole(user.role) === 'admin') return true;
    return roomId.split('_').includes(user.id);
}

export class ChatGateway {
    private io: SocketIOServer;

    constructor(io: SocketIOServer) {
        this.io = io;
        this.initialize();
    }

    private initialize() {
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
            logger.info(`Client connected to Chat: ${socket.id} (user ${user.id})`);

            socket.on('join_room', (roomId: string) => {
                if (typeof roomId !== 'string' || !roomId.trim()) {
                    return socket.emit('error_message', { error: 'roomId không hợp lệ' });
                }
                if (!isParticipant(user, roomId)) {
                    logger.warn(`Socket ${socket.id} (user ${user.id}) bị từ chối vào phòng ${roomId}`);
                    return socket.emit('error_message', { error: 'Bạn không thuộc cuộc hội thoại này' });
                }
                socket.join(roomId);
                logger.info(`Socket ${socket.id} joined room ${roomId}`);
                socket.to(roomId).emit('user_joined', { userId: user.id });
            });

            socket.on('send_message', (data: { roomId: string; message: string }) => {
                const roomId = data?.roomId;
                const message = data?.message;
                if (typeof roomId !== 'string' || typeof message !== 'string' || !message.trim()) {
                    return socket.emit('error_message', { error: 'Payload không hợp lệ' });
                }
                if (!socket.rooms.has(roomId)) {
                    return socket.emit('error_message', { error: 'Bạn chưa tham gia cuộc hội thoại này' });
                }

                logger.info(`Message in room ${roomId} by ${user.id}`);
                this.io.to(roomId).emit('message_received', {
                    senderId: user.id,
                    message,
                    timestamp: new Date()
                });
            });

            socket.on('disconnect', () => {
                logger.info(`Client disconnected: ${socket.id}`);
            });
        });
    }
}
export default ChatGateway;
