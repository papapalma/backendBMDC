import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

/**
 * TEMPORARY ENDPOINT FOR CMS SETTINGS MIGRATION
 * 
 * This endpoint applies the 019_add_cms_settings_tables_FIXED.sql migration
 * to add the missing settings_data JSONB column to the cms_settings table.
 * 
 * After successful migration, DELETE THIS FILE.
 * 
 * Usage: POST http://localhost:3003/api/admin/migrate-cms
 * With header: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */

export async function POST(request: NextRequest) {
  try {
    // Verify authorization - requires service role key
    const authHeader = request.headers.get('authorization');
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!authHeader || !serviceRole) {
      return NextResponse.json(
        { 
          error: 'Unauthorized',
          message: 'Missing Authorization header or SUPABASE_SERVICE_ROLE_KEY'
        },
        { status: 401 }
      );
    }

    // Extract token from "Bearer <token>"
    const token = authHeader.replace('Bearer ', '');
    
    if (token !== serviceRole) {
      return NextResponse.json(
        { 
          error: 'Forbidden',
          message: 'Invalid authorization token'
        },
        { status: 403 }
      );
    }

    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!SUPABASE_URL) {
      return NextResponse.json(
        { error: 'Missing NEXT_PUBLIC_SUPABASE_URL' },
        { status: 500 }
      );
    }

    console.log('🔐 CMS Migration Request Authorized');
    console.log(`📦 Target: ${SUPABASE_URL}\n`);

    const supabase = createClient(
      SUPABASE_URL,
      serviceRole,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Read the migration file
    const migrationPath = path.join(
      process.cwd(),
      'migrations/002-core-features/019_add_cms_settings_tables_FIXED.sql'
    );

    if (!fs.existsSync(migrationPath)) {
      return NextResponse.json(
        { 
          error: 'Migration file not found',
          path: migrationPath
        },
        { status: 404 }
      );
    }

    const sqlContent = fs.readFileSync(migrationPath, 'utf8');
    console.log(`📝 Migration file loaded: ${migrationPath}`);
    console.log(`📊 SQL Content size: ${sqlContent.length} bytes\n`);

    // Execute the migration via SQL RPC
    console.log('⏳ Executing migration...\n');

    let result: any;
    let error: any;
    let executionMethod = 'unknown';

    // Try primary RPC method (exec_sql)
    try {
      executionMethod = 'exec_sql';
      const response = await supabase.rpc('exec_sql', {
        sql: sqlContent,
      });
      result = response.data;
      error = response.error;
    } catch (e) {
      console.log('Primary method (exec_sql) not available, trying alternative...');
      
      // Try alternative RPC method (sql_exec)
      try {
        executionMethod = 'sql_exec';
        const response = await supabase.rpc('sql_exec', {
          query: sqlContent,
        });
        result = response.data;
        error = response.error;
      } catch (e2) {
        console.log('Alternative method (sql_exec) not available either.');
        
        // Try a third method: query_exec
        try {
          executionMethod = 'query_exec';
          const response = await supabase.rpc('query_exec', {
            sql_query: sqlContent,
          });
          result = response.data;
          error = response.error;
        } catch (e3) {
          executionMethod = 'none_available';
          error = new Error('No SQL execution RPC available on Supabase instance');
        }
      }
    }

    if (error || !result) {
      console.error(`❌ Execution failed via ${executionMethod}:`, error?.message || error);
      
      return NextResponse.json(
        { 
          error: 'Migration execution failed',
          method: executionMethod,
          details: error?.message || String(error),
          hint: 'RPC functions (exec_sql, sql_exec, query_exec) are not available on this Supabase instance. Please use the Supabase Web UI instead.'
        },
        { status: 500 }
      );
    }

    console.log(`✅ Migration executed successfully via ${executionMethod}!\n`);

    return NextResponse.json(
      { 
        success: true, 
        message: 'CMS settings migration applied successfully',
        method: executionMethod,
        details: {
          tablesCreated: [
            'cms_settings (with settings_data JSONB column)',
            'cms_settings_versions',
            'cms_audit_log',
            'theme_presets (with 6 default themes)'
          ],
          nextSteps: [
            'Restart your Backend server',
            'POST requests to /api/cms-settings will now work',
            'The admin panel can save customization settings',
            'DELETE this migration endpoint (Backend/src/app/api/admin/migrate-cms/route.ts)'
          ]
        }
      },
      { status: 200 }
    );

  } catch (error: any) {
    console.error('❌ Unexpected error during migration:', error);
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error?.message || String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check if migration is needed
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!authHeader || !serviceRole) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    if (token !== serviceRole) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        message: 'CMS Migration endpoint is ready',
        description: 'POST to this endpoint to apply the CMS settings migration',
        endpoint: '/api/admin/migrate-cms',
        method: 'POST',
        auth: 'Bearer <SUPABASE_SERVICE_ROLE_KEY>',
        status: 'ready'
      },
      { status: 200 }
    );

  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
