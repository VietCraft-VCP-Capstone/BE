import { ProductVariant } from '../../product/infrastructure/models/product-variant.model';

type StockModel = Pick<typeof ProductVariant, 'updateOne'>;

/**
 * Trừ kho từng SKU chỉ khi còn đủ hàng (1 lệnh update có điều kiện, không hở race giữa kiểm và trừ).
 * Hụt 1 dòng thì hoàn lại các dòng đã trừ rồi ném lỗi.
 */
export async function reserveVariantStock(
    items: { variant_id: any; quantity: number; title?: string }[],
    model: StockModel = ProductVariant,
): Promise<void> {
    const done: { variant_id: any; quantity: number }[] = [];
    for (const it of items) {
        const res = await model.updateOne(
            { _id: it.variant_id, stock_quantity: { $gte: it.quantity } },
            { $inc: { stock_quantity: -it.quantity } },
        );
        if (!res.modifiedCount) {
            await releaseVariantStock(done, model);
            throw new Error(`Sản phẩm "${it.title || ''}" không đủ hàng cho phân loại đã chọn`);
        }
        done.push(it);
    }
}

export async function releaseVariantStock(items: { variant_id: any; quantity: number }[], model: StockModel = ProductVariant) {
    for (const it of items) {
        await model.updateOne({ _id: it.variant_id }, { $inc: { stock_quantity: it.quantity } });
    }
}
