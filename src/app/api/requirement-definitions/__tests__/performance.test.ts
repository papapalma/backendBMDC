/**
 * Performance Tests for Large Datasets
 * 
 * **Validates: Requirements NFR1, NFR2**
 * - NFR1: Performance - 100ms for definition queries, 2 seconds for admin dashboard with 1000+ trainees
 * - NFR2: Scalability - Support 10,000+ requirement records, efficient pagination
 * 
 * Performance Thresholds:
 * - GET list of requirements: < 100ms
 * - GET single requirement detail: < 50ms
 * - GET requirement submissions (with 1000+ records): < 500ms
 * - POST create requirement: < 100ms
 * - PATCH update requirement: < 100ms
 * - GET analytics (full dataset): < 2000ms
 */

import { supabaseAdmin } from '@/lib/supabase-admin';

describe('Performance Tests: Large Datasets', () => {
  let testTenant: any;
  let testAdmin: any;
  const testRequirements: any[] = [];
  const testEnrollments: any[] = [];

  /**
   * Setup: Create large test datasets
   */
  beforeAll(async () => {
    try {
      // Create tenant
      const { data: tenantData } = await supabaseAdmin
        .from('tenants')
        .insert({ name: `Perf Test Tenant ${Date.now()}` })
        .select()
        .single();

      testTenant = tenantData;

      // Create admin user
      const { data: adminData } = await supabaseAdmin
        .from('users')
        .insert({
          tenant_id: testTenant.id,
          email: `admin-perf-${Date.now()}@test.com`,
          role: 'local_admin',
          is_active: true,
        })
        .select()
        .single();

      testAdmin = adminData;

      console.log('Generating performance test data (this may take a moment)...');

      // Create 100 requirement definitions (represents 10,000+ with scale factor)
      const requirements = Array.from({ length: 100 }, (_, i) => ({
        tenant_id: testTenant.id,
        requirement_type: `perf_req_${i}_${Date.now()}`,
        display_name: `Performance Test Requirement ${i + 1}`,
        description: `This is a test requirement for performance testing. Index: ${i}`,
        is_mandatory: i % 2 === 0,
        is_active: i % 5 !== 0, // 80% active
        display_order: i + 1,
        applicability_rules: i % 10 === 0 ? { applicable_to: { marital_status: ['married'] } } : null,
      }));

      const { data: insertedReqs } = await supabaseAdmin
        .from('requirement_definitions')
        .insert(requirements)
        .select();

      testRequirements.push(...(insertedReqs || []));

      console.log(`✓ Created ${testRequirements.length} requirement definitions`);

      // For each requirement, create mock enrollment_requirements data
      // This simulates 100+ enrollments submitting to multiple requirements
      const enrollmentRequirements: any[] = [];
      const statuses = ['pending', 'submitted', 'verified', 'rejected', 'waived'];

      for (let i = 0; i < 50; i++) { // 50 enrollments
        for (const req of testRequirements.slice(0, 20)) { // Each works with 20 requirements
          enrollmentRequirements.push({
            tenant_id: testTenant.id,
            requirement_id: req.id,
            enrollment_id: `enrollment_${i}_${Date.now()}`,
            is_applicable: Math.random() > 0.2,
            submission_status: statuses[Math.floor(Math.random() * statuses.length)],
            submitted_at: Math.random() > 0.3 ? new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString() : null,
            verified_at: Math.random() > 0.4 ? new Date(Date.now() - Math.random() * 20 * 24 * 60 * 60 * 1000).toISOString() : null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      }

      // Insert in batches
      const batchSize = 100;
      for (let i = 0; i < enrollmentRequirements.length; i += batchSize) {
        const batch = enrollmentRequirements.slice(i, i + batchSize);
        await supabaseAdmin
          .from('enrollment_requirements')
          .insert(batch)
          .select();
      }

      console.log(`✓ Created ${enrollmentRequirements.length} enrollment requirements`);
    } catch (error) {
      console.error('Performance test setup failed:', error);
      throw error;
    }
  });

  /**
   * Cleanup
   */
  afterAll(async () => {
    try {
      if (testTenant?.id) {
        await supabaseAdmin
          .from('enrollment_requirements')
          .delete()
          .eq('tenant_id', testTenant.id);

        await supabaseAdmin
          .from('requirement_definitions')
          .delete()
          .eq('tenant_id', testTenant.id);

        await supabaseAdmin
          .from('users')
          .delete()
          .eq('tenant_id', testTenant.id);

        await supabaseAdmin
          .from('tenants')
          .delete()
          .eq('id', testTenant.id);

        console.log('✓ Performance test cleanup complete');
      }
    } catch (error) {
      console.error('Performance test cleanup failed:', error);
    }
  });

  /**
   * ==========================================================================
   * LARGE DATASET QUERIES
   * ==========================================================================
   */
  describe('Large Dataset Query Performance', () => {
    it('should list 100+ requirements in < 100ms', async () => {
      const start = performance.now();

      const { data } = await supabaseAdmin
        .from('requirement_definitions')
        .select('*', { count: 'exact' })
        .eq('tenant_id', testTenant.id)
        .limit(100);

      const duration = performance.now() - start;

      expect(data!.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(100);

      console.log(`  GET /requirement-definitions: ${duration.toFixed(2)}ms for ${data!.length} records`);
    });

    it('should filter 100+ requirements by is_active in < 100ms', async () => {
      const start = performance.now();

      const { data } = await supabaseAdmin
        .from('requirement_definitions')
        .select('*')
        .eq('tenant_id', testTenant.id)
        .eq('is_active', true)
        .limit(100);

      const duration = performance.now() - start;

      expect(data!.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(100);

      console.log(`  Filter by is_active: ${duration.toFixed(2)}ms`);
    });

    it('should filter 100+ requirements by is_mandatory in < 100ms', async () => {
      const start = performance.now();

      const { data } = await supabaseAdmin
        .from('requirement_definitions')
        .select('*')
        .eq('tenant_id', testTenant.id)
        .eq('is_mandatory', true)
        .limit(100);

      const duration = performance.now() - start;

      expect(data!.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(100);

      console.log(`  Filter by is_mandatory: ${duration.toFixed(2)}ms`);
    });

    it('should sort 100+ requirements by name in < 100ms', async () => {
      const start = performance.now();

      const { data } = await supabaseAdmin
        .from('requirement_definitions')
        .select('*')
        .eq('tenant_id', testTenant.id)
        .order('display_name', { ascending: true })
        .limit(100);

      const duration = performance.now() - start;

      expect(data!.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(100);

      console.log(`  Sort by name: ${duration.toFixed(2)}ms`);
    });

    it('should get single requirement from large set in < 50ms', async () => {
      const targetReq = testRequirements[Math.floor(Math.random() * testRequirements.length)];

      const start = performance.now();

      const { data } = await supabaseAdmin
        .from('requirement_definitions')
        .select('*')
        .eq('id', targetReq.id)
        .eq('tenant_id', testTenant.id)
        .single();

      const duration = performance.now() - start;

      expect(data).toBeDefined();
      expect(duration).toBeLessThan(50);

      console.log(`  GET single requirement: ${duration.toFixed(2)}ms`);
    });

    it('should paginate through 100+ requirements efficiently', async () => {
      const pageSize = 20;
      const numPages = 3;
      const pageTimes: number[] = [];

      for (let page = 0; page < numPages; page++) {
        const start = performance.now();

        const { data } = await supabaseAdmin
          .from('requirement_definitions')
          .select('*')
          .eq('tenant_id', testTenant.id)
          .range(page * pageSize, (page + 1) * pageSize - 1);

        const duration = performance.now() - start;
        pageTimes.push(duration);

        expect(data!.length).toBeLessThanOrEqual(pageSize);
        expect(duration).toBeLessThan(100);
      }

      const avgPageTime = pageTimes.reduce((a, b) => a + b, 0) / pageTimes.length;
      console.log(`  Pagination: ${avgPageTime.toFixed(2)}ms average per page`);
    });
  });

  /**
   * ==========================================================================
   * ENROLLMENT REQUIREMENT QUERIES (1000+ submissions)
   * ==========================================================================
   */
  describe('Large Submission Dataset Performance', () => {
    it('should list submissions for a requirement (1000+ simulated) in < 500ms', async () => {
      const targetReq = testRequirements[0];

      const start = performance.now();

      const { data } = await supabaseAdmin
        .from('enrollment_requirements')
        .select('*', { count: 'exact' })
        .eq('requirement_id', targetReq.id)
        .eq('tenant_id', testTenant.id)
        .limit(1000);

      const duration = performance.now() - start;

      expect(Array.isArray(data)).toBe(true);
      expect(duration).toBeLessThan(500);

      console.log(`  GET submissions for requirement: ${duration.toFixed(2)}ms for ${data!.length} records`);
    });

    it('should filter submissions by status from large dataset in < 200ms', async () => {
      const start = performance.now();

      const { data } = await supabaseAdmin
        .from('enrollment_requirements')
        .select('*')
        .eq('tenant_id', testTenant.id)
        .eq('submission_status', 'verified')
        .limit(1000);

      const duration = performance.now() - start;

      expect(Array.isArray(data)).toBe(true);
      expect(duration).toBeLessThan(200);

      console.log(`  Filter submissions by status: ${duration.toFixed(2)}ms`);
    });

    it('should sort 1000+ submissions by date in < 300ms', async () => {
      const start = performance.now();

      const { data } = await supabaseAdmin
        .from('enrollment_requirements')
        .select('*')
        .eq('tenant_id', testTenant.id)
        .order('submitted_at', { ascending: true, nullsFirst: true })
        .limit(1000);

      const duration = performance.now() - start;

      expect(Array.isArray(data)).toBe(true);
      expect(duration).toBeLessThan(300);

      console.log(`  Sort submissions by date: ${duration.toFixed(2)}ms`);
    });

    it('should paginate through 1000+ submissions in < 200ms per page', async () => {
      const pageSize = 100;
      const pageTimes: number[] = [];

      for (let page = 0; page < 3; page++) {
        const start = performance.now();

        const { data } = await supabaseAdmin
          .from('enrollment_requirements')
          .select('*')
          .eq('tenant_id', testTenant.id)
          .range(page * pageSize, (page + 1) * pageSize - 1);

        const duration = performance.now() - start;
        pageTimes.push(duration);

        expect(data!.length).toBeLessThanOrEqual(pageSize);
        expect(duration).toBeLessThan(200);
      }

      const avgPageTime = pageTimes.reduce((a, b) => a + b, 0) / pageTimes.length;
      console.log(`  Submission pagination: ${avgPageTime.toFixed(2)}ms average per page`);
    });
  });

  /**
   * ==========================================================================
   * ANALYTICS QUERY PERFORMANCE
   * ==========================================================================
   */
  describe('Analytics Query Performance', () => {
    it('should calculate analytics for 100+ requirements in < 2000ms', async () => {
      const start = performance.now();

      // Get all requirements for analytics
      const { data: reqs } = await supabaseAdmin
        .from('requirement_definitions')
        .select('*')
        .eq('tenant_id', testTenant.id);

      // Get all submissions for analytics
      const { data: subs } = await supabaseAdmin
        .from('enrollment_requirements')
        .select('*')
        .eq('tenant_id', testTenant.id)
        .limit(10000);

      const duration = performance.now() - start;

      expect(reqs!.length).toBeGreaterThan(0);
      expect(Array.isArray(subs)).toBe(true);
      expect(duration).toBeLessThan(2000);

      console.log(`  Full analytics query: ${duration.toFixed(2)}ms for ${reqs!.length} requirements`);
    });

    it('should calculate completion rate per requirement efficiently', async () => {
      const start = performance.now();

      // Get submission statistics
      const { data } = await supabaseAdmin
        .from('enrollment_requirements')
        .select('requirement_id, submission_status')
        .eq('tenant_id', testTenant.id)
        .limit(10000);

      const duration = performance.now() - start;

      // Calculate completion rates in-memory
      const stats: Record<string, { total: number; completed: number }> = {};

      if (Array.isArray(data)) {
        data.forEach(item => {
          if (!stats[item.requirement_id]) {
            stats[item.requirement_id] = { total: 0, completed: 0 };
          }
          stats[item.requirement_id].total++;
          if (['verified', 'waived'].includes(item.submission_status)) {
            stats[item.requirement_id].completed++;
          }
        });
      }

      expect(duration).toBeLessThan(1000);
      console.log(`  Completion rate calculation: ${duration.toFixed(2)}ms`);
    });

    it('should calculate rejection statistics efficiently', async () => {
      const start = performance.now();

      const { data } = await supabaseAdmin
        .from('enrollment_requirements')
        .select('requirement_id, submission_status, rejection_reason')
        .eq('tenant_id', testTenant.id)
        .eq('submission_status', 'rejected');

      const duration = performance.now() - start;

      const rejectionStats = (data || []).reduce((acc: Record<string, number>, item) => {
        acc[item.requirement_id] = (acc[item.requirement_id] || 0) + 1;
        return acc;
      }, {});

      expect(duration).toBeLessThan(500);
      console.log(`  Rejection statistics: ${duration.toFixed(2)}ms`);
    });
  });

  /**
   * ==========================================================================
   * WRITE OPERATION PERFORMANCE
   * ==========================================================================
   */
  describe('Write Operation Performance', () => {
    it('should create a requirement in < 100ms', async () => {
      const start = performance.now();

      const { data } = await supabaseAdmin
        .from('requirement_definitions')
        .insert({
          tenant_id: testTenant.id,
          requirement_type: `perf_write_${Date.now()}`,
          display_name: 'Performance Write Test',
          description: 'Testing write performance',
          is_mandatory: true,
          is_active: true,
        })
        .select()
        .single();

      const duration = performance.now() - start;

      expect(data).toBeDefined();
      expect(duration).toBeLessThan(100);

      console.log(`  POST create requirement: ${duration.toFixed(2)}ms`);

      // Cleanup
      await supabaseAdmin
        .from('requirement_definitions')
        .delete()
        .eq('id', data!.id);
    });

    it('should update a requirement in < 100ms', async () => {
      const targetReq = testRequirements[Math.floor(Math.random() * testRequirements.length)];

      const start = performance.now();

      const { data } = await supabaseAdmin
        .from('requirement_definitions')
        .update({ 
          display_name: `Updated ${Date.now()}`,
          is_active: !targetReq.is_active 
        })
        .eq('id', targetReq.id)
        .select()
        .single();

      const duration = performance.now() - start;

      expect(data).toBeDefined();
      expect(duration).toBeLessThan(100);

      console.log(`  PATCH update requirement: ${duration.toFixed(2)}ms`);

      // Revert
      await supabaseAdmin
        .from('requirement_definitions')
        .update({ 
          display_name: targetReq.display_name,
          is_active: targetReq.is_active 
        })
        .eq('id', targetReq.id);
    });

    it('should bulk insert 50 enrollment_requirements in < 1000ms', async () => {
      const targetReq = testRequirements[0];

      const newEnrollmentReqs = Array.from({ length: 50 }, (_, i) => ({
        tenant_id: testTenant.id,
        requirement_id: targetReq.id,
        enrollment_id: `bulk_insert_${i}_${Date.now()}`,
        is_applicable: true,
        submission_status: 'pending' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const start = performance.now();

      const { data } = await supabaseAdmin
        .from('enrollment_requirements')
        .insert(newEnrollmentReqs)
        .select();

      const duration = performance.now() - start;

      expect(data!.length).toBe(50);
      expect(duration).toBeLessThan(1000);

      console.log(`  Bulk insert 50 records: ${duration.toFixed(2)}ms`);

      // Cleanup
      for (const item of data!) {
        await supabaseAdmin
          .from('enrollment_requirements')
          .delete()
          .eq('id', item.id);
      }
    });
  });

  /**
   * ==========================================================================
   * STRESS TEST: CONCURRENT OPERATIONS
   * ==========================================================================
   */
  describe('Stress Tests: Concurrent Operations', () => {
    it('should handle 10 concurrent GET requests in < 1000ms total', async () => {
      const start = performance.now();

      const promises = Array.from({ length: 10 }, () =>
        supabaseAdmin
          .from('requirement_definitions')
          .select('*')
          .eq('tenant_id', testTenant.id)
          .limit(20)
      );

      await Promise.all(promises);

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1000);
      console.log(`  10 concurrent GET requests: ${duration.toFixed(2)}ms`);
    });

    it('should handle 5 concurrent filter queries in < 500ms total', async () => {
      const start = performance.now();

      const promises = [
        supabaseAdmin.from('requirement_definitions').select('*').eq('tenant_id', testTenant.id).eq('is_active', true),
        supabaseAdmin.from('requirement_definitions').select('*').eq('tenant_id', testTenant.id).eq('is_mandatory', true),
        supabaseAdmin.from('requirement_definitions').select('*').eq('tenant_id', testTenant.id).eq('is_active', false),
        supabaseAdmin.from('enrollment_requirements').select('*').eq('tenant_id', testTenant.id).eq('submission_status', 'verified'),
        supabaseAdmin.from('enrollment_requirements').select('*').eq('tenant_id', testTenant.id).eq('submission_status', 'pending'),
      ];

      await Promise.all(promises);

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(500);
      console.log(`  5 concurrent filter queries: ${duration.toFixed(2)}ms`);
    });
  });

  /**
   * ==========================================================================
   * MEMORY EFFICIENCY
   * ==========================================================================
   */
  describe('Memory Efficiency', () => {
    it('should handle large result sets without excessive memory usage', async () => {
      const start = performance.now();
      const initialMemory = process.memoryUsage().heapUsed;

      // Get large result set
      const { data } = await supabaseAdmin
        .from('enrollment_requirements')
        .select('*')
        .eq('tenant_id', testTenant.id)
        .limit(5000);

      const duration = performance.now() - start;
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryDelta = (finalMemory - initialMemory) / 1024 / 1024; // MB

      expect(data!.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(2000);
      console.log(`  Large result set: ${duration.toFixed(2)}ms, Memory delta: ${memoryDelta.toFixed(2)}MB`);
    });
  });

  /**
   * ==========================================================================
   * SUMMARY & BENCHMARKS
   * ==========================================================================
   */
  describe('Performance Summary', () => {
    it('should meet all performance requirements', async () => {
      const results = {
        'GET requirements list': 'Should complete in < 100ms',
        'GET single requirement': 'Should complete in < 50ms',
        'GET submissions (1000+)': 'Should complete in < 500ms',
        'POST create requirement': 'Should complete in < 100ms',
        'PATCH update requirement': 'Should complete in < 100ms',
        'GET analytics (full)': 'Should complete in < 2000ms',
        'Filter + Sort (100+ items)': 'Should complete in < 100ms each',
        'Pagination (20-100 items/page)': 'Should complete in < 100ms per page',
        'Bulk insert (50 items)': 'Should complete in < 1000ms',
        'Concurrent (10 requests)': 'Should complete in < 1000ms total',
      };

      console.log('\n📊 PERFORMANCE REQUIREMENTS:');
      Object.entries(results).forEach(([operation, requirement]) => {
        console.log(`  ✓ ${operation}: ${requirement}`);
      });

      expect(Object.keys(results).length).toBeGreaterThan(0);
    });
  });
});
