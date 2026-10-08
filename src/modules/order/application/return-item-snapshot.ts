function amount(value: unknown): number | null {
    if (value == null) return null;
    const numeric = Number(typeof value === 'object' ? String(value) : value);
    return Number.isFinite(numeric) && numeric >= 0 && Number.isSafeInteger(Math.round(numeric)) ? Math.round(numeric) : null;
}

function serializable(value: any): any {
    if (value == null || typeof value !== 'object') return value;
    if (value._bsontype === 'Decimal128' || value._bsontype === 'ObjectId') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(serializable);
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializable(entry)]));
}

/** Persist money as VND integers before structuredClone can strip BSON Decimal128 methods. */
export function buildReturnItemSnapshot(order: any, item: any): { snapshot: Record<string, unknown>; valid: boolean } {
    const quantity = Number(item.quantity);
    const unitPrice = amount(item.retail_price ?? item.item_snapshot?.unit_price ?? item.item_snapshot?.price);
    const subtotal = amount(order.financial_breakdown?.subtotal);
    const discount = amount(order.financial_breakdown?.coupon_discount) ?? 0;
    const gross = unitPrice == null ? null : unitPrice * quantity;
    const valid = Number.isSafeInteger(quantity) && quantity > 0 && gross != null && Number.isSafeInteger(gross) && subtotal != null && subtotal >= gross && discount <= subtotal;
    const allocatedDiscount = valid && subtotal! > 0 ? Math.min(gross!, Math.ceil(discount * gross! / subtotal!)) : 0;
    const paid = valid ? gross! - allocatedDiscount : null;
    return { valid, snapshot: {
        ...serializable(item.item_snapshot || {}),
        title: item.title || item.item_snapshot?.title,
        color: item.color || item.item_snapshot?.color,
        size: item.size || item.item_snapshot?.size,
        image: item.image || item.item_snapshot?.image,
        design_file_url: item.design_file_url || item.item_snapshot?.design_file_url,
        unit_price: unitPrice,
        paid_unit_price_minor: paid == null ? null : Math.floor(paid / quantity),
        item_paid_amount_minor: paid,
        allocated_discount_minor: allocatedDiscount,
        currency: 'VND',
        ordered_quantity: quantity,
    } };
}
