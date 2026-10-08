import mongoose from 'mongoose';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { Order } from '../../order/infrastructure/models/order.model';
import { SellerSettingsService } from './seller-settings.service';
import { SellerWithdrawal, ISellerWithdrawal } from '../infrastructure/models/seller-withdrawal.model';
import { PayOS } from '@payos/node';
import { config } from '../../../app/config';
import { PayosRefundGateway, payosPayoutReference, payoutDescription } from '../../payment/application/payos-refund.gateway';
import { logger } from '../../../shared/utils/logger';
import { toNapasBin } from '../../payment/domain/bank-codes';

export interface SellerFinanceOverview {
    availableBalance: number;
    pendingBalance: number;
    settledRevenue: number;
    totalWithdrawn: number;
    totalPlatformFee: number;
    defaultBank?: {
        bankName: string;
        bankCode: string;
        accountNumber: string;
        accountHolder: string;
    } | null;
}

export interface SellerSettlementItem {
    orderId: string;
    orderCode: string;
    orderDate: Date;
    deliveredDate?: Date;
    orderStatus: string;
    subtotal: number;
    platformFee: number;
    commissionRate: number;
    netPayout: number;
    settlementStatus: 'SETTLED' | 'PENDING' | 'CANCELLED';
    itemsCount: number;
}

export interface SellerWithdrawalItem {
    id: string;
    withdrawalCode: string;
    amount: number;
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountHolder: string;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    createdAt: Date;
    completedAt?: Date;
    note?: string;
    failureReason?: string;
}

export class SellerFinanceService {
    private static async findShopId(ownerId: string): Promise<mongoose.Types.ObjectId | null> {
        const shop = await Shop.findOne({
            $or: [
                { owner_id: mongoose.Types.ObjectId.isValid(ownerId) ? new mongoose.Types.ObjectId(ownerId) : null },
                { code: ownerId }
            ]
        }).select('_id').lean();
        return shop ? (shop._id as mongoose.Types.ObjectId) : null;
    }

    /**
     * Lấy tổng quan số dư, doanh thu và dòng tiền của Người bán
     */
    static async getOverview(ownerId: string): Promise<SellerFinanceOverview> {
        const shopId = await this.findShopId(ownerId);
        if (!shopId) {
            return {
                availableBalance: 0,
                pendingBalance: 0,
                settledRevenue: 0,
                totalWithdrawn: 0,
                totalPlatformFee: 0,
                defaultBank: null,
            };
        }

        // 1. Tính toán doanh thu từ các đơn hàng
        const orderAggregation = await Order.aggregate([
            {
                $match: {
                    shop_id: shopId,
                    is_simulated: { $ne: true },
                    order_status: { $ne: 'CANCELLED' }
                }
            },
            {
                $group: {
                    _id: '$order_status',
                    subtotal: { $sum: { $toDouble: '$financial_breakdown.subtotal' } },
                    platformFee: { $sum: { $toDouble: '$financial_breakdown.platform_fee' } },
                    payout: { $sum: { $toDouble: '$financial_breakdown.seller_payout' } },
                }
            }
        ]);

        let settledRevenue = 0;
        let pendingBalance = 0;
        let totalPlatformFee = 0;

        for (const row of orderAggregation) {
            const status = row._id;
            const payout = row.payout || (row.subtotal - row.platformFee) || 0;
            if (status === 'DELIVERED') {
                settledRevenue += payout;
                totalPlatformFee += (row.platformFee || 0);
            } else {
                pendingBalance += payout;
            }
        }

        // 2. Tính tổng số tiền đã rút thành công hoặc đang xử lý
        const withdrawalAggregation = await SellerWithdrawal.aggregate([
            {
                $match: {
                    shop_id: shopId,
                    status: { $in: ['COMPLETED', 'PROCESSING'] }
                }
            },
            {
                $group: {
                    _id: null,
                    totalWithdrawn: { $sum: '$amount' }
                }
            }
        ]);

        const totalWithdrawn = withdrawalAggregation[0]?.totalWithdrawn || 0;
        const availableBalance = Math.max(0, Math.round(settledRevenue - totalWithdrawn));

        // 3. Lấy thông tin tài khoản ngân hàng mặc định
        let defaultBank = null;
        try {
            const settings = await SellerSettingsService.getSettings(ownerId);
            const accounts = settings.payment?.bankAccounts || [];
            const defAccount = accounts.find((b: any) => b.isDefault) || accounts[0];
            if (defAccount) {
                defaultBank = {
                    bankName: defAccount.bankName,
                    bankCode: defAccount.bankCode,
                    accountNumber: defAccount.accountNumber,
                    accountHolder: defAccount.accountHolder,
                };
            }
        } catch { }

        return {
            availableBalance,
            pendingBalance: Math.round(pendingBalance),
            settledRevenue: Math.round(settledRevenue),
            totalWithdrawn: Math.round(totalWithdrawn),
            totalPlatformFee: Math.round(totalPlatformFee),
            defaultBank,
        };
    }

    /**
     * Lấy danh sách chi tiết các phiên đối soát theo đơn hàng
     */
    static async getSettlements(
        ownerId: string,
        params: { page?: number; limit?: number; status?: string; search?: string }
    ): Promise<{ items: SellerSettlementItem[]; total: number; page: number; totalPages: number }> {
        const shopId = await this.findShopId(ownerId);
        if (!shopId) return { items: [], total: 0, page: 1, totalPages: 0 };

        const page = Math.max(1, Number(params.page) || 1);
        const limit = Math.min(50, Math.max(1, Number(params.limit) || 15));
        const skip = (page - 1) * limit;

        const filter: any = {
            shop_id: shopId,
            is_simulated: { $ne: true }
        };

        if (params.status === 'SETTLED') {
            filter.order_status = 'DELIVERED';
        } else if (params.status === 'PENDING') {
            filter.order_status = { $in: ['ORDERED', 'PENDING_DESIGN', 'PROCESSING', 'SHIPPING'] };
        } else if (params.status === 'CANCELLED') {
            filter.order_status = 'CANCELLED';
        }

        if (params.search?.trim()) {
            filter.order_code = { $regex: params.search.trim(), $options: 'i' };
        }

        const [orders, total] = await Promise.all([
            Order.find(filter)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Order.countDocuments(filter)
        ]);

        const items: SellerSettlementItem[] = orders.map(ord => {
            const subtotal = Number(ord.financial_breakdown?.subtotal?.toString() || 0);
            const platformFee = Number(ord.financial_breakdown?.platform_fee?.toString() || 0);
            const commissionRate = Number(ord.financial_breakdown?.commission_rate?.toString() || 0.10);
            const netPayout = Number(ord.financial_breakdown?.seller_payout_amount?.toString() || (subtotal - platformFee));

            let settlementStatus: 'SETTLED' | 'PENDING' | 'CANCELLED' = 'PENDING';
            if (ord.order_status === 'DELIVERED') settlementStatus = 'SETTLED';
            else if (ord.order_status === 'CANCELLED') settlementStatus = 'CANCELLED';

            const deliveredHist = ord.status_history?.find(h => h.status === 'DELIVERED');

            return {
                orderId: ord._id.toString(),
                orderCode: ord.order_code,
                orderDate: ord.created_at,
                deliveredDate: deliveredHist?.changed_at,
                orderStatus: ord.order_status,
                subtotal: Math.round(subtotal),
                platformFee: Math.round(platformFee),
                commissionRate,
                netPayout: Math.round(netPayout),
                settlementStatus,
                itemsCount: ord.items?.length || 0
            };
        });

        return {
            items,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        };
    }

    /**
     * Lấy lịch sử các lần yêu cầu rút tiền
     */
    static async getWithdrawals(
        ownerId: string,
        params: { page?: number; limit?: number; status?: string }
    ): Promise<{ items: SellerWithdrawalItem[]; total: number; page: number; totalPages: number }> {
        const shopId = await this.findShopId(ownerId);
        if (!shopId) return { items: [], total: 0, page: 1, totalPages: 0 };

        const page = Math.max(1, Number(params.page) || 1);
        const limit = Math.min(50, Math.max(1, Number(params.limit) || 15));
        const skip = (page - 1) * limit;

        const filter: any = { shop_id: shopId };
        if (params.status) filter.status = params.status;

        const [docs, total] = await Promise.all([
            SellerWithdrawal.find(filter)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            SellerWithdrawal.countDocuments(filter)
        ]);

        const items: SellerWithdrawalItem[] = docs.map(w => ({
            id: w._id.toString(),
            withdrawalCode: w.withdrawal_code,
            amount: w.amount,
            bankName: w.bank_name,
            bankCode: w.bank_code,
            accountNumber: w.account_number,
            accountHolder: w.account_holder,
            status: w.status,
            createdAt: w.created_at,
            completedAt: w.completed_at,
            note: w.note,
            failureReason: w.failure_reason
        }));

        return {
            items,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        };
    }

    /**
     * Tạo yêu cầu rút tiền từ số dư khả dụng của shop
     */
    static async requestWithdrawal(
        ownerId: string,
        amount: number,
        customBank?: { bankName: string; bankCode: string; accountNumber: string; accountHolder: string }
    ): Promise<SellerWithdrawalItem> {
        const shopId = await this.findShopId(ownerId);
        if (!shopId) throw new Error('Không tìm thấy thông tin gian hàng.');

        if (!Number.isSafeInteger(amount) || amount < 500) {
            throw new Error('Số tiền rút tối thiểu là 500 VNĐ.');
        }

        const overview = await this.getOverview(ownerId);
        if (amount > overview.availableBalance) {
            throw new Error(`Số dư khả dụng không đủ (${overview.availableBalance.toLocaleString('vi-VN')} VNĐ) để thực hiện lệnh rút ${amount.toLocaleString('vi-VN')} VNĐ.`);
        }

        // Lấy thông tin ngân hàng thụ hưởng
        let bank = customBank;
        if (!bank || !bank.accountNumber) {
            bank = overview.defaultBank || undefined;
        }

        if (!bank || !bank.accountNumber || !bank.bankCode) {
            throw new Error('Chưa có thông tin tài khoản ngân hàng thụ hưởng. Vui lòng thiết lập trong Cài đặt thanh toán.');
        }

        const withdrawalCode = `WD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        const withdrawal = await SellerWithdrawal.create({
            shop_id: shopId,
            seller_id: new mongoose.Types.ObjectId(ownerId),
            withdrawal_code: withdrawalCode,
            amount,
            bank_name: bank.bankName,
            bank_code: bank.bankCode,
            account_number: bank.accountNumber,
            account_holder: bank.accountHolder,
            status: 'PROCESSING',
            note: `Rút tiền doanh thu gian hàng ${withdrawalCode}`,
        });

        // Gửi lệnh chi tiền tự động qua PayOS Payout
        try {
            const payosGateway = new PayosRefundGateway();
            if (payosGateway.configured()) {
                const bin = toNapasBin(bank.bankCode);
                if (!bin || !/^\d{6}$/.test(bin)) {
                    throw new Error(`Không xác định được mã BIN Napas của ngân hàng "${bank.bankCode}". Vui lòng chọn ngân hàng trong danh sách hỗ trợ.`);
                }
                const client = new PayOS({
                    clientId: config.payos.payoutClientId!,
                    apiKey: config.payos.payoutApiKey!,
                    checksumKey: config.payos.payoutChecksumKey!,
                    baseURL: config.payos.payoutBaseUrl,
                    timeout: 15_000,
                    maxRetries: 2,
                    logLevel: 'warn',
                });

                // Kiểm tra số dư ví payout trước khi chi
                try {
                    const walletBal = Number((await client.payoutsAccount.balance()).balance);
                    if (Number.isFinite(walletBal) && walletBal < amount) {
                        throw new Error(`Ví chi PayOS của sàn không đủ số dư khả dụng (${walletBal.toLocaleString('vi-VN')}đ) để chi lệnh ${amount.toLocaleString('vi-VN')}đ.`);
                    }
                } catch (bErr: any) {
                    logger.warn(`[SELLER WITHDRAWAL] Không đọc được số dư ví payOS: ${bErr?.message}`);
                }

                const referenceId = `wd-${withdrawalCode}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
                const payoutDesc = payoutDescription(withdrawalCode);
                logger.info(`[SELLER WITHDRAWAL] Bắt đầu gọi PayOS Payout: ref=${referenceId}, amount=${amount}, bin=${bin}, acc=${bank.accountNumber}`);

                const payoutResult = await client.payouts.create({
                    referenceId,
                    amount,
                    description: payoutDesc,
                    toBin: bin,
                    toAccountNumber: bank.accountNumber,
                }, referenceId);

                logger.info(`[SELLER WITHDRAWAL SUCCESS] PayOS Payout phản hồi: ${JSON.stringify(payoutResult)}`);

                withdrawal.status = 'COMPLETED';
                withdrawal.completed_at = new Date();
                withdrawal.payout_reference_id = referenceId;
                withdrawal.payout_transaction_id = payoutResult?.id;
                await withdrawal.save();
            } else {
                logger.warn(`[SELLER WITHDRAWAL] Cổng PayOS Payout chưa được cấu hình ClientID/ApiKey.`);
                withdrawal.status = 'COMPLETED';
                withdrawal.completed_at = new Date();
                withdrawal.note = 'Hoàn tất (Môi trường thử nghiệm không kết nối ví PayOS)';
                await withdrawal.save();
            }
        } catch (err: any) {
            const errMsg = err?.message || 'Lỗi không xác định từ cổng chi tiền PayOS';
            logger.error(`[SELLER WITHDRAWAL FAILED] ${withdrawalCode}: ${errMsg}`);
            withdrawal.status = 'FAILED';
            withdrawal.failure_reason = errMsg;
            await withdrawal.save();
            throw new Error(`Rút tiền không thành công: ${errMsg}`);
        }

        return {
            id: withdrawal._id.toString(),
            withdrawalCode: withdrawal.withdrawal_code,
            amount: withdrawal.amount,
            bankName: withdrawal.bank_name,
            bankCode: withdrawal.bank_code,
            accountNumber: withdrawal.account_number,
            accountHolder: withdrawal.account_holder,
            status: withdrawal.status,
            createdAt: withdrawal.created_at,
            completedAt: withdrawal.completed_at,
            note: withdrawal.note,
        };
    }
}
