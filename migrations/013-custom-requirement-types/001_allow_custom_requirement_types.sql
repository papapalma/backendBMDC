-- Allow tenant admins to create requirement definitions beyond the original core seven.
-- Existing enum values are preserved as text values during the conversion.
ALTER TABLE public.requirement_definitions
  ALTER COLUMN requirement_type TYPE VARCHAR(255)
  USING requirement_type::text;

DROP TYPE IF EXISTS public.requirement_type_enum;