import { evaluatePodEligibility } from './return-policy';
import type { DeliveredEventSourceV3, ReturnEligibilityItem, ReturnEligibilityItemSource, ReturnRequestClock } from './return-request.service';
import type { ReturnRequestV3Repository } from '../infrastructure/repositories/return-request-v3.repository';

export async function evaluateBuyerReturnEligibility(input:{actorId:string;orderId:string;source:ReturnEligibilityItemSource;repository:ReturnRequestV3Repository;deliveredEventSource:DeliveredEventSourceV3;clock:ReturnRequestClock;r06DeliveredWindowHours?:number}):Promise<ReturnEligibilityItem[]> {
    const rows=await input.source.getItems(input.orderId);
    if(!rows.length || rows.some(row=>row.buyerId!==input.actorId)) throw Object.assign(new Error('Buyer does not own this order.'),{statusCode:403});
    const activeRequests=await input.repository.listActiveByOrder(input.orderId);
    return Promise.all(rows.map(async row=>{
        const itemId=row.orderItemId||null;
        const active=itemId?activeRequests.find(request=>request.order_item_id===itemId):undefined;
        const remaining=Math.max(0,row.orderedQuantity-row.replacedQuantity-row.refundedQuantity-row.activeReservedQuantity);
        let deadline:Date|null=null;
        let policyKind:string|undefined;
        if(itemId&&row.itemStatus==='DELIVERED'&&row.cohort==='POD'){
            try{
                const delivered=await input.deliveredEventSource.getVerifiedDeliveredEvent(input.orderId,itemId);
                const result=evaluatePodEligibility({reasonCode:'R02',now:input.clock.now(),deliveredEvent:delivered,r06DeliveredWindowHours:input.r06DeliveredWindowHours});
                policyKind=result.kind;
                if(result.kind==='ELIGIBLE'||result.kind==='EXPIRED') deadline=result.deadline;
            }catch{policyKind='ADMIN_REVIEW';}
        }
        let reasonIfNot:ReturnEligibilityItem['reasonIfNot']=null;
        if(!itemId) reasonIfNot={code:'MISSING_ORDER_ITEM_ID',label:'Thiếu mã order_item_id'};
        else if(row.cohort==='NORMAL') reasonIfNot={code:'NORMAL_UNSUPPORTED',label:'Sản phẩm thường chưa hỗ trợ'};
        else if(active) reasonIfNot={code:'ACTIVE_REQUEST',label:'Đã có yêu cầu đang xử lý'};
        else if(remaining<=0) reasonIfNot={code:'QUANTITY_EXHAUSTED',label:'Đã dùng hết số lượng'};
        else if(row.itemStatus!=='DELIVERED') reasonIfNot={code:'NOT_DELIVERED',label:'Chưa giao'};
        else if(policyKind==='EXPIRED') reasonIfNot={code:'EXPIRED',label:'Đã quá hạn'};
        else if(policyKind!=='ELIGIBLE') reasonIfNot={code:'NOT_DELIVERED',label:'Chưa có dữ liệu giao hàng hợp lệ'};
        return {orderItemId:itemId,eligible:!reasonIfNot,reasonIfNot,deadline:deadline&&Number.isFinite(deadline.getTime())?deadline:null,remainingQuantity:remaining,...(active?{activeRequestId:active.id}:{})};
    }));
}
