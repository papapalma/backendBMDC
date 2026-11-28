/**
 * Training Requirement Files Service
 * 
 * Handles uploading, retrieving, and managing training requirement files
 * with tenant isolation and access control.
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  UPLOAD_BASE_DIR,
  generateDocumentPath,
  initTenantDirectories,
  pathBelongsToTenant,
} from '@/lib/fileStorage';
import { logger } from '@/utils/logger';
import type { RequirementOcrAnalysis } from '@/types/advisory';

// Valid requirement types
export const REQUIREMENT_TYPES = [
  'accomplished_learners_profile_form',
  'birth_certificate_copy',
  'marriage_certificate_copy',
  'id_pictures',
  'valid_id_copy',
  'report_card_tor_copy',
  'barangay_no_grade_certification',
] as const;

export type RequirementType = string;

// Mandatory requirements (marriage certificate is optional)
export const MANDATORY_REQUIREMENTS = [
  'accomplished_learners_profile_form',
  'birth_certificate_copy',
  'id_pictures',
  'valid_id_copy',
  'report_card_tor_copy',
  'barangay_no_grade_certification',
] as const;

export interface TrainingRequirementFile {
  id: string;
  tenant_id: string;
  trainee_id: string;
  requirement_type: RequirementType;
  file_path: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string | null;
  uploaded_by: string;
  uploaded_at: string;
  updated_at: string;
  deleted_at: string | null;
  ocr_analysis?: RequirementOcrAnalysis | null;
}

export interface UploadRequirementFileParams {
  tenantId: string;
  traineeId: string;
  requirementType: RequirementType;
  file: Buffer;
  fileName: string;
  mimeType?: string;
  userId: string;
}

export interface TrainingRequirementFileResponse {
  id: string;
  requirement_type: RequirementType;
  file_path: string;
  file_name: string;
  file_size_bytes: number;
  uploaded_at: string;
  uploaded_by: string;
  ocr_analysis?: RequirementOcrAnalysis | null;
}

/**
 * Upload a training requirement file
 */
export async function uploadRequirementFile(
  params: UploadRequirementFileParams
): Promise<TrainingRequirementFileResponse> {
  const {
    tenantId,
    traineeId,
    requirementType,
    file,
    fileName,
    mimeType,
    userId,
  } = params;

  // Check if there's an existing file for this requirement type
  const existingFile = await getRequirementFile(tenantId, traineeId, requirementType);
  
  if (existingFile) {
    logger.info('[TRAINING_REQUIREMENT] Replacing existing file', {
      tenantId,
      traineeId,
      requirementType,
      oldFile: existingFile.file_name,
      newFile: fileName,
    });
    
    // HARD DELETE the old file record from database
    const { error: deleteError } = await supabaseAdmin
      .from('training_requirement_files')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('trainee_id', traineeId)
      .eq('requirement_type', requirementType)
      .is('deleted_at', null);
    
    if (deleteError) {
      logger.error('[TRAINING_REQUIREMENT] Failed to delete old record', { error: deleteError });
      throw deleteError;
    }
    
    // Delete old file from disk
    try {
      const oldAbsolutePath = path.join(UPLOAD_BASE_DIR, existingFile.file_path.replace(/^\/uploads\//, ''));
      await fs.unlink(oldAbsolutePath);
      logger.info('[TRAINING_REQUIREMENT] Deleted old file from disk', { path: oldAbsolutePath });
    } catch (diskError) {
      logger.warn('[TRAINING_REQUIREMENT] Failed to delete old file from disk', { error: diskError });
      // Continue anyway - we'll upload the new file
    }
  }

  // Initialize tenant directories
  await initTenantDirectories(tenantId);

  // Generate unique filename
  const timestamp = Date.now();
  const random = crypto.randomBytes(6).toString('hex');
  const ext = path.extname(fileName).toLowerCase();
  const uniqueFilename = `${requirementType}_${timestamp}_${random}${ext}`;

  // Generate paths
  const relativePath = `/uploads/${tenantId}/documents/trainees/${traineeId}/${uniqueFilename}`;
  const absolutePath = path.join(UPLOAD_BASE_DIR, tenantId, 'documents', 'trainees', traineeId, uniqueFilename);

  // Ensure directory exists
  const dirPath = path.dirname(absolutePath);
  await fs.mkdir(dirPath, { recursive: true });

  // Write file to disk
  await fs.writeFile(absolutePath, file);

  logger.info('[TRAINING_REQUIREMENT] File uploaded to disk', {
    tenantId,
    traineeId,
    requirementType,
    fileName,
    filePath: relativePath,
    sizeBytes: file.length,
  });

  // Save metadata to database
  const { data, error } = await supabaseAdmin
    .from('training_requirement_files')
    .insert({
      tenant_id: tenantId,
      trainee_id: traineeId,
      requirement_type: requirementType,
      file_path: relativePath,
      file_name: fileName,
      file_size_bytes: file.length,
      mime_type: mimeType || null,
      uploaded_by: userId,
    })
    .select('id, requirement_type, file_path, file_name, file_size_bytes, uploaded_at, uploaded_by')
    .single();

  if (error) {
    // Attempt to delete uploaded file on database error
    try {
      await fs.unlink(absolutePath);
    } catch (unlinkError) {
      logger.warn('[TRAINING_REQUIREMENT] Failed to clean up file after DB error', { unlinkError });
    }
    logger.error('[TRAINING_REQUIREMENT] Failed to save to database', { error });
    throw error;
  }

  logger.info('[TRAINING_REQUIREMENT] File saved to database successfully', {
    id: data.id,
    requirementType,
    fileName,
  });

  // Sync enrollment_requirements so analytics and submission views reflect uploaded registration documents
  await syncEnrollmentRequirementsForFile(
    tenantId,
    traineeId,
    requirementType,
    relativePath,
    data.uploaded_at || new Date().toISOString()
  );

  return data as TrainingRequirementFileResponse;
}

/**
 * Keep enrollment_requirements in sync when a trainee requirement file is uploaded or deleted.
 * Non-fatal: logs a warning if sync fails so file persistence is never rolled back.
 */
async function syncEnrollmentRequirementsForFile(
  tenantId: string,
  traineeId: string,
  requirementType: RequirementType,
  documentUrl: string | null,
  submittedAt: string | null
): Promise<void> {
  try {
    const { data: requirementDef, error: defError } = await supabaseAdmin
      .from('requirement_definitions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('requirement_type', requirementType)
      .is('deleted_at', null)
      .maybeSingle();

    if (defError || !requirementDef?.id) return;

    const { data: enrollments, error: enrollError } = await supabaseAdmin
      .from('enrollments')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('trainee_id', traineeId);

    if (enrollError || !enrollments || enrollments.length === 0) return;

    const enrollmentIds = enrollments.map((e: { id: string }) => e.id).filter(Boolean);
    if (enrollmentIds.length === 0) return;

    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from('enrollment_requirements')
      .select('id, enrollment_id, submission_status')
      .eq('tenant_id', tenantId)
      .eq('requirement_id', requirementDef.id)
      .in('enrollment_id', enrollmentIds);

    if (existingError) {
      logger.warn('[TRAINING_REQUIREMENT] Failed querying enrollment_requirements for sync', {
        traineeId,
        requirementType,
        error: existingError.message,
      });
      return;
    }

    const existingByEnrollment = new Map<string, { id: string; submission_status: string }>(
      (existingRows || []).map((row: any) => [row.enrollment_id, row])
    );

    if (documentUrl) {
      for (const enrollmentId of enrollmentIds) {
        const existing = existingByEnrollment.get(enrollmentId);
        if (existing) {
          const nextStatus =
            existing.submission_status === 'pending' || existing.submission_status === 'rejected'
              ? 'submitted'
              : existing.submission_status;
          await supabaseAdmin
            .from('enrollment_requirements')
            .update({
              document_url: documentUrl,
              submitted_at: submittedAt,
              submission_status: nextStatus,
            })
            .eq('id', existing.id)
            .eq('tenant_id', tenantId);
        } else {
          await supabaseAdmin
            .from('enrollment_requirements')
            .insert({
              enrollment_id: enrollmentId,
              requirement_id: requirementDef.id,
              tenant_id: tenantId,
              is_applicable: true,
              submission_status: 'submitted',
              document_url: documentUrl,
              submitted_at: submittedAt,
            });
        }
      }
    } else {
      for (const row of existingRows || []) {
        if (row.submission_status === 'submitted') {
          await supabaseAdmin
            .from('enrollment_requirements')
            .update({
              submission_status: 'pending',
              document_url: null,
              submitted_at: null,
            })
            .eq('id', row.id)
            .eq('tenant_id', tenantId);
        }
      }
    }
  } catch (syncError: any) {
    logger.warn('[TRAINING_REQUIREMENT] Warning syncing enrollment_requirements', {
      tenantId,
      traineeId,
      requirementType,
      error: syncError?.message || syncError,
    });
  }
}

/**
 * Persist advisory OCR analysis JSONB on a requirement file record.
 * Strictly non-fatal: if migration 018 (ocr_analysis column) has not been applied yet,
 * logs a warning and returns without affecting the uploaded file.
 */
export async function saveRequirementOcrAnalysis(
  tenantId: string,
  fileId: string,
  ocrAnalysis: RequirementOcrAnalysis
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from('training_requirement_files')
      .update({ ocr_analysis: ocrAnalysis })
      .eq('id', fileId)
      .eq('tenant_id', tenantId);

    if (error) {
      logger.warn('[TRAINING_REQUIREMENT] Could not persist ocr_analysis (non-fatal)', {
        fileId,
        error: error.message,
      });
      return false;
    }
    return true;
  } catch (err: any) {
    logger.warn('[TRAINING_REQUIREMENT] Unexpected error saving ocr_analysis (non-fatal)', {
      fileId,
      error: err?.message ?? String(err),
    });
    return false;
  }
}

/**
 * Get all training requirement files for a trainee (not deleted)
 */
export async function getTraineeRequirementFiles(
  tenantId: string,
  traineeId: string
): Promise<TrainingRequirementFileResponse[]> {
  let { data, error } = await supabaseAdmin
    .from('training_requirement_files')
    .select('id, requirement_type, file_path, file_name, file_size_bytes, uploaded_at, uploaded_by, ocr_analysis')
    .eq('tenant_id', tenantId)
    .eq('trainee_id', traineeId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false });

  if (error && /ocr_analysis/i.test(error.message || '')) {
    const fallback = await supabaseAdmin
      .from('training_requirement_files')
      .select('id, requirement_type, file_path, file_name, file_size_bytes, uploaded_at, uploaded_by')
      .eq('tenant_id', tenantId)
      .eq('trainee_id', traineeId)
      .is('deleted_at', null)
      .order('uploaded_at', { ascending: false });
    data = fallback.data as any;
    error = fallback.error;
  }

  if (error) {
    throw error;
  }

  return (data || []) as TrainingRequirementFileResponse[];
}

/**
 * Get a specific requirement file for a trainee
 */
export async function getRequirementFile(
  tenantId: string,
  traineeId: string,
  requirementType: RequirementType
): Promise<TrainingRequirementFileResponse | null> {
  let { data, error } = await supabaseAdmin
    .from('training_requirement_files')
    .select('id, requirement_type, file_path, file_name, file_size_bytes, uploaded_at, uploaded_by, ocr_analysis')
    .eq('tenant_id', tenantId)
    .eq('trainee_id', traineeId)
    .eq('requirement_type', requirementType)
    .is('deleted_at', null)
    .single();

  if (error && /ocr_analysis/i.test(error.message || '')) {
    const fallback = await supabaseAdmin
      .from('training_requirement_files')
      .select('id, requirement_type, file_path, file_name, file_size_bytes, uploaded_at, uploaded_by')
      .eq('tenant_id', tenantId)
      .eq('trainee_id', traineeId)
      .eq('requirement_type', requirementType)
      .is('deleted_at', null)
      .single();
    data = fallback.data as any;
    error = fallback.error;
  }

  if (error && error.code !== 'PGRST116') {
    // PGRST116 is "not found" which is expected
    throw error;
  }

  return (data || null) as TrainingRequirementFileResponse | null;
}

/**
 * Delete (soft delete) a training requirement file
 */
export async function deleteRequirementFile(
  tenantId: string,
  traineeId: string,
  requirementType: RequirementType
): Promise<void> {
  // Get the file first
  const { data, error: fetchError } = await supabaseAdmin
    .from('training_requirement_files')
    .select('file_path')
    .eq('tenant_id', tenantId)
    .eq('trainee_id', traineeId)
    .eq('requirement_type', requirementType)
    .is('deleted_at', null)
    .single();

  if (fetchError) {
    if (fetchError.code === 'PGRST116') {
      // Not found - already deleted
      return;
    }
    throw fetchError;
  }

  // Soft delete in database
  const { error: updateError } = await supabaseAdmin
    .from('training_requirement_files')
    .update({ deleted_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('trainee_id', traineeId)
    .eq('requirement_type', requirementType)
    .is('deleted_at', null);

  if (updateError) {
    throw updateError;
  }

  await syncEnrollmentRequirementsForFile(tenantId, traineeId, requirementType, null, null);

  // Delete file from disk
  if (data?.file_path) {
    try {
      const absolutePath = path.join(UPLOAD_BASE_DIR, data.file_path.replace(/^\/uploads\//, ''));
      await fs.unlink(absolutePath);
      logger.info('[TRAINING_REQUIREMENT] File deleted', {
        tenantId,
        traineeId,
        requirementType,
        filePath: data.file_path,
      });
    } catch (diskError) {
      logger.warn('[TRAINING_REQUIREMENT] Failed to delete file from disk', {
        filePath: data.file_path,
        error: diskError,
      });
      // Don't throw - DB deletion was successful
    }
  }
}

/**
 * Check if trainee has all mandatory requirement files uploaded
 */
export async function checkMandatoryRequirementsComplete(
  tenantId: string,
  traineeId: string
): Promise<{
  complete: boolean;
  missing: RequirementType[];
  uploaded: RequirementType[];
}> {
  const uploadedFiles = await getTraineeRequirementFiles(tenantId, traineeId);
  const uploadedTypes = uploadedFiles.map(f => f.requirement_type as RequirementType);
  
  const missing = MANDATORY_REQUIREMENTS.filter(
    req => !uploadedTypes.includes(req)
  ) as RequirementType[];

  return {
    complete: missing.length === 0,
    missing,
    uploaded: uploadedTypes,
  };
}

/**
 * Verify file belongs to tenant and get its absolute path
 * Used for secure file serving
 */
export async function getSecureFilePath(
  tenantId: string,
  traineeId: string,
  requirementType: RequirementType
): Promise<string | null> {
  logger.info('[GET_SECURE_FILE_PATH] Looking for file', { 
    tenantId, 
    traineeId, 
    requirementType 
  });

  const file = await getRequirementFile(tenantId, traineeId, requirementType);
  
  if (!file) {
    logger.warn('[GET_SECURE_FILE_PATH] File not found in database', { 
      tenantId, 
      traineeId, 
      requirementType 
    });
    return null;
  }

  logger.info('[GET_SECURE_FILE_PATH] File found in database', { 
    tenantId, 
    traineeId, 
    requirementType,
    filePath: file.file_path,
    fileName: file.file_name
  });

  // Verify path belongs to this tenant
  if (!pathBelongsToTenant(file.file_path, tenantId)) {
    logger.warn('[TRAINING_REQUIREMENT] Unauthorized file access attempt', {
      tenantId,
      traineeId,
      requirementType,
      filePath: file.file_path,
    });
    return null;
  }

  const absolutePath = path.join(UPLOAD_BASE_DIR, file.file_path.replace(/^\/uploads\//, ''));
  
  logger.info('[GET_SECURE_FILE_PATH] Checking if file exists on disk', { 
    absolutePath,
    UPLOAD_BASE_DIR 
  });

  // Verify file exists
  try {
    await fs.access(absolutePath);
    logger.info('[GET_SECURE_FILE_PATH] File exists on disk', { absolutePath });
    return absolutePath;
  } catch (error) {
    logger.warn('[TRAINING_REQUIREMENT] File not found on disk', {
      filePath: file.file_path,
      absolutePath,
      error: error
    });
    return null;
  }
}

/**
 * Resolve one submitted file by its database ID for secure downloads.
 * The tenant and trainee checks prevent a file ID from crossing boundaries.
 */
export async function getSecureFilePathById(
  tenantId: string,
  traineeId: string,
  fileId: string
): Promise<string | null> {
  const { data: file, error } = await supabaseAdmin
    .from('training_requirement_files')
    .select('file_path')
    .eq('id', fileId)
    .eq('tenant_id', tenantId)
    .eq('trainee_id', traineeId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  if (!file?.file_path || !pathBelongsToTenant(file.file_path, tenantId)) return null;

  const absolutePath = path.join(UPLOAD_BASE_DIR, file.file_path.replace(/^\/uploads\//, ''));
  try {
    await fs.access(absolutePath);
    return absolutePath;
  } catch {
    return null;
  }
}
