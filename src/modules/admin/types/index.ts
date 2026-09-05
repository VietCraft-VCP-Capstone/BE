import { PageParams, Paginated } from '../../../shared/utils/pagination';

export interface IAdminService {
    listProducts(status: string | undefined, params: PageParams): Promise<Paginated<any>>;
    unpublishProduct(productId: string, reviewerId: string, reason?: string): Promise<any | null>;
    republishProduct(productId: string, reviewerId: string, notes?: string): Promise<{ product: any; warnings: string[] } | null>;
    getModerationHistory(productId: string): Promise<any[]>;
    getModerationStats(): Promise<{ published: number; unpublished: number; draft: number; total: number }>;
}
