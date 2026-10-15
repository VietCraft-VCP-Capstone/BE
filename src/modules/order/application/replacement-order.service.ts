import mongoose from 'mongoose';
import crypto from 'crypto';
import { Order } from '../infrastructure/models/order.model';
import { ReturnRequestV3, ReturnRequestLogV3 } from '../infrastructure/models/return-request-v3.model';
import { printingShopApiService } from '../infrastructure/services/printing-shop-api.service';
import { logger } from '../../../shared/utils/logger';

export class ReplacementOrderService {
    /**
     * Tự động khởi tạo đơn in bù 0đ và gửi sang xưởng in gia công
     */
    static async createAndDispatchReplacement(requestId: string): Promise<{
        replacementOrderId: string;
        replacementOrderCode: string;
        dispatchedToPrinter: boolean;
    }> {
        // 1. Tìm yêu cầu đổi trả V3
        const v3Doc: any = await ReturnRequestV3.findOne({
            $or: [{ _id: requestId }, { id: requestId }]
        });

        if (!v3Doc) {
            throw new Error(`Không tìm thấy yêu cầu đổi/trả với mã: ${requestId}`);
        }

        // Nếu đã có đơn in bù trước đó, tránh tạo lặp
        if (v3Doc.replacement_order_id && v3Doc.replacement_order_code) {
            return {
                replacementOrderId: String(v3Doc.replacement_order_id),
                replacementOrderCode: String(v3Doc.replacement_order_code),
                dispatchedToPrinter: true,
            };
        }

        // 2. Tìm đơn hàng gốc
        let parentOrder: any = null;
        if (mongoose.Types.ObjectId.isValid(v3Doc.order_id)) {
            parentOrder = await Order.findById(v3Doc.order_id);
        }
        if (!parentOrder) {
            parentOrder = await Order.findOne({ order_code: v3Doc.order_id });
        }

        const parentOrderCode = parentOrder?.order_code || v3Doc.order_id;
        const shortSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
        const cleanParentCode = String(parentOrderCode).replace(/^REPLACE-/, '');
        const replacementOrderCode = `REPLACE-${cleanParentCode}-${shortSuffix}`;

        // 3. Chuẩn bị thông tin sản phẩm in bù
        const targetItem = parentOrder?.items?.find((it: any) =>
            it.order_item_id === v3Doc.order_item_id || String(it._id) === v3Doc.order_item_id
        );
        const itemSnapshot = v3Doc.item_snapshot || {};
        const quantity = Number(v3Doc.quantity) || 1;

        const zeroDecimal = mongoose.Types.Decimal128.fromString('0');

        const replacementItem = {
            order_item_id: crypto.randomUUID(),
            item_snapshot: itemSnapshot,
            product_id: targetItem?.product_id || (mongoose.Types.ObjectId.isValid(itemSnapshot.product_id) ? new mongoose.Types.ObjectId(itemSnapshot.product_id) : new mongoose.Types.ObjectId()),
            variant_id: targetItem?.variant_id || (mongoose.Types.ObjectId.isValid(itemSnapshot.variant_id) ? new mongoose.Types.ObjectId(itemSnapshot.variant_id) : new mongoose.Types.ObjectId()),
            title: `[IN BÙ] ${targetItem?.title || itemSnapshot.title || 'Sản phẩm in ấn theo yêu cầu'}`,
            color: targetItem?.color || itemSnapshot.color || 'Trắng',
            size: targetItem?.size || itemSnapshot.size || 'M',
            quantity,
            base_cost: zeroDecimal,
            retail_price: zeroDecimal,
            image: targetItem?.image || itemSnapshot.image || '/image-not-found.jpg',
            design_file_url: targetItem?.design_file_url || itemSnapshot.design_file_url,
            custom_notes: targetItem?.custom_notes || itemSnapshot.custom_notes,
            provider_sku: targetItem?.provider_sku || itemSnapshot.sku,
        };

        const shippingAddress = parentOrder?.shipping_address || {
            recipient_name: 'Khách hàng VietCraft',
            phone: '0901234567',
            address_detail: 'Địa chỉ nhận hàng',
            province_id: '79',
            district_id: '760',
            ward_code: '26734',
        };

        const financialBreakdown = {
            subtotal: zeroDecimal,
            shipping_fee: zeroDecimal,
            coupon_discount: zeroDecimal,
            platform_fee: zeroDecimal,
            seller_payout_amount: zeroDecimal,
        };

        // 4. Tạo document đơn hàng in bù 0đ
        const buyerId = parentOrder?.buyer_id || (mongoose.Types.ObjectId.isValid(v3Doc.buyer_id) ? new mongoose.Types.ObjectId(v3Doc.buyer_id) : new mongoose.Types.ObjectId());
        const shopId = parentOrder?.shop_id || (mongoose.Types.ObjectId.isValid(v3Doc.seller_id) ? new mongoose.Types.ObjectId(v3Doc.seller_id) : new mongoose.Types.ObjectId());

        const replacementOrder = await Order.create({
            buyer_id: buyerId,
            shop_id: shopId,
            order_code: replacementOrderCode,
            payment_method: parentOrder?.payment_method || 'VNPAY',
            payment_status: 'PAID',
            refund_status: 'NONE',
            order_status: 'PROCESSING',
            seller_approval_status: 'APPROVED',
            is_pod: true,
            order_type: 'POD',
            shipping_address: shippingAddress,
            shipping_details: {
                shipping_fee: zeroDecimal,
                carrier: 'GHTK',
                tracking_number: `VN${crypto.randomBytes(4).toString('hex').toUpperCase()}VN`,
            },
            items: [replacementItem],
            financial_breakdown: financialBreakdown,
            status_history: [{
                status: 'PROCESSING',
                changed_at: new Date(),
                note: `Đơn in bù 0đ tự động tạo từ yêu cầu đổi trả ${v3Doc.id || v3Doc._id}`,
            }],
            order_hour_of_week: new Date().getDay() * 24 + new Date().getHours(),
        });

        logger.info(`[REPLACEMENT ORDER CREATED] Đã tạo đơn in bù ${replacementOrder.order_code} (ID: ${replacementOrder._id})`);

        // 5. Gửi đơn sang xưởng in qua Printing Shop API
        let dispatched = false;
        try {
            const fulfillmentRes = await printingShopApiService.createFulfillmentOrder(replacementOrder);
            if (fulfillmentRes?.supplier_order_id) {
                replacementOrder.supplier_order_id = fulfillmentRes.supplier_order_id;
                replacementOrder.fulfillment_status = 'SUBMITTED';
                replacementOrder.printer_info = {
                    printer_id: fulfillmentRes.printer_id || v3Doc.printer_id,
                    printer_name: fulfillmentRes.printer_name,
                    supplier_order_id: fulfillmentRes.supplier_order_id,
                    dispatched_at: new Date(),
                    printer_status: 'RECEIVED',
                };
                await replacementOrder.save();
                dispatched = true;
                logger.info(`[REPLACEMENT DISPATCHED] Đã dispatch đơn in bù ${replacementOrder.order_code} sang xưởng in`);
            }
        } catch (dispatchErr: any) {
            logger.warn(`[REPLACEMENT DISPATCH WARNING] Gửi đơn in bù sang xưởng in thất bại: ${dispatchErr.message}`);
        }

        // 6. Cập nhật trạng thái ReturnRequestV3 sang REPLACEMENT_CREATED
        const repOrderIdStr = String(replacementOrder._id);
        await ReturnRequestV3.updateOne(
            { _id: v3Doc._id },
            {
                $set: {
                    status: 'REPLACEMENT_CREATED',
                    replacement_order_id: repOrderIdStr,
                    replacement_order_code: replacementOrder.order_code,
                    exchange_quota_consumed: true,
                    side_effect_started: true,
                    updated_at: new Date(),
                }
            }
        );

        // 7. Ghi nhận audit trail vào return_request_logs_v3
        await ReturnRequestLogV3.create({
            request_id: String(v3Doc.id || v3Doc._id),
            actor_id: 'SYSTEM',
            actor_role: 'SYSTEM',
            acting_as: 'PRINTER',
            from_status: v3Doc.status,
            to_status: 'REPLACEMENT_CREATED',
            reason: `Đã tự động khởi tạo đơn in bù 0đ mã #${replacementOrderCode} và gửi lệnh sản xuất sang xưởng in.`,
            event_id: repOrderIdStr,
            created_at: new Date(),
        });

        return {
            replacementOrderId: repOrderIdStr,
            replacementOrderCode: replacementOrder.order_code,
            dispatchedToPrinter: dispatched,
        };
    }
}
