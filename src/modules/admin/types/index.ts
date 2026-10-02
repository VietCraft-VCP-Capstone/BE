import { PageParams, Paginated } from '../../../shared/utils/pagination';
import { CommissionChange, StoredRule } from '../../../shared/services/commission-setting.service';

/** Một luật kèm thông tin để hiện lên bảng: tên danh mục và số sản phẩm nó đang chi phối. */
export interface CommissionRuleView extends StoredRule {
    categoryName: string | null;
    /** Số sản phẩm đang bán mà luật này là luật thắng. */
    productCount: number;
}

/**
 * Toàn bộ dữ liệu trang "Cấu hình lợi nhuận": mức mặc định, bảng luật, lịch sử đổi, và số
 * liệu để admin ước lượng tác động trước khi đổi.
 *
 * `impact.netTotal` là tổng tiền NGƯỜI BÁN NHẬN trong kỳ (subtotal trừ hoa hồng). Hoa hồng
 * tỉ lệ thuận với số này, nên trả đúng một con số là phía quản trị tự chiếu ra mức thu ở BẤT
 * KỲ % nào mà không phải gọi lại API mỗi lần gõ phím.
 */
export interface CommissionOverview {
    /** Mức mặc định, áp khi không luật nào khớp. */
    percent: number;
    updatedAt: Date | null;
    rules: CommissionRuleView[];
    /** Số sản phẩm đang rơi vào mức mặc định (không luật nào khớp). */
    defaultProductCount: number;
    /** Danh mục để admin chọn khi thêm luật. */
    categories: { id: string; name: string; productCount: number }[];
    history: (CommissionChange & { changedByEmail: string | null })[];
    impact: {
        periodDays: number;
        orderCount: number;
        paidOrderCount: number;
        /** Tổng tiền người bán nhận trong kỳ — cơ sở để quy đổi ra hoa hồng ở mọi mức %. */
        netTotal: number;
        /** Hoa hồng ĐÃ thực ghi nhận trong kỳ, theo mức áp dụng tại thời điểm từng đơn. */
        feeTotal: number;
        activeProducts: number;
        activeShops: number;
    };
}

/** Các con số tiền của một kỳ. Mọi giá trị là đồng, đã làm tròn. */
export interface FinanceTotals {
    /** Số đơn đã thanh toán trong kỳ — cơ sở của mọi con số còn lại (BR-141). */
    orders: number;
    /** Tổng tiền hàng trước phí, chưa gồm phí vận chuyển (BR-115). */
    gmv: number;
    /** Hoa hồng sàn thu được — đây là "thu nhập" của sàn. */
    commission: number;
    /** Tiền trả người bán. */
    payout: number;
    shipping: number;
    discount: number;
}

export interface FinanceOverview {
    period: { days: number; from: string; to: string };
    /** Kỳ hiện tại và kỳ liền trước cùng độ dài, để tính biến động (BR-142). */
    current: FinanceTotals;
    previous: FinanceTotals;
    /** Một điểm mỗi ngày, đã lấp đủ ngày trống bằng 0 (BR-143). Theo giờ Việt Nam. */
    daily: { date: string; gmv: number; commission: number; orders: number }[];
    topShops: { shopId: string; name: string; orders: number; gmv: number; commission: number }[];
    recent: {
        orderCode: string;
        createdAt: string;
        shopName: string;
        gmv: number;
        commission: number;
        payout: number;
        paymentStatus: string;
        orderStatus: string;
    }[];
    /** Đơn đã hoàn tiền trong kỳ — hoa hồng ở đây phải coi là mất, không phải thu. */
    refunded: { orders: number; gmv: number; commission: number };
    /** % hoa hồng đang cấu hình, để đối chiếu với tỉ lệ thực tế. */
    commissionPercent: number;
}

export interface IAdminService {
    listProducts(status: string | undefined, params: PageParams): Promise<Paginated<any>>;
    unpublishProduct(productId: string, reviewerId: string, reason?: string): Promise<any | null>;
    republishProduct(productId: string, reviewerId: string, notes?: string): Promise<{ product: any; warnings: string[] } | null>;
    getModerationHistory(productId: string): Promise<any[]>;
    getModerationStats(): Promise<{ published: number; unpublished: number; draft: number; total: number }>;

    getCommissionOverview(): Promise<CommissionOverview>;
    getFinanceOverview(days: number): Promise<FinanceOverview>;

    // Seller KYC Applications
    listSellerApplications(query: {
        status?: string;
        seller_type?: string;
        search?: string;
        page?: number;
        limit?: number;
    }): Promise<any>;
    getSellerApplicationStats(): Promise<{ total: number; pending: number; approved: number; rejected: number }>;
    getSellerApplicationDetail(id: string): Promise<any>;
    approveSellerApplication(id: string, adminId: string): Promise<{ success: boolean; message: string; shopId?: any }>;
    rejectSellerApplication(id: string, adminId: string, reason: string): Promise<{ success: boolean; message: string }>;
}
