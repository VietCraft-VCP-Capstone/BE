import mongoose from "mongoose";

export const dec = (n: number) => mongoose.Types.Decimal128.fromString(Math.round(n || 0).toString());
export const num = (v: any) => (v ? Number(v.toString()) : 0);
export function byCodeOrId(id: string) {
  return {
    $or: [
      { order_code: id },
      {
        _id: mongoose.Types.ObjectId.isValid(id)
          ? new mongoose.Types.ObjectId(id)
          : null,
      },
    ],
  };
}

export function toBuyerObjectId(buyerId: string) {
  if (!mongoose.Types.ObjectId.isValid(buyerId)) {
    throw new Error("Phiên đăng nhập không hợp lệ");
  }
  return new mongoose.Types.ObjectId(buyerId);
}