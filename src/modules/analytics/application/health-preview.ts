export const PREVIEW_LIMITS = {
    n_images: 50,
    description_length: 20000,
    n_tags: 50,
    price: 1e10,
} as const;

export type PreviewLever = keyof typeof PREVIEW_LIMITS;

export type PreviewBodyResult<B = Partial<Record<PreviewLever, number>>> =
    | { body: B }
    | { invalid: string };

export function parsePreviewBody(raw: unknown): PreviewBodyResult {
    const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const body: Partial<Record<PreviewLever, number>> = {};

    for (const key of Object.keys(PREVIEW_LIMITS) as PreviewLever[]) {
        const value = source[key];
        if (value === undefined || value === null) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > PREVIEW_LIMITS[key]) {
            return { invalid: key };
        }
        body[key] = value;
    }
    return { body };
}
