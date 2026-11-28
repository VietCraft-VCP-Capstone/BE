# Gợi ý thêm ý tưởng cho dịp mùa vụ — thiết kế ngắn

## Vì sao
Mỗi dịp mỗi năm hiện chỉ có đúng 3 ý tưởng AI, tạo một lần rồi lưu vĩnh viễn; seller không có cách xin thêm.
Một dịp cả năm chỉ 3 ý tưởng là không đủ để chọn.

## Mục tiêu / không làm
- Seller bấm "Gợi ý thêm" → có thêm 3 ý tưởng mới, nối vào sau danh sách hiện có.
- Không đụng ý tưởng cũ: bản đã sửa ("Đã sửa"), đã chọn vào sổ tay, đã gắn sản phẩm giữ nguyên ID và nội dung.
- Ý tưởng mới không trùng ý tưởng cũ và không bịa số: mỗi ý tưởng dựa vào một tín hiệu dữ liệu chưa dùng.
- Không làm: tạo lại (thay thế) ý tưởng cũ; tạo sẵn nhiều ý tưởng ngay lần đầu (lần đầu vẫn 3 cho nhanh).

## Cách đã chọn
Cách 1 (seller chọn): nút "Gợi ý thêm", mỗi lần 3 ý tưởng.
Cách 2 bị loại: tạo sẵn 6–8 ý tưởng làm lần đầu chờ lâu hơn và tốn lượt LLM cho ý tưởng seller có thể không dùng.

## Thiết kế
- **Kho tín hiệu:** tất cả nhóm bán chạy toàn ngành của dịp + tất cả từ khóa cơ hội (không cắt còn 5), bỏ trùng.
  Mỗi đợt lấy 3 tín hiệu chưa dùng theo thứ tự; vai trò lặp vòng: chủ lực / combo quà / món dễ chốt.
- **Lưu trữ:** mục `settings.seasonal_preferences.generated_ideas.<dịp_năm>` lưu thêm `used_anchors` (tín hiệu đã dùng)
  và `inputs` (dữ liệu dựng prompt: phong cách, khung giá, kho tín hiệu…). GET trang mùa vụ ghi bổ sung `inputs`
  cho mục cũ chưa có, để nút dùng được với ý tưởng đã tạo trước đây.
- **API mới:** `POST /forecast/seasonal/more-ideas` `{ camp_id, event_year }` → dựng prompt với 3 tín hiệu chưa dùng
  + danh sách tên ý tưởng đã có (cấm trùng), gọi LLM chờ trực tiếp (~20s), lọc qua `isGrounded` như hiện tại,
  nối vào danh sách đã lưu, trả về danh sách đầy đủ. Có giới hạn tần suất; bấm 2 lần cùng lúc thì lần sau bị từ chối.
- **Giới hạn:** tối đa 30 ý tưởng mỗi dịp; hết tín hiệu chưa dùng thì trả `no_more_signals`.
- **Giao diện:** nút "Gợi ý thêm 3 ý tưởng" dưới lưới ý tưởng; khi chờ hiện trạng thái đang soạn và khóa nút;
  hết tín hiệu/đủ 30 thì nút tắt kèm câu "Đã dùng hết dữ liệu dịp này để gợi ý"; lỗi LLM thì báo và cho bấm lại.
  Số trên tab "Ý tưởng cho shop (n)" cập nhật theo danh sách mới.

## Để người làm tự quyết
Tên trường, thông báo lỗi chi tiết, vị trí nút trong lưới, timeout chính xác.
