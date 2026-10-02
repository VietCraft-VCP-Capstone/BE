const { describe, test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { dist, hasMongod, isolateEnv, startMongo } = require('./helpers/refund-test-env');
const { createFakePayout } = require('./helpers/fake-payos-payout');

const sandbox = isolateEnv();
const mongoose = require('mongoose');
const { ConnectionError } = require('@payos/node');
const { RefundService } = dist('modules/refund/application/refund.service.js');
const { payosPayoutService } = dist('modules/refund/application/payos-payout.service.js');
const { RefundLedgerService } = dist('modules/refund/application/refund-ledger.service.js');
const { Refund } = dist('modules/refund/infrastructure/models/refund.model.js');
const { RefundLedgerEntry } = dist('modules/refund/infrastructure/models/refund-ledger.model.js');
const { Order } = dist('modules/order/infrastructure/models/order.model.js');
const { Transaction } = dist('modules/order/infrastructure/models/transaction.model.js');
const { FulfillmentJob } = dist('modules/order/infrastructure/models/fulfillment-job.model.js');
const { FulfillmentQueueService } = dist('modules/order/application/fulfillment-queue.service.js');
const { Shop } = dist('modules/product/infrastructure/models/shop.model.js');

const { ObjectId, Decimal128 } = mongoose.Types;
const DEST = { destBankBin: '970436', destAccountNo: '0123456789', destAccountName: 'NGUYEN VAN A' };
const ADMIN = { id: String(new ObjectId()), email: 'admin@test', role: 'admin' };
const AMOUNT = 150000;

let mongo;
let fake;
let sequence = 0;

const dec = value => Decimal128.fromString(String(value));
const key = () => `idem-${new ObjectId()}`;

/** Đơn VNPay đã thanh toán `paidSecondsAgo` giây trước, kèm shop, giao dịch PAYMENT và job in đang chờ window. */
async function fixture({ paidSecondsAgo = 10, paymentStatus = 'PAID', shopBank, shopAccounts } = {}) {
    sequence += 1;
    const buyerId = new ObjectId();
    const sellerId = new ObjectId();
    const shopId = new ObjectId();
    const orderId = new ObjectId();
    const orderCode = `VC-${1759461234567 + sequence}-${1000 + sequence}`;
    const paidAt = new Date(Date.now() - paidSecondsAgo * 1000);

    await Shop.collection.insertOne({
        _id: shopId,
        owner_id: sellerId,
        shop_name: `Shop ${sequence}`,
        slug: `shop-${sequence}`,
        ...(shopBank ? { bank_info: shopBank } : {}),
        settings: shopAccounts ? { payment: { bankAccounts: shopAccounts } } : {},
    });
    await Order.collection.insertOne({
        _id: orderId,
        buyer_id: buyerId,
        shop_id: shopId,
        order_code: orderCode,
        payment_method: 'VNPAY',
        payment_status: paymentStatus,
        ...(paymentStatus === 'PAID' ? { paid_at: paidAt } : {}),
        order_status: 'PROCESSING',
        fulfillment_status: 'QUEUED',
        shipping_address: {
            recipient_name: 'Nguyen Van A',
            phone: '0900000000',
            address_detail: '1 Le Loi',
            province_id: '79',
            district_id: '760',
            ward_code: '26734',
        },
        shipping_details: { shipping_fee: dec(30000) },
        items: [],
        financial_breakdown: {
            subtotal: dec(120000),
            shipping_fee: dec(30000),
            coupon_discount: dec(0),
            platform_fee: dec(12000),
            seller_payout_amount: dec(108000),
        },
        status_history: [],
        order_hour_of_week: 1,
        created_at: paidAt,
        updated_at: paidAt,
    });
    if (paymentStatus === 'PAID') {
        await Transaction.collection.insertOne({
            order_id: orderId,
            order_code: orderCode,
            user_id: buyerId,
            gateway: 'VNPAY',
            amount: dec(AMOUNT),
            type: 'PAYMENT',
            status: 'SUCCESS',
            payment_date: paidAt,
            created_at: paidAt,
        });
        await FulfillmentJob.collection.insertOne({
            order_id: orderId,
            order_code: orderCode,
            action: 'DISPATCH_ORDER',
            payload: { order_id: String(orderId) },
            status: 'PENDING',
            attempts: 0,
            max_attempts: 4,
            next_run_at: new Date(paidAt.getTime() + 300_000),
            error_history: [],
        });
    }
    return {
        orderId: String(orderId),
        orderCode,
        buyer: { id: String(buyerId), email: `buyer${sequence}@test`, role: 'buyer' },
        seller: { id: String(sellerId), email: `seller${sequence}@test`, role: 'seller' },
    };
}

async function rejectsWith(promise, reason, statusCode) {
    await assert.rejects(promise, error => {
        assert.equal(error.reason, reason, error.message);
        if (statusCode) assert.equal(error.statusCode, statusCode);
        return true;
    });
}

async function createRefund(f, body = {}) {
    const { refund } = await RefundService.create(f.buyer.id, { orderId: f.orderCode, ...DEST, ...body }, key());
    return refund;
}

/** Reconcile chỉ xét refund EXECUTING cũ hơn 10 giây. */
async function age(refundId, seconds) {
    await Refund.updateOne({ _id: refundId }, { $set: { executed_at: new Date(Date.now() - seconds * 1000) } });
}

async function waitFor(check, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() > deadline) return value;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

async function usePayout(client) {
    payosPayoutService.useClient(client);
    await payosPayoutService.initialize();
}

describe('refund flow trên MongoDB', { skip: hasMongod() ? false : 'cần mongod trong PATH' }, () => {
    before(async () => {
        mongo = await startMongo(sandbox);
        mongoose.set('strictQuery', false);
        await mongoose.connect(mongo.uri);
        await Promise.all([Refund, RefundLedgerEntry, Order, Transaction, FulfillmentJob, Shop].map(model => model.init()));
        fake = createFakePayout();
        await usePayout(fake);
    });

    after(async () => {
        await mongoose.disconnect();
        if (mongo) await mongo.stop();
    });

    afterEach(async () => {
        // A13: sau mọi test, mọi đơn đều thoả refunded + refunding <= paidIn.
        for (const orderId of await Order.distinct('_id')) {
            await RefundLedgerService.assertInvariant(orderId);
        }
        fake.createError = null;
        fake.listError = null;
        fake.balanceError = null;
        fake.balance = 10_000_000;
    });

    test('buyer tạo yêu cầu trong window: REQUESTED, tạm dừng job in, eligibility khớp', async () => {
        const f = await fixture();
        const before = await RefundService.eligibility(f.buyer.id, f.orderCode);
        assert.equal(before.refundEligible, true);
        assert.equal(before.refundBlockedReason, null);
        assert.equal(before.amount, AMOUNT);
        assert.equal(before.refund, null);

        const refund = await createRefund(f);
        assert.equal(refund.status, 'REQUESTED');
        assert.equal(refund.amount, AMOUNT);
        assert.equal(refund.executor, 'PAYOS_PAYOUT');
        assert.equal(refund.destination.bank_name, 'Vietcombank');
        assert.equal(refund.approvalRequired, true);

        const job = await FulfillmentJob.findOne({ order_id: f.orderId });
        assert.equal(job.status, 'FAILED');
        assert.equal(job.last_error, `REFUND_REQUESTED:${refund.id}`);

        const after = await RefundService.eligibility(f.buyer.id, f.orderCode);
        assert.equal(after.refundEligible, false);
        assert.equal(after.refundBlockedReason, 'refund_in_progress');
        assert.equal(after.refund.id, refund.id);
    });

    test('quá window thì 422 window_closed và không có refund (A4)', async () => {
        const f = await fixture({ paidSecondsAgo: 301 });
        await rejectsWith(createRefund(f), 'window_closed', 422);
        assert.equal(await Refund.countDocuments({ order_id: f.orderId }), 0);
        assert.equal((await RefundService.eligibility(f.buyer.id, f.orderCode)).refundBlockedReason, 'window_closed');
    });

    test('đơn chưa thanh toán thì not_paid', async () => {
        const f = await fixture({ paymentStatus: 'PENDING' });
        await rejectsWith(createRefund(f), 'not_paid', 422);
    });

    test('Idempotency-Key: cùng body thì replay, khác body hoặc khác buyer thì 409 (A6, A7)', async () => {
        const f = await fixture();
        const idem = key();
        const body = { orderId: f.orderCode, ...DEST };
        const first = await RefundService.create(f.buyer.id, body, idem);
        const replay = await RefundService.create(f.buyer.id, body, idem);
        assert.equal(first.replayed, false);
        assert.equal(replay.replayed, true);
        assert.equal(replay.refund.id, first.refund.id);
        assert.equal(await Refund.countDocuments({ order_id: f.orderId }), 1);

        await rejectsWith(
            RefundService.create(f.buyer.id, { ...body, destAccountNo: '9876543210' }, idem),
            'idempotency_conflict',
            409,
        );
        const stranger = await fixture();
        await rejectsWith(
            RefundService.create(stranger.buyer.id, body, idem),
            'idempotency_conflict',
            409,
        );
        await rejectsWith(RefundService.create(f.buyer.id, body, 'short'), 'invalid_idempotency_key', 400);
    });

    test('double-click song song chỉ tạo đúng một refund (A5)', async () => {
        const f = await fixture();
        const body = { orderId: f.orderCode, ...DEST };
        const results = await Promise.allSettled([
            RefundService.create(f.buyer.id, body, key()),
            RefundService.create(f.buyer.id, body, key()),
            RefundService.create(f.buyer.id, body, key()),
        ]);
        const created = results.filter(r => r.status === 'fulfilled');
        const rejected = results.filter(r => r.status === 'rejected');
        assert.equal(created.length, 1);
        assert.equal(rejected.length, 2);
        for (const r of rejected) assert.equal(r.reason.reason, 'refund_in_progress');
        assert.equal(await Refund.countDocuments({ order_id: f.orderId }), 1);

        const same = await fixture();
        const idem = key();
        const sameBody = { orderId: same.orderCode, ...DEST };
        const pair = await Promise.all([
            RefundService.create(same.buyer.id, sameBody, idem),
            RefundService.create(same.buyer.id, sameBody, idem),
        ]);
        assert.equal(pair[0].refund.id, pair[1].refund.id);
        assert.deepEqual(pair.map(r => r.replayed).sort(), [false, true]);
    });

    test('tài khoản nhận trùng tài khoản shop hoặc nền tảng thì dest_is_merchant (edge 15)', async () => {
        const shopBank = { bank_code: 'VCB', account_number: '0011223344', account_holder: 'SHOP' };
        const viaBankInfo = await fixture({ shopBank });
        await rejectsWith(
            createRefund(viaBankInfo, { destBankBin: '970436', destAccountNo: '0011 2233 44' }),
            'dest_is_merchant',
            422,
        );

        const viaSettings = await fixture({ shopAccounts: [{ bankCode: 'MB', accountNumber: '5555666677' }] });
        await rejectsWith(
            createRefund(viaSettings, { destBankBin: '970422', destAccountNo: '5555666677' }),
            'dest_is_merchant',
        );

        const platform = await fixture();
        await rejectsWith(
            createRefund(platform, { destBankBin: '970422', destAccountNo: '9999999999' }),
            'dest_is_merchant',
        );

        // Cùng số tài khoản nhưng khác ngân hàng thì là tài khoản khác.
        const otherBank = await fixture({ shopBank });
        const refund = await createRefund(otherBank, { destBankBin: '970418', destAccountNo: '0011223344' });
        assert.equal(refund.status, 'REQUESTED');

        await rejectsWith(createRefund(await fixture(), { destBankBin: 'VCB' }), 'invalid_bank_bin', 400);
        await rejectsWith(createRefund(await fixture(), { destAccountName: '' }), 'invalid_account_name', 400);
    });

    test('quyền: seller shop khác không thấy refund, buyer không duyệt được', async () => {
        const f = await fixture();
        const other = await fixture();
        const refund = await createRefund(f);

        await rejectsWith(RefundService.approve(refund.id, other.seller), 'refund_not_found', 404);
        await rejectsWith(RefundService.get(refund.id, other.seller), 'refund_not_found', 404);
        await rejectsWith(RefundService.get(refund.id, other.buyer), 'refund_not_found', 404);
        await rejectsWith(RefundService.approve(refund.id, f.buyer), 'forbidden', 403);

        assert.equal((await RefundService.get(refund.id, f.buyer)).id, refund.id);
        assert.equal((await RefundService.get(refund.id, f.seller)).id, refund.id);
        assert.equal((await RefundService.get(refund.id, ADMIN)).id, refund.id);
        // Seller đi mua hàng vẫn xem được refund của chính mình.
        assert.equal((await RefundService.get(refund.id, { ...f.buyer, role: 'seller' })).id, refund.id);

        const managed = await RefundService.listManaged(f.seller, {});
        assert.deepEqual(managed.items.map(item => item.id), [refund.id]);
        const mine = await RefundService.listMine(f.buyer.id, {});
        assert.deepEqual(mine.items.map(item => item.id), [refund.id]);
    });

    test('duyệt -> payout PENDING -> reconcile thấy SUCCESS -> SETTLED, đơn REFUNDED (A3)', async () => {
        const f = await fixture();
        const refund = await createRefund(f);
        const executing = await RefundService.approve(refund.id, f.seller);
        assert.equal(executing.status, 'EXECUTING');
        assert.equal(executing.providerReference, `rf-${f.orderCode}`);
        assert.ok(executing.payoutId);
        assert.equal(executing.attemptCount, 1);
        assert.deepEqual(executing.ledger, { paidIn: AMOUNT, refunded: 0, refunding: AMOUNT, available: AMOUNT });
        await rejectsWith(RefundService.settle(refund.id, f.seller, 'FT123456'), 'invalid_executor');

        fake.settle(`rf-${f.orderCode}`, 'FT26276000001');
        await RefundService.reconcilePendingPayOS();
        assert.equal((await Refund.findById(refund.id)).status, 'EXECUTING', 'reconcile bỏ qua refund mới hơn 10s');

        await age(refund.id, 11);
        await RefundService.reconcilePendingPayOS();
        const settled = await RefundService.get(refund.id, f.buyer);
        assert.equal(settled.status, 'SETTLED');
        assert.equal(settled.evidenceRef, 'FT26276000001');
        assert.deepEqual(settled.ledger, { paidIn: AMOUNT, refunded: AMOUNT, refunding: 0, available: 0 });

        const order = await Order.findById(f.orderId);
        assert.equal(order.payment_status, 'REFUNDED');
        assert.equal(order.order_status, 'CANCELLED');
        assert.equal(order.fulfillment_status, 'CANCELLED');
        assert.equal(await Transaction.countDocuments({ order_id: f.orderId, type: 'REFUND', status: 'SUCCESS' }), 1);
        assert.equal(fake.createCalls.filter(c => c.referenceId === `rf-${f.orderCode}`).length, 1);

        // Chạy lại reconcile/webhook không ghi tiền hai lần.
        await RefundService.handlePayOSWebhook({ data: { id: executing.payoutId } });
        await age(refund.id, 11);
        await RefundService.reconcilePendingPayOS();
        assert.equal(await Transaction.countDocuments({ order_id: f.orderId, type: 'REFUND' }), 1);
        assert.equal(await RefundLedgerEntry.countDocuments({ order_id: f.orderId, type: 'REFUND_SETTLED' }), 1);

        const job = await FulfillmentJob.findOne({ order_id: f.orderId });
        assert.equal(await FulfillmentQueueService.processJob(job), false);
        assert.equal((await RefundService.eligibility(f.buyer.id, f.orderCode)).refundBlockedReason, 'already_refunded');
    });

    test('webhook payout chỉ là tín hiệu: BE poll lại payOS rồi mới settle', async () => {
        const f = await fixture();
        const refund = await createRefund(f);
        const executing = await RefundService.approve(refund.id, f.seller);

        await RefundService.handlePayOSWebhook({ data: { id: executing.payoutId, approvalState: 'COMPLETED' } });
        assert.equal((await Refund.findById(refund.id)).status, 'EXECUTING', 'payload giả mạo không được settle');

        fake.settle(`rf-${f.orderCode}`);
        await RefundService.handlePayOSWebhook({ data: { referenceId: `rf-${f.orderCode}` } });
        assert.equal((await Refund.findById(refund.id)).status, 'SETTLED');
    });

    test('payout lỗi: FAILED giữ hold, retry tối đa 3 lần, cancel nhả hold và trả đơn về sản xuất (A11)', async () => {
        const f = await fixture();
        const refund = await createRefund(f);

        fake.balance = 1000;
        const failed = await RefundService.approve(refund.id, f.seller);
        assert.equal(failed.status, 'FAILED');
        assert.equal(failed.failureReason, 'insufficient_wallet_balance');
        assert.equal(failed.ledger.refunding, AMOUNT, 'hold vẫn giữ khi FAILED');
        assert.equal((await Order.findById(f.orderId)).payment_status, 'PAID');

        fake.balance = 10_000_000;
        const second = await RefundService.retry(refund.id, f.seller);
        assert.equal(second.status, 'EXECUTING');
        assert.equal(second.attemptCount, 2);
        assert.equal(second.providerReference, `rf-${f.orderCode}-r2`);

        fake.fail(`rf-${f.orderCode}-r2`);
        await age(refund.id, 11);
        await RefundService.reconcilePendingPayOS();
        const rejected = await Refund.findById(refund.id);
        assert.equal(rejected.status, 'FAILED');
        assert.equal(rejected.failure_reason, 'payout_rejected:BANK_REJECTED');

        const third = await RefundService.retry(refund.id, f.seller);
        assert.equal(third.attemptCount, 3);
        fake.fail(`rf-${f.orderCode}-r3`);
        await age(refund.id, 11);
        await RefundService.reconcilePendingPayOS();
        await rejectsWith(RefundService.retry(refund.id, f.seller), 'max_attempts_reached', 422);

        const canceled = await RefundService.cancel(refund.id, f.seller);
        assert.equal(canceled.status, 'CANCELED');
        assert.deepEqual(canceled.ledger, { paidIn: AMOUNT, refunded: 0, refunding: 0, available: AMOUNT });
        assert.equal((await Order.findById(f.orderId)).payment_status, 'PAID');
        const requeued = await waitFor(() => FulfillmentJob.findOne({ order_id: f.orderId, status: 'PENDING' }));
        assert.ok(requeued, 'đơn được đưa lại vào hàng đợi in');
        await rejectsWith(createRefund(f), 'refund_canceled', 422);
    });

    test('retry thấy payout lần trước đã thành công thì settle, không chi lần hai', async () => {
        const f = await fixture();
        const refund = await createRefund(f);
        await RefundService.approve(refund.id, f.seller);
        // Giả lập reconcile đánh FAILED trong khi payOS sau đó vẫn chi thành công.
        await Refund.updateOne({ _id: refund.id }, { $set: { status: 'FAILED', failure_reason: 'payout_timeout' } });
        fake.settle(`rf-${f.orderCode}`);

        const calls = fake.createCalls.length;
        const resumed = await RefundService.retry(refund.id, f.seller);
        assert.equal(resumed.status, 'SETTLED');
        assert.equal(fake.createCalls.length, calls);
    });

    test('cancel bị chặn khi payout vẫn đang chạy ở payOS', async () => {
        const f = await fixture();
        const refund = await createRefund(f);
        await RefundService.approve(refund.id, f.seller);
        await Refund.updateOne({ _id: refund.id }, { $set: { status: 'FAILED' } });
        await rejectsWith(RefundService.cancel(refund.id, f.seller), 'payout_in_flight', 422);

        fake.listError = new ConnectionError('payOS down');
        await rejectsWith(RefundService.cancel(refund.id, f.seller), 'payout_lookup_failed', 502);
    });

    test('reconcile quá hạn: payout còn chạy thì giữ EXECUTING, không có payout thì FAILED payout_timeout', async () => {
        const inFlight = await fixture();
        const live = await createRefund(inFlight);
        await RefundService.approve(live.id, inFlight.seller);
        await age(live.id, 61);
        await RefundService.reconcilePendingPayOS();
        const pending = await Refund.findById(live.id);
        assert.equal(pending.status, 'EXECUTING');
        assert.equal(pending.failure_reason, 'payout_pending_too_long');

        const lost = await fixture();
        const refund = await createRefund(lost);
        fake.createError = { error: new ConnectionError('socket hang up') };
        const unknown = await RefundService.approve(refund.id, lost.seller);
        fake.createError = null;
        assert.equal(unknown.status, 'EXECUTING');
        assert.equal(unknown.failureReason, 'payout_outcome_unknown');
        assert.ok(Date.now() - (await Refund.findById(refund.id)).executed_at.getTime() < 5000, 'executed_at được đặt lại');

        await age(refund.id, 61);
        await RefundService.reconcilePendingPayOS();
        const timedOut = await Refund.findById(refund.id);
        assert.equal(timedOut.status, 'FAILED');
        assert.equal(timedOut.failure_reason, 'payout_timeout');

        const retried = await RefundService.retry(refund.id, lost.seller);
        assert.equal(retried.status, 'EXECUTING');
        assert.equal(retried.providerReference, `rf-${lost.orderCode}-r2`);
    });

    test('chế độ VietQR thủ công: instruction có QR, seller xác nhận bằng mã giao dịch', async () => {
        const broken = createFakePayout();
        broken.balanceError = new ConnectionError('IP chưa whitelist');
        await usePayout(broken);
        try {
            const f = await fixture();
            const refund = await createRefund(f);
            assert.equal(refund.executor, 'MANUAL_VIETQR');
            assert.equal(refund.provider.degraded, true);

            const executing = await RefundService.approve(refund.id, f.seller);
            assert.equal(executing.status, 'EXECUTING');
            assert.equal(broken.createCalls.length, 0, 'chế độ thủ công không gọi payout');

            const instruction = await RefundService.instruction(refund.id, f.seller);
            assert.equal(instruction.bankName, 'Vietcombank');
            assert.equal(instruction.content, `HOAN ${f.orderCode.replace(/-/g, '')}`);
            assert.ok(instruction.content.length <= 25);
            assert.ok(instruction.qrPayload.includes('0006970436'));
            assert.ok(instruction.qrPayload.includes(`54${String(AMOUNT).length.toString().padStart(2, '0')}${AMOUNT}`));

            await rejectsWith(RefundService.settle(refund.id, f.seller, 'ab'), 'invalid_evidence', 400);
            const settled = await RefundService.settle(refund.id, f.seller, 'FT26276999999');
            assert.equal(settled.status, 'SETTLED');
            assert.equal(settled.evidenceRef, 'FT26276999999');
            assert.equal((await Order.findById(f.orderId)).payment_status, 'REFUNDED');
            await rejectsWith(RefundService.settle(refund.id, f.seller, 'FT26276999999'), 'invalid_state');
        } finally {
            await usePayout(fake);
        }
    });

    test('seller từ chối: REJECTED, đơn vẫn PAID và quay lại hàng đợi in', async () => {
        const f = await fixture();
        const refund = await createRefund(f);
        const rejected = await RefundService.reject(refund.id, f.seller, 'Đã in xong');
        assert.equal(rejected.status, 'REJECTED');
        assert.equal(rejected.failureReason, 'Đã in xong');
        assert.equal((await Order.findById(f.orderId)).payment_status, 'PAID');
        assert.ok(await waitFor(() => FulfillmentJob.findOne({ order_id: f.orderId, status: 'PENDING' })));
        await rejectsWith(RefundService.approve(refund.id, f.seller), 'invalid_state');
        assert.equal((await RefundService.eligibility(f.buyer.id, f.orderCode)).refundBlockedReason, 'refund_canceled');
    });

    test('HTTP: route thật, JWT thật, đúng mã trạng thái 201/200/409/422/403', async () => {
        const app = dist('app/app.js').default;
        const jwt = require('jsonwebtoken');
        const server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}/api/refunds`;
        try {
            const f = await fixture();
            const sign = actor => jwt.sign({ id: actor.id, email: actor.email, role: actor.role }, process.env.JWT_SECRET);
            const buyerToken = sign(f.buyer);
            const call = (method, path, { auth = buyerToken, body, headers = {} } = {}) => fetch(base + path, {
                method,
                headers: {
                    'content-type': 'application/json',
                    ...(auth ? { authorization: `Bearer ${auth}` } : {}),
                    ...headers,
                },
                body: body ? JSON.stringify(body) : undefined,
            });

            assert.equal((await call('GET', '/meta', { auth: null })).status, 401);
            assert.equal((await (await call('GET', '/meta')).json()).refundWindowSeconds, 300);

            const eligibility = await call('GET', `/orders/${f.orderCode}/eligibility`);
            assert.equal(eligibility.status, 200);
            assert.equal((await eligibility.json()).data.refundEligible, true);

            const idem = key();
            const body = { orderId: f.orderCode, ...DEST };
            const created = await call('POST', '', { body, headers: { 'idempotency-key': idem } });
            assert.equal(created.status, 201);
            const { data } = await created.json();
            assert.equal((await call('POST', '', { body, headers: { 'idempotency-key': idem } })).status, 200);

            const conflict = await call('POST', '', { body: { ...body, reason: 'khác' }, headers: { 'idempotency-key': idem } });
            assert.equal(conflict.status, 409);
            assert.equal((await conflict.json()).error, 'idempotency_conflict');
            const again = await call('POST', '', { body, headers: { 'idempotency-key': key() } });
            assert.equal(again.status, 422);
            assert.equal((await again.json()).error, 'refund_in_progress');

            assert.equal((await call('POST', `/${data.id}/approve`)).status, 403);
            const approved = await call('POST', `/${data.id}/approve`, { auth: sign(f.seller) });
            assert.equal(approved.status, 200);
            assert.equal((await approved.json()).data.status, 'EXECUTING');

            fake.settle(`rf-${f.orderCode}`);
            const hook = await call('POST', '/webhooks/payos-payout', {
                auth: null,
                body: { data: { referenceId: `rf-${f.orderCode}` } },
            });
            assert.equal(hook.status, 200);
            const detail = await (await call('GET', `/${data.id}`)).json();
            assert.equal(detail.data.status, 'SETTLED');
        } finally {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('job in không được chạy khi đơn còn refund mở, kể cả retry thủ công', async () => {
        const f = await fixture();
        const refund = await createRefund(f);
        const job = await FulfillmentJob.findOne({ order_id: f.orderId });
        assert.equal(await FulfillmentQueueService.retryManually(String(job._id)), false);
        const after = await FulfillmentJob.findById(job._id);
        assert.equal(after.status, 'FAILED');
        assert.equal(after.last_error, `REFUND_OPEN:${refund.id}`);
        assert.equal((await Order.findById(f.orderId)).fulfillment_status, 'QUEUED');
    });
});
