export type EnvelopeStatus = 'ok' | 'partial' | 'insufficient_data';

export type SourceMode = 'live' | 'seed_demo' | 'derived';

export interface EnvelopeMeta {
    status: EnvelopeStatus;
    reason?: string;
    computed_at: string;
    model_version: string;
    scope: string;
    scope_id: string | null;
    source: {
        database: string;
        collection: string | null;
        mode: SourceMode;
        attributed_to_live_shop: boolean;
    };
    quality: {
        sample_size: number | null;
        identity_linked: boolean;
        confidence: string;
    };
}

export interface Envelope<T> {
    data: T | null;
    meta: EnvelopeMeta;
    error: null;
}

export function nowIso(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function buildMeta(opts: {
    computed_at?: string | Date | null;
    model_version?: string;
    scope: string;
    scope_id?: string | null;
    database?: string;
    collection?: string | null;
    mode?: SourceMode;
    attributed_to_live_shop?: boolean;
    sample_size?: number | null;
    identity_linked?: boolean;
    confidence?: string;
}): EnvelopeMeta {
    const computedAt = opts.computed_at instanceof Date ? opts.computed_at.toISOString() : opts.computed_at;
    return {
        status: 'ok',
        computed_at: computedAt || nowIso(),
        model_version: opts.model_version || 'unknown',
        scope: opts.scope,
        scope_id: opts.scope_id ?? null,
        source: {
            database: opts.database || 'vietcraft',
            collection: opts.collection ?? null,
            mode: opts.mode || 'live',
            attributed_to_live_shop: opts.attributed_to_live_shop ?? true,
        },
        quality: {
            sample_size: opts.sample_size ?? null,
            identity_linked: opts.identity_linked ?? false,
            confidence: opts.confidence || 'medium',
        },
    };
}

export function ok<T>(data: T, meta: EnvelopeMeta): Envelope<T> {
    return { data, meta: { ...meta, status: 'ok' }, error: null };
}

export function insufficient(reason: string, meta: EnvelopeMeta): Envelope<null> {
    return { data: null, meta: { ...meta, status: 'insufficient_data', reason }, error: null };
}
