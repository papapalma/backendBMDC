import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireTenantContext } from '@/middleware/tenantContext';
import { handleOptionsRequest } from '@/middleware/cors';
import { withErrorHandler } from '@/middleware/errorHandler';
import logger from '@/utils/logger';

// Validation schema for creating a remark
const createRemarkSchema = z.object({
  remark: z.string().min(1, 'Remark cannot be empty').max(5000, 'Remark is too long'),
});

/**
 * GET /api/trainees/[id]/remarks
 * Fetch all remarks for a specific trainee
 */
export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;
    const context = ctxResult.context;

    const { id: traineeId } = await params;

    // Fetch remarks with creator information using Supabase RPC or direct query
    const { data: remarks, error } = await supabaseAdmin
      .from('trainee_remarks')
      .select(`
        id,
        trainee_id,
        remark,
        created_at,
        updated_at,
        created_by
      `)
      .eq('trainee_id', traineeId)
      .eq('tenant_id', context.tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('[TRAINEE_REMARKS] Failed to fetch remarks', {
        traineeId,
        error: error.message,
      });
      throw error;
    }

    const creatorIds = [...new Set((remarks || []).map((remark: any) => remark.created_by).filter(Boolean))];
    const { data: creators, error: creatorsError } = creatorIds.length > 0
      ? await supabaseAdmin
          .from('users')
          .select('id, username, email')
          .in('id', creatorIds)
      : { data: [], error: null };

    if (creatorsError) {
      logger.error('[TRAINEE_REMARKS] Failed to fetch remark creators', {
        traineeId,
        error: creatorsError.message,
      });
      throw creatorsError;
    }

    const creatorById = new Map<string, any>(
      (creators || []).map((creator: any) => [creator.id, creator] as [string, any])
    );

    // Transform the data to match expected format
    const formattedRemarks = (remarks || []).map((remark: any) => {
      const creator = creatorById.get(remark.created_by);
      return {
        id: remark.id,
        trainee_id: remark.trainee_id,
        remark: remark.remark,
        created_at: remark.created_at,
        updated_at: remark.updated_at,
        creator_id: creator?.id,
        creator_username: creator?.username,
        creator_email: creator?.email,
        creator_name: creator?.username || creator?.email || null,
      };
    });

    logger.info('[TRAINEE_REMARKS] Fetched remarks', {
      traineeId,
      count: formattedRemarks.length,
      userId: context.userId,
    });

    return NextResponse.json({
      success: true,
      data: formattedRemarks,
    });
  }
);

/**
 * POST /api/trainees/[id]/remarks
 * Create a new remark for a trainee
 */
export const POST = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;
    const context = ctxResult.context;

    const { id: traineeId } = await params;
    const body = await request.json();

    // Validate request body
    const validation = createRemarkSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { remark } = validation.data;

    // Check if trainee exists and belongs to the same tenant
    const { data: trainee, error: traineeError } = await supabaseAdmin
      .from('trainees')
      .select('id')
      .eq('id', traineeId)
      .eq('tenant_id', context.tenantId)
      .maybeSingle();

    if (traineeError) {
      logger.error('[TRAINEE_REMARKS] Failed to check trainee', {
        traineeId,
        error: traineeError.message,
      });
      throw traineeError;
    }

    if (!trainee) {
      return NextResponse.json({ error: 'Trainee not found' }, { status: 404 });
    }

    // Insert the remark
    const { data: newRemark, error: insertError } = await supabaseAdmin
      .from('trainee_remarks')
      .insert({
        trainee_id: traineeId,
        remark,
        created_by: context.userId,
        tenant_id: context.tenantId,
      })
      .select()
      .single();

    if (insertError) {
      logger.error('[TRAINEE_REMARKS] Failed to create remark', {
        traineeId,
        error: insertError.message,
      });
      throw insertError;
    }

    // Fetch creator information
    const { data: creator, error: creatorError } = await supabaseAdmin
      .from('users')
      .select('id, username, email')
      .eq('id', context.userId)
      .single();

    if (creatorError) {
      logger.error('[TRAINEE_REMARKS] Failed to fetch creator', {
        userId: context.userId,
        error: creatorError.message,
      });
      throw creatorError;
    }

    const remarkWithCreator = {
      ...newRemark,
      creator_id: creator.id,
      creator_username: creator.username,
      creator_email: creator.email,
      creator_name: creator.username || creator.email,
    };

    logger.info('[TRAINEE_REMARKS] Created remark', {
      remarkId: newRemark.id,
      traineeId,
      userId: context.userId,
    });

    return NextResponse.json({
      success: true,
      data: remarkWithCreator,
    }, { status: 201 });
  }
);

export const OPTIONS = handleOptionsRequest;
