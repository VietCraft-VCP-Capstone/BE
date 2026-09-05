import { config } from '../../../app/config';
import { logger } from '../../../shared/utils/logger';
import { User } from '../../user/infrastructure/models/user.model';


const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1000;
const TIMEOUT_MS = 5000;

class PrinterClientError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PrinterClientError';
    }
}

export async function dispatchToPrinter(order: any): Promise<void> {
    if (!config.printerApiUrl) {
        logger.warn(`[DISPATCH] PRINTER_API_URL chưa cấu hình — bỏ qua đơn ${order.order_code}.`);
        return;
    }

    const buyer = await User.findById(order.buyer_id).select('full_name').lean().catch(() => null);

    const items = (order.items || []).map((it: any) => {
        let meta: any = {};
        try { meta = it.custom_notes ? JSON.parse(it.custom_notes) : {}; } catch { /* ignore */ }
        return {
            sku: meta.sku || '',
            title: it.title,
            color: it.color,
            size: it.size,
            quantity: it.quantity,
            blank_id: meta.blank_id,
            artwork_url: it.design_file_url,
            design_options: meta.design_options || { scale: 1, rotation: 0, align: 'center' },
        };
    });

    const payload = {
        vietcraft_order_id: order._id.toString(),
        order_code: order.order_code,
        buyer_name: (buyer as any)?.full_name || 'Khách hàng',
        recipient_phone: order.shipping_address?.phone || '',
        shipping_address: order.shipping_address,
        items,
    };

    const url = `${config.printerApiUrl}/api/orders`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!res.ok) {
                const detail = await res.text().catch(() => '');
                const message = `Printer trả về ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`;
                if (res.status >= 400 && res.status < 500) throw new PrinterClientError(message);
                throw new Error(message);
            }
            logger.info(`[DISPATCH] Đã gửi đơn ${order.order_code} sang xưởng in.`);
            return;
        } catch (err: any) {
            // 4xx: payload sai, retry cũng hỏng → ném luôn.
            if (err instanceof PrinterClientError || attempt === MAX_ATTEMPTS) throw err;
            logger.warn(`[DISPATCH] Gửi đơn ${order.order_code} lỗi (lần ${attempt}/${MAX_ATTEMPTS}): ${err?.message || err}. Thử lại...`);
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
    }
}
