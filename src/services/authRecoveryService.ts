import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateOpaqueToken, hashOpaqueToken, hashPassword } from '@/lib/auth';

const REFRESH_TOKEN_EXPIRES_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 14);
const RESET_TOKEN_EXPIRES_MINUTES = Number(process.env.RESET_TOKEN_EXPIRES_MINUTES || 60);

export interface TokenRequestMeta {
  ip?: string;
  userAgent?: string;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

class AuthRecoveryService {
  private getRefreshTokenExpiryDate(): string {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);
    return expiresAt.toISOString();
  }

  private getResetTokenExpiryDate(): string {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + RESET_TOKEN_EXPIRES_MINUTES);
    return expiresAt.toISOString();
  }

  async issueRefreshToken(
    userId: string,
    meta?: TokenRequestMeta,
    rotatedFrom?: string
  ): Promise<{ token: string; expiresAt: string }> {
    const token = generateOpaqueToken(32);
    const tokenHash = hashOpaqueToken(token);
    const expiresAt = this.getRefreshTokenExpiryDate();

    const payload: Record<string, unknown> = {
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_ip: meta?.ip,
      created_user_agent: meta?.userAgent,
    };

    if (rotatedFrom) payload.rotated_from = rotatedFrom;

    const { error } = await supabaseAdmin
      .from('refresh_tokens')
      .insert(payload);

    if (error) throw error;

    return { token, expiresAt };
  }

  async rotateRefreshToken(
    rawToken: string,
    meta?: TokenRequestMeta
  ): Promise<{ userId: string; token: string; expiresAt: string }> {
    const tokenHash = hashOpaqueToken(rawToken);

    const { data: currentToken, error } = await supabaseAdmin
      .from('refresh_tokens')
      .select('id, user_id, token_hash, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle() as { data: RefreshTokenRow | null; error: unknown };

    if (error) throw error;

    if (!currentToken || currentToken.revoked_at) {
      throw new Error('Invalid refresh token');
    }

if (new Date(currentToken.expires_at) <= new Date()) {
      throw new Error('Refresh token expired');
    }

const now = new Date().toISOString();
    const { error: revokeError } = await supabaseAdmin
      .from('refresh_tokens')
      .update({ revoked_at: now, last_used_at: now })
      .eq('id', currentToken.id)
      .is('revoked_at', null);

    if (revokeError) throw revokeError;

    const next = await this.issueRefreshToken(currentToken.user_id, meta, currentToken.id);
    return { userId: currentToken.user_id, token: next.token, expiresAt: next.expiresAt };
  }

  async revokeRefreshToken(rawToken?: string | null): Promise<void> {
    if (!rawToken) return;

    const tokenHash = hashOpaqueToken(rawToken);
    const now = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('refresh_tokens')
      .update({ revoked_at: now, last_used_at: now })
      .eq('token_hash', tokenHash)
      .is('revoked_at', null);

    if (error) throw error;
  }

  async revokeAllRefreshTokensForUser(userId: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('refresh_tokens')
      .update({ revoked_at: now, last_used_at: now })
      .eq('user_id', userId)
      .is('revoked_at', null);

    if (error) throw error;
  }

  async createPasswordResetRequest(
    email: string,
    meta?: TokenRequestMeta
  ): Promise<{ requestId: string; userId: string } | null> {
    const normalizedEmail = email.toLowerCase().trim();

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', normalizedEmail)
      .maybeSingle() as { data: { id: string; email: string } | null; error: unknown };

    if (userError) throw userError;
    if (!user) return null;

    const { data, error } = await supabaseAdmin
      .from('password_reset_requests')
      .insert({
        user_id: user.id,
        request_email: user.email,
        status: 'pending',
        created_ip: meta?.ip,
        created_user_agent: meta?.userAgent,
      })
      .select('id')
      .single() as { data: { id: string } | null; error: unknown };

    if (error) throw error;
    if (!data) throw new Error('Failed to create password reset request');

    return { requestId: data.id, userId: user.id };
  }

  async listPasswordResetRequests(limit: number = 100, status?: string) {
    let query = supabaseAdmin
      .from('password_reset_requests')
      .select('id, user_id, request_email, status, request_notes, approved_by, approved_at, token_expires_at, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async approvePasswordResetRequest(
    requestId: string,
    approverId: string,
    notes?: string
  ): Promise<{ resetToken: string; expiresAt: string }> {
    const { data: request, error: requestError } = await supabaseAdmin
      .from('password_reset_requests')
      .select('id, status')
      .eq('id', requestId)
      .maybeSingle() as { data: { id: string; status: string } | null; error: unknown };

    if (requestError) throw requestError;
    if (!request) throw new Error('Password reset request not found');

    if (request.status === 'completed' || request.status === 'rejected') {
      throw new Error('Password reset request can no longer be approved');
    }

const resetToken = generateOpaqueToken(32);
    const resetTokenHash = hashOpaqueToken(resetToken);
    const expiresAt = this.getResetTokenExpiryDate();

    const { error } = await supabaseAdmin
      .from('password_reset_requests')
      .update({
        status: 'approved',
        approved_by: approverId,
        approved_at: new Date().toISOString(),
        request_notes: notes || null,
        reset_token_hash: resetTokenHash,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId);

    if (error) throw error;

    return { resetToken, expiresAt };
  }

  async rejectPasswordResetRequest(
    requestId: string,
    approverId: string,
    notes?: string
  ): Promise<void> {
    const { error } = await supabaseAdmin
      .from('password_reset_requests')
      .update({
        status: 'rejected',
        approved_by: approverId,
        approved_at: new Date().toISOString(),
        request_notes: notes || null,
        reset_token_hash: null,
        token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .in('status', ['pending', 'approved']);

    if (error) throw error;
  }

  async resetPasswordWithApprovedToken(token: string, newPassword: string): Promise<string> {
    const tokenHash = hashOpaqueToken(token);

    const { data: request, error } = await supabaseAdmin
      .from('password_reset_requests')
      .select('id, user_id, status, token_expires_at, completed_at')
      .eq('reset_token_hash', tokenHash)
      .maybeSingle() as {
        data: {
          id: string;
          user_id: string;
          status: string;
          token_expires_at: string | null;
          completed_at: string | null;
        } | null;
        error: unknown;
      };

    if (error) throw error;
    if (!request) throw new Error('Invalid reset token');
    if (request.status !== 'approved') throw new Error('Reset token is not approved');
    if (!request.token_expires_at || new Date(request.token_expires_at) <= new Date()) {
      throw new Error('Reset token has expired');
    }

if (request.completed_at) throw new Error('Reset token has already been used');

    const passwordHash = await hashPassword(newPassword);

    const { error: userUpdateError } = await supabaseAdmin
      .from('users')
      .update({ password_hash: passwordHash })
      .eq('id', request.user_id);

    if (userUpdateError) throw userUpdateError;

    await this.revokeAllRefreshTokensForUser(request.user_id);

    const { error: requestUpdateError } = await supabaseAdmin
      .from('password_reset_requests')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        reset_token_hash: null,
        token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.id);

    if (requestUpdateError) throw requestUpdateError;

    return request.user_id;
  }
}

export const authRecoveryService = new AuthRecoveryService();
