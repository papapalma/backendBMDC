import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendWhatsApp } from './whatsappService';
import { sendEmail } from './emailService';
import logger from '@/utils/logger';

interface VerificationRecord {
  id: string;
  email: string;
  phone?: string;
  code: string;
  expires_at: string;
  verified_at?: string;
  attempts: number;
  method: 'email' | 'whatsapp' | 'both';
  created_at: string;
}

export class VerificationService {
  /**
   * Resolve trainee context by email lookup
   * Queries the trainees table with case-insensitive email match
   * 
   * @param email - The email address to look up
   * @returns Promise resolving to {traineeId, isVerified} if trainee found, null otherwise
   * @throws Error if database query fails
   */
  async resolveTraineeContext(
    email: string
  ): Promise<{ traineeId: string; isVerified: boolean } | null> {
    try {
      // Handle null/undefined email input gracefully
      if (!email || typeof email !== 'string') {
        return null;
      }

      const { data, error } = await supabaseAdmin
        .from('trainees')
        .select('id, is_verified')
        .ilike('email', email) // Case-insensitive match using ilike
        .limit(1)
        .single();

      // If no trainee found, return null (not an error condition)
      if (error) {
        // PGRST116 is the standard "no rows found" error for .single()
        if (error.code === 'PGRST116') {
          return null;
        }
        // For actual database errors, log and throw
        logger.error('Database error in resolveTraineeContext', { error, email });
        throw new Error('Failed to resolve trainee context');
      }

      if (!data) {
        return null;
      }

      return {
        traineeId: data.id,
        isVerified: data.is_verified,
      };
    } catch (error) {
      logger.error('Error in resolveTraineeContext', { error, email });
      throw error;
    }
  }

  /**
   * Validate that account type is allowed for email verification
   * Only trainee accounts are allowed (either user.role='trainee' OR trainee record exists)
   * 
   * @param email - The email address to validate
   * @returns Promise<boolean> - true if trainee account or trainee record exists, false otherwise
   * @throws Error if database query fails with non-recoverable error
   */
  async isAccountTypeAllowed(email: string): Promise<boolean> {
    try {
      // Handle null/undefined email input gracefully
      if (!email || typeof email !== 'string') {
        logger.warn('isAccountTypeAllowed called with invalid email', { email });
        return false;
      }

      const normalizedEmail = email.toLowerCase();

      // Step 1: Check users table for trainee role
      const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('role')
        .eq('email', normalizedEmail)
        .limit(1)
        .single();

      // Check for actual database errors (not "no rows found")
      if (userError && userError.code !== 'PGRST116') {
        logger.error('Database error checking users table', { error: userError, email: normalizedEmail });
        throw new Error('Failed to validate account type');
      }

      // If user found, check if role is 'trainee'
      if (userData && userData.role === 'trainee') {
        logger.debug('Account type allowed: user with trainee role', { email: normalizedEmail });
        return true;
      }

      // If user found but role is not 'trainee', account type not allowed
      if (userData) {
        logger.debug('Account type not allowed: user with non-trainee role', {
          email: normalizedEmail,
          role: userData.role,
        });
        return false;
      }

      // Step 2: No user found, check trainees table for orphan trainee registration
      const { data: traineeData, error: traineeError } = await supabaseAdmin
        .from('trainees')
        .select('id')
        .eq('email', normalizedEmail)
        .limit(1)
        .single();

      // Check for actual database errors (not "no rows found")
      if (traineeError && traineeError.code !== 'PGRST116') {
        logger.error('Database error checking trainees table', { error: traineeError, email: normalizedEmail });
        throw new Error('Failed to validate account type');
      }

      // If trainee record exists, account type is allowed (orphan trainee registration flow)
      if (traineeData && traineeData.id) {
        logger.debug('Account type allowed: orphan trainee record found', { email: normalizedEmail });
        return true;
      }

      // No user or trainee record found
      logger.debug('Account type not allowed: no user or trainee record found', { email: normalizedEmail });
      return false;
    } catch (error) {
      logger.error('Error in isAccountTypeAllowed', { error, email });
      throw error;
    }
  }

  /**
   * Check if a trainee account is already authenticated
   * Returns true if trainee with is_verified=true exists, false otherwise
   * Returns false if trainee doesn'\'t exist (allows registration flow to proceed)
   * 
   * @param email - The email address to check authentication status for
   * @returns Promise<boolean> - true if trainee is already verified, false otherwise
   * @throws Error if database query fails
   */
  async isAlreadyAuthenticated(email: string): Promise<boolean> {
    try {
      // Handle null/undefined email input gracefully
      if (!email || typeof email !== 'string') {
        return false;
      }

      const { data, error } = await supabaseAdmin
        .from('trainees')
        .select('is_verified')
        .ilike('email', email) // Case-insensitive match using ilike
        .limit(1)
        .single();

      // If no trainee found, return false (allows registration flow to proceed)
      if (error) {
        // PGRST116 is the standard "no rows found" error for .single()
        if (error.code === 'PGRST116') {
          return false;
        }
        // For actual database errors, log and return false (fail gracefully)
        logger.error('Database error in isAlreadyAuthenticated', { error, email });
        return false;
      }

      if (!data) {
        return false;
      }

      // Return true if trainee is verified, false otherwise
      return data.is_verified === true;
    } catch (error) {
      logger.error('Error in isAlreadyAuthenticated', { error, email });
      // Fail gracefully on unexpected errors
      return false;
    }
  }

  /**
   * Build permission error for unauthorized verification requests
   * 
   * @param reason - The reason for the permission denial: 'not_trainee' or 'already_verified'
   * @returns Error object with status code, message, and error type for client-side handling
   * 
   * Status codes:
   * - 'not_trainee': 403 Forbidden (account type not allowed)
   * - 'already_verified': 200 OK (special case: success response with skip message)
   */
  buildPermissionError(reason: 'not_trainee' | 'already_verified'): Error & { statusCode?: number; errorType?: string } {
    const errorMap = {
      not_trainee: {
        statusCode: 403,
        message: 'Email verification is only available for trainee accounts',
        errorType: 'PERMISSION_DENIED',
      },
      already_verified: {
        statusCode: 200,
        message: 'Your account is already verified. Please log in',
        errorType: 'ALREADY_VERIFIED',
      },
    };

    const config = errorMap[reason];
    const error = new Error(config.message) as Error & { statusCode?: number; errorType?: string };
    error.statusCode = config.statusCode;
    error.errorType = config.errorType;

    return error;
  }

  /**
   * Generate a random 6-digit OTP code
   */
  private generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Send verification code via email and/or WhatsApp
   * 
   * STEP 1: Validates account type - only trainee accounts allowed (unless registrationContext=true)
   * STEP 2: Checks authentication state - already-verified trainees skip email send
   * STEP 3: Proceeds with existing OTP generation and sending logic (UNCHANGED)
   */
  async sendVerificationCode(params: {
    email: string;
    phone?: string;
    method: 'email' | 'whatsapp' | 'both';
    firstName?: string;
    registrationContext?: boolean;
  }): Promise<{ success: boolean; message: string; code?: string }> {
    try {
      const { email, phone, method, firstName = 'User', registrationContext = false } = params;
      console.log('[VERIFICATION_SERVICE] sendVerificationCode called with:', { email, phone, method, firstName, registrationContext });

      // STEP 1: Check if account type is allowed (trainee only)
      // Skip check if registrationContext=true (during manual registration)
      if (!registrationContext) {
        const isAllowed = await this.isAccountTypeAllowed(email);
        if (!isAllowed) {
          const error = this.buildPermissionError('not_trainee');
          logger.warn('Non-trainee account attempted verification', { email });
          throw error;
        }
      }

      // STEP 2: Check if trainee is already authenticated (only for non-registration context)
      if (!registrationContext) {
        const isVerified = await this.isAlreadyAuthenticated(email);
        if (isVerified) {
          logger.info('Already-verified trainee attempted re-authentication', { email });
          return {
            success: true,
            message: 'Your account is already verified. Please log in',
          };
        }
      }

      // STEP 3: Generate OTP and proceed with existing logic (UNCHANGED)
      const code = this.generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

      // Store verification code in database
      const { data: verificationRecord, error: insertError } = await supabaseAdmin
        .from('email_verifications')
        .insert({
          email: email.toLowerCase(),
          phone: phone || null,
          code,
          expires_at: expiresAt,
          method,
          attempt_count: 0,
        })
        .select()
        .single();

      if (insertError) {
        logger.error('Failed to create verification record', { error: insertError });
        throw new Error('Failed to create verification record');
      }

      const results = {
        emailSent: false,
        whatsappSent: false,
        error: null as string | null,
      };

      // Send via Email
      if (method === 'email' || method === 'both') {
        try {
          const templateBody = `
<h2>Email Verification</h2>
<p>Hello {{firstName}},</p>
<p>Your verification code is: <strong>{{code}}</strong></p>
<p>This code will expire in {{expiresIn}}.</p>
<p>If you did not request this code, please ignore this email.</p>
          `.trim();

          // Need tenantId - for now use a default one. This should ideally be passed in params
          const tenantId = process.env.NEXT_PUBLIC_BMDC_TENANT_ID || '00000000-0000-0000-0000-000000000001';

          await sendEmail({
            tenantId,
            recipientEmail: email,
            subject: 'Verify Your Email - BMDC Registration',
            templateName: 'email_verification',
            templateBody,
            templateVariables: {
              firstName,
              code,
              expiresIn: '10 minutes',
            },
          });
          results.emailSent = true;
        } catch (emailError) {
          logger.warn('Failed to send verification email', { error: emailError, email });
          results.error = results.error ? `${results.error}, Email failed` : 'Email send failed';
        }
      }

      // Send via WhatsApp
      if ((method === 'whatsapp' || method === 'both') && phone) {
        try {
          const tenantId = process.env.NEXT_PUBLIC_BMDC_TENANT_ID || '00000000-0000-0000-0000-000000000001';

          await sendWhatsApp({
            tenantId,
            recipientPhone: phone,
            templateName: 'verification_code',
            languageCode: 'en_US',
            templateVariables: [code, '10 minutes'],
          });
          results.whatsappSent = true;
        } catch (whatsappError) {
          logger.warn('Failed to send verification WhatsApp', { error: whatsappError, phone });
          results.error = results.error ? `${results.error}, WhatsApp failed` : 'WhatsApp send failed';
        }
      }

      // If at least one channel succeeded
      if (results.emailSent || results.whatsappSent) {
        return {
          success: true,
          message: `Verification code sent via ${results.emailSent && results.whatsappSent ? 'email and WhatsApp' : results.emailSent ? 'email' : 'WhatsApp'}`,
          code: process.env.NODE_ENV === 'development' ? code : undefined, // Return code in dev for testing
        };
      } else {
        throw new Error(results.error || 'Failed to send verification code through any channel');
      }
    } catch (error) {
      logger.error('Error in sendVerificationCode', { error });
      throw error;
    }
  }

  /**
   * Verify the OTP code
   */
  async verifyCode(params: { email: string; code: string }): Promise<{ success: boolean; message: string }> {
    try {
      const { email, code } = params;

      // Find the verification record
      const { data: verificationRecord, error: fetchError } = await supabaseAdmin
        .from('email_verifications')
        .select('*')
        .eq('email', email.toLowerCase())
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (fetchError || !verificationRecord) {
        throw new Error('No verification request found. Please request a new code.');
      }

      // Check if expired
      if (new Date() > new Date(verificationRecord.expires_at)) {
        throw new Error('Verification code has expired. Please request a new one.');
      }

      // Check attempts
      if (verificationRecord.attempt_count >= 5) {
        throw new Error('Too many failed attempts. Please request a new verification code.');
      }

      // Verify code
      if (verificationRecord.code !== code) {
        // Increment attempts
        await supabaseAdmin
          .from('email_verifications')
          .update({ attempt_count: verificationRecord.attempt_count + 1 })
          .eq('id', verificationRecord.id);

        throw new Error('Invalid verification code. Please try again.');
      }

      // Mark as verified
      const { error: updateError } = await supabaseAdmin
        .from('email_verifications')
        .update({ verified_at: new Date().toISOString() })
        .eq('id', verificationRecord.id);

      if (updateError) {
        throw updateError;
      }

      return {
        success: true,
        message: 'Email verified successfully!',
      };
    } catch (error) {
      logger.error('Error in verifyCode', { error });
      throw error;
    }
  }

  /**
   * Check if email is already verified
   */
  async isEmailVerified(email: string): Promise<boolean> {
    try {
      const { data, error } = await supabaseAdmin
        .from('email_verifications')
        .select('verified_at')
        .eq('email', email.toLowerCase())
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !data) return false;
      return !!data.verified_at;
    } catch (error) {
      logger.warn('Error checking email verification', { error });
      return false;
    }
  }

  /**
   * Clear old verification codes
   */
  async cleanupExpiredCodes(): Promise<number> {
    try {
      const { data: deleted, error } = await supabaseAdmin
        .from('email_verifications')
        .delete()
        .lt('expires_at', new Date().toISOString())
        .select();

      if (error) {
        logger.warn('Error cleaning up expired codes', { error });
        return 0;
      }

      return deleted?.length || 0;
    } catch (error) {
      logger.error('Error in cleanupExpiredCodes', { error });
      return 0;
    }
  }
}

export const verificationService = new VerificationService();



