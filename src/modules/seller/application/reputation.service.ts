import mongoose from 'mongoose';
import { Shop, IShop, ReputationTier } from '../../product/infrastructure/models/shop.model';
import { ReputationLog, ReputationReferenceType, IReputationLog } from '../infrastructure/models/reputation-log.model';
import { logger } from '../../../shared/utils/logger';

export interface ShopRiskProfile {
    shop_id: string;
    shop_name: string;
    reputation_score: number;
    reputation_tier: ReputationTier;
    clean_streak_orders: number;
    dispute_count_30d: number;
    penalty_points_30d: number;
    average_rating: number;
    rating_count: number;
    listing_count: number;
    risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    recommendation: string;
}

const BANDS: { min: number; tier: ReputationTier; risk: ShopRiskProfile['risk_level']; recommendation: string }[] = [
    { min: 90, tier: 'TRUSTED', risk: 'LOW', recommendation: 'Shop có chỉ số uy tín xuất sắc (SRS ≥ 90). Tiền sử tuân thủ rất tốt. Ưu tiên xem xét bằng chứng bảo vệ quyền lợi Shop.' },
    { min: 70, tier: 'NORMAL', risk: 'MEDIUM', recommendation: 'Shop ở mức tiêu chuẩn. Đối chiếu khách quan bằng chứng video khui hàng của Buyer và ảnh xuất xưởng.' },
    { min: 50, tier: 'WARNING', risk: 'HIGH', recommendation: 'CẢNH BÁO: Shop có điểm uy tín thấp và tỷ lệ khiếu nại tăng cao gần đây. Khuyến nghị phán quyết bảo vệ Buyer nếu bằng chứng hợp lệ.' },
    { min: -Infinity, tier: 'RESTRICTED', risk: 'CRITICAL', recommendation: 'NGUY CƠ CAO (SRS < 50): Shop bị hạn chế hoạt động do vi phạm nghiêm trọng. Khuyến nghị duyệt hoàn tiền ngay cho Buyer và cấn trừ ví Shop.' },
];

const bandOf = (score: number) => BANDS.find(b => score >= b.min)!;
const scoreOf = (shop: IShop) => typeof shop.reputation_score === 'number' ? shop.reputation_score : 80;

export class ReputationService {
    static calculateTier(score: number): ReputationTier {
        return bandOf(score).tier;
    }

    /** Nhận Shop _id, owner_id, slug hoặc tên shop. */
    static async resolveShop(sellerOrShopId: string | mongoose.Types.ObjectId): Promise<IShop | null> {
        const idStr = String(sellerOrShopId ?? '').trim();
        if (!idStr) return null;

        if (mongoose.Types.ObjectId.isValid(idStr)) {
            const shop = await Shop.findById(idStr) || await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(idStr) });
            if (shop) return shop;
        }
        return Shop.findOne({ $or: [{ slug: idStr }, { shop_name: idStr }] });
    }

    static async deductPoints(
        shop: IShop,
        amount: number,
        reason: string,
        refType: ReputationReferenceType,
        refId?: string,
        actor?: { id?: string; role?: string }
    ): Promise<{ shop: IShop; log: IReputationLog }> {
        if (refId) {
            const existed = await ReputationLog.findOne({ shop_id: shop._id, reference_id: refId, reference_type: refType });
            if (existed) {
                logger.warn(`[REPUTATION] Đã trừ điểm trước đó cho Shop ${shop._id}, refId: ${refId}, refType: ${refType}. Bỏ qua để tránh phạt trùng lặp.`);
                return { shop, log: existed };
            }
        }

        const currentScore = scoreOf(shop);
        const newScore = Math.max(0, currentScore - Math.abs(amount));

        shop.reputation_score = newScore;
        shop.reputation_tier = this.calculateTier(newScore);
        shop.clean_streak_orders = 0;
        shop.penalty_points_30d = (shop.penalty_points_30d || 0) + Math.abs(amount);
        if (refType === 'DISPUTE') shop.dispute_count_30d = (shop.dispute_count_30d || 0) + 1;
        await shop.save();

        const log = await ReputationLog.create({
            shop_id: shop._id,
            delta: newScore - currentScore,
            balance_after: newScore,
            reason,
            reference_type: refType,
            reference_id: refId,
            actor_id: actor?.id,
            actor_role: actor?.role || 'SYSTEM'
        });

        logger.info(`[REPUTATION] Shop ${shop._id} (${shop.shop_name}) deducted ${Math.abs(amount)} pts. Balance: ${newScore}. Reason: ${reason}`);
        return { shop, log };
    }

    static async deductBySellerOrShop(
        sellerOrShopId: string | mongoose.Types.ObjectId,
        amount: number,
        reason: string,
        refType: ReputationReferenceType,
        refId?: string,
        actor?: { id?: string; role?: string }
    ): Promise<{ shop: IShop; log: IReputationLog } | null> {
        try {
            const shop = await this.resolveShop(sellerOrShopId);
            if (!shop) {
                logger.warn(`[REPUTATION] Cannot resolve shop for id: ${sellerOrShopId}`);
                return null;
            }
            return await this.deductPoints(shop, amount, reason, refType, refId, actor);
        } catch (err: any) {
            logger.error(`[REPUTATION] deductBySellerOrShop failed: ${err.message}`);
            return null;
        }
    }

    /** Đơn DELIVERED sạch: đủ 10 đơn liên tiếp thì +5 điểm (trần 100). */
    static async recordCleanOrder(order: any): Promise<IShop | null> {
        try {
            const shop = await this.resolveShop(order.seller_id || order.shop_id?._id || order.shop_id);
            if (!shop) return null;

            const streak = (shop.clean_streak_orders || 0) + 1;
            const currentScore = scoreOf(shop);
            const reward = streak >= 10 && currentScore < 100;
            shop.clean_streak_orders = streak >= 10 ? 0 : streak;
            if (reward) {
                shop.reputation_score = Math.min(100, currentScore + 5);
                shop.reputation_tier = this.calculateTier(shop.reputation_score);
            }
            await shop.save();

            if (reward) {
                await ReputationLog.create({
                    shop_id: shop._id,
                    delta: shop.reputation_score - currentScore,
                    balance_after: shop.reputation_score,
                    reason: 'Hoàn thành chuỗi 10 đơn hàng sạch liên tiếp không khiếu nại (+5đ).',
                    reference_type: 'STREAK',
                    reference_id: order._id?.toString() || order.order_code,
                    actor_role: 'SYSTEM'
                });
                logger.info(`[REPUTATION] Shop ${shop._id} rewarded +5 pts for 10 clean orders. Balance: ${shop.reputation_score}`);
            }
            return shop;
        } catch (err: any) {
            logger.error(`[REPUTATION] recordCleanOrder failed: ${err.message}`);
            return null;
        }
    }

    static async getShopRiskProfile(sellerOrShopId: string | mongoose.Types.ObjectId): Promise<ShopRiskProfile | null> {
        const shop = await this.resolveShop(sellerOrShopId);
        if (!shop) return null;

        const score = scoreOf(shop);
        const band = bandOf(score);
        return {
            shop_id: shop._id.toString(),
            shop_name: shop.shop_name,
            reputation_score: score,
            reputation_tier: band.tier,
            clean_streak_orders: shop.clean_streak_orders || 0,
            dispute_count_30d: shop.dispute_count_30d || 0,
            penalty_points_30d: shop.penalty_points_30d || 0,
            average_rating: shop.average_rating || 5.0,
            rating_count: shop.rating_count || 0,
            listing_count: shop.listing_count || 0,
            risk_level: band.risk,
            recommendation: band.recommendation
        };
    }

    static async getLogs(shopId: string | mongoose.Types.ObjectId, limit = 20): Promise<IReputationLog[]> {
        const shop = await this.resolveShop(shopId);
        if (!shop) return [];
        return ReputationLog.find({ shop_id: shop._id }).sort({ created_at: -1 }).limit(limit).lean();
    }
}
