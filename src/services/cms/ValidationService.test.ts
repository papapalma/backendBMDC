import { ValidationService, ValidationError } from './ValidationService';

/**
 * ValidationService Unit Tests
 * Validates Requirements: 1.3, 3.3, 4.2, 5.2, 6.1, 14.1, 14.2, 14.3
 *
 * Tests cover all validation methods:
 * - validateColors: hex, RGB, HSL format validation
 * - validateTypography: font family, size, weight, line height validation
 * - validateLayout: numeric validation for sizes, padding, margins, gaps
 * - validateComponents: structure and boolean validation
 * - validateContent: text length limits and format validation
 */

describe('ValidationService', () => {
  let service: ValidationService;

  beforeEach(() => {
    service = new ValidationService();
  });

  // ============================================================================
  // validateColors() Tests
  // ============================================================================

  describe('validateColors()', () => {
    it('should accept valid hex color formats (#RGB and #RRGGBB)', () => {
      // Arrange
      const colors = {
        primary: '#1F2937',
        secondary: '#F59E0B',
        accent: '#ABC',
        background: '#FFFFFF',
        text: '#000',
        borders: '#E5E7EB',
      };

      // Act
      const errors = service.validateColors(colors);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should accept valid RGB color formats', () => {
      // Arrange
      const colors = {
        primary: 'rgb(31, 41, 55)',
        secondary: 'rgb(245, 158, 11)',
        accent: 'rgb(59, 130, 246)',
        background: 'rgb(255, 255, 255)',
        text: 'rgb(0, 0, 0)',
        borders: 'rgb(229, 231, 235)',
      };

      // Act
      const errors = service.validateColors(colors);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should accept valid RGBA color formats', () => {
      // Arrange
      const colors = {
        primary: 'rgba(31, 41, 55, 1)',
        secondary: 'rgba(245, 158, 11, 0.8)',
        accent: 'rgba(59, 130, 246, 0.5)',
        background: 'rgba(255, 255, 255, 1)',
        text: 'rgba(0, 0, 0, 1)',
        borders: 'rgba(229, 231, 235, 0.2)',
      };

      // Act
      const errors = service.validateColors(colors);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should accept valid HSL color formats', () => {
      // Arrange
      const colors = {
        primary: 'hsl(213, 47%, 51%)',
        secondary: 'hsl(38, 92%, 50%)',
        accent: 'hsl(217, 91%, 60%)',
        background: 'hsl(0, 0%, 100%)',
        text: 'hsl(0, 0%, 0%)',
        borders: 'hsl(220, 13%, 91%)',
      };

      // Act
      const errors = service.validateColors(colors);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should accept valid HSLA color formats', () => {
      // Arrange
      const colors = {
        primary: 'hsla(213, 47%, 51%, 1)',
        secondary: 'hsla(38, 92%, 50%, 0.7)',
        accent: 'hsla(217, 91%, 60%, 0.5)',
        background: 'hsla(0, 0%, 100%, 1)',
        text: 'hsla(0, 0%, 0%, 1)',
        borders: 'hsla(220, 13%, 91%, 0.3)',
      };

      // Act
      const errors = service.validateColors(colors);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid hex color formats', () => {
      // Arrange
      const colors = {
        primary: '#GGG', // Invalid hex characters
        secondary: '#12', // Too short
        accent: '#1234567', // Too long
        background: '#FFFFFF',
        text: '#000',
        borders: '#E5E7EB',
      };

      // Act
      const errors = service.validateColors(colors);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'colors.primary')).toBe(true);
      expect(errors.some((e) => e.field === 'colors.secondary')).toBe(true);
      expect(errors.some((e) => e.field === 'colors.accent')).toBe(true);
    });

    it('should reject RGB colors with out-of-range values', () => {
      // Arrange
      const colors = {
        primary: 'rgb(256, 41, 55)', // R out of range (max 255)
        secondary: 'rgb(245, -1, 11)', // G out of range (min 0)
        accent: 'rgb(59, 130, 300)', // B out of range
        background: 'rgb(255, 255, 255)',
        text: 'rgb(0, 0, 0)',
        borders: 'rgb(229, 231, 235)',
      };

      // Act
      const errors = service.validateColors(colors);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'colors.primary')).toBe(true);
      expect(errors.some((e) => e.field === 'colors.secondary')).toBe(true);
      expect(errors.some((e) => e.field === 'colors.accent')).toBe(true);
    });

    it('should reject RGBA colors with invalid alpha values', () => {
      // Arrange
      const colors = {
        primary: 'rgba(31, 41, 55, 1.5)', // Alpha > 1
        secondary: 'rgba(245, 158, 11, -0.1)', // Alpha < 0
        accent: 'rgba(59, 130, 246, 0.5)',
        background: 'rgba(255, 255, 255, 1)',
        text: 'rgba(0, 0, 0, 1)',
        borders: 'rgba(229, 231, 235, 0.2)',
      };

      // Act
      const errors = service.validateColors(colors);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'colors.primary')).toBe(true);
      expect(errors.some((e) => e.field === 'colors.secondary')).toBe(true);
    });

    it('should reject HSL colors with out-of-range values', () => {
      // Arrange
      const colors = {
        primary: 'hsl(361, 47%, 51%)', // H out of range (max 360)
        secondary: 'hsl(38, 101%, 50%)', // S out of range (max 100%)
        accent: 'hsl(217, 91%, 101%)', // L out of range
        background: 'hsl(0, 0%, 100%)',
        text: 'hsl(0, 0%, 0%)',
        borders: 'hsl(220, 13%, 91%)',
      };

      // Act
      const errors = service.validateColors(colors);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'colors.primary')).toBe(true);
      expect(errors.some((e) => e.field === 'colors.secondary')).toBe(true);
      expect(errors.some((e) => e.field === 'colors.accent')).toBe(true);
    });

    it('should reject malformed color strings', () => {
      // Arrange
      const colors = {
        primary: 'not-a-color',
        secondary: '1F2937',
        accent: 'rgb(255 255 255)', // Missing commas
        background: 'hsl(0 0 0)', // Missing commas
        text: '#000',
        borders: '#E5E7EB',
      };

      // Act
      const errors = service.validateColors(colors);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'colors.primary')).toBe(true);
      expect(errors.some((e) => e.field === 'colors.secondary')).toBe(true);
    });

    it('should reject missing required colors', () => {
      // Arrange
      const colors = {
        primary: '#1F2937',
        secondary: '#F59E0B',
        // Missing: accent, background, text, borders
      };

      // Act
      const errors = service.validateColors(colors);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'colors.accent')).toBe(true);
      expect(errors.some((e) => e.field === 'colors.background')).toBe(true);
      expect(errors.some((e) => e.field === 'colors.text')).toBe(true);
      expect(errors.some((e) => e.field === 'colors.borders')).toBe(true);
    });

    it('should reject non-object colors input', () => {
      // Act
      const errorsNull = service.validateColors(null);
      const errorsString = service.validateColors('not an object');
      const errorsNumber = service.validateColors(123);

      // Assert
      expect(errorsNull.length).toBeGreaterThan(0);
      expect(errorsString.length).toBeGreaterThan(0);
      expect(errorsNumber.length).toBeGreaterThan(0);
      expect(errorsNull[0].field).toBe('colors');
      expect(errorsString[0].field).toBe('colors');
      expect(errorsNumber[0].field).toBe('colors');
    });

    it('should handle colors with whitespace in formats', () => {
      // Arrange
      const colors = {
        primary: '  #1F2937  ',
        secondary: '  rgb(245, 158, 11)  ',
        accent: '  hsl(217, 91%, 60%)  ',
        background: '#FFFFFF',
        text: '#000',
        borders: '#E5E7EB',
      };

      // Act
      const errors = service.validateColors(colors);

      // Assert
      expect(errors).toHaveLength(0);
    });
  });

  // ============================================================================
  // validateTypography() Tests
  // ============================================================================

  describe('validateTypography()', () => {
    it('should accept valid typography with all properties', () => {
      // Arrange
      const typography = {
        headings: {
          fontFamily: 'Poppins',
          fontSize: { h1: 48, h2: 36, h3: 28 },
          fontWeight: 700,
          lineHeight: 1.2,
        },
        body: {
          fontFamily: 'Inter',
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 1.5,
        },
      };

      // Act
      const errors = service.validateTypography(typography);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should accept various valid font weights', () => {
      // Arrange
      const typography = {
        headings: {
          fontFamily: 'Poppins',
          fontSize: { h1: 48, h2: 36, h3: 28 },
          fontWeight: 300,
          lineHeight: 1.2,
        },
        body: {
          fontFamily: 'Inter',
          fontSize: 16,
          fontWeight: 600,
          lineHeight: 1.5,
        },
      };

      // Act
      const errors = service.validateTypography(typography);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should accept various valid line heights', () => {
      // Arrange
      const typography = {
        headings: {
          fontFamily: 'Poppins',
          fontSize: { h1: 48, h2: 36, h3: 28 },
          fontWeight: 700,
          lineHeight: 1.8,
        },
        body: {
          fontFamily: 'Inter',
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 2.0,
        },
      };

      // Act
      const errors = service.validateTypography(typography);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid font family (non-string)', () => {
      // Arrange
      const typography = {
        headings: {
          fontFamily: 123, // Invalid: number
          fontSize: { h1: 48, h2: 36, h3: 28 },
          fontWeight: 700,
          lineHeight: 1.2,
        },
        body: {
          fontFamily: 'Inter',
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 1.5,
        },
      };

      // Act
      const errors = service.validateTypography(typography);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'typography.headings.fontFamily')).toBe(true);
    });

    it('should reject invalid font sizes (negative or non-numeric)', () => {
      // Arrange
      const typography = {
        headings: {
          fontFamily: 'Poppins',
          fontSize: { h1: -48, h2: 'large', h3: 0 }, // Invalid values
          fontWeight: 700,
          lineHeight: 1.2,
        },
        body: {
          fontFamily: 'Inter',
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 1.5,
        },
      };

      // Act
      const errors = service.validateTypography(typography);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'typography.headings.fontSize.h1')).toBe(true);
      expect(errors.some((e) => e.field === 'typography.headings.fontSize.h3')).toBe(true);
    });

    it('should reject invalid font weights (not between 100-900)', () => {
      // Arrange
      const typography = {
        headings: {
          fontFamily: 'Poppins',
          fontSize: { h1: 48, h2: 36, h3: 28 },
          fontWeight: 550, // Invalid: must be 100, 200, ..., 900
          lineHeight: 1.2,
        },
        body: {
          fontFamily: 'Inter',
          fontSize: 16,
          fontWeight: 150, // Invalid
          lineHeight: 1.5,
        },
      };

      // Act
      const errors = service.validateTypography(typography);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'typography.headings.fontWeight')).toBe(true);
      expect(errors.some((e) => e.field === 'typography.body.fontWeight')).toBe(true);
    });

    it('should reject invalid line heights (non-numeric or negative)', () => {
      // Arrange
      const typography = {
        headings: {
          fontFamily: 'Poppins',
          fontSize: { h1: 48, h2: 36, h3: 28 },
          fontWeight: 700,
          lineHeight: -1.2, // Invalid: negative
        },
        body: {
          fontFamily: 'Inter',
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 'normal', // Invalid: non-numeric
        },
      };

      // Act
      const errors = service.validateTypography(typography);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'typography.headings.lineHeight')).toBe(true);
      expect(errors.some((e) => e.field === 'typography.body.lineHeight')).toBe(true);
    });

    it('should reject non-object typography input', () => {
      // Act
      const errorsNull = service.validateTypography(null);
      const errorsString = service.validateTypography('not an object');
      const errorsNumber = service.validateTypography(123);

      // Assert
      expect(errorsNull.length).toBeGreaterThan(0);
      expect(errorsString.length).toBeGreaterThan(0);
      expect(errorsNumber.length).toBeGreaterThan(0);
    });

    it('should accept typography with partial properties', () => {
      // Arrange
      const typography = {
        headings: {
          fontFamily: 'Poppins',
          fontSize: { h1: 48 }, // Only h1
        },
        body: {
          fontSize: 16,
        },
      };

      // Act
      const errors = service.validateTypography(typography);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should reject non-object headings or body', () => {
      // Arrange
      const typography = {
        headings: 'not-an-object',
        body: { fontFamily: 'Inter' },
      };

      // Act
      const errors = service.validateTypography(typography);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'typography.headings')).toBe(true);
    });
  });

  // ============================================================================
  // validateLayout() Tests
  // ============================================================================

  describe('validateLayout()', () => {
    it('should accept valid layout with containerWidth in px', () => {
      // Arrange
      const layout = {
        containerWidth: '1200px',
        containerLayout: 'centered',
        padding: { heroSection: 40, contentAreas: 32 },
        margins: { sectionSpacing: 48, elementSpacing: 16 },
        gaps: { grid: 24, flex: 16 },
      };

      // Act
      const errors = service.validateLayout(layout);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should accept valid layout with containerWidth in percentage', () => {
      // Arrange
      const layout = {
        containerWidth: '100%',
        containerLayout: 'full-width',
        padding: { heroSection: 40 },
        margins: { sectionSpacing: 48 },
        gaps: { grid: 24 },
      };

      // Act
      const errors = service.validateLayout(layout);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should accept all valid containerLayout values', () => {
      // Arrange
      const layoutCentered = {
        containerWidth: '1200px',
        containerLayout: 'centered',
      };
      const layoutFullWidth = {
        containerWidth: '100%',
        containerLayout: 'full-width',
      };
      const layoutSidebar = {
        containerWidth: '1200px',
        containerLayout: 'sidebar',
      };

      // Act
      const errorsCentered = service.validateLayout(layoutCentered);
      const errorsFullWidth = service.validateLayout(layoutFullWidth);
      const errorsSidebar = service.validateLayout(layoutSidebar);

      // Assert
      expect(errorsCentered).toHaveLength(0);
      expect(errorsFullWidth).toHaveLength(0);
      expect(errorsSidebar).toHaveLength(0);
    });

    it('should accept non-negative padding, margins, and gaps', () => {
      // Arrange
      const layout = {
        containerWidth: '1200px',
        padding: { heroSection: 0, contentAreas: 100 },
        margins: { sectionSpacing: 0, elementSpacing: 50 },
        gaps: { grid: 0, flex: 25 },
      };

      // Act
      const errors = service.validateLayout(layout);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid containerWidth formats', () => {
      // Arrange
      const layout1 = { containerWidth: '-100px' }; // Negative
      const layout2 = { containerWidth: '120' }; // Missing unit
      const layout3 = { containerWidth: '120em' }; // Invalid unit
      const layout4 = { containerWidth: '150%' }; // Percentage > 100
      const layout5 = { containerWidth: 1200 }; // Non-string

      // Act
      const errors1 = service.validateLayout(layout1);
      const errors2 = service.validateLayout(layout2);
      const errors3 = service.validateLayout(layout3);
      const errors4 = service.validateLayout(layout4);
      const errors5 = service.validateLayout(layout5);

      // Assert
      expect(errors1.length).toBeGreaterThan(0);
      expect(errors2.length).toBeGreaterThan(0);
      expect(errors3.length).toBeGreaterThan(0);
      expect(errors4.length).toBeGreaterThan(0);
      expect(errors5.length).toBeGreaterThan(0);
    });

    it('should reject invalid containerLayout values', () => {
      // Arrange
      const layout = {
        containerWidth: '1200px',
        containerLayout: 'invalid-layout',
      };

      // Act
      const errors = service.validateLayout(layout);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'layout.containerLayout')).toBe(true);
    });

    it('should reject negative or non-numeric padding/margins/gaps', () => {
      // Arrange
      const layout = {
        containerWidth: '1200px',
        padding: { heroSection: -10, contentAreas: 'large' }, // Invalid
        margins: { sectionSpacing: -5 }, // Invalid
        gaps: { grid: NaN }, // Invalid
      };

      // Act
      const errors = service.validateLayout(layout);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'layout.padding.heroSection')).toBe(true);
      expect(errors.some((e) => e.field === 'layout.padding.contentAreas')).toBe(true);
      expect(errors.some((e) => e.field === 'layout.margins.sectionSpacing')).toBe(true);
    });

    it('should reject non-object layout input', () => {
      // Act
      const errorsNull = service.validateLayout(null);
      const errorsString = service.validateLayout('not an object');

      // Assert
      expect(errorsNull.length).toBeGreaterThan(0);
      expect(errorsString.length).toBeGreaterThan(0);
    });

    it('should accept layout with partial properties', () => {
      // Arrange
      const layout = {
        containerWidth: '1200px',
        padding: { heroSection: 40 },
      };

      // Act
      const errors = service.validateLayout(layout);

      // Assert
      expect(errors).toHaveLength(0);
    });
  });

  // ============================================================================
  // validateComponents() Tests
  // ============================================================================

  describe('validateComponents()', () => {
    it('should accept valid components with all properties', () => {
      // Arrange
      const components = {
        navigation: { enabled: true, style: 'light' },
        hero: { enabled: true, height: '500px', overlayColor: 'rgba(0,0,0,0.3)' },
        features: { enabled: true, layout: 'grid', columns: 3 },
        testimonials: { enabled: false, displayCount: 3 },
        ctaSection: { enabled: true },
        contact: { enabled: true, formFields: ['email', 'message'] },
        footer: { enabled: true, linkColumns: 4 },
      };

      // Act
      const errors = service.validateComponents(components);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should accept components with only enabled property', () => {
      // Arrange
      const components = {
        navigation: { enabled: true },
        hero: { enabled: false },
        features: { enabled: true },
      };

      // Act
      const errors = service.validateComponents(components);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should reject non-boolean enabled property', () => {
      // Arrange
      const components = {
        navigation: { enabled: 'yes' }, // Invalid: string
        hero: { enabled: 1 }, // Invalid: number
        features: { enabled: true },
      };

      // Act
      const errors = service.validateComponents(components);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'components.navigation.enabled')).toBe(true);
      expect(errors.some((e) => e.field === 'components.hero.enabled')).toBe(true);
    });

    it('should validate hero height format', () => {
      // Arrange
      const validComponents = {
        hero: { enabled: true, height: '400px' },
        features: { enabled: true },
      };
      const invalidComponents = {
        hero: { enabled: true, height: '400' }, // Missing unit
        features: { enabled: true },
      };

      // Act
      const validErrors = service.validateComponents(validComponents);
      const invalidErrors = service.validateComponents(invalidComponents);

      // Assert
      expect(validErrors).toHaveLength(0);
      expect(invalidErrors.length).toBeGreaterThan(0);
    });

    it('should validate hero overlayColor format', () => {
      // Arrange
      const components = {
        hero: { enabled: true, overlayColor: 'not-a-color' },
        features: { enabled: true },
      };

      // Act
      const errors = service.validateComponents(components);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'components.hero.overlayColor')).toBe(true);
    });

    it('should validate features columns as positive number', () => {
      // Arrange
      const validComponents = {
        features: { enabled: true, columns: 4 },
        hero: { enabled: true },
      };
      const invalidComponents = {
        features: { enabled: true, columns: -1 },
        hero: { enabled: true },
      };

      // Act
      const validErrors = service.validateComponents(validComponents);
      const invalidErrors = service.validateComponents(invalidComponents);

      // Assert
      expect(validErrors).toHaveLength(0);
      expect(invalidErrors.length).toBeGreaterThan(0);
    });

    it('should validate testimonials displayCount as positive number', () => {
      // Arrange
      const validComponents = {
        testimonials: { enabled: true, displayCount: 5 },
        hero: { enabled: true },
      };
      const invalidComponents = {
        testimonials: { enabled: true, displayCount: 0 },
        hero: { enabled: true },
      };

      // Act
      const validErrors = service.validateComponents(validComponents);
      const invalidErrors = service.validateComponents(invalidComponents);

      // Assert
      expect(validErrors).toHaveLength(0);
      expect(invalidErrors.length).toBeGreaterThan(0);
    });

    it('should validate contact formFields as array of valid field names', () => {
      // Arrange
      const validComponents = {
        contact: { enabled: true, formFields: ['email', 'phone', 'message'] },
        hero: { enabled: true },
      };
      const invalidComponents1 = {
        contact: { enabled: true, formFields: 'email' }, // Not array
        hero: { enabled: true },
      };
      const invalidComponents2 = {
        contact: { enabled: true, formFields: ['email', 'invalid-field'] },
        hero: { enabled: true },
      };

      // Act
      const validErrors = service.validateComponents(validComponents);
      const invalidErrors1 = service.validateComponents(invalidComponents1);
      const invalidErrors2 = service.validateComponents(invalidComponents2);

      // Assert
      expect(validErrors).toHaveLength(0);
      expect(invalidErrors1.length).toBeGreaterThan(0);
      expect(invalidErrors2.length).toBeGreaterThan(0);
    });

    it('should validate footer linkColumns as positive number', () => {
      // Arrange
      const validComponents = {
        footer: { enabled: true, linkColumns: 4 },
        hero: { enabled: true },
      };
      const invalidComponents = {
        footer: { enabled: true, linkColumns: -2 },
        hero: { enabled: true },
      };

      // Act
      const validErrors = service.validateComponents(validComponents);
      const invalidErrors = service.validateComponents(invalidComponents);

      // Assert
      expect(validErrors).toHaveLength(0);
      expect(invalidErrors.length).toBeGreaterThan(0);
    });

    it('should reject non-object components input', () => {
      // Act
      const errorsNull = service.validateComponents(null);
      const errorsString = service.validateComponents('not an object');

      // Assert
      expect(errorsNull.length).toBeGreaterThan(0);
      expect(errorsString.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // validateContent() Tests
  // ============================================================================

  describe('validateContent()', () => {
    it('should accept valid content with all sections', () => {
      // Arrange
      const content = {
        hero: {
          heading: 'Welcome to Our Platform',
          subheading: 'Build amazing things with our tools',
          ctaText: 'Get Started',
        },
        missionVision: {
          title: 'Our Mission',
          description: 'To empower businesses worldwide',
          vision: 'To be the leading platform',
        },
        features: [
          { title: 'Feature 1', description: 'Description of feature 1' },
          { title: 'Feature 2', description: 'Description of feature 2' },
        ],
        testimonials: [
          { text: 'Great product!', author: 'John Doe' },
          { text: 'Highly recommended', author: 'Jane Smith' },
        ],
        contact: {
          email: 'contact@example.com',
          phone: '+1-555-000-0000',
          address: '123 Main Street, City, State 12345',
          socialLinks: {
            twitter: 'https://twitter.com/example',
            linkedin: 'https://linkedin.com/company/example',
          },
        },
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should reject hero section strings that exceed character limits', () => {
      // Arrange
      const content = {
        hero: {
          heading: 'x'.repeat(121), // Exceeds 120 char limit
          subheading: 'y'.repeat(201), // Exceeds 200 char limit
          ctaText: 'z'.repeat(51), // Exceeds 50 char limit
        },
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'content.hero.heading')).toBe(true);
      expect(errors.some((e) => e.field === 'content.hero.subheading')).toBe(true);
      expect(errors.some((e) => e.field === 'content.hero.ctaText')).toBe(true);
    });

    it('should reject non-string hero section fields', () => {
      // Arrange
      const content = {
        hero: {
          heading: 123,
          subheading: ['array'],
          ctaText: { obj: 'ect' },
        },
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'content.hero.heading')).toBe(true);
    });

    it('should reject missionVision strings that exceed character limits', () => {
      // Arrange
      const content = {
        missionVision: {
          title: 'x'.repeat(101), // Exceeds 100 char limit
          description: 'y'.repeat(501), // Exceeds 500 char limit
          vision: 'z'.repeat(501), // Exceeds 500 char limit
        },
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'content.missionVision.title')).toBe(true);
      expect(errors.some((e) => e.field === 'content.missionVision.description')).toBe(true);
      expect(errors.some((e) => e.field === 'content.missionVision.vision')).toBe(true);
    });

    it('should reject invalid features array', () => {
      // Arrange
      const content = {
        features: 'not-an-array', // Should be array
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'content.features')).toBe(true);
    });

    it('should validate feature titles and descriptions', () => {
      // Arrange
      const content = {
        features: [
          { title: 'x'.repeat(101), description: 'Valid' }, // Title too long
          { title: 'Valid', description: 'y'.repeat(301) }, // Description too long
        ],
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'content.features[0].title')).toBe(true);
      expect(errors.some((e) => e.field === 'content.features[1].description')).toBe(true);
    });

    it('should reject invalid testimonials array', () => {
      // Arrange
      const content = {
        testimonials: 'not-an-array',
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'content.testimonials')).toBe(true);
    });

    it('should validate testimonial text and author', () => {
      // Arrange
      const content = {
        testimonials: [
          { text: 'x'.repeat(501), author: 'Valid' }, // Text too long
          { text: 'Valid', author: 'y'.repeat(101) }, // Author too long
        ],
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'content.testimonials[0].text')).toBe(true);
      expect(errors.some((e) => e.field === 'content.testimonials[1].author')).toBe(true);
    });

    it('should reject invalid email format', () => {
      // Arrange
      const content = {
        contact: {
          email: 'invalid-email',
          phone: '+1-555-000-0000',
        },
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'content.contact.email')).toBe(true);
    });

    it('should accept valid email formats', () => {
      // Arrange
      const content = {
        contact: {
          email: 'contact@example.com',
          phone: '+1-555-000-0000',
        },
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid phone format', () => {
      // Arrange
      const content = {
        contact: {
          email: 'contact@example.com',
          phone: 'not-a-phone',
        },
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'content.contact.phone')).toBe(true);
    });

    it('should accept various valid phone formats', () => {
      // Arrange
      const content1 = { contact: { phone: '+1-555-000-0000' } };
      const content2 = { contact: { phone: '555-000-0000' } };
      const content3 = { contact: { phone: '+1 555 000 0000' } };

      // Act
      const errors1 = service.validateContent(content1);
      const errors2 = service.validateContent(content2);
      const errors3 = service.validateContent(content3);

      // Assert
      expect(errors1).toHaveLength(0);
      expect(errors2).toHaveLength(0);
      expect(errors3).toHaveLength(0);
    });

    it('should reject contact address exceeding character limit', () => {
      // Arrange
      const content = {
        contact: {
          address: 'x'.repeat(201), // Exceeds 200 char limit
        },
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'content.contact.address')).toBe(true);
    });

    it('should reject invalid social media URLs', () => {
      // Arrange
      const content = {
        contact: {
          socialLinks: {
            twitter: 'not-a-url',
            linkedin: 'https://linkedin.com/company/example',
          },
        },
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'content.contact.socialLinks.twitter')).toBe(true);
    });

    it('should accept valid social media URLs', () => {
      // Arrange
      const content = {
        contact: {
          socialLinks: {
            twitter: 'https://twitter.com/example',
            linkedin: 'https://linkedin.com/company/example',
          },
        },
      };

      // Act
      const errors = service.validateContent(content);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it('should reject non-object content input', () => {
      // Act
      const errorsNull = service.validateContent(null);
      const errorsString = service.validateContent('not an object');

      // Assert
      expect(errorsNull.length).toBeGreaterThan(0);
      expect(errorsString.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Property-Based Tests
  // ============================================================================

  describe('Property-Based Tests', () => {
    /**
     * **Validates: Requirements 1.3, 14.1, 14.2, 14.3**
     *
     * Property 3: Input Validation Consistency
     * - Valid inputs are accepted (no errors returned)
     * - Invalid inputs are rejected (errors returned)
     * - Error messages are descriptive and include field paths
     */
    it('should consistently validate valid and invalid inputs (Property: Validation Consistency)', () => {
      // Valid color format should always pass
      const validColors = {
        primary: '#1F2937',
        secondary: '#F59E0B',
        accent: '#ABC',
        background: '#FFFFFF',
        text: '#000',
        borders: '#E5E7EB',
      };

      const validColorsErrors1 = service.validateColors(validColors);
      const validColorsErrors2 = service.validateColors(validColors);

      expect(validColorsErrors1).toHaveLength(0);
      expect(validColorsErrors2).toHaveLength(0);

      // Invalid color format should always fail
      const invalidColors = {
        primary: 'not-a-color',
        secondary: 'rgb(256, 0, 0)', // Out of range
        accent: '#12', // Too short
        background: '#FFFFFF',
        text: '#000',
        borders: '#E5E7EB',
      };

      const invalidColorsErrors1 = service.validateColors(invalidColors);
      const invalidColorsErrors2 = service.validateColors(invalidColors);

      expect(invalidColorsErrors1.length).toBeGreaterThan(0);
      expect(invalidColorsErrors2.length).toBeGreaterThan(0);
      expect(invalidColorsErrors1.length).toBe(invalidColorsErrors2.length);
    });

    /**
     * **Validates: Requirements 3.3, 4.2, 14.1, 14.2**
     *
     * Property: Field Path Accuracy
     * All validation errors include accurate field paths that help identify the invalid field
     */
    it('should provide accurate field paths in error messages (Property: Error Field Path Accuracy)', () => {
      // Invalid typography
      const typography = {
        headings: {
          fontFamily: 'Valid',
          fontSize: { h1: -10 }, // Invalid
          fontWeight: 999, // Invalid
        },
        body: {
          fontFamily: 123, // Invalid
          fontSize: 'large', // Invalid
        },
      };

      const errors = service.validateTypography(typography);

      // Assert all errors have proper field paths
      expect(errors.some((e) => e.field === 'typography.headings.fontSize.h1')).toBe(true);
      expect(errors.some((e) => e.field === 'typography.headings.fontWeight')).toBe(true);
      expect(errors.some((e) => e.field === 'typography.body.fontFamily')).toBe(true);
      expect(errors.some((e) => e.field === 'typography.body.fontSize')).toBe(true);

      // All errors should have messages
      errors.forEach((error) => {
        expect(error.message).toBeDefined();
        expect(error.message.length).toBeGreaterThan(0);
      });
    });

    /**
     * **Validates: Requirements 5.2, 6.1**
     *
     * Property: Component and Content Validation Coverage
     * - All component types are validated
     * - All content sections are validated
     * - Missing or invalid data is caught
     */
    it('should comprehensively validate components and content (Property: Validation Coverage)', () => {
      // Test with incomplete/invalid data
      const incompleteComponents = {
        navigation: { enabled: 'invalid' }, // Should error
        hero: { height: 'invalid-format' }, // Should error
        features: { columns: -1 }, // Should error
        testimonials: { displayCount: 0 }, // Should error
        contact: { formFields: [123] }, // Should error
      };

      const componentErrors = service.validateComponents(incompleteComponents);

      // Should catch all violations
      expect(componentErrors.length).toBeGreaterThan(0);
      expect(componentErrors.some((e) => e.field === 'components.navigation.enabled')).toBe(true);
      expect(componentErrors.some((e) => e.field === 'components.hero.height')).toBe(true);
      expect(componentErrors.some((e) => e.field === 'components.features.columns')).toBe(true);
      expect(componentErrors.some((e) => e.field === 'components.testimonials.displayCount')).toBe(true);
      expect(componentErrors.some((e) => e.field.includes('contact.formFields'))).toBe(true);
    });
  });
});

