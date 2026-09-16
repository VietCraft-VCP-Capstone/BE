import { config } from '../../../app/config';

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
                label: 'Mặt trước (26×34cm)',
                image: '/images/AoMT.png',
                x: 270,
                y: 230,
                width: 260,
                height: 340,
                surface: 'flat'
            },
            {
                key: 'back',
                label: 'Mặt sau (26×34cm)',
                image: '/images/AoMS.png',
                x: 270,
                y: 230,
                width: 260,
                height: 340,
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
                x: 0,
                y: 0,
                width: 2475,
                height: 1155,
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
                label: 'Mặt trước (25×30cm)',
                image: '/images/Tui.png',
                x: 250,
                y: 240,
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
                label: 'Bề mặt tranh (30×40cm)',
                image: '/images/KhungTranh.png',
                x: 100,
                y: 80,
                width: 600,
                height: 640,
                surface: 'flat'
            }
        ],
        is_active: true
    }
];

let cache: { at: number; data: Blank[] } | null = null;
const TTL_MS = 1_000;

async function fetchBlanks(): Promise<Blank[]> {
    const res = await fetch(`${config.printerApiUrl}/api/blanks`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Printer trả về ${res.status}`);
    return res.json() as Promise<Blank[]>;
}

export class BlankClient {
    static async listBlanks(): Promise<Blank[]> {
        if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
        try {
            const data = await fetchBlanks();
            cache = { at: Date.now(), data };
            return data;
        } catch {
            // Khi xưởng in (port 8880) không chạy hoặc lỗi mạng -> Tự động fallback về bộ phôi mặc định
            cache = { at: Date.now(), data: DEFAULT_BLANKS };
            return DEFAULT_BLANKS;
        }
    }

    static async getBlank(id: string): Promise<Blank | undefined> {
        const blanks = await BlankClient.listBlanks();
        return blanks.find(b => b._id === id);
    }

    static async findVariation(blankId: string, sku: string): Promise<BlankVariation | undefined> {
        const blank = await BlankClient.getBlank(blankId);
        return blank?.variations.find(v => v.sku === sku);
    }
}
export default BlankClient;

