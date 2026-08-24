import { User, IAddress } from '../infrastructure/models/user.model';
import { Order } from '../../order/infrastructure/models/order.model';
import { Wishlist } from '../../product/infrastructure/models/wishlist.model';
import { ShopFollower } from '../../product/infrastructure/models/shop-follower.model';
import mongoose from 'mongoose';

export class UserService {
    static async getProfile(userId: string) {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new Error('ID người dùng không hợp lệ');
        }

        const user = await User.findById(userId).select('-password_hash');
        if (!user) {
            throw new Error('Không tìm thấy người dùng');
        }

        const ordersCount = await Order.countDocuments({ buyer_id: userId });
        const wishlist = await Wishlist.findOne({ user_id: userId });
        const wishlistCount = wishlist ? wishlist.product_ids.length : 0;
        const followingCount = await ShopFollower.countDocuments({ buyer_ids: userId });

        const userObj = user.toObject();
        return {
            ...userObj,
            rank: 'Thành viên Bạc',
            stats: {
                ordersCount: ordersCount,
                collectionsCount: wishlistCount,
                followingCount: followingCount
            }
        };
    }

    static async updateProfile(userId: string, payload: { full_name?: string; phone?: string; avatar?: string }) {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new Error('ID người dùng không hợp lệ');
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { $set: payload },
            { new: true }
        ).select('-password_hash');

        if (!user) {
            throw new Error('Không tìm thấy người dùng');
        }

        const ordersCount = await Order.countDocuments({ buyer_id: userId });
        const wishlist = await Wishlist.findOne({ user_id: userId });
        const wishlistCount = wishlist ? wishlist.product_ids.length : 0;
        const followingCount = await ShopFollower.countDocuments({ buyer_ids: userId });

        const userObj = user.toObject();
        return {
            ...userObj,
            rank: 'Thành viên Bạc',
            stats: {
                ordersCount: ordersCount,
                collectionsCount: wishlistCount,
                followingCount: followingCount
            }
        };
    }

    static async addAddress(userId: string, addressData: Partial<IAddress>) {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new Error('ID người dùng không hợp lệ');
        }

        const user = await User.findById(userId);
        if (!user) throw new Error('Không tìm thấy người dùng');

        const newAddress = {
            ...addressData,
            is_default: addressData.is_default || false
        } as IAddress;

        if (newAddress.is_default) {
            // Đặt tất cả địa chỉ khác thành không mặc định
            user.addresses.forEach(addr => {
                addr.is_default = false;
            });
        }

        user.addresses.push(newAddress);
        await user.save();
        return user.addresses;
    }

    static async updateAddress(userId: string, addressId: string, addressData: Partial<IAddress>) {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new Error('ID người dùng không hợp lệ');
        }

        const user = await User.findById(userId);
        if (!user) throw new Error('Không tìm thấy người dùng');

        const address = user.addresses.find(addr => (addr as any)._id.toString() === addressId);
        if (!address) throw new Error('Không tìm thấy địa chỉ');

        if (addressData.is_default) {
            user.addresses.forEach(addr => {
                addr.is_default = false;
            });
        }

        // Cập nhật các trường
        Object.assign(address, addressData);

        await user.save();
        return user.addresses;
    }

    static async deleteAddress(userId: string, addressId: string) {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new Error('ID người dùng không hợp lệ');
        }

        const user = await User.findById(userId);
        if (!user) throw new Error('Không tìm thấy người dùng');

        user.addresses = user.addresses.filter(addr => (addr as any)._id.toString() !== addressId) as any;
        await user.save();
        return user.addresses;
    }
}
