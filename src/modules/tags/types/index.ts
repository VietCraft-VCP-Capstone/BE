import { PageParams, Paginated } from '../../../shared/utils/pagination';

export type TagSortKey = 'name' | 'products';

export interface TagListOptions {
    search?: string;
    sort?: TagSortKey;
}

export interface TagStats {
    total: number;
    pending: number;
    tagged: number;
    unused: number;
}

export interface ITagsService {
    listTags(opts: TagListOptions, params: PageParams): Promise<Paginated<any>>;
    listPendingTags(params: PageParams): Promise<Paginated<any>>;
    getTagStats(): Promise<TagStats>;
    getTagById(id: string): Promise<any | null>;
    createTag(data: any): Promise<any>;
    updateTag(id: string, data: any): Promise<any | null>;
    deleteTag(id: string): Promise<boolean>;
    approveTag(id: string): Promise<any | null>;
    rejectTag(id: string): Promise<boolean>;
    attachTagToProduct(tagId: string, productId: string): Promise<void>;
    detachTagFromProduct(tagId: string, productId: string): Promise<void>;
    listApproved(): Promise<any[]>;
}

