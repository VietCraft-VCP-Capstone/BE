# BÁO CÁO NGHIỆM THU KIẾN TRÚC & TRIỂN KHAI TÍNH NĂNG
## QUẢN TRỊ CẤU HÌNH CHI PHÍ VẬN HÀNH SÀN, MÔ PHỎNG ĐIỂM HÒA VỐN (CVP) & CÂN ĐỐI PHÍ DUY TRÌ SÀN VIETCRAFT
**Nhánh Git:** `feat/admin-fee-simulation`  
**Ngày hoàn thành:** 06/10/2026  
**Vai trò triển khai:** Fullstack Software Architect  

---

## 1. TỔNG QUAN TÍNH NĂNG (EXECUTIVE SUMMARY)

Trước khi triển khai tính năng này, hệ sinh thái VietCraft gặp phải 3 điểm nghẽn nghiêm trọng trong quản trị tài chính:
1. **Tỷ lệ phí sàn bị gán cứng (Hardcoded):** Mức hoa hồng sàn được fix cứng ở hằng số `PLATFORM_FEE_RATE = 0.05` (5%) tại mã nguồn Backend, không thể thay đổi theo chiến lược kinh doanh hoặc quy mô tăng trưởng mà không phải sửa code và deploy lại server.
2. **Thiếu vắng bức tranh kinh tế vi mô (Unit Economics) & Điểm hòa vốn (Break-even):** Đội ngũ Admin không có công cụ tính toán chi phí vận hành cơ sở hạ tầng thực tế (Server, Domain, SSL, CDN, Cổng thanh toán VNPay, Lưu trữ Cloudinary, AI Token). Hệ quả là ban điều hành không biết bán bao nhiêu đơn một tháng thì sàn hòa vốn, hay đang bị thâm hụt ngân sách bao nhiêu tiền trên mỗi đơn hàng.
3. **Không có công cụ mô phỏng kịch bản (What-If CVP Simulation):** Khi chuẩn bị ra mắt chiến dịch hoặc điều chỉnh phí dịch vụ cho người bán (Seller), Admin không thể dự báo trước mức độ ảnh hưởng đến lợi nhuận ròng và dòng tiền nếu nâng hoặc hạ phí sàn.

### Giải pháp đã xây dựng:
Hệ thống **"Quản trị Chi phí Vận hành & Mô phỏng Điểm Hòa Vốn CVP"** được thiết kế và triển khai toàn diện trên toàn bộ stack (`BE` Node.js/Express + `FE` React/Tailwind/Recharts), mang lại:
* **Mô hình định lượng chi phí toàn diện:** Quản lý tập trung cả **Định phí (Fixed Costs)** cơ sở hạ tầng và **Biến phí (Variable Costs)** theo từng giao dịch.
* **Bộ tính toán tài chính tự động (CVP Engine):** Tự động tổng hợp dữ liệu 30 ngày gần nhất từ database thực tế để tính toán $Q_{\text{BEP}}$, $GMV_{\text{BEP}}$, Lợi nhuận ròng ($NP$), và Biên an toàn ($MOS$).
* **Sân chơi tương tác thời gian thực (Interactive What-If Playground):** Cho phép Admin kéo thả slider sản lượng đơn và tỷ lệ hoa hồng để quan sát ngay lập tức đồ thị CVP cắt điểm hòa vốn và nhận khuyến nghị tự động (Auto-Advisor) từ thuật toán.
* **Động cơ phí sàn động (Dynamic Fee Engine):** Thay thế hoàn toàn hằng số fix cứng bằng logic đọc cấu hình động từ database khi tạo đơn hàng, có cơ chế sàn bảo hiểm tối thiểu (`min_order_fee`).

---

## 2. BẢNG TỔNG HỢP CÁC FILE MÃ NGUỒN

### 2.1. Danh mục các file tạo mới
| STT | Đường dẫn file | Phân hệ | Mục đích & Trách nhiệm chính |
| :---: | :--- | :---: | :--- |
| 1 | `BE/src/modules/admin/infrastructure/models/system-config.model.ts` | Backend | Khởi tạo Mongoose Model `PlatformCostConfig` lưu trữ toàn bộ cấu hình định phí, biến phí, hạn mức tài nguyên và chính sách thu phí sàn. |
| 2 | `BE/src/modules/admin/application/platform-finance.service.ts` | Backend | Lớp nghiệp vụ tính toán Unit Economics, phân tích CVP 30 ngày, sinh dữ liệu đồ thị hòa vốn và chạy thuật toán mô phỏng What-If. |
| 3 | `BE/src/modules/admin/presentation/admin-finance.router.ts` | Backend | Cung cấp 4 API RESTful (`GET/PUT /config`, `GET /cvp-analysis`, `POST /simulate`), bảo vệ nghiêm ngặt qua JWT Auth và Admin RBAC. |
| 4 | `FE/src/modules/admin/services/adminFinanceService.ts` | Frontend | Service Axios phía Client kết nối đồng bộ với các API tài chính của Backend. |
| 5 | `FE/src/modules/admin/pages/AdminFinanceSimulationPage.tsx` | Frontend | Màn hình Admin Dashboard hoàn chỉnh gồm 3 khối: Thẻ KPI Unit Economics, Sân chơi mô phỏng CVP kèm biểu đồ Recharts tương tác, và Form điều chỉnh chi phí hạ tầng. |

### 2.2. Danh mục các file chỉnh sửa
| STT | Đường dẫn file | Phân hệ | Nội dung chỉnh sửa chính |
| :---: | :--- | :---: | :--- |
| 1 | `BE/src/modules/order/infrastructure/models/order.model.ts` | Backend | Mở rộng schema `IFinancialBreakdown` và `FinancialBreakdownSchema` thêm 2 trường: `commission_rate` (tỷ lệ hoa hồng áp dụng) và `total_printing_cost` (tổng chi phí phôi in ấn). |
| 2 | `BE/src/modules/admin/index.ts` | Backend | Re-export `PlatformCostConfig`, `platformFinanceService`, và `adminFinanceRouter` để các module khác dễ dàng tái sử dụng. |
| 3 | `BE/src/app/routes.ts` | Backend | Đăng ký router tài chính mới: `router.use('/admin/finance', adminFinanceRouter)`. |
| 4 | `BE/src/modules/order/application/order.service.ts` | Backend | Refactor hàm `createOrder()`: Loại bỏ triệt để hằng số `PLATFORM_FEE_RATE = 0.05`, tích hợp đọc tỷ lệ hoa hồng và phí sàn tối thiểu động từ `PlatformCostConfig`, lưu trữ `commission_rate` và `total_printing_cost` vào database khi chốt đơn. |
| 5 | `FE/src/modules/admin/pages/AdminLayout.tsx` | Frontend | Bổ sung icon `Calculator`, cập nhật nhãn `{ to: '/admin/finance', label: 'Tài chính & Hòa vốn' }` và chống tràn/xuống dòng menu qua `whitespace-nowrap overflow-hidden text-ellipsis`. |
| 6 | `FE/src/modules/admin/pages/AdminPortal.tsx` | Frontend | Khai báo route con `<Route path="finance" element={<AdminFinanceSimulationPage />} />` trong vùng Admin Portal. |

---

## 3. HỆ THỐNG CÔNG THỨC TÀI CHÍNH ĐÃ NHÚNG VÀO CODEBASE

Hệ thống triển khai chuẩn mực lý thuyết **Cost-Volume-Profit (CVP Analysis)** và **Unit Economics** dành cho nền tảng sàn thương mại điện tử:

### 3.1. Xác định Định phí cơ sở & Hạ tầng ($FC_{\text{total}}$)
Định phí là các chi phí bắt buộc phải trả hàng tháng bất kể sàn có phát sinh đơn hàng hay không:
$$FC_{\text{base}} = \text{domain\_monthly} + \text{vps\_base\_monthly} + \text{frontend\_hosting} + \text{security\_ssl}$$
*Giá trị mặc định:* $40.000 + 1.200.000 + 500.000 + 260.000 = 2.000.000\text{ VNĐ/tháng}$.

Chi phí hạ tầng bán cố định theo số lượng Người bán kích hoạt:
$$FC_{\text{infra}} = (N_{\text{sellers}} \times \text{db\_per\_seller}) + (\text{Storage}_{\text{GB}} \times \text{storage\_cost}) + (\text{AI}_{\text{requests}} \times \text{ai\_cost})$$
$$FC_{\text{total}} = FC_{\text{base}} + FC_{\text{infra}}$$

### 3.2. Xác định Biến phí trên từng đơn hàng ($VC_{\text{order}}$)
Biến phí là chi phí trực tiếp sinh ra khi có một giao dịch thành công:
$$VC_{\text{gateway}} = \text{AOV} \times \text{payment\_gateway\_rate}$$
$$VC_{\text{order}} = VC_{\text{gateway}} + \text{notification\_per\_order}$$
*Ví dụ:* Với $\text{AOV} = 350.000\text{ đ}$, cổng thanh toán $1.5\%$ và thông báo $1.000\text{ đ/đơn}$:
$$VC_{\text{order}} = (350.000 \times 0.015) + 1.000 = 5.250 + 1.000 = 6.250\text{ VNĐ/đơn}$$

### 3.3. Doanh thu đơn vị ($P_{\text{order}}$) & Lãi đóng góp ($CM_{\text{order}}$)
$$P_{\text{order}} = \max(\text{round}(\text{AOV} \times \text{commission\_rate}), \text{min\_order\_fee})$$
$$CM_{\text{order}} = P_{\text{order}} - VC_{\text{order}}$$
$$CMR = \frac{CM_{\text{order}}}{P_{\text{order}}} \times 100\% \quad (\text{Contribution Margin Ratio})$$
*Ví dụ:* Với hoa hồng $10\%$, $P_{\text{order}} = 35.000\text{ đ}$. Lãi đóng góp $CM = 35.000 - 6.250 = 28.750\text{ VNĐ/đơn}$. Mỗi đơn hàng bán ra sẽ bù đắp được $28.750\text{ đ}$ vào quỹ định phí máy chủ.

### 3.4. Điểm hòa vốn ($Q_{\text{BEP}}$ & $GMV_{\text{BEP}}$)
Số lượng đơn hàng tối thiểu cần đạt trong tháng để sàn bắt đầu có lãi:
$$Q_{\text{BEP}} = \left\lceil \frac{FC_{\text{total}}}{CM_{\text{order}}} \right\rceil \quad (\text{đơn/tháng})$$
Tổng doanh số giao dịch sàn (GMV) tương ứng tại điểm hòa vốn:
$$GMV_{\text{BEP}} = Q_{\text{BEP}} \times \text{AOV}$$

### 3.5. Lợi nhuận ròng ($NP$) & Biên an toàn ($MOS$)
$$TR = Q \times P_{\text{order}} \quad (\text{Tổng doanh thu sàn})$$
$$TC = FC_{\text{total}} + (Q \times VC_{\text{order}}) \quad (\text{Tổng chi phí sàn})$$
$$NP = TR - TC \quad (\text{Lợi nhuận ròng sàn})$$
$$MOS = \frac{Q_{\text{thực\_tế}} - Q_{\text{BEP}}}{Q_{\text{thực\_tế}}} \times 100\% \quad (\text{Margin of Safety})$$

---

## 4. HƯỚNG DẪN KIỂM THỬ TRÊN MÔI TRƯỜNG LOCAL (TESTING GUIDE)

Để trải nghiệm và kiểm thử toàn bộ tính năng trên máy phát triển, thực hiện theo các bước sau:

### Bước 1: Khởi động Backend (`BE`)
Mở terminal tại thư mục `BE/`:
```powershell
cd d:\FPTLearningTime\Ky9\VietCarft\BE
npm run dev
```
* Backend sẽ chạy tại cổng `http://localhost:8080`.
* Khi khởi động, router `/api/admin/finance` tự động sẵn sàng đón nhận request.

### Bước 2: Khởi động Frontend (`FE`)
Mở terminal tại thư mục `FE/`:
```powershell
cd d:\FPTLearningTime\Ky9\VietCarft\FE
npm run dev
```
* Frontend Vite sẽ chạy tại cổng `http://localhost:3000` (hoặc cổng hiển thị trên terminal).

### Bước 3: Đăng nhập với quyền Quản trị viên (Admin)
1. Mở trình duyệt truy cập: `http://localhost:3000/login`.
2. Đăng nhập bằng tài khoản Quản trị viên (Admin) của hệ thống VietCraft.

### Bước 4: Truy cập màn hình Quản trị Tài chính & Điểm hòa vốn
1. Quan sát thanh bên trái (Sidebar Navigation) của Admin Portal.
2. Bấm vào mục menu mới: **"Tài chính & Điểm hòa vốn"** (URL: `http://localhost:3000/admin/finance`).

### Bước 5: Kiểm tra các khối tính năng
1. **Khối KPI (Unit Economics):**
   * Kiểm tra Badge trạng thái: **CÓ LÃI** (màu xanh) hoặc **BÙ LỖ** (màu đỏ).
   * Kiểm tra các thẻ số liệu: Lợi nhuận ròng 30 ngày, Điểm hòa vốn ($Q_{\text{BEP}}$ đơn), GMV hòa vốn, Biên an toàn (MOS %).
   * Kiểm tra dải 4 chỉ số Unit Economics: Thu sàn TB/đơn ($P$), Biến phí/đơn ($VC$), Lãi đóng góp/đơn ($CM$), Tỷ lệ lãi gộp ($CMR$).
2. **Khối Sân chơi mô phỏng What-If (Interactive Playground):**
   * Kéo thanh trượt **Sản lượng đơn dự kiến / tháng** (từ 50 đến 1.500 đơn).
   * Kéo thanh trượt **Tỷ lệ phí sàn (Take-Rate)** (từ 5% đến 20%).
   * Quan sát 4 thẻ kết quả dự phóng thời gian thực (Doanh thu, Chi phí, Lợi nhuận ròng, Hòa vốn).
   * Quan sát đồ thị Recharts CVP: Đường Xanh (Doanh thu TR), Đường Đỏ (Tổng chi phí TC), Đường Nét đứt (Định phí FC) và các đường mốc đánh dấu kịch bản.
   * Đọc phần **Gợi Ý Cân Đối Chi Phí (Auto-Advisor)** xem phân tích biên an toàn và khuyến nghị điều chỉnh.
3. **Khối Cấu hình Chi phí Vận hành:**
   * Thử thay đổi đơn giá máy chủ VPS hoặc Phí cổng thanh toán hoặc Tỷ lệ hoa hồng mặc định.
   * Bấm nút **"Lưu Thay Đổi"**.
   * Quan sát thông báo thành công và thời gian cập nhật. Mọi số liệu và đồ thị CVP phía trên sẽ tự động tính toán lại ngay lập tức.
4. **Kiểm tra tạo đơn hàng mới:**
   * Khi Buyer đặt đơn hàng mới, kiểm tra trường `financial_breakdown` của đơn trong MongoDB: trường `commission_rate` (ví dụ: `0.10`) và `total_printing_cost` đã được tự động lưu chuẩn xác.

---
**Kết luận:** Tính năng đã được kiểm thử biên dịch TypeScript (0 lỗi cả BE và FE) và sẵn sàng đưa vào vận hành thực tế.
