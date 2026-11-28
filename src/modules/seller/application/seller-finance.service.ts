import mongoose from 'mongoose';
import { Shop } from '../../product/infrastructure/models/shop.model';
import { Order } from '../../order/infrastructure/models/order.model';
import { SellerSettingsService } from './seller-settings.service';
import { SellerWithdrawal, ISellerWithdrawal } from '../infrastructure/models/seller-withdrawal.model';
import { PayOS, APIError } from '@payos/node';

/** Mã nghiệp vụ payOS Payout nghĩa là lệnh bị từ chối, chưa chi tiền. */
const PAYOUT_REJECTED_CODES = new Set(['607']);
import { config } from '../../../app/config';
import { PayosRefundGateway, payosPayoutReference, payoutDescription } from '../../payment/application/payos-refund.gateway';
import { logger } from '../../../shared/utils/logger';
import { toNapasBin } from '../../payment/domain/bank-codes';
import { decryptField, maskBankAccount } from '../../../shared/utils/crypto.service';
import { SettlementStatus, settlementStatusOf, openReturnOrderIds, deliveredAt } from './seller-settlement-rule';

/** Một lần gọi chi (15s × tối đa 3 lần) xong trong dưới 2 phút; khóa cũ hơn là tiến trình đã chết giữa chừng */
const WITHDRAW_LOCK_MS = 2 * 60 * 1000;

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
    settlementStatus: SettlementStatus;
    itemsCount: number;
}

function moneyOf(ord: any): { payout: number; platformFee: number } {
    const fb = ord.financial_breakdown || {};
    const subtotal = Number(fb.subtotal?.toString() || 0);
    const platformFee = Number(fb.platform_fee?.toString() || 0);
    return { payout: Number(fb.seller_payout_amount?.toString() || (subtotal - platformFee)) || 0, platformFee };
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
        const [orders, openIds] = await Promise.all([
            Order.find({ shop_id: shopId, is_simulated: { $ne: true }, order_status: { $ne: 'CANCELLED' } })
                .select('order_status payment_status refund_status status_history updated_at financial_breakdown').lean(),
            openReturnOrderIds(ownerId),
        ]);

        let settledRevenue = 0;
        let pendingBalance = 0;
        let totalPlatformFee = 0;

        for (const ord of orders) {
            const { payout, platformFee } = moneyOf(ord);
            const status = settlementStatusOf(ord, openIds);
            if (status === 'SETTLED') {
                settledRevenue += payout;
                totalPlatformFee += platformFee;
            } else if (status === 'PENDING') {
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
            const accounts = await SellerSettingsService.getDecryptedBankAccounts(ownerId);
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

        if (params.search?.trim()) {
            filter.order_code = { $regex: params.search.trim(), $options: 'i' };
        }

        // shortcut: lọc trạng thái giải ngân trong bộ nhớ, chuyển sang aggregate nếu shop có hàng chục nghìn đơn
        const [all, openIds] = await Promise.all([
            Order.find(filter).sort({ created_at: -1 }).lean(),
            openReturnOrderIds(ownerId),
        ]);
        const rows = all
            .map(ord => ({ ord, settlementStatus: settlementStatusOf(ord, openIds) }))
            .filter(r => !params.status || params.status === 'ALL' || r.settlementStatus === params.status);
        const total = rows.length;

        const items: SellerSettlementItem[] = rows.slice(skip, skip + limit).map(({ ord, settlementStatus }) => {
            const subtotal = Number(ord.financial_breakdown?.subtotal?.toString() || 0);
            const { payout: netPayout, platformFee } = moneyOf(ord);
            const commissionRate = Number(ord.financial_breakdown?.commission_rate?.toString() || 0.10);
            const delivered = ord.order_status === 'DELIVERED' ? deliveredAt(ord) ?? undefined : undefined;

            return {
                orderId: ord._id.toString(),
                orderCode: ord.order_code,
                orderDate: ord.created_at,
                deliveredDate: delivered,
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
            accountNumber: maskBankAccount(decryptField(w.account_number)),
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

        // Một shop chỉ một lệnh rút tại một thời điểm: kiểm số dư rồi mới tạo lệnh, không khóa thì hai request
        // song song cùng thấy đủ tiền và cùng chi. Khóa cũ quá WITHDRAW_LOCK_MS (tiến trình chết giữa chừng) thì lấy lại.
        const locked = await Shop.findOneAndUpdate(
            { _id: shopId, $or: [{ withdrawal_locked_at: null }, { withdrawal_locked_at: { $lt: new Date(Date.now() - WITHDRAW_LOCK_MS) } }] },
            { $set: { withdrawal_locked_at: new Date() } },
        );
        if (!locked) throw new Error('Đang có một lệnh rút tiền khác được xử lý, vui lòng đợi ít phút rồi thử lại.');
        try {
            return await this.withdrawLocked(shopId, ownerId, amount, customBank);
        } finally {
            await Shop.updateOne({ _id: shopId }, { $set: { withdrawal_locked_at: null } }).catch(() => { });
        }
    }

    private static async withdrawLocked(
        shopId: mongoose.Types.ObjectId,
        ownerId: string,
        amount: number,
        customBank?: { bankName: string; bankCode: string; accountNumber: string; accountHolder: string }
    ): Promise<SellerWithdrawalItem> {
        const overview = await this.getOverview(ownerId);
        if (amount > overview.availableBalance) {
            throw new Error(`Số dư khả dụng không đủ (${overview.availableBalance.toLocaleString('vi-VN')} VNĐ) để thực hiện lệnh rút ${amount.toLocaleString('vi-VN')} VNĐ.`);
        }

        // Lấy thông tin ngân hàng thụ hưởng (bảo đảm có số tài khoản thật đã giải mã để gửi lệnh Napas)
        let bank = customBank;
        if (!bank || !bank.accountNumber || bank.accountNumber.includes('*')) {
            const rawAccounts = await SellerSettingsService.getDecryptedBankAccounts(ownerId);
            const matchedBank = customBank?.bankCode 
                ? rawAccounts.find((b: any) => b.bankCode === customBank.bankCode)
                : (rawAccounts.find((b: any) => b.isDefault) || rawAccounts[0]);
            bank = matchedBank || overview.defaultBank || undefined;
        }

        if (!bank || !bank.accountNumber || !bank.bankCode) {
            throw new Error('Chưa có thông tin tài khoản ngân hàng thụ hưởng. Vui lòng thiết lập trong Cài đặt thanh toán.');
        }
        // Số tài khoản phải là chữ số thật: giải mã lỗi trả '****', gửi đi thì payOS từ chối mà tiền vẫn bị tạm giữ.
        if (!/^\d{6,20}$/.test(bank.accountNumber)) {
            logger.error(`[SELLER WITHDRAWAL] Số tài khoản thụ hưởng không hợp lệ sau giải mã (shop ${shopId}, bank ${bank.bankCode}).`);
            throw new Error('Không đọc được số tài khoản ngân hàng thụ hưởng. Vui lòng nhập lại tài khoản trong Cài đặt thanh toán rồi thử lại.');
        }

        // Kiểm mọi điều kiện chi TRƯỚC khi tạo lệnh: chưa cấu hình cổng chi thì không được ghi "đã chi"
        const payosGateway = new PayosRefundGateway();
        if (!payosGateway.configured()) {
            throw new Error('Cổng chi tiền chưa được cấu hình, chưa thể rút tiền. Vui lòng liên hệ quản trị sàn.');
        }
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
        let walletBal = NaN;
        try {
            walletBal = Number((await client.payoutsAccount.balance()).balance);
        } catch (bErr: any) {
            logger.warn(`[SELLER WITHDRAWAL] Không đọc được số dư ví payOS: ${bErr?.message}`);
        }
        if (Number.isFinite(walletBal) && walletBal < amount) {
            throw new Error('Ví chi của sàn tạm thời không đủ số dư để chi lệnh này. Vui lòng thử lại sau.');
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
        const referenceId = `wd-${withdrawalCode}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
        withdrawal.payout_reference_id = referenceId;
        try {
            logger.info(`[SELLER WITHDRAWAL] Bắt đầu gọi PayOS Payout: ref=${referenceId}, amount=${amount}, bin=${bin}, acc=${maskBankAccount(bank.accountNumber)}`);
            const payoutResult = await client.payouts.create({
                referenceId,
                amount,
                description: payoutDescription(withdrawalCode),
                toBin: bin,
                toAccountNumber: bank.accountNumber,
            }, referenceId);

            logger.info(`[SELLER WITHDRAWAL SUCCESS] ${withdrawalCode}: payOS id=${payoutResult?.id}`);
            withdrawal.status = 'COMPLETED';
            withdrawal.completed_at = new Date();
            withdrawal.payout_transaction_id = payoutResult?.id;
            await withdrawal.save();
        } catch (err: any) {
            const errMsg = err?.message || 'Lỗi không xác định từ cổng chi tiền PayOS';
            // payOS trả HTTP 200 kèm mã nghiệp vụ từ chối hẳn (lệnh không được tạo) → FAILED để hoàn số dư.
            // Chỉ nhận các mã chắc chắn không phải "đã chi" (vd 607 tài khoản đích sai, không thể là trùng lệnh do retry).
            if (err instanceof APIError && err.status === 200 && err.code && PAYOUT_REJECTED_CODES.has(err.code)) {
                logger.warn(`[SELLER WITHDRAWAL REJECTED] ${withdrawalCode} (ref ${referenceId}): ${errMsg}`);
                withdrawal.status = 'FAILED';
                withdrawal.failure_reason = `payOS từ chối lệnh chi (ref ${referenceId}): ${errMsg}`;
                await withdrawal.save();
                throw new Error(`Cổng chi tiền từ chối lệnh rút: ${err.desc || errMsg}. Số tiền đã được hoàn lại vào số dư khả dụng.`);
            }
            // Lỗi lúc đã gửi lệnh (mạng, timeout...) thì KHÔNG biết tiền đã chi hay chưa: giữ PROCESSING để số tiền
            // vẫn bị trừ khỏi số dư (không cho rút lại rồi chi hai lần), quản trị đối soát theo mã tham chiếu.
            logger.error(`[SELLER WITHDRAWAL UNKNOWN] ${withdrawalCode} (ref ${referenceId}): ${errMsg}`);
            withdrawal.failure_reason = `Chưa xác nhận được kết quả chi từ payOS (ref ${referenceId}): ${errMsg}`;
            await withdrawal.save();
            throw new Error('Lệnh rút đã gửi nhưng chưa xác nhận được kết quả từ cổng chi tiền. Số tiền tạm giữ, sàn sẽ đối soát và cập nhật cho bạn.');
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
