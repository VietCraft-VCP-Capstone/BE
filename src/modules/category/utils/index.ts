export interface CategoryNode {
    _id: any;
    name: string;
    slug: string;
    parent_id?: any;
    is_active?: boolean;
    sort_order?: number;
    children: CategoryNode[];
    [key: string]: any;
}

export function buildCategoryTree(categories: any[]): CategoryNode[] {
    const map = new Map<string, CategoryNode>();
    const roots: CategoryNode[] = [];

    for (const cat of categories) {
        map.set(cat._id.toString(), { ...cat, children: [] });
    }

    for (const cat of categories) {
        const node = map.get(cat._id.toString())!;
        if (cat.parent_id) {
            const parent = map.get(cat.parent_id.toString());
            if (parent) {
                parent.children.push(node);
            } else {
                // Mồ côi: cha đã bị xoá hoặc nằm ngoài tập dữ liệu. Đưa lên gốc còn
                // hơn để nó biến mất khỏi màn hình quản trị mà không ai hay.
                roots.push(node);
            }
        } else {
            roots.push(node);
        }
    }

    sortNodes(roots);
    return roots;
}

function sortNodes(nodes: CategoryNode[]): void {
    nodes.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name), 'vi'));
    for (const n of nodes) sortNodes(n.children);
}

/**
 * Lọc cây nhưng GIỮ LẠI tổ tiên của mọi nút khớp.
 *
 * Nếu chỉ giữ đúng nút khớp thì kết quả tìm kiếm mất ngữ cảnh phân cấp: người
 * dùng thấy "Ly sứ" nhưng không biết nó nằm dưới "Gốm sứ" hay "Quà tặng".
 */
export function filterCategoryTree(
    nodes: CategoryNode[],
    match: (node: CategoryNode) => boolean
): CategoryNode[] {
    return nodes.reduce<CategoryNode[]>((acc, node) => {
        const children = filterCategoryTree(node.children, match);
        if (match(node) || children.length > 0) acc.push({ ...node, children });
        return acc;
    }, []);
}

/** Đếm mọi nút trong rừng cây, không chỉ nút gốc. */
export function countCategoryNodes(nodes: CategoryNode[]): number {
    return nodes.reduce((sum, node) => sum + 1 + countCategoryNodes(node.children), 0);
}
