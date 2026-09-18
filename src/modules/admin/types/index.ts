import { PageParams, Paginated } from '../../../shared/utils/pagination';

export interface IAdminService {
    listProducts(status: string | undefined, params: PageParams): Promise<Paginated<any>>;
    unpublishProduct(productId: string, reviewerId: string, reason?: string): Promise<any | null>;
    republishProduct(productId: string, reviewerId: string, notes?: string): Promise<{ product: any; warnings: string[] } | null>;
    getModerationHistory(productId: string): Promise<any[]>;
    getModerationStats(): Promise<{ published: number; unpublished: number; draft: number; total: number }>;

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
