/**
 * payOS payout giả trong bộ nhớ, cùng hình dạng với phần SDK `@payos/node` mà refund dùng
 * (payouts.create/get/list, payoutsAccount.balance). Test điều khiển trạng thái payout và
 * chèn lỗi để tái hiện các edge case của spec (mất kết nối sau create, số dư thiếu...).
 */
function createFakePayout() {
    const byReference = new Map();
    let sequence = 0;

    const fake = {
        balance: 10_000_000,
        createCalls: [],
        /** Lỗi ném ra từ create; `afterAccept: true` nghĩa là payOS đã nhận payout rồi mới rớt kết nối. */
        createError: null,
        listError: null,
        balanceError: null,

        payouts: {
            async create(body, idempotencyKey) {
                fake.createCalls.push({ ...body, idempotencyKey });
                const failure = fake.createError;
                if (failure && !failure.afterAccept) throw failure.error;
                sequence += 1;
                const payout = {
                    id: `po_${sequence}`,
                    referenceId: body.referenceId,
                    category: null,
                    approvalState: 'SUBMITTED',
                    createdAt: new Date().toISOString(),
                    transactions: [{
                        id: `tx_${sequence}`,
                        referenceId: body.referenceId,
                        amount: body.amount,
                        description: body.description,
                        toBin: body.toBin,
                        toAccountNumber: body.toAccountNumber,
                        toAccountName: null,
                        reference: null,
                        transactionDatetime: null,
                        errorMessage: null,
                        errorCode: null,
                        state: 'RECEIVED',
                    }],
                };
                byReference.set(body.referenceId, payout);
                if (failure) throw failure.error;
                return structuredClone(payout);
            },
            async get(payoutId) {
                const payout = [...byReference.values()].find(item => item.id === payoutId);
                if (!payout) throw new Error(`payout ${payoutId} not found`);
                return structuredClone(payout);
            },
            async list(params = {}) {
                if (fake.listError) throw fake.listError;
                const data = [...byReference.values()]
                    .filter(item => !params.referenceId || item.referenceId === params.referenceId)
                    .map(item => structuredClone(item));
                return { data };
            },
        },
        payoutsAccount: {
            async balance() {
                if (fake.balanceError) throw fake.balanceError;
                return { accountNumber: '0000000000', accountName: 'VIETCRAFT', currency: 'VND', balance: String(fake.balance) };
            },
        },

        payout(referenceId) {
            return byReference.get(referenceId);
        },
        /** Đẩy payout sang trạng thái cuối như khi ngân hàng trả kết quả. */
        settle(referenceId, bankReference = `FT${Date.now()}`) {
            const payout = byReference.get(referenceId);
            payout.approvalState = 'COMPLETED';
            payout.transactions[0].state = 'SUCCEEDED';
            payout.transactions[0].reference = bankReference;
        },
        fail(referenceId, errorCode = 'BANK_REJECTED', errorMessage = 'Tài khoản không hợp lệ') {
            const payout = byReference.get(referenceId);
            payout.approvalState = 'FAILED';
            payout.transactions[0].state = 'FAILED';
            payout.transactions[0].errorCode = errorCode;
            payout.transactions[0].errorMessage = errorMessage;
        },
        /** Payout có sẵn ở payOS mà không qua create (vd. lần thử trước đã chi nhưng DB không ghi kịp). */
        seed(referenceId, amount, state = 'SUCCEEDED') {
            sequence += 1;
            byReference.set(referenceId, {
                id: `po_${sequence}`,
                referenceId,
                category: null,
                approvalState: state === 'SUCCEEDED' ? 'COMPLETED' : 'PROCESSING',
                createdAt: new Date().toISOString(),
                transactions: [{
                    id: `tx_${sequence}`, referenceId, amount, description: 'seed', toBin: '970436',
                    toAccountNumber: '0123456789', toAccountName: null,
                    reference: state === 'SUCCEEDED' ? `FT-SEED-${sequence}` : null,
                    transactionDatetime: null, errorMessage: null, errorCode: null, state,
                }],
            });
        },
    };
    return fake;
}

module.exports = { createFakePayout };
