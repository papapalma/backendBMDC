#!/bin/bash

# CMS Settings Database Migration Script
# Provides multiple methods to apply the migration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MIGRATION_FILE="$PROJECT_DIR/migrations/002-core-features/019_add_cms_settings_tables_FIXED.sql"

echo "╔════════════════════════════════════════════════╗"
echo "║  CMS Settings Database Migration Tool          ║"
echo "║  Applying: 019_add_cms_settings_tables_FIXED.sql║"
echo "╚════════════════════════════════════════════════╝"
echo ""

# Check if migration file exists
if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}❌ Error: Migration file not found at:${NC}"
    echo "   $MIGRATION_FILE"
    exit 1
fi

echo -e "${GREEN}✓${NC} Migration file found"
echo ""

# Function to show menu
show_menu() {
    echo -e "${BLUE}Choose migration method:${NC}"
    echo ""
    echo "1) Supabase Web UI (Copy & Paste) - Recommended"
    echo "2) npm Script (Automated, if available)"
    echo "3) Supabase CLI (if installed)"
    echo "4) psql Command Line (if available)"
    echo "5) Show Migration SQL (for manual execution)"
    echo "6) Copy Migration to Clipboard (macOS)"
    echo "7) Exit"
    echo ""
    read -p "Select option (1-7): " choice
}

# Function to display migration SQL
show_sql() {
    echo -e "${BLUE}Migration SQL:${NC}"
    echo "════════════════════════════════════════════════"
    cat "$MIGRATION_FILE"
    echo "════════════════════════════════════════════════"
}

# Function to copy to clipboard (macOS)
copy_to_clipboard() {
    if command -v pbcopy &> /dev/null; then
        cat "$MIGRATION_FILE" | pbcopy
        echo -e "${GREEN}✓${NC} Migration SQL copied to clipboard!"
        echo "   You can now paste into Supabase SQL Editor"
    else
        echo -e "${YELLOW}⚠${NC} pbcopy not available (not on macOS)"
        echo "   Use option 5 to view SQL and copy manually"
    fi
}

# Function for Supabase Web UI method
method_supabase_ui() {
    echo -e "${YELLOW}Method 1: Supabase Web UI${NC}"
    echo ""
    echo "Steps:"
    echo "1. Go to: https://supabase.com/dashboard"
    echo "2. Select: Bongabong BMDC project"
    echo "3. Click: SQL Editor → New Query"
    echo "4. Copy the migration SQL (select option 5 or 6)"
    echo "5. Paste into the editor"
    echo "6. Click: RUN button"
    echo "7. Wait for success message"
    echo ""
    read -p "Open Supabase dashboard in browser? (y/n): " open_browser
    if [ "$open_browser" = "y" ] || [ "$open_browser" = "Y" ]; then
        if command -v open &> /dev/null; then
            open "https://supabase.com/dashboard"
        elif command -v xdg-open &> /dev/null; then
            xdg-open "https://supabase.com/dashboard"
        else
            echo "Please manually open: https://supabase.com/dashboard"
        fi
    fi
}

# Function for npm script method
method_npm_script() {
    echo -e "${YELLOW}Method 2: NPM Script${NC}"
    echo ""
    cd "$PROJECT_DIR"
    
    if npm run migrate:cms; then
        echo -e "${GREEN}✅ Migration completed successfully!${NC}"
    else
        echo -e "${RED}❌ Migration failed via npm script${NC}"
        echo "   Try Method 1 (Supabase Web UI) instead"
    fi
}

# Function for Supabase CLI method
method_supabase_cli() {
    echo -e "${YELLOW}Method 3: Supabase CLI${NC}"
    echo ""
    
    if ! command -v supabase &> /dev/null; then
        echo -e "${RED}❌ Supabase CLI not installed${NC}"
        echo "   Install with: npm install -g supabase"
        return 1
    fi
    
    echo -e "${GREEN}✓${NC} Supabase CLI found"
    echo ""
    
    cd "$PROJECT_DIR"
    
    echo "Running: supabase db push"
    supabase db push
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Migration completed successfully!${NC}"
    else
        echo -e "${RED}❌ Migration failed via Supabase CLI${NC}"
    fi
}

# Function for psql method
method_psql() {
    echo -e "${YELLOW}Method 4: psql Command Line${NC}"
    echo ""
    
    if ! command -v psql &> /dev/null; then
        echo -e "${RED}❌ psql not installed${NC}"
        echo "   Install PostgreSQL client first"
        return 1
    fi
    
    echo -e "${GREEN}✓${NC} psql found"
    echo ""
    
    read -p "Enter PostgreSQL host (e.g., uhhavzjgdsznlokozocr.supabase.co): " pg_host
    read -p "Enter PostgreSQL user (default: postgres): " pg_user
    pg_user=${pg_user:-postgres}
    read -s -p "Enter PostgreSQL password: " pg_password
    echo ""
    
    read -p "Enter PostgreSQL port (default: 5432): " pg_port
    pg_port=${pg_port:-5432}
    
    echo ""
    echo "Connecting to PostgreSQL..."
    
    PGPASSWORD="$pg_password" psql \
        -h "$pg_host" \
        -U "$pg_user" \
        -d postgres \
        -p "$pg_port" \
        -f "$MIGRATION_FILE"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Migration completed successfully!${NC}"
    else
        echo -e "${RED}❌ Migration failed via psql${NC}"
    fi
}

# Main menu loop
while true; do
    show_menu
    
    case $choice in
        1)
            method_supabase_ui
            ;;
        2)
            method_npm_script
            ;;
        3)
            method_supabase_cli
            ;;
        4)
            method_psql
            ;;
        5)
            show_sql
            ;;
        6)
            copy_to_clipboard
            ;;
        7)
            echo "Exiting..."
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid option${NC}"
            ;;
    esac
    
    echo ""
    read -p "Continue? (y/n): " continue_prompt
    if [ "$continue_prompt" != "y" ] && [ "$continue_prompt" != "Y" ]; then
        break
    fi
    echo ""
done

echo ""
echo -e "${GREEN}✓${NC} Migration process complete"
echo ""
echo "Next steps:"
echo "1. Verify migration in Supabase dashboard"
echo "2. Restart backend: cd Backend && npm run dev"
echo "3. Test API endpoints"
echo "4. Check admin panel for customization features"
