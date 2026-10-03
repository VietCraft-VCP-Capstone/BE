import mongoose from 'mongoose';
import crypto from 'crypto';
import { Order } from '../infrastructure/models/order.model';
import { byCodeOrId, toBuyerObjectId } from '../utils';

export const SIMULATABLE_ORDER_STATUSES = ['ORDERED', 'SHIPPING', 'DELIVERED'] as const;
export type SimulatableOrderStatus = typeof SIMULATABLE_ORDER_STATUSES[number];

export interface OrderStatusSimulationGate {
    enabled: boolean;
    maxCopiesPerBuyer: number;
}

export function readOrderStatusSimulationGate(env: NodeJS.ProcessEnv = process.env): OrderStatusSimulationGate {
    const maxCopies = Number.parseInt(env.DEV_ORDER_SIMULATION_MAX_COPIES_PER_BUYER || '3', 10);
    return {
        enabled: env.NODE_ENV === 'development' && env.ENABLE_DEV_ORDER_SIMULATION === 'true',
        maxCopiesPerBuyer: Number.isInteger(maxCopies) && maxCopies > 0 ? Math.min(maxCopies, 20) : 3,
    };
}

export function isOrderStatusSimulationEnabled(environment = process.env.NODE_ENV, optIn = process.env.ENABLE_DEV_ORDER_SIMULATION): boolean {
    return environment === 'development' && optIn === 'true';
}

export interface SimulatedOrderStatusResult {
    orderId: string;
    orderCode: string;
    orderStatus: SimulatableOrderStatus;
    paymentStatus: 'PENDING';
}

export interface OrderStatusSimulatorRepository {
    createOwnedTestOrderCopy(orderId: string, buyerId: string, at: Date): Promise<string | null>;
    updateOwnedTestOrder(orderId: string, buyerId: string, target: SimulatableOrderStatus, at: Date): Promise<SimulatedOrderStatusResult | null>;
}

export interface OrderStatusSimulatorClock { now(): Date }

export class OrderStatusSimulationError extends Error {
    constructor(message: string, readonly statusCode = 400) { super(message); this.name = 'OrderStatusSimulationError'; }
}

export function buildOrderStatusSimulationUpdate(target: SimulatableOrderStatus, at: Date) {
    if (!SIMULATABLE_ORDER_STATUSES.some(status => status === target) || !(at instanceof Date) || !Number.isFinite(at.getTime())) {
        throw new OrderStatusSimulationError('Trạng thái mô phỏng không hợp lệ.');
    }
    return {
        $set: { order_status: target },
        $push: { status_history: { status: target, changed_at: at, note: 'Mô phỏng trạng thái trong môi trường development; không thay đổi thanh toán.' } },
    };
}

export class MongoOrderStatusSimulatorRepository implements OrderStatusSimulatorRepository {
    constructor(private readonly maxCopiesPerBuyer = readOrderStatusSimulationGate().maxCopiesPerBuyer) {}

    async createOwnedTestOrderCopy(orderId: string, buyerId: string, at: Date): Promise<string | null> {
        if (!mongoose.Types.ObjectId.isValid(buyerId)) return null;
        const ownerId = toBuyerObjectId(buyerId);
        const source = await Order.findOne({
            ...byCodeOrId(orderId),
            buyer_id: ownerId,
        }).lean();
        if (!source) return null;
        if (source.is_simulated) return source.order_code;
        const sourceKey = String(source._id);
        const testOrderCode = `TEST-STATUS-${sourceKey}`;
        if (!source.shop_id || !source.payment_method || !source.financial_breakdown || !source.shipping_address || !source.shipping_details || !source.items?.length) {
            throw new OrderStatusSimulationError('Đơn hàng chưa đủ dữ liệu để tạo bản sao mô phỏng.');
        }
        const existingTestOrder = await Order.findOne({
            simulation_source_id: source._id,
            buyer_id: ownerId,
            is_simulated: true,
        }).lean();
        if (existingTestOrder) return existingTestOrder.order_code;
        const ownedCopies = await Order.countDocuments({ buyer_id: ownerId, is_simulated: true });
        if (ownedCopies >= this.maxCopiesPerBuyer) {
            throw new OrderStatusSimulationError('Bạn đã đạt giới hạn đơn mô phỏng.', 429);
        }
        try {
            const created = await Order.create({
                buyer_id: source.buyer_id,
                shop_id: new mongoose.Types.ObjectId(),
                order_code: testOrderCode,
                simulation_source_id: source._id,
                is_simulated: true,
                payment_method: source.payment_method,
                payment_status: 'PENDING',
                refund_status: 'NONE',
                order_status: 'ORDERED',
                seller_approval_status: source.seller_approval_status,
                is_pod: source.is_pod,
                order_type: source.order_type,
                shipping_address: source.shipping_address,
                shipping_details: source.shipping_details,
                items: source.items.map(item => ({ ...item, order_item_id: crypto.randomUUID(), item_snapshot: item.item_snapshot || { product_id: String(item.product_id), variant_id: String(item.variant_id), title: item.title, color: item.color, size: item.size, image: item.image, design_file_url: item.design_file_url, custom_notes: item.custom_notes } })),
                financial_breakdown: source.financial_breakdown,
                status_history: [{ status: 'ORDERED', changed_at: at, note: 'Bản sao test; trạng thái thanh toán không mô phỏng.' }],
                order_hour_of_week: source.order_hour_of_week,
            });
            return created.order_code;
        } catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
                const racedTestOrder = await Order.findOne({
                    simulation_source_id: source._id,
                    buyer_id: ownerId,
                    is_simulated: true,
                }).lean();
                if (racedTestOrder) return racedTestOrder.order_code;
            }
            throw error;
        }
    }

    async updateOwnedTestOrder(orderId: string, buyerId: string, target: SimulatableOrderStatus, at: Date): Promise<SimulatedOrderStatusResult | null> {
        if (!mongoose.Types.ObjectId.isValid(buyerId)) return null;
        const filter = {
            ...byCodeOrId(orderId),
            buyer_id: toBuyerObjectId(buyerId),
            is_simulated: true,
        };
        const updated = await Order.findOneAndUpdate(filter, buildOrderStatusSimulationUpdate(target, at), { new: true })
            .select('order_code order_status payment_status')
            .lean();
        if (!updated) return null;
        return {
            orderId: String(updated._id),
            orderCode: updated.order_code,
            orderStatus: updated.order_status as SimulatableOrderStatus,
            paymentStatus: updated.payment_status as 'PENDING',
        };
    }
}

export class OrderStatusSimulationService {
    constructor(
        private readonly repository: OrderStatusSimulatorRepository,
        private readonly environment: string,
        private readonly clock: OrderStatusSimulatorClock = { now: () => new Date() },
        private readonly optIn = process.env.ENABLE_DEV_ORDER_SIMULATION,
    ) {}

    async simulate(input: { orderId: string; buyerId: string; target: SimulatableOrderStatus }): Promise<SimulatedOrderStatusResult> {
        if (!isOrderStatusSimulationEnabled(this.environment, this.optIn)) throw new OrderStatusSimulationError('Mô phỏng trạng thái chưa được bật ở development.', 404);
        if (!input.orderId?.trim() || !input.buyerId?.trim()) throw new OrderStatusSimulationError('Thiếu thông tin đơn hàng hoặc người mua.');
        const at = this.clock.now();
        buildOrderStatusSimulationUpdate(input.target, at);
        const testOrderCode = await this.repository.createOwnedTestOrderCopy(input.orderId, input.buyerId, at);
        if (!testOrderCode) throw new OrderStatusSimulationError('Không tìm thấy đơn hàng của bạn.', 404);
        const result = await this.repository.updateOwnedTestOrder(testOrderCode, input.buyerId, input.target, at);
        if (!result) throw new OrderStatusSimulationError('Không thể cập nhật trạng thái đơn test.', 409);
        return result;
    }
}
