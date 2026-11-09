import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import sharp from 'sharp';
import { config } from '../../../app/config';
import { UPLOAD_ROOT, publicUrl } from '../../../shared/upload/upload.middleware';
import { logger } from '../../../shared/utils/logger';
import { loadImage } from './mockup.service';

/**
 * Video quảng cáo AI (~4s) cho sản phẩm POD ở bước preview.
 *
 * ⚠️ MỖI LẦN TẠO LÀ MỘT KHOẢN TIỀN THẬT. Các chốt chặn chi phí:
 *  1. Chỉ tạo khi seller bấm nút (không tự chạy khi vào bước preview).
 *  2. Dedupe: cùng seller + cùng ảnh + cùng prompt → trả lại job cũ, KHÔNG gọi API lần nữa.
 *  3. Một seller chỉ có tối đa 1 job đang chạy.
 *  4. Hạn mức / 24h theo seller và toàn hệ thống (lưu file, sống qua restart).
 *  5. Không tự retry request tạo task; polling chỉ gọi endpoint trạng thái (không tính tiền)
 *     và chỉ khi client hỏi, có timeout cứng.
 *  6. Kill switch VIDEO_AI_ENABLED=false.
 */

export type VideoAdStatus = 'pending' | 'done' | 'failed';

export interface VideoAdJob {
    id: string;
    userId: string;
    key: string;
    status: VideoAdStatus;
    videoUrl?: string;
    error?: string;
    upstreamId?: string;
    createdAt: number;
    lastPollAt: number;
}

export class VideoAdError extends Error {
    constructor(message: string, public status = 400) {
        super(message);
    }
}

const jobs = new Map<string, VideoAdJob>();
const jobByKey = new Map<string, string>();

const VIDEO_DIR = path.join(UPLOAD_ROOT, 'videos');
fs.mkdirSync(VIDEO_DIR, { recursive: true });

// ---------- Sổ hạn mức (persist để restart không reset trần chi phí) ----------
const LEDGER_FILE = path.resolve(process.cwd(), 'storage', 'video-ai-ledger.json');
const DAY_MS = 24 * 60 * 60 * 1000;
type LedgerEntry = { userId: string; at: number };

function readLedger(): LedgerEntry[] {
    try {
        const all: LedgerEntry[] = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
        const since = Date.now() - DAY_MS;
        return Array.isArray(all) ? all.filter(e => e && e.at > since) : [];
    } catch {
        return [];
    }
}
function writeLedger(entries: LedgerEntry[]) {
    try {
        fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
        fs.writeFileSync(LEDGER_FILE, JSON.stringify(entries));
    } catch (e: any) {
        logger.warn('Không ghi được sổ hạn mức video AI: ' + e.message);
    }
}
function reserveQuota(userId: string): LedgerEntry {
    const cfg = config.videoAi;
    const ledger = readLedger();
    if (ledger.length >= cfg.dailyLimitGlobal) {
        throw new VideoAdError('Hệ thống đã đạt giới hạn tạo video hôm nay. Vui lòng thử lại vào ngày mai.', 429);
    }
    if (ledger.filter(e => e.userId === userId).length >= cfg.dailyLimitPerUser) {
        throw new VideoAdError(`Bạn đã dùng hết ${cfg.dailyLimitPerUser} lượt tạo video trong 24 giờ qua.`, 429);
    }
    const entry = { userId, at: Date.now() };
    writeLedger([...ledger, entry]);
    return entry;
}
function refundQuota(entry: LedgerEntry) {
    writeLedger(readLedger().filter(e => !(e.userId === entry.userId && e.at === entry.at)));
}

export function getQuota(userId: string) {
    const cfg = config.videoAi;
    const ledger = readLedger();
    const used = ledger.filter(e => e.userId === userId).length;
    return {
        enabled: cfg.enabled && Boolean(cfg.apiKey),
        durationSec: cfg.durationSec,
        used,
        limit: cfg.dailyLimitPerUser,
        remaining: Math.max(0, Math.min(cfg.dailyLimitPerUser - used, cfg.dailyLimitGlobal - ledger.length)),
    };
}

// ---------- Tiện ích ----------
const SAFE_IMAGE_URL = /^(\/uploads\/[\w\-./]+|\/images\/[\w\-./]+|https:\/\/res\.cloudinary\.com\/[^\s]+)$/;

/** FE ghép origin vào ảnh local (http://host/uploads/x.png) → đưa về /uploads/x.png; cloudinary giữ nguyên. */
function normalizeImageUrl(raw: string): string {
    try {
        const u = new URL(raw);
        if (u.hostname === 'res.cloudinary.com') return raw;
        if (/^\/(uploads|images)\//.test(u.pathname)) return u.pathname;
    } catch { /* đường dẫn tương đối */ }
    return raw;
}

function buildPrompt(title: string): string {
    const name = (title || '').replace(/[\r\n"]+/g, ' ').trim().slice(0, 80);
    return [
        `Premium ${config.videoAi.durationSec}-second product advertisement${name ? ` for "${name}"` : ''}.`,
        'Slow cinematic camera push-in with a subtle rotation of the product shown in the image,',
        'soft studio lighting, clean elegant background, gentle highlights.',
        'Keep the product shape, colors and printed design EXACTLY as in the image.',
        'No text overlays, no logos, no people, no watermark.',
    ].join(' ');
}

async function toDataUri(imageUrl: string): Promise<string> {
    const buf = await loadImage(imageUrl);
    // Thu nhỏ để payload nhẹ, tránh gateway từ chối vì body quá lớn.
    const jpeg = await sharp(buf)
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 88 })
        .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

async function upstream(method: 'GET' | 'POST', route: string, body?: any): Promise<any> {
    const cfg = config.videoAi;
    const res = await fetch(`${cfg.baseUrl}${route}`, {
        method,
        headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(method === 'POST' ? 90_000 : 20_000),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* không phải JSON */ }
    if (!res.ok) {
        const msg = json?.error?.message || json?.message || (typeof json?.error === 'string' ? json.error : '') || text.slice(0, 200);
        throw new VideoAdError(`Dịch vụ video AI trả lỗi ${res.status}: ${msg}`.trim(), 502);
    }
    return json ?? {};
}

const pick = (o: any, ...keys: string[]) => {
    for (const k of keys) if (o && typeof o[k] === 'string' && o[k]) return o[k] as string;
    return undefined;
};

function extractTaskId(r: any): string | undefined {
    return pick(r, 'task_id', 'id') || pick(r?.data, 'task_id', 'id') || pick(r?.data?.[0], 'task_id', 'id');
}

function extractStatus(r: any): VideoAdStatus {
    const s = String(pick(r, 'status') || pick(r?.data, 'status') || '').toLowerCase();
    if (/(complet|succe|done|finish)/.test(s)) return 'done';
    if (/(fail|error|cancel|reject|expire)/.test(s)) return 'failed';
    return 'pending';
}

function extractVideoUrl(r: any): string | undefined {
    const direct = pick(r, 'video_url', 'url', 'result_url', 'content_url', 'output_url')
        || pick(r?.data, 'video_url', 'url', 'result_url', 'output')
        || pick(r?.data?.[0], 'video_url', 'url')
        || pick(r?.output, 'url', 'video_url')
        || pick(r?.metadata, 'url', 'video_url');
    if (direct && /^https?:\/\//i.test(direct)) return direct;
    // Quét sâu tìm link file video
    const stack: any[] = [r];
    while (stack.length) {
        const cur = stack.pop();
        if (typeof cur === 'string' && /^https?:\/\/\S+\.(mp4|webm|mov)(\?\S*)?$/i.test(cur)) return cur;
        if (cur && typeof cur === 'object') stack.push(...Object.values(cur));
    }
    return undefined;
}

function extractError(r: any): string {
    const e = r?.error?.message || (typeof r?.error === 'string' ? r.error : '') || r?.fail_reason || r?.message || r?.data?.error;
    return typeof e === 'string' && e ? e : 'Tạo video thất bại.';
}

async function saveVideo(remoteUrl: string): Promise<string> {
    const res = await fetch(remoteUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Không tải được video kết quả (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024 || buf.length > 60 * 1024 * 1024) throw new Error('Video kết quả không hợp lệ.');
    const out = path.join(VIDEO_DIR, `${crypto.randomUUID()}.mp4`);
    await fs.promises.writeFile(out, buf);
    return publicUrl(out);
}

// ---------- API công khai ----------
export const VideoAdService = {
    quota: getQuota,

    /** Tạo video (tốn tiền). Idempotent theo (seller, ảnh, prompt). */
    async create(userId: string, input: { imageUrl: string; title?: string }): Promise<VideoAdJob> {
        const cfg = config.videoAi;
        if (!cfg.enabled || !cfg.apiKey) {
            throw new VideoAdError('Tính năng tạo video AI chưa được bật.', 503);
        }
        const imageUrl = normalizeImageUrl(String(input.imageUrl || '').trim());
        if (!SAFE_IMAGE_URL.test(imageUrl) || imageUrl.includes('..')) {
            throw new VideoAdError('Ảnh sản phẩm không hợp lệ (chỉ nhận ảnh mockup của hệ thống).');
        }

        // Quy ảnh tuyệt đối trỏ về chính server (dev) thành đường dẫn tương đối không cần — chỉ nhận /uploads, /images, cloudinary.
        const prompt = buildPrompt(input.title || '');
        const key = crypto.createHash('sha256').update([userId, imageUrl, prompt, cfg.model].join('|')).digest('hex');

        // Chốt 2: dedupe — không bao giờ trả tiền hai lần cho cùng một yêu cầu thành công/đang chạy.
        const existingId = jobByKey.get(key);
        const existing = existingId ? jobs.get(existingId) : undefined;
        if (existing && existing.status !== 'failed') return existing;

        // Chốt 3: mỗi seller 1 job đang chạy.
        for (const j of jobs.values()) {
            if (j.userId === userId && j.status === 'pending') {
                throw new VideoAdError('Bạn đang có một video đang được tạo, vui lòng chờ hoàn tất.', 409);
            }
        }

        // Chốt 4: trừ hạn mức TRƯỚC khi gọi API.
        const ticket = reserveQuota(userId);
        const job: VideoAdJob = {
            id: crypto.randomUUID(), userId, key, status: 'pending',
            createdAt: Date.now(), lastPollAt: 0,
        };

        try {
            const image = await toDataUri(imageUrl);
            // Một lần gọi duy nhất, không retry.
            const r = await upstream('POST', '/video/generations', {
                model: cfg.model,
                prompt,
                image,
                duration: cfg.durationSec,
                n: 1,
            });
            const upstreamId = extractTaskId(r);
            const immediateUrl = extractVideoUrl(r);
            if (!upstreamId && !immediateUrl) {
                throw new VideoAdError('Dịch vụ video AI không trả về mã tác vụ.', 502);
            }
            job.upstreamId = upstreamId;
            if (immediateUrl && extractStatus(r) === 'done') {
                job.videoUrl = await saveVideo(immediateUrl);
                job.status = 'done';
            }
        } catch (e: any) {
            // Gọi chưa được nhận → chưa bị tính tiền → hoàn lại lượt.
            refundQuota(ticket);
            logger.warn(`Video AI create failed: ${e.message}`);
            throw e instanceof VideoAdError ? e : new VideoAdError(e.message || 'Không tạo được video.', 502);
        }

        jobs.set(job.id, job);
        jobByKey.set(key, job.id);
        return job;
    },

    /** Hỏi trạng thái. Gọi endpoint trạng thái (không tính tiền), giãn tối thiểu 3s/lần. */
    async status(userId: string, jobId: string): Promise<VideoAdJob> {
        const job = jobs.get(jobId);
        if (!job || job.userId !== userId) throw new VideoAdError('Không tìm thấy tác vụ video.', 404);
        if (job.status !== 'pending') return job;

        if (Date.now() - job.createdAt > config.videoAi.pollTimeoutMs) {
            job.status = 'failed';
            job.error = 'Quá thời gian chờ tạo video.';
            return job;
        }
        if (Date.now() - job.lastPollAt < 3000 || !job.upstreamId) return job;
        job.lastPollAt = Date.now();

        try {
            const r = await upstream('GET', `/video/generations/${encodeURIComponent(job.upstreamId)}`);
            const st = extractStatus(r);
            if (st === 'done') {
                const url = extractVideoUrl(r);
                if (!url) throw new Error('Tác vụ hoàn tất nhưng không có link video.');
                job.videoUrl = await saveVideo(url);
                job.status = 'done';
            } else if (st === 'failed') {
                job.status = 'failed';
                job.error = extractError(r);
            }
        } catch (e: any) {
            // Lỗi mạng khi hỏi trạng thái: giữ pending, client hỏi lại (timeout cứng ở trên).
            logger.warn(`Video AI poll error: ${e.message}`);
        }
        return job;
    },
};

export const toPublicJob = (j: VideoAdJob) => ({
    jobId: j.id,
    status: j.status,
    videoUrl: j.videoUrl,
    error: j.error,
});
