import mongoose from 'mongoose';
import { ChatMessage, IChatMessage } from '../infrastructure/models/chat-message.model';
import { Conversation, IConversation } from '../infrastructure/models/conversation.model';
import { User } from '../../user/infrastructure/models/user.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import {
    ChatMessageDTO,
    ConversationItemDTO,
    ConversationPartnerDTO,
    ProductWidgetDTO,
    CustomQuotationDTO
} from '../types/chat.dto';
import { logger } from '../../../shared/utils/logger';

export function buildConversationId(userA: string, userB: string): string {
    return [userA, userB].sort().join('_');
}

function mapMessageToDTO(msg: any): ChatMessageDTO {
    let productWidget: ProductWidgetDTO | undefined = undefined;
    if (msg.product_widget) {
        productWidget = {
            product_id: msg.product_widget.product_id?.toString() || '',
            title: msg.product_widget.title || '',
            price: msg.product_widget.price ? parseFloat(msg.product_widget.price.toString()) : 0,
            image: msg.product_widget.image || ''
        };
    }

    let customQuotation: CustomQuotationDTO | undefined = undefined;
    if (msg.custom_quotation) {
        customQuotation = {
            amount: msg.custom_quotation.amount ? parseFloat(msg.custom_quotation.amount.toString()) : 0,
            design_url: msg.custom_quotation.design_url || '',
            status: msg.custom_quotation.status || 'OFFERED'
        };
    }

    const senderId = msg.sender_id?.toString() || '';
    const receiverId = msg.receiver_id?.toString() || '';
    const text = msg.message_text || '';
    const dateIso = msg.created_at ? new Date(msg.created_at).toISOString() : new Date().toISOString();

    return {
        id: msg._id.toString(),
        conversation_id: msg.conversation_id,
        sender_id: senderId,
        receiver_id: receiverId,
        message_text: text,
        attachments: msg.attachments || [],
        product_widget: productWidget,
        custom_quotation: customQuotation,
        is_read: Boolean(msg.is_read),
        created_at: dateIso,
        senderId,
        message: text,
        timestamp: dateIso
    };
}

export class ChatService {
    /**
     * Lấy hoặc tạo mới cuộc hội thoại giữa 2 người dùng (User & Seller)
     */
    async getOrCreateConversation(
        userAId: string,
        partnerId?: string,
        shopId?: string,
        productWidget?: ProductWidgetDTO
    ): Promise<ConversationItemDTO> {
        let resolvedPartnerId = partnerId;
        let resolvedShopId = shopId;

        // Nếu truyền shopId mà chưa có partnerId, tìm owner của shop
        if (!resolvedPartnerId && shopId) {
            const shop = await Shop.findById(shopId).lean();
            if (!shop) {
                throw new Error('Không tìm thấy gian hàng tương ứng');
            }
            resolvedPartnerId = shop.owner_id.toString();
            resolvedShopId = shop._id.toString();
        }

        if (!resolvedPartnerId) {
            throw new Error('Cần cung cấp partnerId hoặc shopId hợp lệ');
        }

        if (resolvedPartnerId === userAId) {
            throw new Error('Không thể tạo cuộc trò chuyện với chính mình');
        }

        const conversationId = buildConversationId(userAId, resolvedPartnerId);

        let conv = await Conversation.findOne({ conversation_id: conversationId });

        if (!conv) {
            const unreadMap = new Map<string, number>();
            unreadMap.set(userAId, 0);
            unreadMap.set(resolvedPartnerId, 0);

            conv = await Conversation.create({
                conversation_id: conversationId,
                participants: [new mongoose.Types.ObjectId(userAId), new mongoose.Types.ObjectId(resolvedPartnerId)],
                shop_id: resolvedShopId ? new mongoose.Types.ObjectId(resolvedShopId) : undefined,
                unread_counts: unreadMap
            });
            logger.info(`Tạo mới cuộc hội thoại: ${conversationId}`);
        } else if (resolvedShopId && !conv.shop_id) {
            conv.shop_id = new mongoose.Types.ObjectId(resolvedShopId);
            await conv.save();
        }

        // Lấy thông tin partner
        const partnerUser = await User.findById(resolvedPartnerId).lean();
        const partnerShop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(resolvedPartnerId) }).lean();

        const partnerDTO: ConversationPartnerDTO = {
            id: resolvedPartnerId,
            full_name: partnerShop?.shop_name || partnerUser?.full_name || 'Người dùng VietCraft',
            avatar: partnerShop?.logo || partnerUser?.avatar || '',
            email: partnerUser?.email || '',
            role: partnerUser?.role || 'BUYER',
            shop: partnerShop ? {
                id: partnerShop._id.toString(),
                name: partnerShop.shop_name,
                logo: partnerShop.logo,
                slug: partnerShop.slug
            } : undefined
        };

        const unreadVal = (conv.unread_counts && typeof (conv.unread_counts as any).get === 'function')
            ? (conv.unread_counts as any).get(userAId)
            : (conv.unread_counts as any)?.[userAId];

        return {
            conversation_id: conv.conversation_id,
            partner: partnerDTO,
            last_message: conv.last_message ? {
                text: conv.last_message.text,
                sender_id: conv.last_message.sender_id.toString(),
                created_at: conv.last_message.created_at.toISOString()
            } : undefined,
            unread_count: Number(unreadVal) || 0,
            updated_at: conv.updated_at.toISOString()
        };
    }

    /**
     * Lấy danh sách cuộc hội thoại của một user
     */
    async getUserConversations(userId: string): Promise<ConversationItemDTO[]> {
        const userObjId = new mongoose.Types.ObjectId(userId);
        const conversations = await Conversation.find({ participants: userObjId })
            .sort({ updated_at: -1 })
            .lean();

        if (conversations.length === 0) return [];

        // Gom các partner IDs và shop IDs
        const partnerIds: mongoose.Types.ObjectId[] = [];
        const shopIds: mongoose.Types.ObjectId[] = [];

        for (const c of conversations) {
            const pId = c.participants.find(p => p.toString() !== userId);
            if (pId) partnerIds.push(pId);
            if (c.shop_id) shopIds.push(c.shop_id);
        }

        const [users, shops] = await Promise.all([
            User.find({ _id: { $in: partnerIds } }).select('_id full_name avatar email role').lean(),
            Shop.find({
                $or: [
                    { _id: { $in: shopIds } },
                    { owner_id: { $in: partnerIds } }
                ]
            }).select('_id owner_id shop_name logo slug').lean()
        ]);

        const userMap = new Map(users.map(u => [u._id.toString(), u]));
        const shopByOwner = new Map(shops.map(s => [s.owner_id.toString(), s]));
        const shopById = new Map(shops.map(s => [s._id.toString(), s]));

        const results: ConversationItemDTO[] = [];

        for (const c of conversations) {
            const pId = c.participants.find(p => p.toString() !== userId)?.toString();
            if (!pId) continue;

            const u = userMap.get(pId);
            const shop = (c.shop_id ? shopById.get(c.shop_id.toString()) : null) || shopByOwner.get(pId);

            const partnerDTO: ConversationPartnerDTO = {
                id: pId,
                full_name: shop?.shop_name || u?.full_name || 'Người dùng VietCraft',
                avatar: shop?.logo || u?.avatar || '',
                email: u?.email || '',
                role: u?.role || 'BUYER',
                shop: shop ? {
                    id: shop._id.toString(),
                    name: shop.shop_name,
                    logo: shop.logo,
                    slug: shop.slug
                } : undefined
            };

            const unreadCounts = c.unread_counts instanceof Map
                ? c.unread_counts
                : new Map(Object.entries(c.unread_counts || {}));

            results.push({
                conversation_id: c.conversation_id,
                partner: partnerDTO,
                last_message: c.last_message ? {
                    text: c.last_message.text,
                    sender_id: c.last_message.sender_id.toString(),
                    created_at: new Date(c.last_message.created_at).toISOString()
                } : undefined,
                unread_count: Number(unreadCounts.get(userId) || 0),
                updated_at: new Date(c.updated_at).toISOString()
            });
        }

        return results;
    }

    /**
     * Lấy lịch sử tin nhắn của một cuộc hội thoại
     */
    async getMessages(conversationId: string, userId: string, limit = 50, before?: Date): Promise<ChatMessageDTO[]> {
        const parts = conversationId.split('_');
        if (!parts.includes(userId)) {
            throw new Error('Bạn không có quyền xem cuộc trò chuyện này');
        }

        const query: any = { conversation_id: conversationId };
        if (before) {
            query.created_at = { $lt: before };
        }

        const rawMessages = await ChatMessage.find(query)
            .sort({ created_at: -1 })
            .limit(limit)
            .lean();

        // Đảo ngược để có thứ tự thời gian tăng dần
        const messages = rawMessages.reverse();

        return messages.map(mapMessageToDTO);
    }

    /**
     * Lưu tin nhắn vào DB, cập nhật Conversation last_message và unread_counts
     */
    async saveMessage(data: {
        senderId: string;
        receiverId?: string;
        roomId?: string;
        messageText?: string;
        attachments?: string[];
        productWidget?: ProductWidgetDTO;
        customQuotation?: CustomQuotationDTO;
    }): Promise<ChatMessageDTO> {
        let roomId = data.roomId;
        let receiverId = data.receiverId;

        if (roomId && !receiverId) {
            const parts = roomId.split('_');
            receiverId = parts.find(p => p !== data.senderId);
        } else if (!roomId && receiverId) {
            roomId = buildConversationId(data.senderId, receiverId);
        }

        if (!roomId || !receiverId) {
            throw new Error('Thiếu thông tin người nhận hoặc cuộc hội thoại');
        }

        let productWidgetDoc: any = undefined;
        if (data.productWidget && data.productWidget.product_id) {
            productWidgetDoc = {
                product_id: new mongoose.Types.ObjectId(data.productWidget.product_id),
                title: data.productWidget.title,
                price: mongoose.Types.Decimal128.fromString(data.productWidget.price.toString()),
                image: data.productWidget.image
            };
        }

        let customQuotationDoc: any = undefined;
        if (data.customQuotation && data.customQuotation.amount) {
            customQuotationDoc = {
                amount: mongoose.Types.Decimal128.fromString(data.customQuotation.amount.toString()),
                design_url: data.customQuotation.design_url,
                status: data.customQuotation.status || 'OFFERED'
            };
        }

        const messageDoc = await ChatMessage.create({
            conversation_id: roomId,
            sender_id: new mongoose.Types.ObjectId(data.senderId),
            receiver_id: new mongoose.Types.ObjectId(receiverId),
            message_text: data.messageText || '',
            attachments: data.attachments || [],
            product_widget: productWidgetDoc,
            custom_quotation: customQuotationDoc,
            is_read: false,
            created_at: new Date()
        });

        // Snippet tin nhắn hiển thị cho last_message
        let snippetText = data.messageText || '';
        if (!snippetText && data.productWidget) {
            snippetText = `[Sản phẩm] ${data.productWidget.title}`;
        } else if (!snippetText && data.attachments?.length) {
            snippetText = `[${data.attachments.length} hình ảnh]`;
        } else if (!snippetText && data.customQuotation) {
            snippetText = `[Báo giá thiết kế]`;
        }

        // Cập nhật Conversation
        const updateObj: any = {
            $set: {
                last_message: {
                    text: snippetText,
                    sender_id: new mongoose.Types.ObjectId(data.senderId),
                    created_at: new Date()
                },
                [`unread_counts.${data.senderId}`]: 0,
                updated_at: new Date()
            },
            $inc: {
                [`unread_counts.${receiverId}`]: 1
            },
            $setOnInsert: {
                conversation_id: roomId,
                participants: [new mongoose.Types.ObjectId(data.senderId), new mongoose.Types.ObjectId(receiverId)],
            }
        };

        await Conversation.findOneAndUpdate(
            { conversation_id: roomId },
            updateObj,
            { upsert: true, new: true }
        );

        return mapMessageToDTO(messageDoc);
    }

    /**
     * Đánh dấu cuộc hội thoại là đã đọc bởi userId
     */
    async markAsRead(conversationId: string, userId: string): Promise<void> {
        const parts = conversationId.split('_');
        if (!parts.includes(userId)) return;

        const userObjId = new mongoose.Types.ObjectId(userId);

        await Promise.all([
            ChatMessage.updateMany(
                { conversation_id: conversationId, receiver_id: userObjId, is_read: false },
                { $set: { is_read: true } }
            ),
            Conversation.updateOne(
                { conversation_id: conversationId },
                { $set: { [`unread_counts.${userId}`]: 0 } }
            )
        ]);
    }

    /**
     * Lấy tổng số tin nhắn chưa đọc của user
     */
    async getTotalUnreadCount(userId: string): Promise<number> {
        const userObjId = new mongoose.Types.ObjectId(userId);
        const count = await ChatMessage.countDocuments({
            receiver_id: userObjId,
            is_read: false
        });
        return count;
    }
}

export const chatService = new ChatService();
export default chatService;
