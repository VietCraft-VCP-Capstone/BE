import { normalizeVi } from '../../../shared/utils/vietnamese-search.util';

// Từ ghép hay gặp trong tên sản phẩm; bổ sung khi có sản phẩm mới
const WORDS = [
    'cá tính', 'cao cấp', 'chân váy', 'áo thun', 'áo khoác', 'áo dài', 'áo phông', 'áo đôi', 'phong cách', 'họa tiết',
    'thiết kế', 'thời trang', 'trang trí', 'quà tặng', 'kỷ niệm', 'gốm sứ', 'tối giản', 'dễ thương', 'đáng yêu', 'dịu dàng',
    'thoáng mát', 'dày dặn', 'co giãn', 'sang trọng', 'sang chảnh', 'cổ điển', 'hoài cổ', 'cổ kính', 'nghệ thuật', 'thư pháp',
    'bình minh', 'hoàng hôn', 'cầu vồng', 'chuồn chuồn', 'khủng long', 'đèn lồng', 'trung thu', 'hoa sen', 'hoa mai', 'hoa giấy',
    'hoa khô', 'cá chép', 'hà nội', 'sài gòn', 'đà lạt', 'hội an', 'việt nam', 'hàn quốc', 'bắc âu', 'thể thao',
    'bóng đá', 'du lịch', 'gia đình', 'bạn bè', 'người yêu', 'văn phòng', 'phòng khách', 'phòng ngủ', 'treo tường', 'tiện lợi',
    'chống nước', 'chính hãng', 'nhiều màu', 'phối màu', 'bạc màu', 'bền màu', 'sắc nét', 'hài hước', 'vui nhộn', 'may mắn',
    'ý nghĩa', 'huyền thoại', 'vũ trụ', 'phi hành gia', 'bất đối xứng', 'đối xứng', 'thập niên', 'xe máy', 'cà phê', 'bánh mì',
    'đi học', 'đi làm', 'đi chơi', 'dáng rộng', 'khóa kéo', 'mùa đông', 'mùa thu', 'se lạnh', 'giữ ấm', 'lông cừu',
    'kẻ caro', 'sọc ngang', 'tua rua', 'cổ tròn', 'cổ bẻ', 'mộng mơ', 'thiếu nữ', 'phố cổ', 'hồ gươm', 'sông hương',
    'đại nội', 'chùa cầu', 'đông hồ', 'đông sơn', 'trống đồng', 'nón lá', 'men lam', 'chu đậu', 'cung đình', 'dã quỳ',
    'thuyền thúng', 'chợ bến thành', 'bến thành', 'màu nước', 'màu pastel', 'nam nữ', 'bố mẹ', 'mẹ con', 'local brand',
];

const COMPOUNDS = new Set(WORDS.map(normalizeVi));

/** Nếu một từ ghép vắt qua vị trí `end` (độc quyền) thì kéo `end` tới cuối từ ghép đó. */
export function compoundEnd(norms: string[], end: number): number {
    for (let s = Math.max(0, end - 2); s < end; s++) {
        for (let n = 3; n >= 2; n--) {
            if (s + n > end && s + n <= norms.length && COMPOUNDS.has(norms.slice(s, s + n).join(' '))) return s + n;
        }
    }
    return end;
}
