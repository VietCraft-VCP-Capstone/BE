import { Router, type RequestHandler } from 'express';
import type { AuthenticatedRequest } from '../../../app/middleware/auth.middleware';
import type { ReturnRequestApplicationService, ReturnRequestClock } from '../application/return-request.service';
import type { ReturnRequestV3ActorRole } from '../infrastructure/repositories/return-request-v3.repository';
import type { ReturnActor } from '../application/return-state-machine';
import type { ReturnEvidenceItem } from '../application/return-evidence-policy';
import { validateRefundEvidence } from '../application/refund-evidence-policy';

export interface ReturnRequestRouteDependencies {
    service: ReturnRequestApplicationService;
    authenticate: RequestHandler;
    clock: ReturnRequestClock;
}

const enabledDev = () => process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_ORDER_SIMULATION === 'true';
const roleMap: Record<string, ReturnActor> = { buyer:'BUYER', seller:'SELLER', printer:'PRINTER', admin:'ADMIN' };
const asyncRoute = (handler: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: (error?: unknown) => void) => { void handler(req,res).catch(next); };
function validateUploadedReferences(items: readonly ReturnEvidenceItem[], reason: string, description: string): void {
    validateRefundEvidence(reason,description,items.map(item=>item.uri));
    for(const item of items) if(item.kind==='IMAGE'?!/\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(item.uri):!/\.(mp4|webm|mov)(\?|#|$)/i.test(item.uri)) throw new Error('Evidence kind must match the uploaded file type.');
}
async function validateRequestEvidence(service: ReturnRequestApplicationService, actorId: string, role: ReturnActor, requestId: string, evidence?: readonly ReturnEvidenceItem[]): Promise<void> {
    if(!evidence?.length) return;
    const detail=await service.getRequestDetail(actorId,role,requestId);
    if(!detail) throw Object.assign(new Error('Return request not found.'),{statusCode:404});
    validateUploadedReferences(evidence,detail.request.reason_code,detail.request.reason_description);
}
const sendError = (res: any, error: any) => res.status(error?.statusCode || (/not found/i.test(error?.message) ? 404 : /actor cannot|ownership|assigned printer required|only assigned|cannot perform|cannot view/i.test(error?.message) ? 403 : 400)).json({ error:error?.message || 'Return request failed.' });

export function createReturnRequestRouter({ service, authenticate, clock }: ReturnRequestRouteDependencies) {
    const router=Router();
    router.use(authenticate);
    router.get('/eligibility', asyncRoute(async(req,res)=>{
        if(String(req.user?.role||'').toLowerCase()!=='buyer') return res.status(req.user?403:401).json({error:'Buyer role required.'});
        if(typeof req.query.orderId!=='string'||!req.query.orderId.trim()) return res.status(400).json({error:'orderId is required.'});
        const data=await service.evaluateBuyerEligibility(req.user.id,req.query.orderId.trim()); return res.json({data:{items:data}});
    }));
    router.get('/requests', asyncRoute(async(req,res)=>{
        const role=roleMap[String(req.user?.role||'').toLowerCase()] as ReturnRequestV3ActorRole|undefined;
        if(!role) return res.status(req.user?403:401).json({error:'Buyer, Seller, Printer or Admin role required.'});
        const result=await service.listRequests({role,actorId:req.user.id,status:typeof req.query.status==='string'?req.query.status:undefined,page:Number(req.query.page)||1,pageSize:Number(req.query.pageSize)||20});
        return res.json({data:result});
    }));
    router.post('/requests', asyncRoute(async(req,res)=>{
        if(String(req.user?.role||'').toLowerCase()!=='buyer') return res.status(req.user?403:401).json({error:'Buyer role required.'});
        validateUploadedReferences(req.body?.evidence||[],req.body?.reasonCode,req.body?.description);
        const data=await service.createBuyerRequest({actorId:req.user.id,orderId:req.body?.orderId,orderItemId:req.body?.orderItemId,quantity:Number(req.body?.quantity),reasonCode:req.body?.reasonCode,description:req.body?.description,resolution:req.body?.resolution,evidence:req.body?.evidence||[]});
        return res.status(201).json({data});
    }));
    router.get('/requests/:id', asyncRoute(async(req,res)=>{
        const role=roleMap[String(req.user?.role||'').toLowerCase()]; if(!role) return res.status(req.user?403:401).json({error:'Unsupported role.'});
        const data=await service.getRequestDetail(req.user.id,role,req.params.id); return data?res.json({data}):res.status(404).json({error:'Return request not found.'});
    }));
    router.post('/requests/:id/printer-evidence-request', asyncRoute(async(req,res)=>{
        if(String(req.user?.role||'').toLowerCase()!=='printer') return res.status(req.user?403:401).json({error:'Printer role required.'});
        const data=await service.printerDecision({actorId:req.user.id,requestId:req.params.id,action:'REQUEST_EVIDENCE',reason:req.body?.reason}); return res.json({data});
    }));
    router.post('/requests/:id/evidence', asyncRoute(async(req,res)=>{
        const role=String(req.user?.role||'').toLowerCase(); const evidence=req.body?.evidence;
        if(!['buyer','seller','printer'].includes(role)) return res.status(req.user?403:401).json({error:'Evidence can be added by Buyer, Seller or Printer.'});
        if(!Array.isArray(evidence)) return res.status(400).json({error:'evidence must be an array of uploaded-file references.'});
        const actorRole=roleMap[role]; if(!actorRole) return res.status(403).json({error:'Unsupported role.'});
        const detail=await service.getRequestDetail(req.user.id,actorRole,req.params.id); if(!detail) return res.status(404).json({error:'Return request not found.'});
        validateUploadedReferences(evidence,detail.request.reason_code,detail.request.reason_description);
        const data=role==='buyer'?await service.buyerAddEvidence({actorId:req.user.id,requestId:req.params.id,evidence}):await service.addEvidence({actorId:req.user.id,requestId:req.params.id,role:role.toUpperCase() as 'SELLER'|'PRINTER',evidence});
        return res.json({data});
    }));
    router.post('/requests/:id/printer-decision', asyncRoute(async(req,res)=>{
        if(String(req.user?.role||'').toLowerCase()!=='printer') return res.status(req.user?403:401).json({error:'Printer role required.'});
        await validateRequestEvidence(service,req.user.id,'PRINTER',req.params.id,req.body?.evidence);
        const data=await service.printerDecision({actorId:req.user.id,requestId:req.params.id,action:req.body?.action,reason:req.body?.reason,proposedFault:req.body?.proposedFault,proposedClassification:req.body?.proposedClassification,evidence:req.body?.evidence}); return res.json({data});
    }));
    router.post('/requests/:id/dispute', asyncRoute(async(req,res)=>{
        if(String(req.user?.role||'').toLowerCase()!=='buyer') return res.status(req.user?403:401).json({error:'Buyer role required.'});
        await validateRequestEvidence(service,req.user.id,'BUYER',req.params.id,req.body?.evidence);
        const data=await service.buyerDispute({actorId:req.user.id,requestId:req.params.id,reason:req.body?.reason,evidence:req.body?.evidence}); return res.json({data});
    }));
    router.post('/requests/:id/appeal', asyncRoute(async(req,res)=>{
        if(String(req.user?.role||'').toLowerCase()!=='seller') return res.status(req.user?403:401).json({error:'Seller role required.'});
        await validateRequestEvidence(service,req.user.id,'SELLER',req.params.id,req.body?.evidence);
        const data=await service.sellerAppeal({actorId:req.user.id,requestId:req.params.id,reason:req.body?.reason,evidence:req.body?.evidence}); return res.json({data});
    }));
    router.post('/requests/:id/admin/decision', asyncRoute(async(req,res)=>{
        if(String(req.user?.role||'').toLowerCase()!=='admin') return res.status(req.user?403:401).json({error:'Admin role required.'});
        const data=await service.adminDecide({actorId:req.user.id,requestId:req.params.id,resolution:req.body?.resolution,faultParty:req.body?.faultParty,reason:req.body?.reason,amountMinor:req.body?.amountMinor,currency:req.body?.currency}); return res.json({data});
    }));
    router.post('/requests/:id/admin/confirm-refund', asyncRoute(async(req,res)=>{
        if(String(req.user?.role||'').toLowerCase()!=='admin') return res.status(req.user?403:401).json({error:'Admin role required.'});
        const data=await service.adminConfirmRefund({actorId:req.user.id,requestId:req.params.id,amountMinor:req.body?.amountMinor,currency:req.body?.currency,faultParty:req.body?.faultParty}); return res.json({data});
    }));
    if(enabledDev()) {
        router.post('/requests/dev/printer-action', asyncRoute(async(req,res)=>{
            if(String(req.user?.role||'').toLowerCase()!=='admin') return res.status(req.user?403:401).json({error:'Admin role required.'});
            await validateRequestEvidence(service,req.user.id,'ADMIN',req.body?.requestId,req.body?.evidence);
            const data=await service.printerDecision({actorId:req.user.id,devAdminActorId:req.user.id,requestId:req.body?.requestId,action:req.body?.action,reason:req.body?.reason,proposedFault:req.body?.proposedFault,proposedClassification:req.body?.proposedClassification,evidence:req.body?.evidence}); return res.json({data});
        }));
        router.get('/clock',(req: AuthenticatedRequest,res)=>{ if(String(req.user?.role||'').toLowerCase()!=='admin') return res.status(req.user?403:401).json({error:'Admin role required.'}); return res.json({now:clock.now().toISOString()}); });
    }
    router.use((error: any,_req: any,res: any,_next: any)=>sendError(res,error));
    return router;
}
