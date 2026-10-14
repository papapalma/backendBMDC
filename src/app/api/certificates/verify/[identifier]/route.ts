/**
 * GET /api/certificates/verify/:identifier
 *
 * Public certificate verification endpoint (Req 16.6).
 * Accepts either a certificate number (e.g. BMDC-CERT-2025-0001)
 * or a QR code value (e.g. CERT-BMDC-CERT-2025-0001).
 *
 * No authentication required — anyone with the QR code or certificate
 * number can verify authenticity.
 *
 * Requirements: 16.5, 16.6
 */
import { NextRequest } from 'next/server';
import { successResponse, notFoundResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { verifyCertificate } from '@/services/certificateService';

// OPTIONS /api/certificates/verify/:identifier

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/certificates/verify/:identifier — public verification (Req 16.6)

export const GET = withErrorHandler(
  async (
  _request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
  ) => { const { identifier } = await params;

  if (!identifier || identifier.trim().length === 0) { return notFoundResponse('Certificate identifier is required'); }

const certificate = await verifyCertificate(decodeURIComponent(identifier));

  if (!certificate) { return notFoundResponse('Certificate not found or has been revoked'); }

  // Return verification details — trainee name, program, issue date, authenticity

return successResponse({ valid: true,
  certificate: { certificate_number: certificate.certificate_number,
  issue_date: certificate.issue_date,
  verification_url: certificate.verification_url,
  signatory_name: certificate.signatory_name,
  signatory_title: certificate.signatory_title, },
  trainee: certificate.trainee
  ? { name: [
  certificate.trainee.first_name,
  certificate.trainee.middle_name,
  certificate.trainee.last_name,
  ]
  .filter(Boolean)
  .join(' '), }
  : null,
  program: certificate.program
  ? { name: certificate.program.name, }
  : null,
  completion: certificate.enrollment
  ? { date: certificate.enrollment.completion_date,
  status: certificate.enrollment.status, }
  : null, }); }
);
