/**
 * Migration: Fix and complete the rename of 'level' column to 'type_of_funding'
 * 
 * This handles the case where the previous migration partially applied.
 * It will:
 * - Ensure type_of_funding column exists and is properly configured
 * - Remove type_of_funding if it exists with wrong constraints
 * - Migrate data from level to type_of_funding (if level still exists)
 * - Drop the old level column
 * - Apply proper constraints (NOT NULL, max 255 chars)
 */

-- Step 1: Drop type_of_funding if it exists but isn't properly constrained
-- (This handles the case where a partial migration was applied)
DO $$
DECLARE
  col_not_null BOOLEAN;
  col_type TEXT;
BEGIN
  -- Check if type_of_funding exists and get its constraints
  SELECT is_nullable, data_type INTO col_not_null, col_type
  FROM information_schema.columns
  WHERE table_name = 'programs' AND column_name = 'type_of_funding';
  
  -- If it exists but is nullable or wrong type, drop it to rebuild
  IF col_not_null = true OR col_type != 'character varying' THEN
    ALTER TABLE programs DROP COLUMN IF EXISTS type_of_funding CASCADE;
  END IF;
END $$;

-- Step 2: Create or update type_of_funding column
DO $$
BEGIN
  -- Add type_of_funding if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'programs' AND column_name = 'type_of_funding'
  ) THEN
    ALTER TABLE programs
    ADD COLUMN type_of_funding VARCHAR(255);
    
    -- Migrate data from level if it exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'programs' AND column_name = 'level'
    ) THEN
      UPDATE programs SET type_of_funding = level WHERE level IS NOT NULL;
    END IF;
    
    -- Set default for remaining NULLs
    UPDATE programs SET type_of_funding = 'Not Specified' WHERE type_of_funding IS NULL;
    
    -- Apply NOT NULL constraint
    ALTER TABLE programs ALTER COLUMN type_of_funding SET NOT NULL;
  END IF;
END $$;

-- Step 3: Drop level column if it still exists
ALTER TABLE programs DROP COLUMN IF EXISTS level CASCADE;

-- Step 4: Add comment
COMMENT ON COLUMN programs.type_of_funding IS 'Type of funding for the program (e.g., Government, Private, NGO, Corporate). Required free-text field. Max 255 characters.';
