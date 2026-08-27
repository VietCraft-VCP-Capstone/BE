
import { Request } from "express";
export type Role = 'buyer' | 'seller' | 'admin';

//JWT decode
export interface AuthUser {
    id: string;
    email: string;
    role: string;
}

export interface AuthenticatedRequest extends Request {
    user?: AuthUser;
}