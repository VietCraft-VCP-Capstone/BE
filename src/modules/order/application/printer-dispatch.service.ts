import { config } from '../../../app/config';
import { User } from '../../user/infrastructure/models/user.model';

// Đẩy đơn đã thanh toán sang hệ Printer (webhook POST /api/orders). Idempotent bên Printer (dedupe order_code).
// ponytail: fetch native + 1 lần retry. Đủ cho MVP; hàng đợi/outbox khi cần đảm bảo giao chắc.
export async function dispatchToPrinter(order: any): Promise<void> {
    const buyer = await User.findById(order.buyer_id).lean().catch(() => null);

    const items = (order.items || []).map((it: any) => {
        let meta: any = {};
        try { meta = it.custom_notes ? JSON.parse(it.custom_notes) : {}; } catch { /* ignore */ }
        return {
            sku: meta.sku || '',
            title: it.title,
            color: it.color,
            size: it.size,
            quantity: it.quantity,
            artwork_url: it.design_file_url,
            design_options: meta.design_options || { scale: 1, rotation: 0, align: 'center' },
        };
    });

    const payload = {
        vietcraft_order_id: order._id.toString(),
        order_code: order.order_code,
        buyer_name: (buyer as any)?.name || 'Khách hàng',
        recipient_phone: order.shipping_address?.phone || '',
        shipping_address: order.shipping_address,
        items,
    };

    const url = `${config.printerApiUrl}/api/orders`;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) throw new Error(`Printer trả về ${res.status}`);
            console.log(`[DISPATCH] Đã gửi đơn ${order.order_code} sang xưởng in.`);
            return;
        } catch (err: any) {
            if (attempt === 2) throw err;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}
