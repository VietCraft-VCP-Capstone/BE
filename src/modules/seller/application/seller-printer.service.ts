import mongoose from 'mongoose';
import { Shop, IPrinterPartner } from '../../product/infrastructure/models/shop.model';
import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';

export interface PrinterConnectionInput {
    printer_name: string;
    api_url: string;
    api_key?: string;
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
        return {
            printer: shop.printer_partner || {
                printer_name: 'Xưởng in VietCraft Partner',
                api_url: config.printerApiUrl || 'http://localhost:8880',
                is_connected: false,
                auto_approve: false
            },
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
     */
    static async connectPrinter(ownerId: string, input: PrinterConnectionInput): Promise<IPrinterPartner> {
        const shop = await this.findShop(ownerId);
        const cleanUrl = String(input.api_url || '').trim().replace(/\/+$/, '');

        // Test kết nối trước khi lưu
        const testResult = await this.testConnection(cleanUrl, input.api_key);
        if (!testResult.success) {
            throw new Error(`Kiểm tra kết nối thất bại: ${testResult.message}`);
        }

        const printerData: IPrinterPartner = {
            printer_name: input.printer_name?.trim() || 'Xưởng in đối tác',
            api_url: cleanUrl,
            api_key: input.api_key?.trim() || '',
            webhook_secret: input.webhook_secret?.trim() || config.printerWebhookSecret || '',
            is_connected: true,
            connected_at: new Date(),
            auto_approve: Boolean(input.auto_approve)
        };

        shop.printer_partner = printerData;
        await shop.save();

        logger.info(`[SELLER PRINTER CONNECTED] Shop ${shop.shop_name} đã liên kết thành công với xưởng in: ${cleanUrl}`);
        return shop.printer_partner;
    }

    /**
     * Ngắt kết nối xưởng in
     */
    static async disconnectPrinter(ownerId: string) {
        const shop = await this.findShop(ownerId);
        if (shop.printer_partner) {
            shop.printer_partner.is_connected = false;
            await shop.save();
        }
        return { success: true, message: 'Đã ngắt kết nối với xưởng in.' };
    }
}
