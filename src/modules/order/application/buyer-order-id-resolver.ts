export interface BuyerOrderLookup {
    byId(orderId: string, buyerId: string): Promise<string | null>;
    byOrderCode(orderCode: string, buyerId: string): Promise<string | null>;
}

export function createBuyerOrderIdResolver(lookup: BuyerOrderLookup): (orderId: unknown, buyerId: string) => Promise<string> {
    return async (input, buyerId) => {
        const orderId = typeof input === 'string' ? input.trim() : '';
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(orderId)) {
            throw Object.assign(new Error('Mã đơn hàng không hợp lệ'), { statusCode: 400 });
        }

        const canonicalId = /^[a-f0-9]{24}$/i.test(orderId)
            ? await lookup.byId(orderId, buyerId)
            : await lookup.byOrderCode(orderId, buyerId);
        if (!canonicalId) throw Object.assign(new Error('Không tìm thấy đơn hàng.'), { statusCode: 404 });
        return canonicalId;
    };
}
