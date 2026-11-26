import { NewsletterSubscriber, NewsletterSource } from '../infrastructure/models/newsletter-subscriber.model';

// Đủ chặt để loại dữ liệu rác, không cố bắt chước toàn bộ RFC 5322.
const EMAIL_RE = /^[^\s@<>()[\]\,;:"]+@[^\s@<>()[\]\,;:"]+\.[a-z]{2,}$/i;

export class NewsletterValidationError extends Error {}

export function normalizeEmail(raw: unknown): string {
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
        throw new NewsletterValidationError('Địa chỉ email không hợp lệ.');
    }
    return email;
}

const SOURCES: NewsletterSource[] = ['landing_footer', 'other'];

export const NewsletterService = {
    /** Đăng ký (idempotent). `alreadySubscribed` = email này đã đăng ký từ trước. */
    async subscribe(input: { email: unknown; source?: unknown; userId?: string; ip?: string; userAgent?: string }) {
        const email = normalizeEmail(input.email);
        const source = SOURCES.includes(input.source as NewsletterSource) ? (input.source as NewsletterSource) : 'other';

        const existing: any = await NewsletterSubscriber.findOne({ email }).lean();
        if (existing?.status === 'SUBSCRIBED') return { email, alreadySubscribed: true };

        try {
            await NewsletterSubscriber.updateOne(
                { email },
                {
                    $set: { status: 'SUBSCRIBED', subscribed_at: new Date(), source, ip: input.ip, user_agent: input.userAgent?.slice(0, 300) },
                    ...(input.userId ? { $setOnInsert: { user_id: input.userId } } : {}),
                },
                { upsert: true },
            );
        } catch (err: any) {
            // Hai yêu cầu cùng lúc cho một email: bản ghi đã có, coi như đăng ký thành công.
            if (err?.code !== 11000) throw err;
        }
        return { email, alreadySubscribed: false };
    },
};
