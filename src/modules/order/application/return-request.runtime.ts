import crypto from 'crypto';
import mongoose from 'mongoose';
import { Order } from '../infrastructure/models/order.model';
import { createBuyerOrderIdResolver } from './buyer-order-id-resolver';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { MongoReturnRequestRepository } from '../infrastructure/repositories/return-request.repository';
import { MongooseReturnRefundExecutionRepository } from '../infrastructure/services/return-refund-execution.repository';
import { createLinkedRefundExecution } from './return-refund-bridge.service';
import { OrderDeliveredEventSource } from './order-delivered-event-source';
import type { OrderReturnSnapshotSource, ReturnRequestClock, ReturnRequestRefundBridge } from './return-request.service';
import { ReturnRequestApplicationService } from './return-request.service';
import { createReturnEligibilityItemSource } from './return-eligibility-source';
import { getOrderItemReturnQuantityUsage } from './return-quantity-source';
import { buildReturnItemSnapshot } from './return-item-snapshot';
import { executeReturnRefund } from './return-refund-executor';

export function isDevOrderSimulationEnabled(env: NodeJS.ProcessEnv = process.env): boolean { return env.NODE_ENV==='development' && env.ENABLE_DEV_ORDER_SIMULATION==='true'; }
export function createReturnClock(realClock: ReturnRequestClock, env: NodeJS.ProcessEnv = process.env): ReturnRequestClock {
    if (!isDevOrderSimulationEnabled(env)) return realClock;
    const offset=Number(env.DEV_CLOCK_OFFSET_HOURS || 0); const milliseconds=Number.isFinite(offset)?offset*60*60*1000:0;
    return { now:()=>new Date(realClock.now().getTime()+milliseconds) };
}

const resolveBuyerOrderId = createBuyerOrderIdResolver({
    async byId(orderId,buyerId) {
        const order=await Order.findOne({ _id:new mongoose.Types.ObjectId(orderId),buyer_id:buyerId }).select('_id').lean();
        return order?String(order._id):null;
    },
    async byOrderCode(orderCode,buyerId) {
        const order=await Order.findOne({ order_code:orderCode,buyer_id:buyerId }).select('_id').lean();
        return order?String(order._id):null;
    },
});
export function createOrderReturnSnapshotSource(allowSimulated = false, env: NodeJS.ProcessEnv = process.env): OrderReturnSnapshotSource {
    return {
    async getSnapshot(orderId,itemId) {
        if(!mongoose.Types.ObjectId.isValid(orderId)) return null;
        const order=await Order.findOne({ _id:new mongoose.Types.ObjectId(orderId) }).lean(); if(!order || (!allowSimulated && order.is_simulated===true)) return null;
        const item=(order.items||[]).find((row:any)=>String(row.order_item_id||row._id||'')===itemId); if(!item) return null;
        let shop=await Shop.findById(order.shop_id).select('owner_id printer_partner.printer_id').lean();
        if(!shop && (order as any).simulation_source_id) {
            const sourceOrder = await Order.findById((order as any).simulation_source_id).select('shop_id printer_info').lean();
            if(sourceOrder?.shop_id) {
                shop = await Shop.findById(sourceOrder.shop_id).select('owner_id printer_partner.printer_id').lean();
            }
        }
        const status=String(order.order_status).toUpperCase();
        const sellerId = String(shop?.owner_id || order.shop_id || 'SELLER_DEFAULT');
        const printerId = String((order as any).printer_info?.printer_id || shop?.printer_partner?.printer_id || env.PRINTER_REFUND_PRINTER_ID || 'PRINTER_SHOP');
        const [usage, snapshot] = await Promise.all([getOrderItemReturnQuantityUsage(order,itemId,Number(item.quantity)||0), Promise.resolve(buildReturnItemSnapshot(order,item))]);
        return { orderId:String(order._id),orderItemId:itemId,buyerId:String(order.buyer_id),sellerId,printerId,cohort:order.is_pod||order.order_type==='POD'?'POD' as const:'NORMAL' as const,itemStatus:status==='DELIVERED'?'DELIVERED' as const:status==='SHIPPING'?'SHIPPING' as const:'OTHER' as const,itemSnapshot:snapshot.snapshot,valid:snapshot.valid,orderedQuantity:Number(item.quantity)||0,...usage,policyVersion:'pod-v1',schemaVersion:'v3',is_simulated:order.is_simulated===true };
    }
    };
}

export function createReturnRequestService(realClock: ReturnRequestClock = { now:()=>new Date() }, env: NodeJS.ProcessEnv = process.env): ReturnRequestApplicationService {
    const enabled=isDevOrderSimulationEnabled(env);
    const bridgeRepository=new MongooseReturnRefundExecutionRepository();
    const bridge: ReturnRequestRefundBridge={ async createLinkedRefund(input){ return createLinkedRefundExecution(bridgeRepository,input); } };
    return new ReturnRequestApplicationService({ repository:new MongoReturnRequestRepository(),snapshotSource:createOrderReturnSnapshotSource(enabled,env),eligibilityItemSource:createReturnEligibilityItemSource(enabled),resolveBuyerOrderId,deliveredEventSource:new OrderDeliveredEventSource(enabled),bridge,executeRefund:executeReturnRefund,clock:createReturnClock(realClock,env),id:()=>crypto.randomUUID() });
}
