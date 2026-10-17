import { config } from '../../../app/config';
import { decryptField } from '../../../shared/utils/crypto.service';

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
    dimensions_info?: string;
    variations: BlankVariation[];
    print_areas?: { key: string; label?: string; image?: string; x: number; y: number; width: number; height: number; surface?: 'flat' | 'wrap'; template_w?: number; template_h?: number; arc?: number }[];
    is_active?: boolean;
    printer_id?: string;
    printer_name?: string;
}

export const DEFAULT_BLANKS: Blank[] = [
    {
        _id: 'blank-tshirt-01',
        title: 'Áo thun Oversize Cotton Premium 250gsm',
        description: 'Phôi áo thun 100% Cotton định lượng 250gsm dày dặn, phom dáng oversize Unisex mộc mạc chuẩn phong cách VietCraft. Bề mặt vải dệt chần êm mịn, dệt không xơ hỗ trợ in nhiệt & in kỹ thuật số (DTG/DTF) sắc nét.',
        category: 'Thời trang',
        dimensions_info: 'Dài 72cm × Rộng 54cm (Form Oversize Unisex)',
        default_image: '/images/AoMT.png',
        variations: [
            { sku: 'TSHIRT-BLK-S', color: 'Đen', size: 'S', base_cost: 85000 },
            { sku: 'TSHIRT-BLK-M', color: 'Đen', size: 'M', base_cost: 85000 },
            { sku: 'TSHIRT-BLK-L', color: 'Đen', size: 'L', base_cost: 85000 },
            { sku: 'TSHIRT-BLK-XL', color: 'Đen', size: 'XL', base_cost: 88000 },
            { sku: 'TSHIRT-WHT-S', color: 'Trắng', size: 'S', base_cost: 85000 },
            { sku: 'TSHIRT-WHT-M', color: 'Trắng', size: 'M', base_cost: 85000 },
            { sku: 'TSHIRT-WHT-L', color: 'Trắng', size: 'L', base_cost: 85000 },
            { sku: 'TSHIRT-WHT-XL', color: 'Trắng', size: 'XL', base_cost: 88000 },
            { sku: 'TSHIRT-BRN-M', color: 'Nâu Gỗ', size: 'M', base_cost: 87000 },
            { sku: 'TSHIRT-BRN-L', color: 'Nâu Gỗ', size: 'L', base_cost: 87000 }
        ],
        print_areas: [
            {
                key: 'front',
                label: 'Mặt trước (25×33cm)',
                image: '/images/AoMT.png',
                x: 275,
                y: 220,
                width: 250,
                height: 330,
                surface: 'flat'
            },
            {
                key: 'back',
                label: 'Mặt sau (25×33cm)',
                image: '/images/AoMS.png',
                x: 275,
                y: 220,
                width: 250,
                height: 330,
                surface: 'flat'
            }
        ],
        is_active: true
    },
    {
        _id: 'blank-mug-01',
        title: 'Ly / Cốc Sứ Trắng Men Mờ 330ml (In 3D Wrap)',
        description: 'Ly sứ men trắng mờ cao cấp nung ở 1300°C bền bỉ, an toàn thực phẩm. Hỗ trợ công nghệ in uốn cong 3D (Cylinder Warp) bao phủ toàn bộ thân ly với độ giải đáp màu chân thực.',
        category: 'Gia dụng & Quà tặng',
        dimensions_info: 'Cao 9.5cm × Đường kính 8.2cm (Dung tích 330ml)',
        default_image: '/images/Ly.png',
        variations: [
            { sku: 'MUG-WHT-330', color: 'Trắng Men Mờ', size: '330ml', material: 'Sứ cao cấp', base_cost: 45000 },
            { sku: 'MUG-BLK-330', color: 'Đen Huyền Bí', size: '330ml', material: 'Sứ cao cấp', base_cost: 48000 }
        ],
        print_areas: [
            {
                key: 'wrap',
                label: 'Vòng quanh ly (3D Wrap)',
                image: '/images/Ly.png',
                x: 180,
                y: 220,
                width: 440,
                height: 340,
                surface: 'wrap',
                template_w: 2475,
                template_h: 1155
            }
        ],
        is_active: true
    },
    {
        _id: 'blank-tote-01',
        title: 'Túi Tote Vải Bố Canvas Tự Nhiên',
        description: 'Túi xách vải bố Canvas dệt sợi bông tự nhiên màu kem mộc, quai may gia cường chịu lực đến 15kg. Thích hợp cho các dòng sản phẩm quà tặng, thời trang dạo phố và thủ công mỹ nghệ Việt.',
        category: 'Phụ kiện',
        dimensions_info: 'Rộng 35cm × Cao 40cm (Quai xách dài 28cm)',
        default_image: '/images/Tui.png',
        variations: [
            { sku: 'TOTE-NAT-STD', color: 'Kem tự nhiên', size: '35x40cm', material: 'Vải bố Canvas 320gsm', base_cost: 38000 },
            { sku: 'TOTE-BLK-STD', color: 'Đen mộc', size: '35x40cm', material: 'Vải bố Canvas 320gsm', base_cost: 42000 }
        ],
        print_areas: [
            {
                key: 'front',
                label: 'Thân túi (30×33cm)',
                image: '/images/Tui.png',
                x: 250,
                y: 320,
                width: 300,
                height: 330,
                surface: 'flat'
            }
        ],
        is_active: true
    },
    {
        _id: 'blank-frame-01',
        title: 'Tranh Treo Tường Khung Gỗ Sồi Canvas 30x40cm',
        description: 'Khung tranh gỗ sồi tự nhiên tinh chế mộc mạc, căng sẵn vải Canvas dệt nổi thô chuyên dụng cho hội họa. Khung bo viền chắc chắn, cho khả năng hiển thị tác phẩm nghệ thuật tinh tế.',
        category: 'Trang trí nhà cửa',
        dimensions_info: 'Khung 30 × 40 cm (Độ dày khung 2.5cm)',
        default_image: '/images/KhungTranh.png',
        variations: [
            { sku: 'FRAME-OAK-3040', color: 'Gỗ Sồi Tự Nhiên', size: '30x40cm', material: 'Gỗ Sồi & Canvas', base_cost: 115000 },
            { sku: 'FRAME-WAL-3040', color: 'Gỗ Nâu Óc Chó', size: '30x40cm', material: 'Gỗ Walnut & Canvas', base_cost: 125000 }
        ],
        print_areas: [
            {
                key: 'front',
                label: 'Lòng tranh (30×40cm)',
                image: '/images/KhungTranh.png',
                x: 205,
                y: 140,
                width: 390,
                height: 520,
                surface: 'flat'
            }
        ],
        is_active: true
    }
];

import mongoose from 'mongoose';
import { Shop } from '../infrastructure/models/shop.model';

let cache: { at: number; data: Blank[] } | null = null;
const TTL_MS = 1_000;

async function fetchBlanksFromUrl(apiUrl: string, apiKey?: string, printerId?: string, printerName?: string): Promise<Blank[]> {
    const res = await fetch(`${apiUrl}/api/blanks`, {
        signal: AbortSignal.timeout(5000),
        headers: {
            'Accept': 'application/json',
            ...(apiKey ? { 'X-API-Key': apiKey } : {}),
        },
    });
    if (!res.ok) throw new Error(`Printer trả về ${res.status}`);
    const data = await res.json() as Blank[];
    return (data || []).map(b => {
        let printAreas = b.print_areas || [];
        if (!printAreas || printAreas.length === 0) {
            printAreas = [{
                key: 'front',
                label: 'Mặt trước',
                image: b.default_image,
                x: 275,
                y: 220,
                width: 250,
                height: 330,
                surface: 'flat'
            }];
        }
        return {
            ...b,
            print_areas: printAreas,
            printer_id: printerId || (b as any).printer_id || 'vietcraft-direct',
            printer_name: printerName || (b as any).printer_name || 'Xưởng in đối tác'
        };
    });
}

export class BlankClient {
    static async listBlanks(sellerId?: string): Promise<Blank[]> {
        if (sellerId && mongoose.Types.ObjectId.isValid(sellerId)) {
            const shop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(sellerId) }).lean();
            // Lấy danh sách tất cả các xưởng in đang liên kết của Seller
            const activePrinters = (shop?.printer_partners && shop.printer_partners.length > 0)
                ? shop.printer_partners.filter(p => p.is_connected && p.api_url)
                : (shop?.printer_partner?.is_connected && shop?.printer_partner?.api_url ? [shop.printer_partner] : []);

            if (activePrinters.length === 0) {
                // Nếu chưa liên kết xưởng in nào hoặc không có xưởng online, lấy danh sách phôi mặc định/hệ thống
                return BlankClient.listSystemBlanks();
            }

            const allBlanks: Blank[] = [];
            const seenKeys = new Set<string>();

            for (const printer of activePrinters) {
                try {
                    const blanks = await fetchBlanksFromUrl(
                        printer.api_url,
                        decryptField(printer.api_key || ''),
                        printer.printer_id,
                        printer.printer_name
                    );
                    for (const b of blanks) {
                        const uniqueKey = `${b._id}_${b.printer_id}`;
                        if (!seenKeys.has(uniqueKey)) {
                            seenKeys.add(uniqueKey);
                            allBlanks.push(b);
                        }
                    }
                } catch (err: any) {
                    // Tiếp tục với xưởng khác nếu một xưởng offline
                }
            }
            if (allBlanks.length > 0) return allBlanks;
            return BlankClient.listSystemBlanks();
        }

        return BlankClient.listSystemBlanks();
    }

    private static async listSystemBlanks(): Promise<Blank[]> {
        if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
        try {
            const data = await fetchBlanksFromUrl(config.printerApiUrl || 'http://localhost:8880', config.printerApiKey);
            if (data && data.length > 0) {
                cache = { at: Date.now(), data };
                return data;
            }
            return DEFAULT_BLANKS;
        } catch {
            return DEFAULT_BLANKS;
        }
    }

    static async getBlank(id: string, sellerId?: string): Promise<Blank | undefined> {
        // 1. Thử tìm trong danh sách phôi của seller (nếu có sellerId)
        if (sellerId) {
            try {
                const blanks = await BlankClient.listBlanks(sellerId);
                const found = blanks.find(b => b._id === id || String(b._id) === String(id));
                if (found) return found;
            } catch {
                // Tiếp tục fallback
            }
        }

        // 2. Thử tìm trong danh sách phôi hệ thống / cache
        try {
            const sysBlanks = await BlankClient.listBlanks();
            const foundSys = sysBlanks.find(b => b._id === id || String(b._id) === String(id));
            if (foundSys) return foundSys;
        } catch {
            // Tiếp tục fallback
        }

        // 3. Thử gọi trực tiếp endpoint GET /api/blanks/:id từ Printing Shop
        try {
            const apiUrl = config.printerApiUrl || 'http://localhost:8880';
            const res = await fetch(`${apiUrl}/api/blanks/${id}`, {
                signal: AbortSignal.timeout(5000),
                headers: {
                    'Accept': 'application/json',
                    ...(config.printerApiKey ? { 'X-API-Key': config.printerApiKey } : {})
                }
            });
            if (res.ok) {
                const b = await res.json() as Blank;
                if (b && b._id) {
                    let printAreas = b.print_areas || [];
                    if (!printAreas || printAreas.length === 0) {
                        printAreas = [{
                            key: 'front',
                            label: 'Mặt trước',
                            image: b.default_image,
                            x: 275,
                            y: 220,
                            width: 250,
                            height: 330,
                            surface: 'flat'
                        }];
                    }
                    return {
                        ...b,
                        print_areas: printAreas,
                        printer_id: b.printer_id || 'vietcraft-direct',
                        printer_name: b.printer_name || 'Xưởng in đối tác'
                    };
                }
            }
        } catch {
            // Tiếp tục fallback
        }

        // 4. Dự phòng: nếu không tìm thấy trong danh sách phôi từ xưởng thì tìm trong phôi dự phòng mặc định sàn
        return DEFAULT_BLANKS.find(b => b._id === id || String(b._id) === String(id));
    }

    static async findVariation(blankId: string, sku: string, sellerId?: string): Promise<BlankVariation | undefined> {
        const blank = await BlankClient.getBlank(blankId, sellerId);
        return blank?.variations.find(v => v.sku === sku);
    }
}
export default BlankClient;

