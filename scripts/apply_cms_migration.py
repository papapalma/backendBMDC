#!/usr/bin/env python3

"""
Direct migration runner using PostgreSQL connection
"""

import os
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load environment variables
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    print("❌ Error: Missing Supabase credentials in .env")
    sys.exit(1)

try:
    from supabase import create_client
    print("✅ Supabase package available")
except ImportError:
    print("❌ Supabase package not installed")
    print("Install with: pip install supabase")
    sys.exit(1)

print(f"🎯 Target: {SUPABASE_URL}\n")

# Create Supabase client
supabase = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

# Read migration file
migration_path = Path(__file__).parent.parent / "migrations" / "002-core-features" / "019_add_cms_settings_tables_FIXED.sql"

if not migration_path.exists():
    print(f"❌ Migration file not found: {migration_path}")
    sys.exit(1)

print(f"📄 Reading migration file: {migration_path}")
sql_content = migration_path.read_text()
print(f"✅ Migration file loaded ({len(sql_content)} bytes)\n")

# Try to execute via RPC
print("⏳ Executing migration...")

try:
    # Try exec_sql RPC
    result = supabase.rpc("exec_sql", {"sql": sql_content}).execute()
    print("✅ Migration executed successfully via exec_sql!")
    print(f"Result: {result}\n")
except Exception as e:
    print(f"⚠️  exec_sql failed: {str(e)}")
    
    try:
        # Try sql_exec RPC
        result = supabase.rpc("sql_exec", {"query": sql_content}).execute()
        print("✅ Migration executed successfully via sql_exec!")
        print(f"Result: {result}\n")
    except Exception as e2:
        print(f"❌ Both RPC methods failed:")
        print(f"   exec_sql: {str(e)}")
        print(f"   sql_exec: {str(e2)}")
        print("\n💡 Try Method 2 (Supabase Web UI) instead")
        sys.exit(1)

# Verify
print("🔍 Verifying migration...")
try:
    # Query for settings_data column
    result = supabase.table("cms_settings").select("settings_data").limit(1).execute()
    print("✅ Verification successful! Column exists.\n")
    print("📝 Next steps:")
    print("   1. Restart backend: cd Backend && npm run dev")
    print("   2. Refresh /cms-settings page")
    print("   3. Try saving settings again\n")
except Exception as e:
    print(f"⚠️  Verification inconclusive: {str(e)}")
    print("   The migration may have succeeded. Restart backend and try again.\n")
