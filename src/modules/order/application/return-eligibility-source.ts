import { Order } from '../infrastructure/models/order.model';
import type { ReturnEligibilityItemSource } from './return-request.service';
import { getOrderItemReturnQuantityUsage } from './return-quantity-source';

export function createReturnEligibilityItemSource(allowSimulated = false): ReturnEligibilityItemSource {
    return {
    async getItems(orderId) {
        const order=await Order.findById(orderId).lean(); if(!order || (!allowSimulated && order.is_simulated===true)) return [];
        return Promise.all((order.items||[]).map(async(item:any)=>{
            const orderItemId=item.order_item_id ? String(item.order_item_id) : null;
            const usage=orderItemId ? await getOrderItemReturnQuantityUsage(order,orderItemId,Number(item.quantity)||0) : {replacedQuantity:0,refundedQuantity:0,activeReservedQuantity:0};
            return {orderItemId,buyerId:String(order.buyer_id),cohort:order.is_pod||order.order_type==='POD'?'POD' as const:'NORMAL' as const,itemStatus:String(order.order_status).toUpperCase()==='DELIVERED'?'DELIVERED' as const:String(order.order_status).toUpperCase()==='SHIPPING'?'SHIPPING' as const:'OTHER' as const,orderedQuantity:Number(item.quantity)||0,...usage};
        }));
    }
    };
}

export const eligibilityItemSource = createReturnEligibilityItemSource();
