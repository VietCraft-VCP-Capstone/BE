import { PageParams, Paginated } from '../../../shared/utils/pagination';

export type TagSortKey = 'name' | 'products';

export interface TagListOptions {
    /** Khớp theo tên hoặc slug, không phân biệt hoa thường và không phân biệt dấu. */
    search?: string;
    sort?: TagSortKey;
}

export interface TagStats {
    /** Thẻ đã duyệt. Thẻ chờ duyệt đếm riêng ở `pending`. */
    total: number;
    pending: number;
    /** Tổng lượt thẻ được gắn lên sản phẩm. */
    tagged: number;
    /** Thẻ đã duyệt nhưng chưa sản phẩm nào dùng. */
    unused: number;
}

export interface ITagsService {
    /** Thẻ ĐÃ DUYỆT, đã cắt trang. Thẻ chờ duyệt có lối đọc riêng. */
    listTags(opts: TagListOptions, params: PageParams): Promise<Paginated<any>>;
    listPendingTags(params: PageParams): Promise<Paginated<any>>;
    /** Số liệu toàn cục — không đổi theo trang đang xem. */
    getTagStats(): Promise<TagStats>;
    getTagById(id: string): Promise<any | null>;
    createTag(data: any): Promise<any>;
    updateTag(id: string, data: any): Promise<any | null>;
    deleteTag(id: string): Promise<boolean>;
    approveTag(id: string): Promise<any | null>;
    rejectTag(id: string): Promise<boolean>;
    attachTagToProduct(tagId: string, productId: string): Promise<void>;
    detachTagFromProduct(tagId: string, productId: string): Promise<void>;
    /** Lối đọc công khai: thẻ đã duyệt, bỏ thẻ seller mới đề xuất. */
    listApproved(): Promise<any[]>;
}
