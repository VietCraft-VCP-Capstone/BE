import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../../../../app/config';
import { logger } from '../../../../shared/utils/logger';
import { User } from '../../../user/infrastructure/models/user.model';
import { Shop } from '../../../product/infrastructure/models/shop.model';

export class PrintingApiError extends Error {
    public statusCode?: number;
    public isRetryable: boolean;
    public details?: any;

    constructor(message: string, statusCode?: number, isRetryable = false, details?: any) {
        super(message);
        this.name = 'PrintingApiError';
        this.statusCode = statusCode;
        this.isRetryable = isRetryable;
        this.details = details;
    }
}

export class PrintingShopApiService {
    private client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: config.printerApiUrl || 'http://localhost:8880',
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': config.printerApiKey || '',
            },
        });

        // Request logger
        this.client.interceptors.request.use((reqConfig) => {
            logger.info(`[PRINTER API OUTBOUND] ${reqConfig.method?.toUpperCase()} ${reqConfig.baseURL}${reqConfig.url}`);
            return reqConfig;
        });
    }

    /**
     * Chuyển đổi dữ liệu đơn hàng thành payload JSON chuẩn của xưởng in và POST đi
     */
    async createFulfillmentOrder(order: any): Promise<{
        supplier_order_id: string;
        printer_id?: string;
        printer_name?: string;
        rawResponse: any;
    }> {
        const shop = order.shop_id ? await Shop.findById(order.shop_id).lean().catch(() => null) : null;
        const targetBaseUrl = (shop?.printer_partner?.is_connected && shop.printer_partner.api_url) 
            ? shop.printer_partner.api_url 
            : (config.printerApiUrl || 'http://localhost:8880');
        const targetApiKey = (shop?.printer_partner?.is_connected && shop.printer_partner.api_key)
            ? shop.printer_partner.api_key
            : (config.printerApiKey || '');

        if (!targetBaseUrl) {
            throw new PrintingApiError('Địa chỉ xưởng in (PRINTER_API_URL) chưa được cấu hình', undefined, false);
        }

        const buyer = await User.findById(order.buyer_id).select('full_name email').lean().catch(() => null);

        const items = (order.items || []).map((it: any) => {
            let meta: any = {};
            try {
                if (it.custom_notes) meta = JSON.parse(it.custom_notes);
            } catch {
                // ignore parsing failure
            }

            const targetSku = it.provider_sku || meta.sku || it.sku || '';

            return {
                sku: targetSku,
                title: it.title,
                color: it.color,
                size: it.size,
                quantity: Number(it.quantity) || 1,
                blank_id: meta.blank_id || it.blank_id,
                artwork_url: it.design_file_url || it.image,
                design_options: meta.design_options || { scale: 100, rotation: 0, align: 'center' },
            };
        });

        const payload = {
            vietcraft_order_id: order._id ? order._id.toString() : order.id,
            order_code: order.order_code,
            shop_id: order.shop_id ? order.shop_id.toString() : undefined,
            shop_name: shop?.shop_name || 'VietCraft Shop',
            seller_id: shop?.owner_id ? shop.owner_id.toString() : undefined,
            buyer_name: (buyer as any)?.full_name || (buyer as any)?.email || order.shipping_address?.recipient_name || 'Khách hàng VietCraft',
            recipient_phone: order.shipping_address?.phone || '',
            shipping_address: order.shipping_address,
            items,
        };

        try {
            logger.info(`[PRINTER DISPATCH] Gửi đơn ${order.order_code} tới ${targetBaseUrl}/api/orders`);
            const res = await axios.post(`${targetBaseUrl}/api/orders`, payload, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json',
                    ...(targetApiKey ? { 'X-API-Key': targetApiKey } : {})
                }
            });
            const data = res.data;

            // Xưởng trả về newPrintOrder hoặc object có _id / supplier_order_id
            const supplierOrderId = data?.supplier_order_id || data?.order?._id || data?._id || '';

            logger.info(`[PRINTER API SUCCESS] Đã gửi đơn ${order.order_code} sang xưởng in (${targetBaseUrl}). Supplier Order ID: ${supplierOrderId}`);
            return {
                supplier_order_id: String(supplierOrderId),
                printer_id: shop?.printer_partner?.printer_id,
                printer_name: shop?.printer_partner?.printer_name || 'Xưởng in VietCraft Partner',
                rawResponse: data,
            };
        } catch (err: any) {
            if (axios.isAxiosError(err)) {
                const axiosErr = err as AxiosError<any>;
                const status = axiosErr.response?.status;
                const errorData = axiosErr.response?.data;
                const errorMsg = errorData?.error || errorData?.message || axiosErr.message;

                // 4xx: Bad Request, Missing DPI, Invalid format -> Không retry
                if (status && status >= 400 && status < 500) {
                    logger.error(`[PRINTER API 4xx ERROR] Status ${status}: ${errorMsg}`);
                    throw new PrintingApiError(`Xưởng từ chối đơn (${status}): ${errorMsg}`, status, false, errorData);
                }

                // 5xx hoặc Network Error / Timeout -> Retryable
                logger.warn(`[PRINTER API 5xx/NETWORK ERROR] Status ${status || 'TIMEOUT'}: ${errorMsg}. Cần retry.`);
                throw new PrintingApiError(`Lỗi kết nối xưởng (${status || 'NETWORK'}): ${errorMsg}`, status, true, errorData);
            }

            throw new PrintingApiError(`Lỗi không xác định khi gọi xưởng in: ${err?.message || err}`, undefined, true);
        }
    }

    /**
     * Lấy phí vận chuyển thời gian thực từ xưởng in hoặc nhà cung cấp
     */
    async getShippingRates(address: {
        province_id?: string;
        district_id?: string;
        ward_code?: string;
        address_detail?: string;
    }): Promise<{ standard_fee: number; fast_fee?: number; carrier?: string }> {
        try {
            const res = await this.client.post('/api/shipping/rates', { address });
            return res.data;
        } catch (err: any) {
            logger.warn(`[PRINTER SHIPPING RATES] Không lấy được phí ship từ xưởng, sử dụng phí ship mặc định: ${err?.message}`);
            // Fallback sang phí ship chuẩn nội thành / liên tỉnh
            return {
                standard_fee: 30000,
                fast_fee: 45000,
                carrier: 'GHN'
            };
        }
    }
}

export const printingShopApiService = new PrintingShopApiService();
