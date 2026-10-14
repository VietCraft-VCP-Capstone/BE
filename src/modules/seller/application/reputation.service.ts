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

export class ReputationService {
    /**
     * Xác định phân tầng của Shop dựa trên điểm số (0 - 100)
     */
    static calculateTier(score: number): ReputationTier {
        if (score >= 90) return 'TRUSTED';
        if (score >= 70) return 'NORMAL';
        if (score >= 50) return 'WARNING';
        return 'RESTRICTED';
    }

    /**
     * Tìm Shop theo Shop ID hoặc User Owner ID (hỗ trợ cả mock ID và Mongo ID)
     */
    static async resolveShop(sellerOrShopId: string | mongoose.Types.ObjectId): Promise<IShop | null> {
        if (!sellerOrShopId) return null;
        const idStr = String(sellerOrShopId).trim();
        if (!idStr) return null;

        // Thử tìm theo Shop _id
        if (mongoose.Types.ObjectId.isValid(idStr)) {
            const byId = await Shop.findById(idStr);
            if (byId) return byId;

            const byOwner = await Shop.findOne({ owner_id: new mongoose.Types.ObjectId(idStr) });
            if (byOwner) return byOwner;
        }

        // Tìm fallback theo slug hoặc owner_id dạng string nếu có
        return Shop.findOne({ $or: [{ slug: idStr }, { shop_name: idStr }] });
    }

    /**
     * Trừ điểm vi phạm và lưu log kiểm toán bất biến
     */
    static async deductPoints(
        shop: IShop,
        amount: number,
        reason: string,
        refType: ReputationReferenceType,
        refId?: string,
        actor?: { id?: string; role?: string }
    ): Promise<{ shop: IShop; log: IReputationLog }> {
        // Chống trừ điểm trùng lặp cho cùng 1 vụ việc (Idempotency Guard)
        if (refId) {
            const existed = await ReputationLog.findOne({
                shop_id: shop._id,
                reference_id: refId,
                reference_type: refType
            });
            if (existed) {
                logger.warn(`[REPUTATION] Đã trừ điểm trước đó cho Shop ${shop._id}, refId: ${refId}, refType: ${refType}. Bỏ qua để tránh phạt trùng lặp.`);
                return { shop, log: existed };
            }
        }

        const currentScore = typeof shop.reputation_score === 'number' ? shop.reputation_score : 100;
        const newScore = Math.max(0, currentScore - Math.abs(amount));
        const delta = -(currentScore - newScore);

        shop.reputation_score = newScore;
        shop.reputation_tier = this.calculateTier(newScore);
        shop.clean_streak_orders = 0; // Vi phạm làm gãy chuỗi đơn sạch
        shop.penalty_points_30d = (shop.penalty_points_30d || 0) + Math.abs(amount);

        if (refType === 'DISPUTE') {
            shop.dispute_count_30d = (shop.dispute_count_30d || 0) + 1;
        }

        await shop.save();

        const log = await ReputationLog.create({
            shop_id: shop._id,
            delta,
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

    /**
     * Helper trừ điểm tự động theo seller_id hoặc shop_id
     */
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

    /**
     * Ghi nhận đơn hàng hoàn thành sạch (DELIVERED không lỗi)
     * Đủ 20 đơn sạch liên tiếp -> Cộng +5 điểm hồi phục (trần 100đ)
     */
    static async recordCleanOrder(
        sellerOrShopId: string | mongoose.Types.ObjectId,
        orderId?: string
    ): Promise<IShop | null> {
        try {
            const shop = await this.resolveShop(sellerOrShopId);
            if (!shop) return null;

            const currentStreak = (shop.clean_streak_orders || 0) + 1;
            const currentScore = typeof shop.reputation_score === 'number' ? shop.reputation_score : 100;

            if (currentStreak >= 20) {
                // Đạt mốc thưởng
                shop.clean_streak_orders = 0; // Reset streak sau khi nhận thưởng
                if (currentScore < 100) {
                    const newScore = Math.min(100, currentScore + 5);
                    const delta = newScore - currentScore;
                    shop.reputation_score = newScore;
                    shop.reputation_tier = this.calculateTier(newScore);

                    await shop.save();

                    await ReputationLog.create({
                        shop_id: shop._id,
                        delta,
                        balance_after: newScore,
                        reason: 'Hoàn thành chuỗi 20 đơn hàng sạch liên tiếp không khiếu nại (+5đ).',
                        reference_type: 'STREAK',
                        reference_id: orderId,
                        actor_role: 'SYSTEM'
                    });

                    logger.info(`[REPUTATION] Shop ${shop._id} rewarded +5 pts for 20 clean orders. Balance: ${newScore}`);
                    return shop;
                }
            } else {
                shop.clean_streak_orders = currentStreak;
            }

            await shop.save();
            return shop;
        } catch (err: any) {
            logger.error(`[REPUTATION] recordCleanOrder failed: ${err.message}`);
            return null;
        }
    }

    /**
     * Lấy hồ sơ rủi ro của Shop phục vụ màn hình Admin Dispute
     */
    static async getShopRiskProfile(sellerOrShopId: string | mongoose.Types.ObjectId): Promise<ShopRiskProfile | null> {
        const shop = await this.resolveShop(sellerOrShopId);
        if (!shop) return null;

        const score = typeof shop.reputation_score === 'number' ? shop.reputation_score : 100;
        const tier = shop.reputation_tier || this.calculateTier(score);

        const risk_level = score >= 90 ? 'LOW' : score >= 70 ? 'MEDIUM' : score >= 50 ? 'HIGH' : 'CRITICAL';

        let recommendation = '';
        if (score >= 90) {
            recommendation = 'Shop có chỉ số uy tín xuất sắc (SRS ≥ 90). Tiền sử tuân thủ rất tốt. Ưu tiên xem xét bằng chứng bảo vệ quyền lợi Shop.';
        } else if (score >= 70) {
            recommendation = 'Shop ở mức tiêu chuẩn. Đối chiếu khách quan bằng chứng video khui hàng của Buyer và ảnh xuất xưởng.';
        } else if (score >= 50) {
            recommendation = 'CẢNH BÁO: Shop có điểm uy tín thấp và tỷ lệ khiếu nại tăng cao gần đây. Khuyến nghị phán quyết bảo vệ Buyer nếu bằng chứng hợp lệ.';
        } else {
            recommendation = 'NGUY CƠ CAO (SRS < 50): Shop bị hạn chế hoạt động do vi phạm nghiêm trọng. Khuyến nghị duyệt hoàn tiền ngay cho Buyer và cấn trừ ví Shop.';
        }

        return {
            shop_id: shop._id.toString(),
            shop_name: shop.shop_name,
            reputation_score: score,
            reputation_tier: tier,
            clean_streak_orders: shop.clean_streak_orders || 0,
            dispute_count_30d: shop.dispute_count_30d || 0,
            penalty_points_30d: shop.penalty_points_30d || 0,
            average_rating: shop.average_rating || 5.0,
            rating_count: shop.rating_count || 0,
            listing_count: shop.listing_count || 0,
            risk_level,
            recommendation
        };
    }

    /**
     * Lấy lịch sử biến động điểm của Shop
     */
    static async getLogs(shopId: string | mongoose.Types.ObjectId, limit = 20): Promise<IReputationLog[]> {
        const shop = await this.resolveShop(shopId);
        if (!shop) return [];
        return ReputationLog.find({ shop_id: shop._id }).sort({ created_at: -1 }).limit(limit).lean();
    }
}
