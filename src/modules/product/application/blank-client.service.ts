import { config } from '../../../app/config';

// Blank (phôi) sống ở hệ Printer (port 8880). Marketplace chỉ đọc qua HTTP.
// ponytail: fetch native (Node 18+) + cache in-memory TTL 60s. Đổi sang Redis nếu chạy nhiều instance.

export interface BlankVariation {
    sku: string;
    color?: string;
    size?: string;
    material?: string;
    base_cost: number;
}
export interface Blank {
    _id: string;
    title: string;
    description?: string;
    category: string;
    default_image: string;
    variations: BlankVariation[];
    print_areas?: { key: string; label?: string; image?: string; x: number; y: number; width: number; height: number; surface?: 'flat' | 'wrap'; template_w?: number; template_h?: number; arc?: number }[];
    is_active?: boolean;
}

let cache: { at: number; data: Blank[] } | null = null;
const TTL_MS = 60_000;

async function fetchBlanks(): Promise<Blank[]> {
    // ponytail: timeout 5s để không treo request seller khi Printer chậm/treo.
    const res = await fetch(`${config.printerApiUrl}/api/blanks`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Printer trả về ${res.status}`);
    return res.json() as Promise<Blank[]>;
}

export class BlankClient {
    /** Danh sách phôi active (đã cache). Ném lỗi rõ ràng nếu Printer offline. */
    static async listBlanks(): Promise<Blank[]> {
        if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
        try {
            const data = await fetchBlanks();
            cache = { at: Date.now(), data };
            return data;
        } catch (err: any) {
            if (cache) return cache.data; // fallback cache cũ nếu có
            throw new Error(`Không lấy được danh sách phôi từ xưởng in: ${err.message}`);
        }
    }

    static async getBlank(id: string): Promise<Blank | undefined> {
        const blanks = await BlankClient.listBlanks();
        return blanks.find(b => b._id === id);
    }

    /** Tra 1 biến thể phôi theo sku — dùng để lấy base_cost khi tạo variant. */
    static async findVariation(blankId: string, sku: string): Promise<BlankVariation | undefined> {
        const blank = await BlankClient.getBlank(blankId);
        return blank?.variations.find(v => v.sku === sku);
    }
}
export default BlankClient;
