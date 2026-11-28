import { PreviewBodyResult } from './health-preview';

export function parseHealthFeedback(raw: unknown): PreviewBodyResult<{ image_url: string; verdict: 'ai_wrong' | 'ai_right' }> {
    const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

    const imageUrl = typeof src.image_url === 'string' ? src.image_url.trim() : '';
    if (imageUrl.length < 1 || imageUrl.length > 2000) return { invalid: 'image_url' };

    const verdict = src.verdict;
    if (verdict !== 'ai_wrong' && verdict !== 'ai_right') return { invalid: 'verdict' };

    return { body: { image_url: imageUrl, verdict } };
}
