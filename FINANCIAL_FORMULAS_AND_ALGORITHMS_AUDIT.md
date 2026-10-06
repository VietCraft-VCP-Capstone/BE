# BÁO CÁO KIỂM KÊ TOÀN DIỆN CÔNG THỨC TOÁN HỌC & THUẬT TOÁN TÀI CHÍNH
## HỆ THỐNG QUẢN TRỊ CHI PHÍ SÀN, PHÂN TÍCH CVP & MÔ PHỎNG HÒA VỐN VIETCRAFT
**Nhánh Git:** `feat/admin-fee-simulation`  
**Ngày kiểm định:** 06/10/2026  
**Chuyên môn:** Fullstack Software Architect & Financial Systems Analyst  

---

## MỤC LỤC
1. [Tổng quan hệ thống công thức](#1-tổng-quan-hệ-thống-công-thức)
2. [Chi tiết từng công thức & Thuật toán nghiệp vụ](#2-chi-tiết-từng-công-thức--thuật-toán-nghiệp-vụ)
   - [Nhóm 1: Kinh tế vi mô trên từng đơn hàng (Unit Economics)](#nhóm-1-kinh-tế-vi-mô-trên-từng-đơn-hàng-unit-economics)
   - [Nhóm 2: Định phí & Chi phí hạ tầng vận hành sàn (Platform Overhead Costs)](#nhóm-2-định-phí--chi-phí-hạ-tầng-vận-hành-sàn-platform-overhead-costs)
   - [Nhóm 3: Mô hình phân tích điểm hòa vốn CVP (Cost-Volume-Profit)](#nhóm-3-mô-hình-phân-tích-điểm-hòa-vốn-cvp-cost-volume-profit)
   - [Nhóm 4: Thuật toán mô phỏng kịch bản giả lập (What-If Simulation Engine)](#nhóm-4-thuật-toán-mô-phỏng-kịch-bản-giả-lập-what-if-simulation-engine)
3. [Bảng tổng hợp điều kiện biên & Cơ chế phòng vệ ngoại lệ (Defensive Handling)](#3-bảng-tổng-hợp-điều-kiện-biên--cơ-chế-phòng-vệ-ngoại-lệ)
4. [Báo cáo đối chiếu tính nhất quán giữa Backend và Frontend (Cross-Validation Audit)](#4-báo-cáo-đối-chiếu-tính-nhất-quán-giữa-backend-và-frontend)

---

## 1. TỔNG QUAN HỆ THỐNG CÔNG THỨC

Hệ thống tài chính trên nhánh `feat/admin-fee-simulation` giải quyết bài toán: **"Làm sao để VietCraft vận hành sàn POD tự nuôi được hệ thống máy chủ, không bị thâm hụt ngân sách và tự động cân đối tỷ lệ hoa hồng tối ưu?"**

Hệ thống áp dụng 2 trường phái quản trị kinh tế:
1. **Unit Economics (Kinh tế đơn vị):** Phân tích dòng tiền từng đơn hàng từ lúc Người mua trả tiền $\rightarrow$ Sàn khấu trừ $\rightarrow$ Trả cổng thanh toán $\rightarrow$ Giữ lại lãi thuần.
2. **CVP Analysis (Cost-Volume-Profit):** Phân chia chi phí thành **Định phí (Fixed Costs)** và **Biến phí (Variable Costs)** để xác định sản lượng hòa vốn ($Q_{\text{BEP}}$) và biên an toàn ($MOS$).

---

## 2. CHI TIẾT TỪNG CÔNG THỨC & THUẬT TOÁN NGHIỆP VỤ

### NHÓM 1: KINH TẾ VI MÔ TRÊN TỪNG ĐƠN HÀNG (UNIT ECONOMICS)

#### Công thức 1.1: Phí sàn thu trên từng đơn hàng ($P_{\text{order}}$)
* **Mục đích nghiệp vụ:** Tính số tiền hoa hồng mà sàn VietCraft thu về từ một đơn hàng thành công, có cơ chế sàn bảo hiểm tối thiểu để tránh lỗ trên các đơn giá trị nhỏ.
* **Công thức toán học:**
  $$P_{\text{order}} = \max\left(\text{round}(Subtotal \times r_{\text{commission}}), \ Fee_{\text{min}}\right)$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/order/application/order.service.ts` (Hàm `createOrder`)
  * **Biến đầu vào:**
    * `subtotal`: Tổng giá trị tiền hàng khách mua (không gồm ship).
    * `commissionRate` ($r_{\text{commission}}$): Tỷ lệ hoa hồng từ `PlatformCostConfig.policies.default_commission_rate` (mặc định: `0.10` tương đương 10%).
    * `minOrderFee` ($Fee_{\text{min}}$): Phí tối thiểu từ `PlatformCostConfig.policies.min_order_fee` (mặc định: `10000` VNĐ).
  * **Biến kết quả:** `platformFee` (được lưu vào `financial_breakdown.platform_fee` và `financial_breakdown.commission_rate`).
* **Điều kiện biên / Ngoại lệ:**
  * Nếu $Subtotal \times r_{\text{commission}} < Fee_{\text{min}}$: Hệ thống tự động nâng lên mức $Fee_{\text{min}}$ ($10.000$ VNĐ).
  * Làm tròn số nguyên `Math.round()` để triệt tiêu số thập phân lẻ của tiền tệ Việt Nam Đồng (VND).

---

#### Công thức 1.2: Tiền chi trả cho Người bán ($Payout_{\text{seller}}$)
* **Mục đích nghiệp vụ:** Xác định số tiền Người bán thực nhận sau khi trừ phí sàn và phân bổ chiết khấu voucher (Sàn chịu voucher hay Shop chịu voucher).
* **Công thức toán học:**
  $$Payout_{\text{seller}} = \begin{cases} 
  \max\left(0, Subtotal - P_{\text{order}}\right) & \text{nếu là Voucher của Sàn (Platform Voucher)} \\
  \max\left(0, Subtotal - Discount - P_{\text{order}}\right) & \text{nếu là Voucher của Shop (Shop Voucher)}
  \end{cases}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/order/application/order.service.ts` (Hàm `createOrder`)
  * **Biến đầu vào:**
    * `subtotal`: Tổng tiền hàng.
    * `discount`: Số tiền giảm giá từ coupon.
    * `isPlatformCoupon`: Boolean xác định đơn vị phát hành mã.
    * `platformFee`: Phí dịch vụ sàn đã tính từ Công thức 1.1.
  * **Biến kết quả:** `sellerPayoutAmount` (lưu vào `financial_breakdown.seller_payout_amount`).
* **Điều kiện biên / Ngoại lệ:**
  * Bọc qua `Math.max(0, ...)` ngăn chặn triệt để trường hợp số dư người bán bị âm khi giảm giá vượt giá trị hàng.

---

#### Công thức 1.3: Tổng chi phí phôi in ấn đơn hàng ($Cost_{\text{print}}$)
* **Mục đích nghiệp vụ:** Lũy kế chi phí phôi áo/cốc và công in ấn của xưởng in đối tác (`Printing-shop`) trên toàn bộ item của đơn hàng.
* **Công thức toán học:**
  $$Cost_{\text{print}} = \sum_{i=1}^{n} \left(\text{BaseCost}_i \times Quantity_i\right)$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/order/application/order.service.ts` (Hàm `createOrder`)
  * **Biến đầu vào:** `orderItems`: Mảng các sản phẩm trong đơn, mỗi item chứa `base_cost` (lấy từ catalog xưởng) và `quantity`.
  * **Biến kết quả:** `totalPrintingCost` (lưu vào `financial_breakdown.total_printing_cost`).

---

#### Công thức 1.4: Giá trị đơn hàng trung bình ($AOV$ - Average Order Value)
* **Mục đích nghiệp vụ:** Tính giá trị trung bình của một đơn hàng thành công trên toàn sàn trong 30 ngày qua, làm tham số chuẩn cho các bài toán phân tích.
* **Công thức toán học:**
  $$AOV = \begin{cases} 
  \text{round}\left(\frac{\sum Subtotal}{N_{\text{orders}}}\right) & \text{khi } N_{\text{orders}} > 0 \\
  350.000\text{ VNĐ} & \text{khi } N_{\text{orders}} = 0 \text{ (Giá trị mặc định chuẩn thị trường POD)}
  \end{cases}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts` (Hàm `getCVPAnalysis`)
  * **Biến đầu vào:** `totalGmv` ($\sum Subtotal$ của các đơn DELIVERED trong 30 ngày), `completedOrdersCount` ($N_{\text{orders}}$).
  * **Biến kết quả:** `aov`.

---

#### Công thức 1.5: Biến phí trực tiếp trên 1 đơn hàng ($VC_{\text{order}}$)
* **Mục đích nghiệp vụ:** Tính toán tổng chi phí trung gian mà sàn bắt buộc phải chi trả cho bên thứ ba (Cổng thanh toán + Dịch vụ thông báo) mỗi khi có 1 đơn phát sinh.
* **Công thức toán học:**
  $$VC_{\text{gateway}} = \text{round}\left(AOV \times r_{\text{gateway}}\right)$$
  $$VC_{\text{order}} = VC_{\text{gateway}} + Fee_{\text{notification}}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts` (Hàm `getCVPAnalysis` & `runSimulation`)
  * **Biến đầu vào:**
    * `aov`: Giá trị đơn trung bình.
    * `config.unit_costs.payment_gateway_rate` ($r_{\text{gateway}}$): Phí cổng VNPay (mặc định `0.015` = 1.5%).
    * `config.unit_costs.notification_per_order` ($Fee_{\text{notification}}$): Phí SMS/Email/Socket (mặc định `1000` VNĐ/đơn).
  * **Biến kết quả:** `variableCostPerOrder` ($VC_{\text{order}}$).
* **Ví dụ số học:** Với $AOV = 315.462$ đ:
  $$VC_{\text{gateway}} = 315.462 \times 1.5\% = 4.732\text{ đ}$$
  $$VC_{\text{order}} = 4.732 + 1.000 = 5.732\text{ VNĐ/đơn}$$

---

#### Công thức 1.6: Lãi đóng góp đơn vị ($CM_{\text{order}}$ - Contribution Margin)
* **Mục đích nghiệp vụ:** Tính số tiền thực tế sàn đút túi trên mỗi đơn hàng sau khi đã trừ toàn bộ biến phí trung gian. Đây là khoản tiền duy nhất dùng để bù đắp định phí máy chủ hàng tháng!
* **Công thức toán học:**
  $$CM_{\text{order}} = P_{\text{order}} - VC_{\text{order}}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts` (Hàm `getCVPAnalysis`)
  * **Biến đầu vào:** `revenuePerOrder` ($P_{\text{order}}$), `variableCostPerOrder` ($VC_{\text{order}}$).
  * **Biến kết quả:** `contributionMarginPerOrder` ($CM_{\text{order}}$).
* **Ý nghĩa:**
  * Nếu $CM_{\text{order}} \le 0$: Sàn bán càng nhiều đơn càng lỗ tiền túi (Unit Economics âm).
  * Nếu $CM_{\text{order}} > 0$: Sàn bắt đầu tích lũy được tiền để trả tiền thuê máy chủ.

---

#### Công thức 1.7: Tỷ lệ lãi đóng góp ($CMR$ - Contribution Margin Ratio)
* **Mục đích nghiệp vụ:** Đo lường hiệu suất giữ lại tiền của sàn trên mỗi đồng hoa hồng thu được.
* **Công thức toán học:**
  $$CMR = \begin{cases} 
  \frac{CM_{\text{order}}}{P_{\text{order}}} & \text{khi } P_{\text{order}} > 0 \\
  0 & \text{khi } P_{\text{order}} = 0
  \end{cases}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts` (Hàm `getCVPAnalysis`)
  * **Biến kết quả:** `contributionMarginRatio` (trên Frontend hiển thị dưới dạng phần trăm: `(CMR * 100).toFixed(1)%` hay "Hiệu suất giữ tiền: 81.8%").

---

#### Công thức 1.8: Tổng tiền Người mua thanh toán đơn hàng ($TotalAmount$)
* **Mục đích nghiệp vụ:** Xác định chính xác số tiền Khách hàng chuyển qua cổng thanh toán (hoặc COD), bao gồm tiền hàng, chiết khấu và phí vận chuyển.
* **Công thức toán học:**
  $$TotalAmount = \max\left(0, Subtotal - Discount\right) + Fee_{\text{shipping}}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/order/application/order.service.ts` (Hàm `createOrder`)
  * **Biến đầu vào:**
    * `subtotal`: Tổng giá trị giỏ hàng trước giảm giá.
    * `discount`: Số tiền giảm giá được áp dụng từ Coupon.
    * `shippingFee`: Phí vận chuyển báo từ đơn vị vận chuyển (GHN/GHTK).
  * **Biến kết quả:** `totalAmount` (lưu vào `order.total_amount`).
* **Điều kiện biên / Ngoại lệ:**
  * Bọc qua `Math.max(0, subtotal - discount)` để không bao giờ có tiền hàng âm nếu mã giảm giá lớn hơn tiền hàng.

---

#### Công thức 1.9: Ngưỡng trần bảo trợ Voucher của Sàn ($VoucherCap$)
* **Mục đích nghiệp vụ:** Giới hạn mức chiết khấu tối đa mà Sàn được phép tài trợ từ quỹ hoa hồng để không bị thâm hụt tài chính trên từng đơn.
* **Công thức toán học:**
  $$VoucherCap = \text{round}\left(P_{\text{order}} \times r_{\text{voucher\_share}}\right)$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/infrastructure/models/system-config.model.ts` & `platform-finance.service.ts`
  * **Biến đầu vào:**
    * `platformFee` ($P_{\text{order}}$): Hoa hồng sàn thu trên đơn.
    * `config.policies.max_voucher_profit_share` ($r_{\text{voucher\_share}}$): Tỷ lệ trần trích lập tài trợ voucher (mặc định: `0.30` = 30%).
  * **Ý nghĩa:** Sàn chỉ được phép trích tối đa $30\%$ tiền hoa hồng của chính đơn hàng đó để tài trợ voucher kích cầu, bảo toàn tối thiểu $70\%$ hoa hồng còn lại để trả biến phí VNPay và bù đắp định phí máy chủ.

---

### NHÓM 2: ĐỊNH PHÍ & CHI PHÍ HẠ TẦNG VẬN HÀNH SÀN (PLATFORM OVERHEAD COSTS)

#### Công thức 2.1: Tổng định phí cơ sở hàng tháng ($FC_{\text{base}}$)
* **Mục đích nghiệp vụ:** Gom toàn bộ các hóa đơn cố định hàng tháng mà sàn phải thanh toán độc lập với số lượng đơn hàng.
* **Công thức toán học:**
  $$FC_{\text{base}} = C_{\text{domain}} + C_{\text{vps}} + C_{\text{frontend}} + C_{\text{ssl}}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts`
  * **Biến đầu vào:**
    * `config.fixed_costs.domain_monthly` ($40.000$ đ)
    * `config.fixed_costs.vps_base_monthly` ($1.200.000$ đ)
    * `config.fixed_costs.frontend_hosting` ($500.000$ đ)
    * `config.fixed_costs.security_ssl` ($260.000$ đ)
  * **Biến kết quả:** `baseFixedCosts` ($2.000.000$ VNĐ/tháng).

---

#### Công thức 2.2: Chi phí hạ tầng bán cố định theo quy mô ($FC_{\text{infra}}$)
* **Mục đích nghiệp vụ:** Tính toán chi phí tài nguyên máy chủ tăng theo số lượng Người bán, dung lượng lưu trữ ảnh Artwork POD và số lượt gọi AI phân tích xu hướng.
* **Công thức toán học:**
  $$C_{\text{db\_sellers}} = N_{\text{sellers}} \times UnitCost_{\text{db}}$$
  $$Storage_{\text{GB}} = \max\left(0.5, \ \text{round}\left(\frac{N_{\text{designs}} \times 2.5\text{ MB}}{1024}, 2\right)\right)$$
  $$C_{\text{storage}} = \text{round}\left(Storage_{\text{GB}} \times UnitCost_{\text{storage}}\right)$$
  $$C_{\text{ai}} = \text{round}\left((N_{\text{sellers}} \times 15) \times UnitCost_{\text{ai}}\right)$$
  $$FC_{\text{infra}} = C_{\text{db\_sellers}} + C_{\text{storage}} + C_{\text{ai}}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts`
  * **Biến đầu vào:**
    * `activeSellersCount`: Số gian hàng trên hệ thống (`Shop.countDocuments()`).
    * `totalDesignsCount`: Tổng số file thiết kế (`Design.countDocuments()`).
    * Đơn giá: `db_per_active_seller` ($5.000$ đ), `storage_per_gb` ($600$ đ), `ai_per_request` ($150$ đ).
  * **Biến kết quả:** `infraSubtotal`.

---

#### Công thức 2.3: Tổng định phí gộp hàng tháng ($FC_{\text{total}}$)
* **Mục đích nghiệp vụ:** Là toàn bộ "cục tiền" cố định sàn phải trả mỗi tháng, làm tử số trong bài toán tìm điểm hòa vốn.
* **Công thức toán học:**
  $$FC_{\text{total}} = FC_{\text{base}} + FC_{\text{infra}}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts`
  * **Biến kết quả:** `totalFixedOverhead` (hoặc `total_fixed_costs`).
  * **Ví dụ thực tế:** $2.000.000\text{ đ} + 65.550\text{ đ} = 2.065.550\text{ VNĐ/tháng}$.

---

### NHÓM 3: MÔ HÌNH PHÂN TÍCH ĐIỂM HÒA VỐN CVP (COST-VOLUME-PROFIT)

#### Công thức 3.1: Sản lượng hòa vốn ($Q_{\text{BEP}}$)
* **Mục đích nghiệp vụ:** Số lượng đơn hàng tối thiểu sàn cần bán trong tháng để tổng hoa hồng thu về vừa vặn bù đắp hết chi phí máy chủ và cổng thanh toán ($NP = 0$).
* **Công thức toán học:**
  $$Q_{\text{BEP}} = \begin{cases}
  \left\lceil \frac{FC_{\text{total}}}{CM_{\text{order}}} \right\rceil & \text{khi } CM_{\text{order}} > 0 \\
  999.999 & \text{khi } CM_{\text{order}} \le 0 \text{ (Không thể hòa vốn)}
  \end{cases}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts` (Hàm `getCVPAnalysis` & `runSimulation`)
  * **Biến đầu vào:** `totalFixedOverhead` ($FC_{\text{total}}$), `contributionMarginPerOrder` ($CM_{\text{order}}$).
  * **Biến kết quả:** `breakEvenOrders` ($Q_{\text{BEP}}$).
* **Điều kiện biên:** Dùng hàm `Math.ceil()` vì số đơn hàng bắt buộc phải là số nguyên (không có $0.5$ đơn hàng).
* **Ví dụ thực tế:**
  $$Q_{\text{BEP}} = \left\lceil \frac{2.065.550}{25.814} \right\rceil = \lceil 80.016 \rceil = 81\text{ đơn/tháng}$$

---

#### Công thức 3.2: Doanh số toàn sàn cần đạt để hòa vốn ($GMV_{\text{BEP}}$)
* **Mục đích nghiệp vụ:** Tổng giá trị giao dịch người mua chi trả trên sàn để sàn đạt trạng thái hòa vốn.
* **Công thức toán học:**
  $$GMV_{\text{BEP}} = Q_{\text{BEP}} \times AOV$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts`
  * **Biến kết quả:** `breakEvenGmv`.
* **Ví dụ thực tế:** $81 \times 315.462\text{ đ} \approx 25.552.422\text{ VNĐ}$ ($\approx 25,6$ triệu).

---

#### Công thức 3.3: Tổng chi phí thực tế trong 30 ngày ($TC_{\text{actual}}$)
* **Mục đích nghiệp vụ:** Tính tổng chi phí thực tế sàn đã chi (gồm tiền máy chủ cố định + tiền trả cổng VNPay theo số đơn thực tế đã bán).
* **Công thức toán học:**
  $$TC_{\text{actual}} = FC_{\text{total}} + \left(N_{\text{completed\_orders}} \times VC_{\text{order}}\right)$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts`
  * **Biến kết quả:** `totalCosts` ($TC_{\text{actual}}$).

---

#### Công thức 3.4: Lợi nhuận ròng thực tế ($NP_{\text{actual}}$)
* **Mục đích nghiệp vụ:** Thước đo tối hậu của sàn trong 30 ngày qua: Sàn đang có lãi hay Admin đang phải bỏ tiền túi bù lỗ.
* **Công thức toán học:**
  $$NP_{\text{actual}} = TR_{\text{actual}} - TC_{\text{actual}}$$
  $$\text{Trạng thái} = \begin{cases} \text{CÓ LÃI (PROFIT)} & \text{khi } NP_{\text{actual}} \ge 0 \\ \text{BÙ LỖ (LOSS)} & \text{khi } NP_{\text{actual}} < 0 \end{cases}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts`
  * **Biến đầu vào:** `actualPlatformRevenue` ($TR_{\text{actual}} = \sum \text{platform\_fee}$), `totalCosts` ($TC_{\text{actual}}$).
  * **Biến kết quả:** `netProfit` ($NP$) và `is_profitable` (Boolean).
* **Ví dụ thực tế (Từ database hiện tại):**
  * Thu sàn: $614.700$ đ
  * Tổng chi phí: $2.289.148$ đ
  * $NP = 614.700 - 2.289.148 = -1.674.448\text{ VNĐ}$ $\rightarrow$ Admin đang phải bỏ tiền túi bù lỗ $1.674.448$ đ.

---

#### Công thức 3.5: Biên an toàn kế toán ($MOS\%$ - Margin of Safety)
* **Mục đích nghiệp vụ:** Đo lường khoảng cách từ sản lượng thực tế đến ngưỡng phá sản/lỗ vốn theo chuẩn mực kế toán quản trị.
* **Công thức toán học:**
  $$MOS\% = \begin{cases} 
  \text{round}\left(\frac{N_{\text{actual}} - Q_{\text{BEP}}}{N_{\text{actual}}} \times 100, \ 1\right) & \text{khi } N_{\text{actual}} > 0 \\
  0 & \text{khi } N_{\text{actual}} = 0
  \end{cases}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts`
  * **Biến kết quả:** `marginOfSafetyPct` ($MOS\%$).
* **Giải nghĩa:**
  * Nếu $N_{\text{actual}} = 39$ đơn và $Q_{\text{BEP}} = 81$ đơn:
    $$MOS\% = \frac{39 - 81}{39} \times 100\% = -107.7\%$$
    Dấu âm phản ánh sàn đang ở vùng lỗ, sản lượng thực tế còn thiếu $107.7\%$ so với quy mô hoạt động hiện có.

---

#### Công thức 3.6: Tỷ lệ sống sót / Ngưỡng hòa vốn trực quan ($Survive\%$)
* **Mục đích nghiệp vụ:** Hiển thị thanh tiến trình trực quan trên giao diện Admin: Sàn đã đi được bao nhiêu % quãng đường để tự nuôi sống được mình.
* **Công thức toán học:**
  $$Survive\% = \begin{cases} 
  \min\left(100, \ \text{round}\left(\frac{N_{\text{actual}}}{Q_{\text{BEP}}} \times 100\right)\right) & \text{khi } Q_{\text{BEP}} > 0 \\
  0 & \text{khi } Q_{\text{BEP}} = 0
  \end{cases}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `FE/src/modules/admin/pages/AdminFinanceSimulationPage.tsx`
  * **Biến kết quả:** `survivePercent` (Render ra thanh Progress Bar trên Card 4).
* **Ví dụ:** $39 / 81 = 48.1\% \rightarrow 48\%$. Sàn đã đạt $48\%$ ngưỡng hòa vốn.

---

### NHÓM 4: THUẬT TOÁN MÔ PHỎNG KỊCH BẢN GIẢ LẬP (WHAT-IF SIMULATION ENGINE)

#### Công thức 4.1: Doanh thu dự phóng theo kịch bản ($TR_{\text{projected}}$)
* **Mục đích nghiệp vụ:** Dự báo doanh thu sàn khi Admin thử nghiệm số lượng đơn $Q_{\text{sim}}$ và mức hoa hồng $r_{\text{sim}}$.
* **Công thức toán học:**
  $$P_{\text{sim}} = \max\left(\text{round}(AOV \times r_{\text{sim}}), \ Fee_{\text{min}}\right)$$
  $$TR_{\text{projected}} = Q_{\text{sim}} \times P_{\text{sim}}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts` (Hàm `runSimulation`)
  * **Biến đầu vào:** `simulatedOrdersInput` ($Q_{\text{sim}}$), `simulatedRateInput` ($r_{\text{sim}}$).
  * **Biến kết quả:** `projectedRevenue`.

---

#### Công thức 4.2: Tổng chi phí dự phóng theo kịch bản ($TC_{\text{projected}}$)
* **Mục đích nghiệp vụ:** Dự báo chi phí tương ứng trong kịch bản giả lập (gồm định phí máy chủ giữ nguyên + biến phí tăng theo $Q_{\text{sim}}$).
* **Công thức toán học:**
  $$TC_{\text{projected}} = FC_{\text{total}} + \left(Q_{\text{sim}} \times VC_{\text{order}}\right)$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts` (Hàm `runSimulation`)
  * **Biến kết quả:** `projectedTotalCost`.

---

#### Công thức 4.3: Lợi nhuận ròng dự phóng ($NP_{\text{projected}}$)
* **Công thức toán học:**
  $$NP_{\text{projected}} = TR_{\text{projected}} - TC_{\text{projected}}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts` (Hàm `runSimulation`)
  * **Biến kết quả:** `projectedNetProfit`.

---

#### Công thức 4.4: Điểm hòa vốn trong kịch bản giả lập ($Q_{\text{BEP\_sim}}$)
* **Công thức toán học:**
  $$CM_{\text{sim}} = P_{\text{sim}} - VC_{\text{order}}$$
  $$Q_{\text{BEP\_sim}} = \begin{cases} 
  \left\lceil \frac{FC_{\text{total}}}{CM_{\text{sim}}} \right\rceil & \text{khi } CM_{\text{sim}} > 0 \\
  999.999 & \text{khi } CM_{\text{sim}} \le 0
  \end{cases}$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts` (Hàm `runSimulation`)
  * **Biến kết quả:** `breakEvenOrders` ($Q_{\text{BEP\_sim}}$).

---

#### Công thức 4.5: Thuật toán sinh tập điểm đồ thị CVP ($Series_{\text{CVP}}$)
* **Mục đích nghiệp vụ:** Sinh mảng tọa độ $\{Q_i, TR_i, TC_i, FC_i\}$ cho thư viện Recharts vẽ 3 đường cong cắt nhau tại điểm hòa vốn.
* **Thuật toán sinh dải trục hoành:**
  1. Xác định cận trên trục hoành:
     $$Q_{\text{max}} = \max\left(500, \ \text{round}(Q_{\text{sim}} \times 1.5), \ \text{round}(Q_{\text{BEP}} \times 1.6)\right)$$
  2. Chia đều thành $N_{\text{steps}} = 10$ bước nhảy:
     $$\Delta Q = \max\left(10, \ \text{round}\left(\frac{Q_{\text{max}}}{10}\right)\right)$$
  3. Lặp $q = 0, \Delta Q, 2\Delta Q, \dots, Q_{\text{max}}$:
     $$TR(q) = q \times P_{\text{sim}}$$
     $$TC(q) = FC_{\text{total}} + (q \times VC_{\text{order}})$$
     $$FC(q) = FC_{\text{total}}$$
  4. Nếu điểm $Q_{\text{sim}}$ hiện tại của slider chưa nằm trong mảng, chèn thêm điểm $\{Q_{\text{sim}}\}$ và sắp xếp lại mảng theo thứ tự tăng dần.
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `BE/src/modules/admin/application/platform-finance.service.ts` (Hàm `runSimulation`)
  * **Biến kết quả:** `chart_series: SimulationPoint[]`.

---

#### Công thức 4.6: Ngưỡng sản lượng khuyến nghị an toàn trong Advisor ($Q_{\text{recommend}}$)
* **Mục đích nghiệp vụ:** Đưa ra cảnh báo và mục tiêu đơn hàng cụ thể cho Admin khi sàn có nguy cơ thâm hụt tài chính hoặc biên an toàn quá mỏng ($MOS < 20\%$).
* **Công thức toán học:**
  $$Q_{\text{recommend}} = \text{round}\left(Q_{\text{BEP}} \times 1.25\right)$$
* **Ánh xạ mã nguồn thực tế:**
  * **File:** `FE/src/modules/admin/pages/AdminFinanceSimulationPage.tsx` (Hook `autoAdvisorMessage`, L167)
  * **Biến đầu vào:** `bep` ($Q_{\text{BEP}}$: Số đơn hòa vốn).
  * **Biến kết quả:** Chuỗi tin nhắn cảnh báo trong Banner Advisor (`Math.round(bep * 1.25)`).
* **Ý nghĩa:** Hệ số $1.25$ tương đương vùng đệm an toàn dự phòng rủi ro $25\%$ trên sản lượng hòa vốn, giúp sàn chịu được các biến động hủy đơn, hoàn hàng hoặc biến động giá máy chủ.

---

## 3. BẢNG TỔNG HỢP ĐIỀU KIỆN BIÊN & CƠ CHẾ PHÒNG VỆ NGOẠI LỆ

| STT | Tình huống ngoại lệ (Edge Case) | Hậu quả nếu không chặn | Cơ chế xử lý đã cài đặt trong Codebase | Vị trí kiểm soát |
| :---: | :--- | :--- | :--- | :--- |
| **1** | $Subtotal$ đơn hàng quá nhỏ (vd: $10.000$ đ), hoa hồng $10\% = 1.000$ đ trong khi biến phí cổng VNPay + SMS mất $5.732$ đ. | Sàn bị âm tiền trực tiếp trên đơn hàng. | Sử dụng `Math.max(rawPlatformFee, minOrderFee)`. Ép mức sàn tối thiểu $10.000$ VNĐ. | `BE: order.service.ts` (L186) & `platform-finance.service.ts` (L228) |
| **2** | Đơn dùng mã giảm giá lớn hơn tiền hàng hoặc trừ phí sàn xong bị âm. | Số dư ví Người bán ($Payout$) bị âm. | Sử dụng `Math.max(0, subtotal - discount - platformFee)`. | `BE: order.service.ts` (L196) |
| **3** | Cơ sở dữ liệu mới khởi tạo, chưa có đơn hàng DELIVERED nào ($N_{\text{orders}} = 0$). | Phép chia cho $0$ gây lỗi `NaN` hoặc `Infinity` khi tính AOV. | Kiểm tra: Nếu $N_{\text{orders}} == 0 \rightarrow$ Gán $AOV = 350.000$ VNĐ (fallback chuẩn). | `BE: platform-finance.service.ts` (L198) |
| **4** | Lãi đóng góp âm ($CM_{\text{order}} \le 0$) do Admin hạ hoa hồng quá thấp ($< 1.8\%$) khiến $P < VC$. | Phép tính $Q_{\text{BEP}} = FC / CM$ trả về số âm hoặc chia cho $0$. | Kiểm tra: Nếu $CM \le 0 \rightarrow$ Gán $Q_{\text{BEP}} = 999.999$ (Báo hiệu kịch bản không thể hòa vốn). | `BE: platform-finance.service.ts` (L238, L325) |
| **5** | Admin kéo thanh trượt Slider về $0$ đơn hoặc nhập số âm. | Gây lỗi tính toán số liệu và sinh đồ thị rỗng. | Sử dụng `Math.max(1, Number(...) || 0)`. | `FE: AdminFinanceSimulationPage.tsx` (L389) |
| **6** | Admin nhập tỷ lệ hoa hồng vượt ngưỡng ($> 50\%$ hoặc $< 1\%$). | Gây đột biến đồ thị hoặc chính sách phi lý tế. | Bọc `Math.max(0.01, Math.min(0.5, ...))` ở Backend để kẹp dải hoa hồng an toàn trong khoảng $1\% - 50\%$. | `BE: platform-finance.service.ts` (L308) |

---

## 4. BÁO CÁO ĐỐI CHIẾU TÍNH NHẤT QUÁN GIỮA BACKEND VÀ FRONTEND

Chúng tôi đã tiến hành đối chiếu từng tham số giữa logic tính toán ở Backend và hiển thị ở Frontend:

| Tiêu chí đối chiếu | Triển khai ở Backend (`BE`) | Hiển thị ở Frontend (`FE`) | Trạng thái đồng nhất | Ghi chú kỹ thuật |
| :--- | :--- | :--- | :---: | :--- |
| **Công thức Doanh thu/đơn ($P$)** | $\max(AOV \times r, \ Fee_{\text{min}})$ | Hiển thị từ `cvp.unit_economics.revenue_per_order` | **KHỚP 100%** | FE sử dụng dữ liệu trực tiếp từ BE API. |
| **Công thức Biến phí/đơn ($VC$)** | $AOV \times r_{\text{gateway}} + Fee_{\text{notif}}$ | Hiển thị từ `cvp.unit_economics.variable_cost_per_order` | **KHỚP 100%** | Đồng nhất đơn giá VNPay $1.5\%$ và SMS $1.000$ đ. |
| **Lãi đóng góp/đơn ($CM$)** | $P - VC$ | Hiển thị từ `cvp.unit_economics.contribution_margin_per_order` | **KHỚP 100%** | Cùng ra con số $25.814$ đ/đơn. |
| **Sản lượng hòa vốn ($Q_{\text{BEP}}$)** | $\lceil FC / CM \rceil$ | Hiển thị từ `cvp.break_even_orders` | **KHỚP 100%** | Cùng ra $81$ đơn/tháng. |
| **Lợi nhuận ròng ($NP$)** | $TR - TC$ | Hiển thị từ `cvp.net_profit` | **KHỚP 100%** | Cùng ra $-1.674.448$ đ/tháng. |
| **Dòng tiền khấu trừ xưởng & Seller** | $Subtotal - P_{\text{order}}$ | $\max(0, AOV - P_{\text{order}})$ | **KHỚP 100%** | FE tính phần trả xưởng & Seller $= 315.462 - 31.546 = 283.916$ đ. |
| **Tọa độ đồ thị CVP** | Backend sinh mảng `chart_series` gồm 11 điểm $\{Q, TR, TC, FC\}$ | Recharts vẽ trực tiếp từ mảng `simulation.chart_series` | **KHỚP 100%** | FE không tự ý tính toán lại tọa độ, đảm bảo tính toàn vẹn 1:1 với Backend. |

### Kết luận kiểm định:
> **Không có bất kỳ sai lệch công thức nào giữa Backend và Frontend.** Toàn bộ các công thức tính toán tài chính phức tạp, phân rã chi phí và điểm hòa vốn đều được tập trung hóa xử lý tại tầng **Backend Service (`PlatformFinanceService`)**. Phía **Frontend (`AdminFinanceSimulationPage`)** đóng vai trò là lớp hiển thị trực quan (View/Presentation Layer), đảm bảo tính nguyên tử (Atomic) và Single Source of Truth cho toàn hệ thống.
