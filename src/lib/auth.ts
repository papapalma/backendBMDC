import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { JWTPayload } from '@/types';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';

export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

export const comparePassword = async (
  password: string,
  hashedPassword: string
): Promise<boolean> => {
  return bcrypt.compare(password, hashedPassword);
};

export const generateToken = (payload: Partial<Omit<JWTPayload, 'jti' | 'iat' | 'exp'>> & { userId: string; email: string; role: string }): string => {
  const jti = crypto.randomBytes(16).toString('hex');
  const fullPayload: JWTPayload = {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    tenantId: payload.tenantId || 'unknown',
    jti,
  };
  return jwt.sign(fullPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
};

export const generateOpaqueToken = (bytes: number = 32): string => {
  return crypto.randomBytes(bytes).toString('hex');
};

export const hashOpaqueToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

export const verifyToken = (token: string): JWTPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    return null;
  }
};

export const extractTokenFromHeader = (authHeader?: string): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
};

export const extractTokenFromCookie = (cookieHeader?: string | null): string | null => {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

export const extractCookieValue = (
  cookieHeader: string | null | undefined,
  cookieName: string
): string | null => {
  if (!cookieHeader) return null;
  const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
};
