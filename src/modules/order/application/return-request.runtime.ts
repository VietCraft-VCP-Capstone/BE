import crypto from 'crypto';
import { Order } from '../infrastructure/models/order.model';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { ReturnRequestV3, RETURN_REQUEST_V3_ACTIVE_STATUSES } from '../infrastructure/models/return-request-v3.model';
import { MongoReturnRequestV3Repository } from '../infrastructure/repositories/return-request-v3.repository';
import { MongooseReturnRefundExecutionRepository } from '../infrastructure/services/return-refund-execution.repository';
import { createLinkedRefundExecution } from './return-refund-bridge.service';
import { OrderStatusSimulationDeliveredEventSource } from './order-status-simulator-delivered-event-source';
import type { DeliveredEventSourceV3, OrderReturnSnapshotSource, ReturnRequestClock, ReturnRequestRefundBridge } from './return-request.service';
import { ReturnRequestApplicationService } from './return-request.service';
import { eligibilityItemSource } from './return-eligibility-source';

export function isDevOrderSimulationEnabled(env: NodeJS.ProcessEnv = process.env): boolean { return env.NODE_ENV==='development' && env.ENABLE_DEV_ORDER_SIMULATION==='true'; }
export function createReturnClock(realClock: ReturnRequestClock, env: NodeJS.ProcessEnv = process.env): ReturnRequestClock {
    if (!isDevOrderSimulationEnabled(env)) return realClock;
    const offset=Number(env.DEV_CLOCK_OFFSET_HOURS || 0); const milliseconds=Number.isFinite(offset)?offset*60*60*1000:0;
    return { now:()=>new Date(realClock.now().getTime()+milliseconds) };
}

const noDeliveredEvents: DeliveredEventSourceV3 = { async getVerifiedDeliveredEvent(){ return null; } };
const snapshotSource: OrderReturnSnapshotSource = {
    async getSnapshot(orderId,itemId) {
        const order=await Order.findOne({ $or:[{_id:orderId},{order_code:orderId}] }).lean(); if(!order) return null;
        const item=(order.items||[]).find((row:any)=>String(row.order_item_id||row._id||'')===itemId); if(!item) return null;
        const shop=await Shop.findById(order.shop_id).select('owner_id printer_partner.printer_id').lean();
        const status=String(order.order_status).toUpperCase();
        return { orderId:String(order._id),orderItemId:itemId,buyerId:String(order.buyer_id),sellerId:String(shop?.owner_id||''),printerId:String((order as any).printer_info?.printer_id||shop?.printer_partner?.printer_id||''),cohort:order.is_pod||order.order_type==='POD'?'POD' as const:'NORMAL' as const,itemStatus:status==='DELIVERED'?'DELIVERED' as const:status==='SHIPPING'?'SHIPPING' as const:'OTHER' as const,itemSnapshot:(item.item_snapshot||{title:item.title,color:item.color,size:item.size,image:item.image,design_file_url:item.design_file_url}) as Record<string,unknown>,valid:true,orderedQuantity:Number(item.quantity)||1,replacedQuantity:0,refundedQuantity:0,activeReservedQuantity:await ReturnRequestV3.countDocuments({order_item_id:itemId,status:{$in:[...RETURN_REQUEST_V3_ACTIVE_STATUSES]}}),policyVersion:'pod-v1',schemaVersion:'v3',is_simulated:order.is_simulated===true };
    }
};

export function createReturnRequestService(realClock: ReturnRequestClock = { now:()=>new Date() }, env: NodeJS.ProcessEnv = process.env): ReturnRequestApplicationService {
    const enabled=isDevOrderSimulationEnabled(env);
    const bridgeRepository=new MongooseReturnRefundExecutionRepository();
    const bridge: ReturnRequestRefundBridge={ async createLinkedRefund(input){ return createLinkedRefundExecution(bridgeRepository,input); } };
    return new ReturnRequestApplicationService({ repository:new MongoReturnRequestV3Repository(),snapshotSource,eligibilityItemSource,deliveredEventSource:enabled?new OrderStatusSimulationDeliveredEventSource(true):noDeliveredEvents,bridge,clock:createReturnClock(realClock,env),id:()=>crypto.randomUUID() });
}
