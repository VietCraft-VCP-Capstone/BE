import mongoose from 'mongoose';
import { Shop, IPrinterPartner } from '../../product/infrastructure/models/shop.model';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';

export interface PrinterConnectionInput {
    printer_name?: string;
    api_url: string;
    api_key: string;
    printing_email?: string;
    printing_password?: string;
    webhook_secret?: string;
    auto_approve?: boolean;
}

export class SellerPrinterService {
    private static async findShop(ownerId: string) {
        if (!mongoose.Types.ObjectId.isValid(ownerId)) {
            throw new Error('Phiên làm việc không hợp lệ.');
        }
        const shop = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(ownerId) });
        if (!shop) {
            throw new Error('Không tìm thấy cửa hàng của bạn.');
        }
        return shop;
    }

    /**
     * Lấy cấu hình xưởng in của Shop hiện tại
     */
    static async getPrinterSettings(ownerId: string) {
        const shop = await this.findShop(ownerId);
        let list = shop.printer_partners || [];

        // Migration/Sync: nếu printer_partner có dữ liệu nhưng chưa có trong printer_partners
        if (shop.printer_partner?.is_connected) {
            const exists = list.some(p => p.printer_id === shop.printer_partner?.printer_id || p.api_key === shop.printer_partner?.api_key);
            if (!exists) {
                list = [shop.printer_partner, ...list];
                shop.printer_partners = list;
                await shop.save();
            }
        }

        const activePrinters = (list || []).filter(p => p.is_connected);

        return {
            printer: shop.printer_partner || {
                printer_name: 'Chưa liên kết xưởng in',
                api_url: config.printerApiUrl || 'http://localhost:8880',
                is_connected: false,
                auto_approve: false
            },
            printers: activePrinters,
            defaultApiUrl: config.printerApiUrl || 'http://localhost:8880'
        };
    }

    /**
     * Kiểm tra ping kết nối tới xưởng in
     */
    static async testConnection(apiUrl: string, apiKey?: string): Promise<{ success: boolean; message: string; blanksCount?: number }> {
        const cleanUrl = String(apiUrl || '').trim().replace(/\/+$/, '');
        if (!cleanUrl) {
            throw new Error('Vui lòng nhập API URL của xưởng in.');
        }

        try {
            logger.info(`[SELLER PRINTER] Testing connection to ${cleanUrl}/api/blanks`);
            const res = await fetch(`${cleanUrl}/api/blanks`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
                headers: {
                    'Accept': 'application/json',
                    ...(apiKey ? { 'X-API-Key': apiKey } : {})
                }
            });

            if (!res.ok) {
                return {
                    success: false,
                    message: `Xưởng in phản hồi mã lỗi HTTP ${res.status}. Vui lòng kiểm tra lại URL hoặc API Key.`
                };
            }

            const data = await res.json() as any[];
            const count = Array.isArray(data) ? data.length : 0;
            return {
                success: true,
                message: `Kết nối thành công! Đã nhận diện catalog với ${count} phôi in từ xưởng.`,
                blanksCount: count
            };
        } catch (err: any) {
            logger.warn(`[SELLER PRINTER TEST FAILED] ${err.message}`);
            return {
                success: false,
                message: `Không thể kết nối tới xưởng in tại ${cleanUrl}: ${err.message || 'Hết thời gian chờ (Timeout)'}`
            };
        }
    }

    /**
     * Lưu thông tin và kích hoạt kết nối xưởng in
     * Yêu cầu xác thực tài khoản Seller bên Printing Shop và API Key đã được duyệt
     */
    static async connectPrinter(ownerId: string, input: PrinterConnectionInput): Promise<{ current: IPrinterPartner; printers: IPrinterPartner[] }> {
        const shop = await this.findShop(ownerId);
        const cleanUrl = String(input.api_url || '').trim().replace(/\/+$/, '');

        if (!cleanUrl) {
            throw new Error('Vui lòng nhập địa chỉ máy chủ API của xưởng in.');
        }
        if (!input.api_key?.trim()) {
            throw new Error('Vui lòng nhập khóa API Key do xưởng in cấp cho thỏa thuận hợp tác của bạn.');
        }

        // Thực hiện xác thực chéo với xưởng in qua API Key và tài khoản Seller
        let verifiedPrinter = {
            id: 'printer_default',
            name: input.printer_name?.trim() || 'Xưởng in đối tác'
        };

        logger.info(`[SELLER PRINTER] Xác thực chéo tài khoản ${input.printing_email || 'API Key'} với xưởng in tại ${cleanUrl}`);
        try {
            const verifyRes = await fetch(`${cleanUrl}/api/partnerships/verify-seller`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: input.printing_email?.trim() || undefined,
                    password: input.printing_password || undefined,
                    api_key: input.api_key.trim(),
                    api_url: cleanUrl
                }),
                signal: AbortSignal.timeout(6000)
            });

            const verifyData = await verifyRes.json() as any;
            if (!verifyRes.ok) {
                throw new Error(verifyData.error || 'Xác thực tài khoản hoặc khóa API với xưởng in thất bại.');
            }

            if (verifyData.printer) {
                verifiedPrinter = {
                    id: verifyData.printer.id || 'printer_default',
                    name: verifyData.printer.name || input.printer_name || 'Xưởng in đối tác'
                };
            }
        } catch (err: any) {
            logger.warn(`[SELLER PRINTER VERIFY NOTICE] ${err.message}. Kiểm tra kết nối catalog qua API Key...`);
            // Thử kiểm tra kết nối catalog
            const testResult = await this.testConnection(cleanUrl, input.api_key);
            if (!testResult.success) {
                throw new Error(`Xác thực kết nối xưởng in thất bại: ${err.message}`);
            }
        }

        // Xác định tên xưởng in chuẩn xác:
        // Ưu tiên tên thực tế trả về từ xưởng in (ví dụ: "Danang Clothes WS")
        let finalPrinterName = verifiedPrinter.name;
        if (!finalPrinterName || finalPrinterName === 'Xưởng in đối tác') {
            finalPrinterName = input.printer_name?.trim() || 'Xưởng in đối tác';
        } else if (input.printer_name && 
                   input.printer_name.trim() !== '' && 
                   input.printer_name !== 'Xưởng in VietCraft Partner' &&
                   input.printer_name !== 'Xưởng In VietCraft Direct Hub') {
            finalPrinterName = input.printer_name.trim();
        }

        const printerData: IPrinterPartner = {
            printer_id: verifiedPrinter.id,
            printer_name: finalPrinterName,
            api_url: cleanUrl,
            api_key: input.api_key.trim(),
            seller_printing_email: input.printing_email?.trim().toLowerCase() || '',
            webhook_secret: input.webhook_secret?.trim() || config.printerWebhookSecret || '',
            is_connected: true,
            connected_at: new Date(),
            auto_approve: Boolean(input.auto_approve)
        };

        // Gán xưởng in vừa kết nối làm xưởng mặc định
        shop.printer_partner = printerData;

        // Quản lý danh sách xưởng in hợp tác của Seller
        if (!shop.printer_partners) {
            shop.printer_partners = [];
        }
        const existingIdx = shop.printer_partners.findIndex(p => 
            p.printer_id === printerData.printer_id || p.api_key === printerData.api_key
        );
        if (existingIdx >= 0) {
            shop.printer_partners[existingIdx] = printerData;
        } else {
            shop.printer_partners.push(printerData);
        }

        await shop.save();

        logger.info(`[SELLER PRINTER CONNECTED] Shop ${shop.shop_name} đã liên kết thành công với xưởng in: ${cleanUrl} (${printerData.printer_name})`);
        return {
            current: shop.printer_partner,
            printers: shop.printer_partners.filter(p => p.is_connected)
        };
    }

    /**
     * Ngắt kết nối xưởng in
     */
    static async disconnectPrinter(ownerId: string, targetPrinterId?: string) {
        const shop = await this.findShop(ownerId);
        if (targetPrinterId) {
            if (shop.printer_partners) {
                shop.printer_partners = shop.printer_partners.filter(p => 
                    p.printer_id !== targetPrinterId && p.api_key !== targetPrinterId
                );
            }
            if (shop.printer_partner?.printer_id === targetPrinterId || shop.printer_partner?.api_key === targetPrinterId) {
                const nextActive = (shop.printer_partners || []).find(p => p.is_connected);
                shop.printer_partner = nextActive || undefined;
            }
        } else {
            if (shop.printer_partner) {
                shop.printer_partner.is_connected = false;
            }
            if (shop.printer_partners) {
                shop.printer_partners.forEach(p => { p.is_connected = false; });
            }
        }
        await shop.save();
        return { 
            success: true, 
            message: 'Đã ngắt kết nối xưởng in.',
            printers: (shop.printer_partners || []).filter(p => p.is_connected)
        };
    }
}
