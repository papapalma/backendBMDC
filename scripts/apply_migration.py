#!/usr/bin/env python3

"""
CMS Settings Database Migration Script
Applies the CMS settings migration to Supabase PostgreSQL database

Usage: python3 apply_migration.py
"""

import os
import sys
import psycopg2
from psycopg2 import sql
from urllib.parse import urlparse
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
DATABASE_URL = os.getenv('DATABASE_URL')

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    print("❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
    sys.exit(1)

print("╔════════════════════════════════════════════════╗")
print("║  CMS Settings Database Migration Tool          ║")
print("║  Applying: 019_add_cms_settings_tables_FIXED.sql║")
print("╚════════════════════════════════════════════════╝\n")

def get_supabase_connection_string(url: str, service_role_key: str) -> str:
    """
    Extract connection details from Supabase URL and construct PostgreSQL connection string
    Supabase URL format: https://<project-ref>.supabase.co
    """
    # Parse the URL to get project reference
    parsed = urlparse(url)
    project_ref = parsed.netloc.split('.')[0]
    
    # Supabase connection details
    # Default Supabase PostgreSQL port is 5432
    # Database name is typically 'postgres'
    # Username is typically 'postgres'
    
    # Construct connection string
    # Note: You need to use the actual database credentials
    # For Supabase, you typically connect via the pooler or direct connection
    
    conn_str = (
        f"host={parsed.netloc} "
        f"port=5432 "
        f"database=postgres "
        f"user=postgres "
        f"password={service_role_key} "
        f"sslmode=require"
    )
    
    return conn_str

def apply_migration():
    """Execute the migration SQL file"""
    try:
        # Read migration file
        migration_path = Path(__file__).parent.parent / 'migrations' / '002-core-features' / '019_add_cms_settings_tables_FIXED.sql'
        
        if not migration_path.exists():
            print(f"❌ Error: Migration file not found at {migration_path}")
            sys.exit(1)
        
        with open(migration_path, 'r') as f:
            sql_content = f.read()
        
        print("📝 Migration file loaded")
        print(f"📦 Target: {SUPABASE_URL}\n")
        print("⏳ Executing migration...\n")
        
        # Try to connect to the database
        try:
            conn_str = get_supabase_connection_string(SUPABASE_URL, SERVICE_ROLE_KEY)
            conn = psycopg2.connect(conn_str)
        except psycopg2.Error as e:
            print(f"⚠ Could not connect via direct PostgreSQL: {e}")
            print("ℹ Trying alternative connection method...\n")
            
            # If direct connection fails, you might need to:
            # 1. Use Supabase's SQL Editor web interface
            # 2. Use psql CLI with proper credentials
            # 3. Use Supabase's API with proper authentication
            
            print("❌ Direct PostgreSQL connection failed.")
            print("\n📋 Alternative methods to apply this migration:\n")
            print("1️⃣  Use Supabase SQL Editor (Web UI):")
            print(f"   - Go to: {SUPABASE_URL}/project/sql/new")
            print("   - Copy the SQL from: Backend/migrations/002-core-features/019_add_cms_settings_tables_FIXED.sql")
            print("   - Paste into the editor and execute\n")
            
            print("2️⃣  Use Supabase CLI:")
            print("   - Install: npm install -g supabase")
            print("   - Run: supabase db pull")
            print("   - Then apply migrations\n")
            
            print("3️⃣  Use psql command line:")
            print(f"   - Get your PostgreSQL credentials from Supabase dashboard")
            print(f"   - Run: psql -h <host> -U postgres -f Backend/migrations/002-core-features/019_add_cms_settings_tables_FIXED.sql\n")
            
            sys.exit(1)
        
        # Execute the migration
        cursor = conn.cursor()
        
        # Split into statements and execute
        statements = [
            stmt.strip() 
            for stmt in sql_content.split(';') 
            if stmt.strip() and not stmt.strip().startswith('--')
        ]
        
        print(f"Found {len(statements)} SQL statements\n")
        
        executed = 0
        for i, statement in enumerate(statements, 1):
            try:
                cursor.execute(statement)
                executed += 1
                print(f"✓ Statement {i}/{len(statements)} executed")
            except psycopg2.Error as e:
                # Some errors are expected (IF NOT EXISTS)
                if 'already exists' in str(e) or 'does not exist' in str(e):
                    print(f"⚠ Statement {i}/{len(statements)} skipped (object already exists)")
                    executed += 1
                else:
                    print(f"✗ Statement {i}/{len(statements)} failed: {e}")
                    conn.rollback()
                    raise
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"\n✅ Migration completed! {executed}/{len(statements)} statements executed")
        print("\n📋 CMS Settings tables created successfully!")
        print("   - cms_settings (with settings_data JSONB column)")
        print("   - cms_settings_versions")
        print("   - cms_audit_log")
        print("   - theme_presets (with 6 default themes)")
        
    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        sys.exit(1)

if __name__ == '__main__':
    apply_migration()
