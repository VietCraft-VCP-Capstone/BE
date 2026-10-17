import mongoose from 'mongoose';
import { logger } from '../utils/logger';

export interface SystemBannedKeyword {
    keyword: string;
    reason: string;
}

export const BUILTIN_SYSTEM_KEYWORDS: SystemBannedKeyword[] = [
    // 18+ / Đồi trụy / Khiêu dâm
    { keyword: 'khiêu dâm', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'dâm ô', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'đồi trụy', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'gái gọi', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'gái bao', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'mại dâm', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'bán dâm', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'mua dâm', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'loạn luân', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'kích dục', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'ấu dâm', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'phim sex', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'thuốc kích dục', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'đồ chơi tình dục', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'giao cấu', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'chat sex', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'nude 18+', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'người lớn 18+', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'sex', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'porn', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'xxx', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'hentai', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },
    { keyword: 'jav', reason: 'Nội dung 18+ / Đồi trụy / Khiêu dâm' },

    // Ma tuý / Chất kích thích / Thuốc cấm
    { keyword: 'ma túy', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'ma túy đá', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'heroin', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'cocaine', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'cần sa', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'thuốc lắc', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'ecstasy', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'thuốc phiện', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'cỏ mỹ', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'bóng cười', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'shisha', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'ketamine', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'chất gây nghiện', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'nấm ma thuật', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'methamphetamine', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'kẹo bay', reason: 'Chất gây nghiện / Ma túy' },
    { keyword: 'nước vui', reason: 'Chất gây nghiện / Ma túy' },

    // Vũ khí / Chất nổ / Bạo lực
    { keyword: 'vũ khí quân dụng', reason: 'Vũ khí / Chất nổ / Bạo lực' },
    { keyword: 'súng bắn tỉa', reason: 'Vũ khí / Chất nổ / Bạo lực' },
    { keyword: 'súng ak', reason: 'Vũ khí / Chất nổ / Bạo lực' },
    { keyword: 'súng trường', reason: 'Vũ khí / Chất nổ / Bạo lực' },
    { keyword: 'thuốc nổ', reason: 'Vũ khí / Chất nổ / Bạo lực' },
    { keyword: 'bom thư', reason: 'Vũ khí / Chất nổ / Bạo lực' },
    { keyword: 'lựu đạn', reason: 'Vũ khí / Chất nổ / Bạo lực' },
    { keyword: 'pháo nổ', reason: 'Vũ khí / Chất nổ / Bạo lực' },
    { keyword: 'pháo hoa lậu', reason: 'Vũ khí / Chất nổ / Bạo lực' },
    { keyword: 'chất nổ', reason: 'Vũ khí / Chất nổ / Bạo lực' },
    { keyword: 'thuốc độc', reason: 'Vũ khí / Chất nổ / Bạo lực' },
    { keyword: 'ám sát', reason: 'Vũ khí / Chất nổ / Bạo lực' },
    { keyword: 'khủng bố', reason: 'Vũ khí / Chất nổ / Bạo lực' },
    { keyword: 'chế tạo bom', reason: 'Vũ khí / Chất nổ / Bạo lực' },

    // Động vật hoang dã / Hàng cấm tuyệt đối
    { keyword: 'ngà voi', reason: 'Động vật hoang dã cấm buôn bán' },
    { keyword: 'sừng tê giác', reason: 'Động vật hoang dã cấm buôn bán' },
    { keyword: 'da hổ', reason: 'Động vật hoang dã cấm buôn bán' },
    { keyword: 'móng hổ', reason: 'Động vật hoang dã cấm buôn bán' },
    { keyword: 'cao hổ cốt', reason: 'Động vật hoang dã cấm buôn bán' },
    { keyword: 'mật gấu', reason: 'Động vật hoang dã cấm buôn bán' },
    { keyword: 'vảy tê tê', reason: 'Động vật hoang dã cấm buôn bán' },

    // Cờ bạc / Cá cược
    { keyword: 'đánh bạc', reason: 'Cờ bạc / Cá cược / Tệ nạn' },
    { keyword: 'cá độ', reason: 'Cờ bạc / Cá cược / Tệ nạn' },
    { keyword: 'lô đề', reason: 'Cờ bạc / Cá cược / Tệ nạn' },
    { keyword: 'soi cầu', reason: 'Cờ bạc / Cá cược / Tệ nạn' },
    { keyword: 'tài xỉu', reason: 'Cờ bạc / Cá cược / Tệ nạn' },
    { keyword: 'xóc đĩa', reason: 'Cờ bạc / Cá cược / Tệ nạn' },
    { keyword: 'casino trực tuyến', reason: 'Cờ bạc / Cá cược / Tệ nạn' },
    { keyword: 'đá gà mạng', reason: 'Cờ bạc / Cá cược / Tệ nạn' },

    // Tục tĩu / Chửi thề nặng (phrases & words)
    { keyword: 'đụ má', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'đụ mẹ', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'đậu má', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'con mẹ mày', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'thằng chó má', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'mẹ kiếp', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'đĩ', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'dcm', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'vcl', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'clgt', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'vkl', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'fuck', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'bitch', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'pussy', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'dick', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'asshole', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'cunt', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
    { keyword: 'whore', reason: 'Tục tĩu / Xúc phạm / Chửi thề' },
];

const SINGLE_WORD_SET = new Set([
    'sex', 'porn', 'xxx', 'hentai', 'jav',
    'dcm', 'vcl', 'clgt', 'vkl',
    'fuck', 'bitch', 'pussy', 'dick', 'asshole', 'cunt', 'whore'
]);

// Danh sách cụm từ cấm (Phrases)
const BUILTIN_BANNED_PHRASES = BUILTIN_SYSTEM_KEYWORDS
    .map(k => k.keyword)
    .filter(kw => !SINGLE_WORD_SET.has(kw));

// Các từ đơn cấm
const BUILTIN_BANNED_WORDS = Array.from(SINGLE_WORD_SET);

function removeVietnameseAccents(str: string): string {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd');
}

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[\s,./\\;:'"!@#$%^&*()_+=\-[\]{}|<>?~`]+/)
        .map(t => t.trim())
        .filter(Boolean);
}

function matchesSequence(textTokens: string[], phraseTokens: string[]): boolean {
    if (phraseTokens.length === 0 || textTokens.length < phraseTokens.length) return false;
    for (let i = 0; i <= textTokens.length - phraseTokens.length; i++) {
        let match = true;
        for (let j = 0; j < phraseTokens.length; j++) {
            if (textTokens[i + j] !== phraseTokens[j]) {
                match = false;
                break;
            }
        }
        if (match) return true;
    }
    return false;
}

class ContentModerationService {
    private cachedDbKeywords: string[] = [];
    private lastFetchTime = 0;
    private readonly CACHE_TTL_MS = 60 * 1000;

    private async getDbKeywords(): Promise<string[]> {
        const now = Date.now();
        if (now - this.lastFetchTime < this.CACHE_TTL_MS && this.cachedDbKeywords.length > 0) {
            return this.cachedDbKeywords;
        }

        try {
            if (mongoose.connection.readyState === 1) {
                const col = mongoose.connection.collection('banned_keywords');
                const docs = await col.find({}, { projection: { keyword: 1 } }).toArray();
                this.cachedDbKeywords = docs
                    .map(d => String(d.keyword || '').trim().toLowerCase())
                    .filter(Boolean);
                this.lastFetchTime = now;
            }
        } catch (err: any) {
            logger.warn(`[ContentModeration] Failed to fetch banned_keywords: ${err.message}`);
        }

        return this.cachedDbKeywords;
    }

    /**
     * Kiểm tra chuỗi văn bản xem có chứa từ cấm không.
     * Sử dụng phân tích token theo ranh giới từ để tránh false-positives (ví dụ 'dạ hội' không bị nhầm thành 'da hổ').
     */
    public async checkContent(text: string): Promise<{ isClean: boolean; violatedWord?: string; reason?: string }> {
        if (!text || typeof text !== 'string') {
            return { isClean: true };
        }

        const raw = text.trim().toLowerCase();
        if (!raw) return { isClean: true };

        const noAccents = removeVietnameseAccents(raw);

        // Tokens gốc và Tokens không dấu
        const rawTokens = tokenize(raw);
        const noAccentTokens = tokenize(noAccents);

        // Chuỗi rút gọn (nối các chữ bị ngăn bởi ký tự phân tách đặc biệt, ví dụ s-e-x -> sex)
        const stripped = raw.replace(/[-_.*@#!~]/g, '');
        const strippedTokens = tokenize(stripped);
        const strippedNoAccentTokens = tokenize(removeVietnameseAccents(stripped));

        // 1. Kiểm tra từ cấm động từ database
        const dbKeywords = await this.getDbKeywords();
        for (const kw of dbKeywords) {
            const kwRawTokens = tokenize(kw);
            const kwNoAccentTokens = tokenize(removeVietnameseAccents(kw));

            if (
                matchesSequence(rawTokens, kwRawTokens) ||
                matchesSequence(noAccentTokens, kwNoAccentTokens) ||
                matchesSequence(strippedTokens, kwRawTokens) ||
                matchesSequence(strippedNoAccentTokens, kwNoAccentTokens)
            ) {
                return {
                    isClean: false,
                    violatedWord: kw,
                    reason: `Chứa từ ngữ bị cấm trong hệ thống sàn: "${kw}"`
                };
            }
        }

        // 2. Kiểm tra các cụm từ cấm mặc định (BUILTIN_BANNED_PHRASES)
        for (const phrase of BUILTIN_BANNED_PHRASES) {
            const phraseRawTokens = tokenize(phrase);
            const phraseNoAccentTokens = tokenize(removeVietnameseAccents(phrase));

            if (
                matchesSequence(rawTokens, phraseRawTokens) ||
                matchesSequence(noAccentTokens, phraseNoAccentTokens) ||
                matchesSequence(strippedTokens, phraseRawTokens) ||
                matchesSequence(strippedNoAccentTokens, phraseNoAccentTokens)
            ) {
                return {
                    isClean: false,
                    violatedWord: phrase,
                    reason: `Chứa từ ngữ không phù hợp hoặc bị cấm: "${phrase}"`
                };
            }
        }

        // 3. Kiểm tra các từ đơn cấm (BUILTIN_BANNED_WORDS)
        const allTokenSet = new Set([
            ...rawTokens,
            ...noAccentTokens,
            ...strippedTokens,
            ...strippedNoAccentTokens
        ]);

        for (const word of BUILTIN_BANNED_WORDS) {
            const wordNoAccent = removeVietnameseAccents(word);
            if (allTokenSet.has(word) || allTokenSet.has(wordNoAccent)) {
                return {
                    isClean: false,
                    violatedWord: word,
                    reason: `Chứa từ ngữ không phù hợp hoặc bị cấm: "${word}"`
                };
            }
        }

        return { isClean: true };
    }
}

export const contentModerationService = new ContentModerationService();
