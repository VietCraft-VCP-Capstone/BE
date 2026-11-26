import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    heuristicMask, maskCoverage, maskFromAlpha, recolorInMask, resolveColorHex, shadingMap,
} from '../src/modules/product/application/mockup-color';

const W = 40, H = 40;
const px = (rgba: Uint8Array, x: number, y: number) => Array.from(rgba.slice((y * W + x) * 4, (y * W + x) * 4 + 3));

/** Ảnh thử: nền chuyển màu (xanh nhạt -> hồng), bóng đổ mềm dưới phôi, phôi trắng ở giữa có 1 nếp xám. */
function scene(): { rgba: Uint8Array; product: (x: number, y: number) => boolean } {
    const rgba = new Uint8Array(W * H * 4);
    const product = (x: number, y: number) => x >= 10 && x < 30 && y >= 8 && y < 28;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        // nền chuyển màu theo chiều ngang: đổi từ từ, mỗi pixel lệch ít
        let r = 180 + x, g = 210 - x, b = 230 - Math.round(x / 2);
        // bóng đổ mềm bên dưới phôi
        if (y >= 28 && y < 34 && x >= 8 && x < 32) { const k = 1 - (y - 28) * 0.03; r *= k; g *= k; b *= k; }
        if (product(x, y)) { r = 245; g = 245; b = 245; if (x === 20) { r = 170; g = 170; b = 170; } }
        rgba[o] = Math.round(r); rgba[o + 1] = Math.round(g); rgba[o + 2] = Math.round(b); rgba[o + 3] = 255;
    }
    return { rgba, product };
}

test('mã màu: hex trắng mặc định không đè tên màu rõ ràng', () => {
    assert.equal(resolveColorHex('Đen', '#FFFFFF'), '#18181b');
    assert.equal(resolveColorHex('Xanh Navy đậm', '#fff'), '#1e3a8a');
    assert.equal(resolveColorHex('Trắng', '#FFFFFF'), '#ffffff');
    assert.equal(resolveColorHex('Màu lạ', '#FFFFFF'), '#ffffff');
    assert.equal(resolveColorHex('Đen', '#123456'), '#123456', 'hex thật của xưởng luôn thắng');
    assert.equal(resolveColorHex('Đỏ đô'), '#991b1b', 'khoá dài thắng khoá ngắn');
    assert.equal(resolveColorHex('Không biết'), undefined);
});

test('mask ước lượng: nền chuyển màu và bóng đổ mềm không bị tính là phôi', () => {
    const { rgba, product } = scene();
    const m = heuristicMask(rgba, W, H);
    let wrong = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if ((m[y * W + x] > 127) !== product(x, y)) wrong++;
    }
    assert.equal(wrong, 0);
    assert.ok(Math.abs(maskCoverage(m) - (20 * 20) / (W * H)) < 1e-9);
});

test('đổi màu chỉ trong mask, nền và bóng đổ giữ nguyên, nếp vải vẫn tối hơn', () => {
    const { rgba } = scene();
    const m = heuristicMask(rgba, W, H);
    const out = recolorInMask(rgba, m, '#1e3a8a');
    assert.deepEqual(px(out, 2, 2), px(rgba, 2, 2), 'nền');
    assert.deepEqual(px(out, 20, 31), px(rgba, 20, 31), 'bóng đổ');
    const body = px(out, 15, 15), fold = px(out, 20, 15);
    assert.ok(body[2] > body[0] && body[2] > 120, `thân phôi phải ra xanh navy, được ${body}`);
    assert.ok(fold[2] < body[2], 'nếp vải tối hơn thân');
});

test('đổi sang màu sáng trên ảnh phôi trắng vẫn chạy (không bỏ qua như thuật toán cũ)', () => {
    const { rgba } = scene();
    const m = heuristicMask(rgba, W, H);
    const out = recolorInMask(rgba, m, '#fef3c7');
    const body = px(out, 15, 15);
    assert.ok(body[2] < 230 && body[0] > 240, `kem phải ngả vàng, được ${body}`);
});

test('mask từ alpha chỉ dùng khi ảnh thật sự có nền trong suốt', () => {
    const opaque = new Uint8Array(W * H * 4).fill(255);
    assert.equal(maskFromAlpha(opaque, W, H), null);
    const cut = new Uint8Array(opaque);
    for (let i = 0; i < W * H / 2; i++) cut[i * 4 + 3] = 0;
    const m = maskFromAlpha(cut, W, H)!;
    assert.equal(m[0], 0);
    assert.equal(m[W * H - 1], 255);
});

test('bản đồ bóng chỉ làm tối trong phôi, ngoài phôi = 255', () => {
    const { rgba } = scene();
    const m = heuristicMask(rgba, W, H);
    const s = shadingMap(rgba, m, undefined, W);
    assert.equal(s[0], 255);
    assert.equal(s[15 * W + 15], 255, 'thân phôi sáng đều -> giữ nguyên');
    assert.ok(s[15 * W + 20] < 255, 'nếp vải làm tối thiết kế');
});
