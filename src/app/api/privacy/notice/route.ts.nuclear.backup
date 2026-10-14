/**
 * GET /api/privacy/notice
 *
 * Returns the privacy notice content for display during trainee registration
 * (Req 22.1, 22.2). This is a public endpoint — no authentication required.
 *
 * The notice explains:
 *   - What personal data is collected and why
 *   - Data retention period (5 years after program completion)
 *   - Data categories and purposes
 *   - Data Protection Officer (DPO) contact information
 *   - Trainee rights under RA 10173 (Philippine Data Privacy Act of 2012)
 *
 * The current consent version is returned so the frontend can record it
 * alongside the trainee's consent timestamp and IP address.
 *
 * Requirements: 22.1, 22.2
 */
import { NextRequest } from 'next/server';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

/** Increment this version string whenever the privacy notice content changes. */
const CURRENT_CONSENT_VERSION = '1.0.0';

/** Effective date of the current privacy notice */
const EFFECTIVE_DATE = '2025-01-01';

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const GET = withErrorHandler(async (_request: NextRequest) => {
  return successResponse({
    version: CURRENT_CONSENT_VERSION,
    effectiveDate: EFFECTIVE_DATE,
    title: 'Privacy Notice — Training Management System',
    legalBasis: 'Republic Act No. 10173 (Data Privacy Act of 2012)',

    introduction:
      'This Privacy Notice explains how the Local Government Unit (LGU) Training ' +
      'Management System collects, uses, stores, and protects your personal information ' +
      'in accordance with the Philippine Data Privacy Act of 2012 (RA 10173).',

    dataController: {
      description:
        'The Local Government Unit operating this training center is the Personal ' +
        'Information Controller (PIC) responsible for your personal data.',
      contact: 'Please contact your LGU training center for the specific controller details.',
    },

    dataProtectionOfficer: {
      description:
        'A Data Protection Officer (DPO) has been designated to oversee compliance ' +
        'with RA 10173.',
      contact:
        process.env.DPO_EMAIL ??
        'dpo@lgu-training.gov.ph (contact your LGU for the specific DPO email)',
    },

    dataCategories: [
      {
        category: 'Identity Information',
        examples: 'Full name, date of birth, place of birth, sex, civil status',
        purpose: 'Trainee identification and certificate issuance',
      },
      {
        category: 'Contact Information',
        examples: 'Email address, phone number, home address (province, municipality, barangay, street)',
        purpose: 'Communication about training schedules, notifications, and certificates',
      },
      {
        category: 'Educational & Employment Background',
        examples: 'Educational attainment, course, year graduated, employment status, classification',
        purpose: 'Program eligibility assessment and demographic reporting',
      },
      {
        category: 'Training Records',
        examples: 'Enrollment dates, attendance records, assessment scores, completion status',
        purpose: 'Training program management and certificate generation',
      },
      {
        category: 'Profile Photo',
        examples: 'Photograph uploaded during registration',
        purpose: 'Trainee identification and QR code generation',
      },
      {
        category: 'Emergency Contact',
        examples: 'Emergency contact name and phone number',
        purpose: 'Emergency communication during training activities',
      },
    ],

    purposes: [
      'Enrollment and management of training programs',
      'Attendance tracking and assessment recording',
      'Generation and issuance of training certificates',
      'Compliance with government reporting requirements',
      'Statistical analysis and program improvement (anonymized/aggregated)',
      'Communication regarding training schedules and updates',
    ],

    retentionPolicy: {
      description:
        'Your personal data will be retained for 5 years after the completion of ' +
        'your last enrolled training program, in accordance with government record-keeping ' +
        'requirements. After this period, your data will be securely deleted or anonymized.',
      period: '5 years after program completion',
      basis: 'Government record-keeping requirements and RA 10173',
    },

    dataSharing: {
      description:
        'Your personal data is not sold or shared with third parties for commercial ' +
        'purposes. Data may be shared with:',
      recipients: [
        'National Government Agencies (NGA) for compliance reporting (anonymized/aggregated)',
        'Technical service providers operating this system under strict data processing agreements',
      ],
    },

    yourRights: [
      {
        right: 'Right to be Informed',
        description: 'You have the right to know how your personal data is collected and used.',
      },
      {
        right: 'Right to Access',
        description:
          'You may request a copy of all personal data we hold about you via ' +
          'GET /api/trainees/:id/personal-data.',
      },
      {
        right: 'Right to Rectification',
        description:
          'You may request correction of inaccurate personal data via ' +
          'PATCH /api/trainees/:id/personal-data.',
      },
      {
        right: 'Right to Erasure',
        description:
          'You may request deletion of your personal data, subject to legal retention ' +
          'requirements, via POST /api/trainees/:id/anonymize.',
      },
      {
        right: 'Right to Object',
        description:
          'You may object to the processing of your personal data for specific purposes.',
      },
      {
        right: 'Right to Data Portability',
        description:
          'You may request your personal data in a structured, machine-readable format.',
      },
    ],

    consentStatement:
      'By checking the consent box during registration, you acknowledge that you have ' +
      'read and understood this Privacy Notice and consent to the collection and processing ' +
      'of your personal data as described above. You may withdraw your consent at any time ' +
      'by contacting the Data Protection Officer, subject to legal retention requirements.',

    contactForRequests:
      'To exercise your rights or for any privacy-related concerns, please contact ' +
      'the Data Protection Officer at the email address listed above.',
  });
});
