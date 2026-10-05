import { Order } from '../infrastructure/models/order.model';
import { ReturnRequestV3, ReturnExchangeQuotaV3, RETURN_REQUEST_V3_ACTIVE_STATUSES } from '../infrastructure/models/return-request-v3.model';
import type { ReturnEligibilityItemSource } from './return-request.service';

export const eligibilityItemSource: ReturnEligibilityItemSource = {
    async getItems(orderId) {
        const order=await Order.findById(orderId).lean(); if(!order) return [];
        return Promise.all((order.items||[]).map(async(item:any)=>{
            const orderItemId=item.order_item_id ? String(item.order_item_id) : null;
            const activeReservedQuantity=orderItemId ? await ReturnRequestV3.aggregate([{ $match:{order_item_id:orderItemId,status:{$in:[...RETURN_REQUEST_V3_ACTIVE_STATUSES]}} },{ $group:{_id:null,total:{$sum:'$quantity'}} }]).then(rows=>Number(rows[0]?.total)||0) : 0;
            const quota=orderItemId ? await ReturnExchangeQuotaV3.countDocuments({order_item_id:orderItemId}) : 0;
            return {orderItemId,buyerId:String(order.buyer_id),cohort:order.is_pod||order.order_type==='POD'?'POD' as const:'NORMAL' as const,itemStatus:String(order.order_status).toUpperCase()==='DELIVERED'?'DELIVERED' as const:String(order.order_status).toUpperCase()==='SHIPPING'?'SHIPPING' as const:'OTHER' as const,orderedQuantity:Number(item.quantity)||0,replacedQuantity:quota?Number(item.quantity)||0:0,refundedQuantity:0,activeReservedQuantity};
        }));
    }
};
