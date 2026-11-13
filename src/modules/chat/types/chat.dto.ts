export interface ProductWidgetDTO {
    product_id: string;
    title: string;
    price: number;
    image: string;
}

export interface CustomQuotationDTO {
    amount: number;
    design_url: string;
    status: 'OFFERED' | 'ACCEPTED' | 'REJECTED';
}

export interface ChatMessageDTO {
    id: string;
    conversation_id: string;
    sender_id: string;
    receiver_id: string;
    message_text?: string;
    attachments: string[];
    product_widget?: ProductWidgetDTO;
    custom_quotation?: CustomQuotationDTO;
    is_read: boolean;
    created_at: string;
    senderId?: string;
    message?: string;
    timestamp?: string;
}

export interface ConversationPartnerDTO {
    id: string;
    full_name: string;
    avatar?: string;
    email: string;
    role: string;
    shop?: {
        id: string;
        name: string;
        logo?: string;
        slug?: string;
    };
}

export interface ConversationItemDTO {
    conversation_id: string;
    partner: ConversationPartnerDTO;
    last_message?: {
        text: string;
        sender_id: string;
        created_at: string;
    };
    unread_count: number;
    updated_at: string;
}

export interface StartConversationDTO {
    partnerId?: string;
    shopId?: string;
    initialMessage?: string;
    productWidget?: ProductWidgetDTO;
}

export interface SendMessageDTO {
    receiver_id?: string;
    message_text?: string;
    attachments?: string[];
    product_widget?: ProductWidgetDTO;
    custom_quotation?: CustomQuotationDTO;
}
