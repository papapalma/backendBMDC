/**
 * Unit Tests for CMSValidationService
 * Tests all validation functions for colors, typography, layout, components, and content
 *
 * Requirements: 1.3, 3.3, 4.2, 5.2, 6.1, 14.1, 14.2, 14.3
 */

import { CMSValidationService } from './cms-validation.service';

describe('CMSValidationService', () => {
  describe('Color Validation', () => {
    it('should accept valid hex colors', () => {
      const colors = {
        primary: '#3B82F6',
        secondary: '#10B981',
        accent: '#F59E0B',
        background: '#FFFFFF',
        text: '#1F2937',
        borders: '#E5E7EB',
      };

      const errors = CMSValidationService.validateColors(colors);
      expect(errors).toHaveLength(0);
    });

    it('should accept valid RGB colors', () => {
      const colors = {
        primary: 'rgb(59, 130, 246)',
        secondary: 'rgb(16, 185, 129)',
      };

      const errors = CMSValidationService.validateColors(colors);
      expect(errors).toHaveLength(0);
    });

    it('should accept valid HSL colors', () => {
      const colors = {
        primary: 'hsl(217, 91%, 60%)',
        secondary: 'hsl(160, 84%, 39%)',
      };

      const errors = CMSValidationService.validateColors(colors);
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid color formats', () => {
      const colors = {
        primary: 'invalid-color',
        secondary: '12345',
      };

      const errors = CMSValidationService.validateColors(colors);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('invalid format');
    });

    it('should reject invalid color keys', () => {
      const colors = {
        primary: '#3B82F6',
        invalidKey: '#10B981',
      };

      const errors = CMSValidationService.validateColors(colors);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Invalid color key');
    });

    it('should reject non-string color values', () => {
      const colors = {
        primary: 123 as any,
      };

      const errors = CMSValidationService.validateColors(colors);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('must be a string');
    });
  });

  describe('Typography Validation', () => {
    it('should accept valid typography settings', () => {
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

      const errors = CMSValidationService.validateTypography(typography);
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid font family', () => {
      const typography = {
        headings: {
          fontFamily: 'Invalid@Font#Name!',
        },
      };

      const errors = CMSValidationService.validateTypography(typography);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('invalid characters');
    });

    it('should reject empty font family', () => {
      const typography = {
        headings: {
          fontFamily: '',
        },
      };

      const errors = CMSValidationService.validateTypography(typography);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject invalid heading font sizes', () => {
      const typography = {
        headings: {
          fontFamily: 'Poppins',
          fontSize: { h1: 200, h2: 5, h3: 28 },
        },
      };

      const errors = CMSValidationService.validateTypography(typography);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('between 14-96px');
    });

    it('should reject invalid font weights', () => {
      const typography = {
        headings: {
          fontFamily: 'Poppins',
          fontWeight: 550, // Not a valid weight
        },
      };

      const errors = CMSValidationService.validateTypography(typography);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('100-900 in 100 increments');
    });

    it('should reject invalid line heights', () => {
      const typography = {
        body: {
          fontFamily: 'Inter',
          lineHeight: 10, // Too high
        },
      };

      const errors = CMSValidationService.validateTypography(typography);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('between 1-3');
    });
  });

  describe('Layout Validation', () => {
    it('should accept valid layout settings', () => {
      const layout = {
        containerWidth: '1200px',
        containerLayout: 'centered',
        padding: {
          heroSection: 40,
          contentAreas: 32,
          footer: 24,
        },
        margins: {
          sectionSpacing: 48,
          elementSpacing: 16,
        },
        gaps: {
          grid: 24,
          flex: 16,
        },
      };

      const errors = CMSValidationService.validateLayout(layout);
      expect(errors).toHaveLength(0);
    });

    it('should accept percentage and vw container widths', () => {
      const layout = {
        containerWidth: '100%',
      };

      let errors = CMSValidationService.validateLayout(layout);
      expect(errors).toHaveLength(0);

      layout.containerWidth = '100vw';
      errors = CMSValidationService.validateLayout(layout);
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid container layout', () => {
      const layout = {
        containerLayout: 'invalid-layout',
      };

      const errors = CMSValidationService.validateLayout(layout);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('full-width, centered, sidebar');
    });

    it('should reject invalid padding values', () => {
      const layout = {
        padding: {
          heroSection: -10, // Negative value
          contentAreas: 300, // Exceeds max
        },
      };

      const errors = CMSValidationService.validateLayout(layout);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject non-numeric spacing values', () => {
      const layout = {
        margins: {
          sectionSpacing: '48px' as any,
        },
      };

      const errors = CMSValidationService.validateLayout(layout);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('must be integer');
    });
  });

  describe('Component Validation', () => {
    it('should accept valid component settings', () => {
      const components = {
        navigation: {
          enabled: true,
          style: 'light',
        },
        hero: {
          enabled: true,
          height: '500px',
        },
        features: {
          enabled: true,
          columns: 3,
        },
      };

      const errors = CMSValidationService.validateComponents(components);
      expect(errors).toHaveLength(0);
    });

    it('should accept valid hero colors', () => {
      const components = {
        hero: {
          enabled: true,
          overlayColor: '#000000',
        },
      };

      const errors = CMSValidationService.validateComponents(components);
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid component enabled property', () => {
      const components = {
        navigation: {
          enabled: 'yes' as any,
        },
      };

      const errors = CMSValidationService.validateComponents(components);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('must be boolean');
    });

    it('should reject invalid feature columns', () => {
      const components = {
        features: {
          columns: 10,
        },
      };

      const errors = CMSValidationService.validateComponents(components);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('between 1-6');
    });

    it('should reject invalid overlay color', () => {
      const components = {
        hero: {
          overlayColor: 'invalid-color',
        },
      };

      const errors = CMSValidationService.validateComponents(components);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('Content Validation', () => {
    it('should accept valid content settings', () => {
      const content = {
        hero: {
          heading: 'Welcome',
          subheading: 'To our platform',
          ctaText: 'Get Started',
        },
        missionVision: {
          title: 'Our Mission',
          description: 'To empower businesses',
          vision: 'To be the leading platform',
        },
        contact: {
          email: 'contact@example.com',
          phone: '+1-555-0000',
        },
      };

      const errors = CMSValidationService.validateContent(content);
      expect(errors).toHaveLength(0);
    });

    it('should accept content arrays', () => {
      const content = {
        features: [
          { title: 'Feature 1', description: 'Description' },
          { title: 'Feature 2', description: 'Description' },
        ],
        testimonials: [
          { text: 'Great product!', author: 'John Doe' },
        ],
      };

      const errors = CMSValidationService.validateContent(content);
      expect(errors).toHaveLength(0);
    });

    it('should reject content fields exceeding max length', () => {
      const content = {
        hero: {
          heading: 'A'.repeat(2001),
        },
      };

      const errors = CMSValidationService.validateContent(content);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('2000 characters');
    });

    it('should reject invalid email in contact', () => {
      const content = {
        contact: {
          email: 'invalid-email',
        },
      };

      const errors = CMSValidationService.validateContent(content);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('valid email');
    });

    it('should reject invalid phone in contact', () => {
      const content = {
        contact: {
          phone: 'invalid-phone!@#$',
        },
      };

      const errors = CMSValidationService.validateContent(content);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('valid phone format');
    });

    it('should reject invalid social media URLs', () => {
      const content = {
        contact: {
          socialLinks: {
            twitter: 'not-a-url',
          },
        },
      };

      const errors = CMSValidationService.validateContent(content);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('valid URLs');
    });
  });

  describe('Full Settings Validation', () => {
    it('should validate complete settings object', () => {
      const settings = {
        colors: {
          primary: '#3B82F6',
          secondary: '#10B981',
          accent: '#F59E0B',
          background: '#FFFFFF',
          text: '#1F2937',
          borders: '#E5E7EB',
        },
        typography: {
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
        },
        layout: {
          containerWidth: '1200px',
          containerLayout: 'centered',
          padding: { heroSection: 40, contentAreas: 32, footer: 24 },
          margins: { sectionSpacing: 48, elementSpacing: 16 },
          gaps: { grid: 24, flex: 16 },
        },
        components: {
          navigation: { enabled: true },
          hero: { enabled: true },
          features: { enabled: true },
        },
        content: {
          hero: { heading: 'Welcome', ctaText: 'Get Started' },
        },
      };

      const errors = CMSValidationService.validateSettings(settings);
      expect(errors).toHaveLength(0);
    });

    it('should catch errors across multiple sections', () => {
      const settings = {
        colors: {
          primary: 'invalid',
        },
        typography: {
          headings: {
            fontWeight: 550,
          },
        },
        layout: {
          padding: {
            heroSection: 500,
          },
        },
      };

      const errors = CMSValidationService.validateSettings(settings);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });

    it('should reject non-object settings', () => {
      const errors = CMSValidationService.validateSettings('not an object' as any);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('must be a valid object');
    });
  });

  describe('Numeric Validation', () => {
    it('should validate numeric inputs', () => {
      const errors = CMSValidationService.validateNumeric('spacing', 32, 0, 200);
      expect(errors).toHaveLength(0);
    });

    it('should reject non-integers', () => {
      const errors = CMSValidationService.validateNumeric('spacing', 3.5, 0, 200);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject values below minimum', () => {
      const errors = CMSValidationService.validateNumeric('spacing', -5, 0, 200);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject values exceeding maximum', () => {
      const errors = CMSValidationService.validateNumeric('spacing', 250, 0, 200);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('String Validation', () => {
    it('should validate string inputs', () => {
      const errors = CMSValidationService.validateString('heading', 'Welcome', 1, 100);
      expect(errors).toHaveLength(0);
    });

    it('should reject non-strings', () => {
      const errors = CMSValidationService.validateString('heading', 123 as any);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject strings below minimum length', () => {
      const errors = CMSValidationService.validateString('heading', '', 1, 100);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject strings exceeding maximum length', () => {
      const errors = CMSValidationService.validateString('heading', 'A'.repeat(101), 1, 100);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
