import { NextRequest, NextResponse } from 'next/server';
import { requireRoleAsync } from '@/middleware/auth';
import { passwordResetRequestDecisionSchema } from '@/utils/validators';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { authRecoveryService } from '@/services/authRecoveryService';
import { activityLogService } from '@/services/activityLogService';

// OPTIONS /api/auth/password-reset-requests/:id - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// PATCH /api/auth/password-reset-requests/:id - Admin approve/reject reset request

export const PATCH = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const authResult = await requireRoleAsync(request, ['local_admin', 'super_admin']);
    if ('error' in authResult) return authResult.error as NextResponse;

    const { id } = await params;
    const body = await request.json();
    const parsed = passwordResetRequestDecisionSchema.parse(body);

    if (parsed.action === 'approve') { const approval = await authRecoveryService.approvePasswordResetRequest(
        id,
        authResult.user.userId,
        parsed.notes
      );

      await activityLogService.logAction(
        authResult.user.userId,
        'password_reset_approved',
        'password_reset_request',
        id,
        { expires_at: approval.expiresAt }
      );

      return successResponse(
        { requestId: id,
          status: 'approved',
          resetToken: approval.resetToken,
          expiresAt: approval.expiresAt, },
        'Password reset request approved'
      ); }

    await authRecoveryService.rejectPasswordResetRequest(
      id,
      authResult.user.userId,
      parsed.notes
    );

    await activityLogService.logAction(
      authResult.user.userId,
      'password_reset_rejected',
      'password_reset_request',
      id,
      { notes: parsed.notes }
    );

    return successResponse({ requestId: id, status: 'rejected' }, 'Password reset request rejected'); }
);
