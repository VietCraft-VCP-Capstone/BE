import mongoose from 'mongoose';
import { Order } from '../../order/infrastructure/models/order.model';

const REFUNDED_RETURN = {
    $and: [
        { $eq: ['$status', 'COMPLETED'] },
        { $eq: [{ $ifNull: ['$final_resolution', '$requested_resolution'] }, 'REFUND'] },
    ],
};

/** Đã bán = số lượng trong đơn DELIVERED, trừ món đã hoàn tiền; món được đổi vẫn tính. */
export async function getSoldCounts(productIds: (string | mongoose.Types.ObjectId)[]): Promise<Map<string, number>> {
    const ids = productIds.filter(id => mongoose.Types.ObjectId.isValid(String(id))).map(id => new mongoose.Types.ObjectId(String(id)));
    if (ids.length === 0) return new Map();

    const rows = await Order.aggregate([
        { $match: { order_status: 'DELIVERED', refund_status: { $ne: 'REFUNDED' }, 'items.product_id': { $in: ids } } },
        { $unwind: '$items' },
        { $match: { 'items.product_id': { $in: ids } } },
        {
            $lookup: {
                from: 'return_requests',
                let: { oid: { $toString: '$_id' }, iid: '$items.order_item_id' },
                pipeline: [
                    { $match: { $expr: { $and: [{ $eq: ['$order_id', '$$oid'] }, { $eq: ['$order_item_id', '$$iid'] }, REFUNDED_RETURN] } } },
                    { $group: { _id: null, qty: { $sum: '$quantity' } } },
                ],
                as: '_refunded',
            },
        },
        {
            $group: {
                _id: '$items.product_id',
                sold: { $sum: { $max: [0, { $subtract: ['$items.quantity', { $ifNull: [{ $first: '$_refunded.qty' }, 0] }] }] } },
            },
        },
    ]);
    return new Map(rows.map((r: any) => [String(r._id), r.sold]));
}
