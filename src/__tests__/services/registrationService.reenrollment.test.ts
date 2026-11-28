import { RegistrationService, ConflictError } from '../../services/registrationService';
import { supabaseAdmin } from '@/lib/supabase-admin';

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  hashPassword: jest.fn().mockResolvedValue('hashed-password-123'),
}));

jest.mock('../../services/emailService', () => ({
  sendAccountApprovalConfirmationEmail: jest.fn().mockResolvedValue({ success: true }),
  sendWelcomeEmail: jest.fn().mockResolvedValue({ success: true }),
  sendRegistrationRejectionEmail: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../../services/enrollmentRequirementService', () => ({
  initializeEnrollmentRequirements: jest.fn().mockResolvedValue(undefined),
}));

const sampleRegistrationInput = {
  username: 'trainee_12345678',
  email: 'existing.trainee@example.com',
  password: '',
  first_name: 'Maria',
  last_name: 'Santos',
  middle_name: 'L.',
  phone: '09171234567',
  sex: 'Female' as const,
  birth_date: '1999-05-15',
  birth_place: 'Manila',
  civil_status: 'Single' as const,
  province: 'Metro Manila',
  municipality: 'Quezon City',
  barangay: 'Diliman',
  street: '123 Commonwealth Ave',
  educational_attainment: 'College Graduate',
  course: 'BS Information Technology',
  year_graduated: '2021',
  classification: 'Unemployed',
  disability: null,
  employment_status: 'Unemployed',
  program_id: 'prog-new-222',
};

describe('RegistrationService — Existing Trainee Multi-Program Re-Enrollment', () => {
  let service: RegistrationService;
  const tenantId = 'tenant-111';
  const existingTraineeId = 'trainee-existing-111';
  const existingUserId = 'user-existing-111';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RegistrationService();
  });

  it('reuses and updates the existing trainee row (avoiding trainees_tenant_id_email_key violation) when an existing trainee with 0 active enrollments applies to another program', async () => {
    const traineesInsertSpy = jest.fn();
    const traineesUpdateSpy = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: {
              id: existingTraineeId,
              tenant_id: tenantId,
              user_id: existingUserId,
              email: sampleRegistrationInput.email,
              first_name: sampleRegistrationInput.first_name,
              last_name: sampleRegistrationInput.last_name,
              registration_status: 'pending',
              status: 'inactive',
            },
            error: null,
          }),
        }),
      }),
    });

    const enrollmentsInsertSpy = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: {
            id: 'enroll-new-222',
            tenant_id: tenantId,
            trainee_id: existingTraineeId,
            program_id: sampleRegistrationInput.program_id,
            status: 'enrolled',
          },
          error: null,
        }),
      }),
    });

    let traineesSelectCount = 0;
    let enrollmentsSelectCount = 0;

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'trainees') {
        return {
          select: jest.fn().mockImplementation(() => {
            traineesSelectCount++;
            return {
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: {
                      id: existingTraineeId,
                      user_id: existingUserId,
                      email: sampleRegistrationInput.email,
                      registration_status: 'completed',
                      status: 'completed',
                      tenant_id: tenantId,
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }),
          insert: traineesInsertSpy,
          update: traineesUpdateSpy,
        };
      }

      if (table === 'enrollments') {
        return {
          select: jest.fn().mockImplementation((_cols: string, opts?: any) => {
            enrollmentsSelectCount++;
            if (opts?.head) {
              // checkIncompleteEnrollment count query -> 0 active enrollments
              return {
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    in: jest.fn().mockResolvedValue({ count: 0, error: null }),
                  }),
                }),
              };
            }
            // Target program existing enrollment check -> null (new program)
            return {
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            };
          }),
          insert: enrollmentsInsertSpy,
        };
      }

      return {};
    });

    const result = await service.submitRegistration(sampleRegistrationInput, tenantId, true, 'direct');

    expect(traineesInsertSpy).not.toHaveBeenCalled();
    expect(traineesUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: existingUserId,
        registration_status: 'pending',
        status: 'inactive',
        deleted_at: null,
      })
    );
    expect(enrollmentsInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: tenantId,
        trainee_id: existingTraineeId,
        program_id: sampleRegistrationInput.program_id,
        status: 'enrolled',
      })
    );
    expect(result.id).toBe(existingTraineeId);
  });

  it('reactivates a previously dropped enrollment via UPDATE instead of INSERT when re-applying to the same program', async () => {
    const enrollmentsInsertSpy = jest.fn();
    const enrollmentsUpdateSpy = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: {
              id: 'enroll-dropped-111',
              tenant_id: tenantId,
              trainee_id: existingTraineeId,
              program_id: sampleRegistrationInput.program_id,
              status: 'enrolled',
            },
            error: null,
          }),
        }),
      }),
    });

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'trainees') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: {
                    id: existingTraineeId,
                    user_id: existingUserId,
                    email: sampleRegistrationInput.email,
                    registration_status: 'completed',
                    status: 'dropped',
                    tenant_id: tenantId,
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: existingTraineeId,
                    tenant_id: tenantId,
                    user_id: existingUserId,
                    email: sampleRegistrationInput.email,
                    registration_status: 'pending',
                    status: 'inactive',
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === 'enrollments') {
        return {
          select: jest.fn().mockImplementation((_cols: string, opts?: any) => {
            if (opts?.head) {
              return {
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    in: jest.fn().mockResolvedValue({ count: 0, error: null }),
                  }),
                }),
              };
            }
            return {
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    maybeSingle: jest.fn().mockResolvedValue({
                      data: { id: 'enroll-dropped-111', status: 'dropped' },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }),
          insert: enrollmentsInsertSpy,
          update: enrollmentsUpdateSpy,
        };
      }

      return {};
    });

    await service.submitRegistration(sampleRegistrationInput, tenantId, true, 'direct');

    expect(enrollmentsInsertSpy).not.toHaveBeenCalled();
    expect(enrollmentsUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'enrolled',
        completion_date: null,
      })
    );
  });

  it('blocks application with ConflictError when trainee already has an active/enrolled program', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'trainees') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: {
                    id: existingTraineeId,
                    user_id: existingUserId,
                    email: sampleRegistrationInput.email,
                    registration_status: 'completed',
                    status: 'active',
                    tenant_id: tenantId,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === 'enrollments') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                in: jest.fn().mockResolvedValue({ count: 1, error: null }),
              }),
            }),
          }),
        };
      }

      return {};
    });

    await expect(
      service.submitRegistration(sampleRegistrationInput, tenantId, true, 'direct')
    ).rejects.toThrow(ConflictError);
  });

  it('transitions pending enrolled row to dropped when rejectRegistration is called', async () => {
    const enrollmentsUpdateEqStatusSpy = jest.fn().mockResolvedValue({ error: null });
    const enrollmentsUpdateSpy = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: enrollmentsUpdateEqStatusSpy,
        }),
      }),
    });

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'trainees') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: existingTraineeId,
                  registration_status: 'pending',
                  email: sampleRegistrationInput.email,
                  first_name: 'Maria',
                  last_name: 'Santos',
                  tenant_id: tenantId,
                },
                error: null,
              }),
            }),
          }),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
        };
      }

      if (table === 'enrollments') {
        return {
          update: enrollmentsUpdateSpy,
        };
      }

      return {};
    });

    await service.rejectRegistration(existingTraineeId, 'admin-1', 'Incomplete documents');

    expect(enrollmentsUpdateSpy).toHaveBeenCalledWith({ status: 'dropped' });
    expect(enrollmentsUpdateEqStatusSpy).toHaveBeenCalledWith('status', 'enrolled');
  });

  it('picks the active pending program enrollment over older completed/dropped enrollments in getAllRegistrations', async () => {
    (supabaseAdmin.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [
                {
                  id: existingTraineeId,
                  tenant_id: tenantId,
                  email: sampleRegistrationInput.email,
                  first_name: 'Maria',
                  last_name: 'Santos',
                  registration_status: 'pending',
                  enrollments: [
                    {
                      id: 'enroll-old-1',
                      program_id: 'prog-old-111',
                      status: 'completed',
                      updated_at: '2026-01-10T00:00:00Z',
                      programs: { id: 'prog-old-111', name: 'Old Completed Program' },
                    },
                    {
                      id: 'enroll-new-2',
                      program_id: 'prog-new-222',
                      status: 'enrolled',
                      updated_at: '2026-11-24T00:00:00Z',
                      programs: { id: 'prog-new-222', name: 'New Target Program' },
                    },
                  ],
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });

    const registrations = await service.getAllRegistrations({
      tenantId,
      userId: 'admin-1',
      role: 'local_admin',
      isSuperAdmin: false,
    });

    expect(registrations).toHaveLength(1);
    expect(registrations[0].program_id).toBe('prog-new-222');
    expect((registrations[0] as any).program?.name).toBe('New Target Program');
  });

  it('clears deleted_at when approveRegistration completes a previously soft-deleted trainee', async () => {
    const traineesUpdateSpy = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'trainees') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: existingTraineeId,
                  tenant_id: tenantId,
                  email: sampleRegistrationInput.email,
                  first_name: 'Maria',
                  last_name: 'Santos',
                  registration_status: 'pending',
                  created_at: '2026-09-15T00:00:00Z',
                  enrollments: [{ program_id: 'prog-new-222', status: 'enrolled', enrollment_date: '2026-11-25' }],
                },
                error: null,
              }),
            }),
          }),
          update: traineesUpdateSpy,
        };
      }

      if (table === 'users') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              is: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: { id: existingUserId, email: sampleRegistrationInput.email },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === 'users_tenants' || table === 'trainee_accounts') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: { user_id: existingUserId }, error: null }),
              }),
            }),
          }),
        };
      }

      if (table === 'pending_registration_passwords' || table === 'pending_registration_usernames') {
        return {
          delete: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
        };
      }

      return {};
    });

    await service.approveRegistration(existingTraineeId, 'admin-1');

    expect(traineesUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        registration_status: 'completed',
        user_id: existingUserId,
        status: 'active',
        deleted_at: null,
      })
    );
  });
});
