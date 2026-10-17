import { PageParams, Paginated } from '../../../shared/utils/pagination';

export type CategoryStatusFilter = 'all' | 'active' | 'hidden';

export interface CategoryListOptions {
    search?: string;
    status?: CategoryStatusFilter;
}

export interface CategoryStats {
    total: number;
    active: number;
    hidden: number;
    roots: number;
    pending: number;
    rejected?: number;
}

export interface PaginatedCategoryTree extends Paginated<any> {
    totalNodes: number;
}

export interface ICategoryService {
    listCategories(opts: CategoryListOptions, params: PageParams): Promise<Paginated<any>>;
    listCategoryTree(opts: CategoryListOptions, params: PageParams): Promise<PaginatedCategoryTree>;
    getCategoryStats(): Promise<CategoryStats>;
    listOptions(): Promise<any[]>;
    getCategoryById(id: string): Promise<any | null>;
    createCategory(data: any): Promise<any>;
    updateCategory(id: string, data: any): Promise<any | null>;
    deleteCategory(id: string): Promise<boolean>;
    listActive(): Promise<any[]>;
    proposeCategory(sellerId: string, data: any): Promise<any>;
    listMyProposals(sellerId: string): Promise<any[]>;
    listPending(params: PageParams): Promise<Paginated<any>>;
    listRejected(params: PageParams): Promise<Paginated<any>>;
    approveCategory(id: string): Promise<any | null>;
    restoreCategory(id: string): Promise<any | null>;
    rejectCategory(id: string, adminId?: string, reason?: string): Promise<boolean>;
}
