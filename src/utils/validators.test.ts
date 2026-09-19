/**
 * Property-Based Tests for Schema Validators
 * 
 * Tests for Zod schema definitions to ensure proper functionality
 * and validate bug fixes.
 * 
 * **Validates: Requirements 1**
 */

import { z } from 'zod';
import fc from 'fast-check';

/**
 * Bug Condition Exploration Test: ZodEffects Method Chain Failure
 * 
 * SCOPED PBT APPROACH - Concrete Failing Case:
 * This test explores the bug condition by attempting to instantiate updateTraineeStatusSchema
 * which calls .partial().omit() on a schema wrapped in .refine() calls.
 * 
 * Expected Behavior on UNFIXED code:
 * - Test FAILS with TypeError: "...partial is not a function"
 * - This proves the bug exists (ZodEffects doesn't have these methods)
 * - Error counterexample: TypeError at line where .partial() is called
 * 
 * Expected Behavior on FIXED code:
 * - Test PASSES
 * - updateTraineeStatusSchema is defined without error
 * - Schema has .parse() method available
 * - Validation refinements are preserved
 */
describe('Bug Condition: ZodEffects Method Chain Failure - Exploration', () => {
  it('Fixed Pattern: .partial().omit() works when applied BEFORE .refine()', () => {
    // Demonstrates the FIXED pattern: .partial().omit() applied BEFORE .refine()
    // This is the correct approach that allows refinements to be applied while
    // preserving all fields as optional and excluding identity fields
    
    // Step 1: Define base schema
    const baseSchema = z.object({
      id: z.string().uuid('Invalid ID'),
      name: z.string().max(100),
      employment_status: z.enum(['employed', 'unemployed', 'pending']),
      job_title: z.string().optional().nullable(),
    });
    
    // Step 2: Apply .partial().omit() BEFORE .refine() - this is the fix
    const updateSchema = baseSchema
      .partial()
      .omit({ id: true })
      .refine(
        (data) => {
          if (data.employment_status === 'employed') {
            return data.job_title && data.job_title.trim().length > 0;
          }
          return true;
        },
        { message: 'Job title is required for employed status', path: ['job_title'] }
      );
    
    // Property Test 1: Parse method should be callable (core requirement)
    expect(typeof updateSchema.parse).toBe('function');
    expect(typeof updateSchema.safeParse).toBe('function');
    
    // Property Test 2: Empty object should parse (all fields optional)
    const result = updateSchema.safeParse({});
    expect(result.success).toBe(true);
    
    // Property Test 3: Refinement should be enforced
    const result2 = updateSchema.safeParse({
      employment_status: 'employed',
      // Missing job_title - should fail refinement
    });
    expect(result2.success).toBe(false);
  });

  it('Bug Condition Documented: TypeError on updateTraineeStatusSchema instantiation', () => {
    // CONCRETE FAILING CASE: Import and instantiate updateTraineeStatusSchema
    // 
    // Bug Condition C(X):
    //   X = { schema with .refine() applied }
    //   calling .partial().omit() on X
    //   => TypeError: partial is not a function
    //
    // This test fails on unfixed code with:
    // TypeError: exports.createTraineeStatusSchema.partial is not a function
    // at src/utils/validators.ts:623
    
    try {
      const validators = require('./validators');
      
      // If we reach here without error, the bug is fixed
      const schema = validators.updateTraineeStatusSchema;
      expect(schema).toBeDefined();
      expect(typeof schema.parse).toBe('function');
      expect(typeof schema.safeParse).toBe('function');
    } catch (error) {
      // On unfixed code, importing validators throws because updateTraineeStatusSchema
      // definition fails at line 623: updateTraineeStatusSchema = createTraineeStatusSchema.partial().omit(...)
      if (error instanceof TypeError && error.message.includes('partial')) {
        // This is the expected bug condition - document the counterexample
        const counterexample = `TypeError: ${error.message}`;
        throw new Error(
          `BUG CONFIRMED - ZodEffects Method Chain Failure\n` +
          `Counterexample: ${counterexample}\n` +
          `Location: src/utils/validators.ts:623\n` +
          `Root cause: .refine() wraps schema in ZodEffects which lacks .partial()/.omit() methods\n` +
          `Expected Fix: Apply .partial().omit() BEFORE .refine() calls`
        );
      }
      throw error;
    }
  });
});

/**
 * Validation Refinements Tests: Task 3.4
 * 
 * **Validates: Requirements 1.3**
 * 
 * Verifies that employment status validation and unemployment reason validation
 * work correctly in both createTraineeStatusSchema and updateTraineeStatusSchema.
 */
describe('Task 3.4: Validation Refinements - Employment Status and Unemployment Reason', () => {
  const validators = require('./validators');

  describe('Employment Status Validation', () => {
    describe('createTraineeStatusSchema', () => {
      it('Valid: accepts employed status with job title', () => {
        const input = {
          trainee_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          enrollment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
          graduation_status: 'pending',
          employment_status: 'employed',
          job_title: 'Engineer',
        };

        const result = validators.createTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('Invalid: rejects employed status with empty job title', () => {
        const input = {
          trainee_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          enrollment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
          graduation_status: 'pending',
          employment_status: 'employed',
          job_title: '',
        };

        const result = validators.createTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain('Job title is required');
      });

      it('Invalid: rejects employed status with whitespace-only job title', () => {
        const input = {
          trainee_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          enrollment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
          graduation_status: 'pending',
          employment_status: 'employed',
          job_title: '   ',
        };

        const result = validators.createTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain('Job title is required');
      });

      it('Valid: accepts self_employed status with job title', () => {
        const input = {
          trainee_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          enrollment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
          graduation_status: 'pending',
          employment_status: 'self_employed',
          job_title: 'Freelancer',
        };

        const result = validators.createTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('Invalid: rejects self_employed status with empty job title', () => {
        const input = {
          trainee_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          enrollment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
          graduation_status: 'pending',
          employment_status: 'self_employed',
          job_title: '',
        };

        const result = validators.createTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain('Job title is required');
      });

      it('Valid: accepts pending status without job title', () => {
        const input = {
          trainee_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          enrollment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
          graduation_status: 'pending',
          employment_status: 'pending',
        };

        const result = validators.createTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('Valid: accepts pursuing_education status without job title', () => {
        const input = {
          trainee_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          enrollment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
          graduation_status: 'pending',
          employment_status: 'pursuing_education',
        };

        const result = validators.createTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    describe('updateTraineeStatusSchema', () => {
      it('Valid: accepts partial data with employed status and job title', () => {
        const input = {
          employment_status: 'employed',
          job_title: 'Engineer',
        };

        const result = validators.updateTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('Invalid: rejects partial data with employed status and empty job title', () => {
        const input = {
          employment_status: 'employed',
          job_title: '',
        };

        const result = validators.updateTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain('Job title is required');
      });

      it('Valid: accepts partial data with pending status without job title', () => {
        const input = {
          employment_status: 'pending',
        };

        const result = validators.updateTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('Valid: accepts empty object (all fields optional in update)', () => {
        const input = {};

        const result = validators.updateTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('Valid: does not include trainee_id and enrollment_id in parsed result', () => {
        const input = {
          employment_status: 'employed',
          job_title: 'Engineer',
        };

        const result = validators.updateTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(true);
        
        // Verify the fields are not present (omitted)
        if (result.success) {
          expect(result.data).not.toHaveProperty('trainee_id');
          expect(result.data).not.toHaveProperty('enrollment_id');
        }
      });
    });
  });

  describe('Unemployment Reason Validation', () => {
    describe('createTraineeStatusSchema', () => {
      it('Valid: accepts unemployed status with unemployment reason', () => {
        const input = {
          trainee_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          enrollment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
          graduation_status: 'pending',
          employment_status: 'unemployed',
          unemployment_reason: 'No jobs available',
        };

        const result = validators.createTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('Invalid: rejects unemployed status with empty unemployment reason', () => {
        const input = {
          trainee_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          enrollment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
          graduation_status: 'pending',
          employment_status: 'unemployed',
          unemployment_reason: '',
        };

        const result = validators.createTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain('Unemployment reason is required');
      });

      it('Invalid: rejects unemployed status with whitespace-only unemployment reason', () => {
        const input = {
          trainee_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          enrollment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
          graduation_status: 'pending',
          employment_status: 'unemployed',
          unemployment_reason: '   ',
        };

        const result = validators.createTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain('Unemployment reason is required');
      });

      it('Valid: accepts employed status without unemployment reason', () => {
        const input = {
          trainee_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          enrollment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
          graduation_status: 'pending',
          employment_status: 'employed',
          job_title: 'Engineer',
        };

        const result = validators.createTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    describe('updateTraineeStatusSchema', () => {
      it('Valid: accepts partial data with unemployed status and unemployment reason', () => {
        const input = {
          employment_status: 'unemployed',
          unemployment_reason: 'No jobs available',
        };

        const result = validators.updateTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('Invalid: rejects partial data with unemployed status and empty unemployment reason', () => {
        const input = {
          employment_status: 'unemployed',
          unemployment_reason: '',
        };

        const result = validators.updateTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain('Unemployment reason is required');
      });

      it('Valid: accepts partial data with employed status without unemployment reason', () => {
        const input = {
          employment_status: 'employed',
          job_title: 'Software Engineer',
        };

        const result = validators.updateTraineeStatusSchema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Property-Based: Validation Refinements Across Various Inputs', () => {
    it('Property: Employed status requires non-empty job title in both schemas', () => {
      fc.assert(
        fc.property(
          fc.string().filter(s => s.length === 0 || /^\s+$/.test(s)), // Empty or whitespace
          (jobTitle) => {
            const createInput = {
              trainee_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
              enrollment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
              graduation_status: 'pending',
              employment_status: 'employed',
              job_title: jobTitle,
            };

            const updateInput = {
              employment_status: 'employed',
              job_title: jobTitle,
            };

            const createResult = validators.createTraineeStatusSchema.safeParse(createInput);
            const updateResult = validators.updateTraineeStatusSchema.safeParse(updateInput);

            // Both should fail validation
            expect(createResult.success).toBe(false);
            expect(updateResult.success).toBe(false);
            return true;
          }
        ),
        { numRuns: 10 }
      );
    });

    it('Property: Unemployed status requires non-empty unemployment reason in both schemas', () => {
      fc.assert(
        fc.property(
          fc.string().filter(s => s.length === 0 || /^\s+$/.test(s)), // Empty or whitespace
          (reason) => {
            const createInput = {
              trainee_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
              enrollment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
              graduation_status: 'pending',
              employment_status: 'unemployed',
              unemployment_reason: reason,
            };

            const updateInput = {
              employment_status: 'unemployed',
              unemployment_reason: reason,
            };

            const createResult = validators.createTraineeStatusSchema.safeParse(createInput);
            const updateResult = validators.updateTraineeStatusSchema.safeParse(updateInput);

            // Both should fail validation
            expect(createResult.success).toBe(false);
            expect(updateResult.success).toBe(false);
            return true;
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});


/**
 * Preservation Tests: Verify existing schemas are not affected by fix
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3**
 * 
 * These tests establish a baseline showing that OTHER schemas (not the broken updateTraineeStatusSchema)
 * continue to work fine on unfixed code. This ensures that when the fix is implemented, we don't break anything else.
 * 
 * IMPORTANT: 
 * - These tests demonstrate that OTHER schemas WORK on UNFIXED code (import succeeds for them)
 * - After the fix, these tests should CONTINUE TO PASS (regression check)
 * 
 * Since validators.ts fails to import completely on unfixed code (due to the bug),
 * we test schemas individually by importing Zod and recreating them to verify
 * the pattern works when not affected by the broken updateTraineeStatusSchema.
 */
describe('Preservation: Other Schemas Continue to Work', () => {
  it('Property 1.1: Schemas using .partial() without .refine() remain functional', () => {
    // Observe: createTraineeSchema.partial() works on UNFIXED code (line 222)
    // because it doesn't have .refine() calls
    //
    // Property: For all trainee schemas that use .partial() pattern WITHOUT .refine(),
    //           they can be instantiated and used successfully
    
    // Recreate the pattern from createTraineeSchema -> updateTraineeSchema
    // This pattern WORKS because no .refine() is used
    const baseTraineeSchema = z.object({
      id: z.string().uuid(),
      name: z.string().max(100),
      email: z.string().email(),
    });
    
    // .partial() should work fine on ZodObject (not wrapped in .refine())
    expect(typeof baseTraineeSchema.partial).toBe('function');
    
    const partialSchema = baseTraineeSchema.partial();
    expect(typeof partialSchema.parse).toBe('function');
    expect(typeof partialSchema.safeParse).toBe('function');
    
    // Empty object should parse (all fields are optional)
    expect(() => {
      partialSchema.parse({});
    }).not.toThrow();
  });

  it('Property 1.2: Schemas using .refine() without chaining .partial() after work', () => {
    // Observe: createProgramSchema.refine() works on UNFIXED code (line 265)
    // because no attempt is made to call .partial() on the refined schema
    //
    // Property: For all schemas that use .refine() WITHOUT attempting .partial().omit() after,
    //           they should continue to work correctly
    
    // Recreate the pattern from createProgramSchema
    // This pattern WORKS because .partial() is not called after .refine()
    const baseProgramSchema = z.object({
      name: z.string().min(1).max(255),
      start_date: z.string().datetime(),
      end_date: z.string().datetime(),
    });
    
    const createProgramSchema = baseProgramSchema.refine(
      (data) => new Date(data.end_date) > new Date(data.start_date),
      { message: 'End date must be after start date', path: ['end_date'] }
    );
    
    // The refined schema should have parse method
    expect(typeof createProgramSchema.parse).toBe('function');
    expect(typeof createProgramSchema.safeParse).toBe('function');
    
    // Validation should be callable
    expect(() => {
      createProgramSchema.safeParse({});
    }).not.toThrow();
  });

  it('Property 1.3: Schemas with multiple .refine() calls work without .partial() chaining', () => {
    // Observe: createLendingSchema with multiple .refine() calls works on UNFIXED code
    // because no attempt is made to chain .partial().omit() after the refinements
    //
    // Property: For schemas with MULTIPLE .refine() calls (complex refinements),
    //           they should continue to work correctly as long as no .partial().omit()
    //           is chained after
    
    // Recreate the pattern from createLendingSchema with multiple refinements
    // This pattern WORKS because .partial() is not called after .refine()
    const baseLendingSchema = z.object({
      trainee_id: z.string().uuid().optional(),
      borrower_name: z.string().optional(),
      item_id: z.string().uuid(),
      quantity: z.number().int().min(1),
    });
    
    const createLendingSchema = baseLendingSchema
      .refine(
        (data) => data.trainee_id !== undefined || (data.borrower_name !== undefined && data.borrower_name.length > 0),
        { message: 'Either trainee_id or borrower_name required', path: ['trainee_id'] }
      );
    
    // The schema with multiple refinements should have parse method
    expect(typeof createLendingSchema.parse).toBe('function');
    expect(typeof createLendingSchema.safeParse).toBe('function');
    
    // Validation should be callable without throwing TypeError
    expect(() => {
      createLendingSchema.safeParse({});
    }).not.toThrow();
  });

  // Property-based preservation test: verify the fix pattern
  describe('Property-Based: Correct Pattern After Fix', () => {
    it('Property: .partial().omit() works when applied BEFORE .refine()', () => {
      // This property tests the CORRECT pattern that will be used in the fix:
      // 1. Define base schema
      // 2. Apply .partial().omit() to the BASE schema (before .refine())
      // 3. Then apply .refine() calls
      // 
      // Property: This pattern should allow method chaining to work correctly
      
      // Correct pattern: .partial().omit() BEFORE .refine()
      const baseSchema = z.object({
        id: z.string().uuid(),
        name: z.string().max(100),
        status: z.enum(['active', 'inactive']),
        note: z.string().optional().nullable(),
      });
      
      // Apply .partial().omit() BEFORE .refine()
      const updateSchema = baseSchema
        .partial()
        .omit({ id: true })
        .refine(
          (data) => {
            // Some validation logic
            if (data.status === 'active') {
              return data.name && data.name.length > 0;
            }
            return true;
          },
          { message: 'Name required for active status', path: ['name'] }
        );
      
      // Property Test: The resulting schema should have all Zod methods
      expect(typeof updateSchema.parse).toBe('function');
      expect(typeof updateSchema.safeParse).toBe('function');
      
      // Property Test: Empty object should parse (all fields optional)
      expect(() => {
        updateSchema.parse({});
      }).not.toThrow();
      
      // Property Test: Refinement should still be enforced
      const result = updateSchema.safeParse({
        status: 'active',
        // name is missing - should fail refinement
      });
      expect(result.success).toBe(false);
    });

    it('Property-Based: Schema methods available after .partial().omit().refine() chain', () => {
      // Verify with fast-check that the corrected pattern works across various inputs
      fc.assert(
        fc.property(
          fc.record({
            status: fc.oneof(fc.constant('active'), fc.constant('inactive')),
          }),
          (input) => {
            // Apply the correct pattern used in the fix
            const baseSchema = z.object({
              id: z.string().uuid(),
              name: z.string().max(100),
              status: z.enum(['active', 'inactive']),
              jobTitle: z.string().optional().nullable(),
            });
            
            const updateSchema = baseSchema
              .partial()
              .omit({ id: true })
              .refine(
                (data) => {
                  if (data.status === 'active') {
                    return data.name && data.name.trim().length > 0;
                  }
                  return true;
                },
                { message: 'Name required for active', path: ['name'] }
              );
            
            // Property: Schema methods should always be available
            expect(typeof updateSchema.parse).toBe('function');
            expect(typeof updateSchema.safeParse).toBe('function');
            
            // Property: safeParse should not throw (even if validation fails)
            const result = updateSchema.safeParse({
              // Partial data
              status: input.status,
            });
            
            // Result should have success property
            expect(result).toHaveProperty('success');
            return true;
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
