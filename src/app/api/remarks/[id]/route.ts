import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireTenantContext } from '@/middleware/tenantContext';
import { handleOptionsRequest } from '@/middleware/cors';
import { withErrorHandler } from '@/middleware/errorHandler';
import logger from '@/utils/logger';

// Validation schema for updating a remark
const updateRemarkSchema = z.object({
  remark: z.string().min(1, 'Remark cannot be empty').max(5000, 'Remark is too long'),
});

/**
 * PUT /api/remarks/[id]
 * Update an existing remark
 */
export const PUT = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;
    const context = ctxResult.context;

    const { id: remarkId } = await params;
    const body = await request.json();

    // Validate request body
    const validation = updateRemarkSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { remark } = validation.data;

    // Check if remark exists, belongs to user's tenant, and user is the creator
    const { data: existingRemark, error: checkError } = await supabaseAdmin
      .from('trainee_remarks')
      .select('id, created_by')
      .eq('id', remarkId)
      .eq('tenant_id', context.tenantId)
      .maybeSingle();

    if (checkError) {
      logger.error('[TRAINEE_REMARKS] Failed to check remark', {
        remarkId,
        error: checkError.message,
      });
      throw checkError;
    }

    if (!existingRemark) {
      return NextResponse.json({ error: 'Remark not found' }, { status: 404 });
    }

    // Only allow the creator to update their own remark (or super_admin)
    if (existingRemark.created_by !== context.userId && context.role !== 'super_admin') {
      return NextResponse.json(
        { error: 'You can only edit your own remarks' },
        { status: 403 }
      );
    }

    // Update the remark
    const { data: updatedRemark, error: updateError } = await supabaseAdmin
      .from('trainee_remarks')
      .update({
        remark,
        updated_at: new Date().toISOString(),
      })
      .eq('id', remarkId)
      .eq('tenant_id', context.tenantId)
      .select()
      .single();

    if (updateError) {
      logger.error('[TRAINEE_REMARKS] Failed to update remark', {
        remarkId,
        error: updateError.message,
      });
      throw updateError;
    }

    logger.info('[TRAINEE_REMARKS] Updated remark', {
      remarkId,
      userId: context.userId,
    });

    return NextResponse.json({
      success: true,
      data: updatedRemark,
    });
  }
);

/**
 * DELETE /api/remarks/[id]
 * Delete a remark
 */
export const DELETE = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;
    const context = ctxResult.context;

    const { id: remarkId } = await params;

    // Check if remark exists, belongs to user's tenant, and user is the creator
    const { data: existingRemark, error: checkError } = await supabaseAdmin
      .from('trainee_remarks')
      .select('id, created_by')
      .eq('id', remarkId)
      .eq('tenant_id', context.tenantId)
      .maybeSingle();

    if (checkError) {
      logger.error('[TRAINEE_REMARKS] Failed to check remark', {
        remarkId,
        error: checkError.message,
      });
      throw checkError;
    }

    if (!existingRemark) {
      return NextResponse.json({ error: 'Remark not found' }, { status: 404 });
    }

    // Only allow the creator to delete their own remark (or super_admin)
    if (existingRemark.created_by !== context.userId && context.role !== 'super_admin') {
      return NextResponse.json(
        { error: 'You can only delete your own remarks' },
        { status: 403 }
      );
    }

    // Delete the remark
    const { error: deleteError } = await supabaseAdmin
      .from('trainee_remarks')
      .delete()
      .eq('id', remarkId)
      .eq('tenant_id', context.tenantId);

    if (deleteError) {
      logger.error('[TRAINEE_REMARKS] Failed to delete remark', {
        remarkId,
        error: deleteError.message,
      });
      throw deleteError;
    }

    logger.info('[TRAINEE_REMARKS] Deleted remark', {
      remarkId,
      userId: context.userId,
    });

    return NextResponse.json({
      success: true,
      message: 'Remark deleted successfully',
    });
  }
);

export const OPTIONS = handleOptionsRequest;
