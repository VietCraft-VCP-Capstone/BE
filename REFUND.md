# Refund workflow

Module hoàn tiền của VietCraft nằm tại `src/modules/refund`. Module viết lại theo hướng của
`refund-mvp` (Spring Boot), không chạy hay import code từ project đó: cùng state machine,
idempotency, ledger append-only, executor payOS payout / VietQR thủ công và reconcile job.

## Quy tắc

- Chỉ hoàn toàn bộ đơn đã thanh toán, mỗi đơn tối đa một refund.
- Buyer tạo yêu cầu trong `REFUND_WINDOW_SECONDS` (mặc định 300 giây) tính từ `paid_at`.
  Window chỉ chặn việc tạo; refund tạo ở giây 299 vẫn được thực thi tiếp.
- `Idempotency-Key` (8–200 ký tự) chống double-click: cùng key + cùng body trả lại refund cũ
  (200), khác body hoặc key của buyer khác trả 409.
- VietCraft thu tiền qua VNPay/MOMO/COD nên không có tài khoản đối ứng từ webhook như MVP.
  Buyer luôn tự nhập tài khoản nhận, vì vậy seller/admin phải duyệt trước khi chi (edge 16).
- Tài khoản nhận trùng tài khoản của shop (`bank_info` hoặc `settings.payment.bankAccounts`) hoặc
  của nền tảng (`MERCHANT_BANK_BIN` + `MERCHANT_ACCOUNT_NO`) bị chặn `dest_is_merchant`.
- Seller chỉ xử lý refund của shop mình; admin xử lý được toàn hệ thống.
- Ledger append-only luôn kiểm `refunded + refunding <= paidIn`.
- Job in POD chờ hết refund window. Tạo refund tạm dừng job chưa gửi xưởng; job không chạy được
  khi đơn còn refund mở (kể cả retry thủ công). Reject/cancel đưa đơn lại vào hàng đợi.

## Executor

| Chế độ | Khi nào | Tiền đi thế nào |
| --- | --- | --- |
| `PAYOS_PAYOUT` | `REFUND_MODE=PAYOUT` và health-check payout lúc khởi động thành công | payOS chi từ ví payout sang tài khoản buyer; webhook hoặc reconcile worker chốt kết quả |
| `MANUAL_VIETQR` | `REFUND_MODE=MANUAL`, `STUB_PAYOS=true`, thiếu credential, hoặc health-check lỗi (IP chưa whitelist, kênh chưa bật...) | Seller lấy QR ở `/instruction`, chuyển khoản, rồi `settle` bằng mã giao dịch |

Executor được chốt lúc tạo refund. `GET /api/refunds/meta` cho biết chế độ đang chạy và lý do bị hạ.

An toàn khi chi tiền qua payOS:

- Reference payout là `rf-<mã đơn>` (lần thử đầu) hoặc `rf-<mã đơn>-r<n>`, idempotency key theo lần
  thử. Trước khi tạo và sau mọi lỗi create, BE tra payout theo reference và nhận lại nếu đã có.
- 4xx và lỗi nghiệp vụ payOS (HTTP 200, `code` khác `00`) là từ chối, refund sang `FAILED`.
  Lỗi mạng, 5xx, 408, 429 và "Idempotency key đã tồn tại" là chưa rõ kết quả: refund ở lại
  `EXECUTING` cho reconcile xử lý, không bao giờ đoán là thất bại.
- Retry/cancel luôn tra mọi reference cũ trước: payout cũ đã thành công thì settle, đang chạy thì
  theo dõi tiếp (retry) hoặc từ chối 422 `payout_in_flight` (cancel).
- Reconcile worker chạy mỗi 30 giây với refund `EXECUTING` cũ hơn 10 giây. Quá
  `PAYOS_PAYOUT_TIMEOUT_SECONDS`: payout còn chạy ở payOS thì giữ `EXECUTING` với
  `payout_pending_too_long`; không hề có payout thì `FAILED` với `payout_timeout`.
- Webhook payout chỉ là tín hiệu đánh thức; BE luôn poll lại payOS trước khi đổi trạng thái tiền.

## Trạng thái

```text
REQUESTED -> APPROVED -> EXECUTING -> SETTLED
    |                        |
    v                        v
 REJECTED                 FAILED -> EXECUTING (retry, tối đa REFUND_MAX_ATTEMPTS lần)
                             |
                             v
                          CANCELED (nhả hold)
```

`SETTLED` chuyển đơn sang `payment_status=REFUNDED`, `order_status=CANCELLED` và ghi một
transaction `REFUND`. Đơn `CANCELLED` không còn tính vào doanh thu seller.

## API

Tất cả endpoint cần Bearer token, trừ webhook payout.

```text
GET  /api/refunds/meta                          chế độ executor, window, số lần thử
GET  /api/refunds/orders/:orderId/eligibility   buyer: còn hoàn được không, hạn chót, refund hiện có
POST /api/refunds                               buyer tạo yêu cầu (header Idempotency-Key)
GET  /api/refunds/mine                          refund của buyer
GET  /api/refunds/manage                        hàng đợi seller/admin (?status=&page=&limit=)
GET  /api/refunds/:id                           chi tiết
POST /api/refunds/:id/approve                   seller/admin duyệt và bắt đầu chi
POST /api/refunds/:id/reject                    từ chối REQUESTED {note?}
GET  /api/refunds/:id/instruction               VietQR (qrPayload EMVCo + qrImageUrl) hoặc trạng thái payout
POST /api/refunds/:id/settle                    xác nhận chuyển khoản thủ công {evidenceRef}
POST /api/refunds/:id/retry                     chạy lại refund FAILED
POST /api/refunds/:id/reconcile                 poll payOS ngay, không gửi lệnh chi mới
POST /api/refunds/:id/cancel                    đóng refund FAILED và nhả hold
POST /api/refunds/webhooks/payos-payout         payOS gọi; header x-payos-webhook-secret nếu có đặt secret
```

Tạo yêu cầu:

```http
POST /api/refunds
Authorization: Bearer <buyer-token>
Idempotency-Key: <uuid sinh một lần cho mỗi lần bấm>
Content-Type: application/json

{
  "orderId": "VC-...",
  "reason": "Tôi đổi ý",
  "destBankBin": "970436",
  "destAccountNo": "0123456789",
  "destAccountName": "NGUYEN VAN A"
}
```

`destBankBin` là BIN Napas 6 số; `destBankName` có thể bỏ trống, BE tự điền theo BIN.

Lỗi trả về `{ "error": "<reason>", "message": "..." }`. Lý do FE cần hiển thị:
`window_closed`, `not_paid`, `already_refunded`, `refund_in_progress`, `refund_canceled`,
`order_canceled`, `payment_time_missing`, `dest_is_merchant`, `idempotency_conflict` (409),
`max_attempts_reached`, `payout_in_flight`, `invalid_bank_bin`, `invalid_account_no`.

## Cấu hình

```text
REFUND_WINDOW_SECONDS=300
REFUND_MAX_ATTEMPTS=3
REFUND_MODE=PAYOUT                  # hoặc MANUAL
PAYOS_PAYOUT_TIMEOUT_SECONDS=900
PAYOS_PAYOUT_CLIENT_ID / PAYOS_PAYOUT_API_KEY / PAYOS_PAYOUT_CHECKSUM_KEY
PAYOS_PAYOUT_BASE_URL               # mặc định https://api-merchant.payos.vn
PAYOS_PAYOUT_WEBHOOK_SECRET         # tuỳ chọn
MERCHANT_BANK_BIN / MERCHANT_ACCOUNT_NO   # tuỳ chọn, tài khoản nhận tiền của nền tảng
STUB_PAYOS=false                    # true: ép MANUAL, không giả lập chi tiền trên dữ liệu thật
```

`npm run env:import-payos` chép credential payOS từ `../refund-mvp/.env` sang `.env` (không chép
`JWT_SECRET` hay thông tin DB của project Spring).

payOS payout yêu cầu IP máy chủ nằm trong whitelist trên dashboard. Chạy ở máy dev chưa whitelist,
health-check sẽ lỗi và BE tự chạy `MANUAL_VIETQR`.

## Test

```bash
npm run test:refund
```

Gồm test domain (state machine, eligibility, VietQR, BIN), test executor payOS với SDK giả, và
test luồng đầy đủ trên một `mongod` tạm (cần `mongod` trong PATH; không có thì test luồng tự skip).
Test không đọc `.env` và không gọi payOS thật. Sau mỗi test luồng, invariant ledger được kiểm cho
mọi đơn.
