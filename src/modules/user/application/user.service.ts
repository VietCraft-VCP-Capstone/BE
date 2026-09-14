import { User } from '../infrastructure/models/user.model';
import { IAddress } from '../types';
import { Order } from '../../order/infrastructure/models/order.model';
import { Wishlist } from '../../product/infrastructure/models/wishlist.model';
import { ShopFollower } from '../../product/infrastructure/models/shop-follower.model';
import mongoose from 'mongoose';

const EDITABLE_PROFILE_FIELDS = ['full_name', 'phone', 'avatar', 'identity_card_number', 'tax_code', 'notification_settings'] as const;

const EDITABLE_ADDRESS_FIELDS = ['recipient_name', 'phone', 'address_detail', 'province_id', 'district_id', 'ward_code', 'is_default'] as const;

function pick<T extends object>(source: any, fields: readonly string[]): T {
    const out: any = {};
    if (!source || typeof source !== 'object') return out;
    for (const field of fields) {
        if (source[field] !== undefined) out[field] = source[field];
    }
    return out as T;
}

export class UserService {
    static async getProfile(userId: string) {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new Error('ID người dùng không hợp lệ');
        }

        const user = await User.findById(userId).select('-password_hash').lean();
        if (!user) {
            throw new Error('Không tìm thấy người dùng');
        }

        const [ordersCount, wishlist, followingCount] = await Promise.all([
            Order.countDocuments({ buyer_id: userId }),
            Wishlist.findOne({ user_id: userId }).lean(),
            ShopFollower.countDocuments({ buyer_ids: userId })
        ]);
        const wishlistCount = wishlist ? wishlist.product_ids.length : 0;

        return {
            ...user,
            rank: 'Thành viên Bạc',
            stats: {
                ordersCount,
                collectionsCount: wishlistCount,
                followingCount
            }
        };
    }

    static async updateProfile(userId: string, payload: Record<string, any>) {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new Error('ID người dùng không hợp lệ');
        }

        const safePayload = pick<Record<string, any>>(payload, EDITABLE_PROFILE_FIELDS);

        const user = await User.findByIdAndUpdate(
            userId,
            { $set: safePayload },
            { new: true, runValidators: true }
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
            ...pick<Partial<IAddress>>(addressData, EDITABLE_ADDRESS_FIELDS),
            is_default: addressData.is_default || false
        } as IAddress;

        if (newAddress.is_default) {
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

        Object.assign(address, pick<Partial<IAddress>>(addressData, EDITABLE_ADDRESS_FIELDS));

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

