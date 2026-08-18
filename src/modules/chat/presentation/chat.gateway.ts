import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../../../shared/utils/logger';

export class ChatGateway {
    private io: SocketIOServer;

    constructor(io: SocketIOServer) {
        this.io = io;
        this.initialize();
    }

    private initialize() {
        this.io.on('connection', (socket: Socket) => {
            logger.info(`Client connected to Chat: ${socket.id}`);

            socket.on('join_room', (roomId: string) => {
                socket.join(roomId);
                logger.info(`Socket ${socket.id} joined room ${roomId}`);
                socket.to(roomId).emit('user_joined', { socketId: socket.id });
            });

            socket.on('send_message', (data: { roomId: string; senderId: string; message: string }) => {
                const { roomId, senderId, message } = data;
                logger.info(`Message in room ${roomId} by ${senderId}: ${message}`);

                this.io.to(roomId).emit('message_received', {
                    senderId,
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
