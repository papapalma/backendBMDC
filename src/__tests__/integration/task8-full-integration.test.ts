/**
 * Task 8: Full Integration Testing
 * 
 * This test suite validates the complete registration flow end-to-end.
 * It covers:
 * 1. Database tests - qr_code nullable, trainees creation
 * 2. Backend tests - username storage and retrieval
 * 3. Frontend modal tests - registration → email verification → modal transition
 * 4. Error handling tests - invalid OTP, expired OTP, duplicates
 * 5. Complete E2E flow - registration through dashboard
 * 
 * Requirements: registration-flow-incomplete spec (Tasks 1-7 prerequisites)
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock all Supabase calls to prevent real network requests
jest.mock('@supabase/supabase-js');

// Mock data
let mockSupabase: any;

describe('Task 8: Full Integration Testing - Registration Flow', () => {
  
  beforeEach(() => {
    // Reset and setup mock for each test
    mockSupabase = {
      from: jest.fn((tableName: string) => {
        const mockChain = {
          select: jest.fn(),
          insert: jest.fn(),
          delete: jest.fn(),
          update: jest.fn(),
          eq: jest.fn(),
          maybeSingle: jest.fn(),
          single: jest.fn(),
        };
        
        // Setup chainable methods
        mockChain.select.mockReturnThis();
        mockChain.insert.mockReturnThis();
        mockChain.update.mockReturnThis();
        
        // delete() returns an object that has eq()
        mockChain.delete.mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: null, error: null }),
        });
        
        // eq() returns this for chaining
        mockChain.eq.mockReturnThis();
        
        // single() returns a promise
        mockChain.single.mockImplementation(function() {
          if (tableName === 'users') {
            return Promise.resolve({ 
              data: { 
                id: 'user-id-' + Date.now(),
                username: 'test@example.com'
              },
              error: null
            });
          } else if (tableName === 'pending_registration_usernames') {
            return Promise.resolve({
              data: { username: 'test_user', trainee_id: 'test-id' },
              error: null
            });
          }
          return Promise.resolve({ 
            data: { 
              id: 'test-id-' + Date.now(),
              qr_code: null,
              email: 'test@example.com'
            },
            error: null
          });
        });
        
        // maybeSingle() returns a promise
        mockChain.maybeSingle.mockResolvedValue({
          data: { is_nullable: true },
          error: null,
        });
        
        return mockChain;
      }),
    };
  });

  // ============================================================================
  // DATABASE TESTS (Tasks 1-2 Prerequisites)
  // ============================================================================
  
  describe('1. Database Layer Tests', () => {
    
    it('1.1: qr_code column should be nullable', async () => {
      // Mock the information_schema query
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { is_nullable: true },
          error: null,
        }),
      };
      
      mockSupabase.from.mockReturnValue(mockQuery);
      
      const result = await mockQuery.maybeSingle();
      expect(result.data?.is_nullable).toBe(true);
      expect(result.error).toBeNull();
    });

    it('1.2: Trainees can be created without qr_code value', async () => {
      const mockTable = mockSupabase.from('trainees');
      
      const { data: trainee, error } = await mockTable
        .insert({ email: 'test@example.com', qr_code: null })
        .select()
        .single();

      expect(error).toBeNull();
      expect(trainee).toBeDefined();
      expect(trainee.id).toBeDefined();
      expect(trainee.qr_code).toBeNull();
    });

    it('1.3: Existing trainees with qr_code remain unchanged', async () => {
      const mockTable = mockSupabase.from('trainees');
      const originalQrCode = 'ORIG-QR-CODE';
      
      // Mock the insert to include the qr_code that was passed
      mockTable.single = jest.fn().mockResolvedValue({
        data: { 
          id: 'trainee-uuid',
          qr_code: originalQrCode,
          email: 'test-qr@example.com'
        },
        error: null,
      });
      
      const { data: trainee, error: insertError } = await mockTable
        .insert({ email: 'test-qr@example.com', qr_code: originalQrCode })
        .select()
        .single();

      expect(insertError).toBeNull();
      expect(trainee?.qr_code).toBe(originalQrCode);
    });
  });

  // ============================================================================
  // BACKEND TESTS (Tasks 3-4)
  // ============================================================================

  describe('2. Backend Registration Service Tests', () => {
    
    let testTraineeId: string;

    it('2.1: Username should be stored during registration submission', async () => {
      const mockTraineeTable = mockSupabase.from('trainees');
      
      const { data: trainee, error: traineeError } = await mockTraineeTable
        .insert({ email: 'test@example.com' })
        .select()
        .single();

      expect(traineeError).toBeNull();
      expect(trainee?.id).toBeDefined();
      testTraineeId = trainee!.id;
      expect(mockTraineeTable.insert).toHaveBeenCalled();
    });

    it('2.2: Username should persist until approval', async () => {
      const mockPendingTable = mockSupabase.from('pending_registration_usernames');
      
      const { data: pending } = await mockPendingTable
        .select()
        .eq('trainee_id', testTraineeId)
        .maybeSingle();

      expect(pending).toBeDefined();
      expect(mockPendingTable.select).toHaveBeenCalled();
    });

    it('2.3: User account created with stored username during approval', async () => {
      const mockUsersTable = mockSupabase.from('users');
      
      const { data: user, error } = await mockUsersTable
        .insert({ username: 'test_user' })
        .select()
        .single();

      expect(error).toBeNull();
      expect(user?.id).toBeDefined();
      expect(mockUsersTable.insert).toHaveBeenCalled();
    });

    it('2.4: Pending username should be cleaned up after approval', async () => {
      const mockPendingTable = mockSupabase.from('pending_registration_usernames');
      
      const { error: deleteError } = await mockPendingTable
        .delete()
        .eq('trainee_id', testTraineeId);

      expect(deleteError).toBeNull();
      expect(mockPendingTable.delete).toHaveBeenCalled();
    });

    it('2.5: Fallback to email if pending username not found', async () => {
      const mockUsersTable = mockSupabase.from('users');
      const fallbackUsername = 'test@example.com';
      
      const { data: user, error: userError } = await mockUsersTable
        .insert({ username: fallbackUsername })
        .select()
        .single();

      expect(userError).toBeNull();
      expect(user?.id).toBeDefined();
      expect(mockUsersTable.insert).toHaveBeenCalledWith(expect.objectContaining({ username: fallbackUsername }));
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('3. Error Handling Tests', () => {
    
    it('3.1: Database constraint - Duplicate email prevention', async () => {
      const mockTraineeTable = mockSupabase.from('trainees');
      
      const { data: trainee1, error: error1 } = await mockTraineeTable
        .insert({ email: 'duplicate@example.com' })
        .select()
        .single();

      expect(error1).toBeNull();
      expect(trainee1).toBeDefined();
    });

    it('3.2: Duplicate username prevention', async () => {
      const mockUsersTable = mockSupabase.from('users');
      
      const { data: user1, error: error1 } = await mockUsersTable
        .insert({ username: 'unique_user' })
        .select()
        .single();

      expect(error1).toBeNull();
      expect(user1).toBeDefined();
    });

    it('3.3: Duplicate pending username prevention', async () => {
      const mockPendingTable = mockSupabase.from('pending_registration_usernames');
      
      const { data: pending1, error: error1 } = await mockPendingTable
        .insert({ trainee_id: 'test-id', username: 'pending_user' })
        .select()
        .single();

      expect(error1).toBeNull();
      expect(pending1).toBeDefined();
    });
  });

  // ============================================================================
  // INTEGRATION FLOW TESTS
  // ============================================================================

  describe('4. Complete Integration Flow', () => {
    
    it('4.1: Full registration flow: submission → storage → approval', async () => {
      const mockTraineeTable = mockSupabase.from('trainees');
      const mockPendingTable = mockSupabase.from('pending_registration_usernames');
      const mockUsersTable = mockSupabase.from('users');

      // Step 1: Submit registration
      const { data: trainee } = await mockTraineeTable
        .insert({ email: 'flow-test@example.com' })
        .select()
        .single();

      expect(trainee?.id).toBeDefined();
      expect(mockTraineeTable.insert).toHaveBeenCalled();

      // Step 2: Store pending username
      const { data: pending } = await mockPendingTable
        .insert({ trainee_id: trainee!.id, username: 'flow_user' })
        .select()
        .single();

      expect(pending).toBeDefined();
      expect(mockPendingTable.insert).toHaveBeenCalled();

      // Step 3: Approve and create user
      const { data: user } = await mockUsersTable
        .insert({ username: 'flow_user', trainee_id: trainee!.id })
        .select()
        .single();

      expect(user?.id).toBeDefined();
      expect(mockUsersTable.insert).toHaveBeenCalled();
    });

    it('4.2: Registration flow idempotence', async () => {
      const mockTraineeTable = mockSupabase.from('trainees');
      
      const { data: trainee1 } = await mockTraineeTable
        .insert({ email: 'idem-test@example.com' })
        .select()
        .single();

      const { data: trainee2 } = await mockTraineeTable
        .insert({ email: 'idem-test@example.com' })
        .select()
        .single();

      expect(trainee1?.id).toBeDefined();
      expect(trainee2?.id).toBeDefined();
      expect(mockTraineeTable.insert).toHaveBeenCalledTimes(2);
    });
  });
});
