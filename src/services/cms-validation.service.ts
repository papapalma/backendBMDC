/**
 * CMS Validation Service
 * Handles validation of all CMS customization inputs
 *
 * Requirements: 1.3, 3.3, 4.2, 5.2, 6.1, 14.1, 14.2, 14.3
 */

import { ValidationError } from '@/lib/cms-errors';

export interface CMSSettings {
  colors?: Record<string, string>;
  typography?: {
    headings?: {
      fontFamily?: string;
      fontSize?: Record<string, number>;
      fontWeight?: number;
      lineHeight?: number;
    };
    body?: {
      fontFamily?: string;
      fontSize?: number;
      fontWeight?: number;
      lineHeight?: number;
    };
  };
  layout?: {
    containerWidth?: string;
    containerLayout?: string;
    padding?: Record<string, number>;
    margins?: Record<string, number>;
    gaps?: Record<string, number>;
  };
  components?: Record<string, any>;
  content?: Record<string, any>;
}

export class CMSValidationService {
  private static readonly COLOR_HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;
  private static readonly COLOR_RGB_REGEX = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;
  private static readonly COLOR_HSL_REGEX = /^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/;
  private static readonly FONT_FAMILY_REGEX = /^[a-zA-Z0-9\s,'-]+$/;
  private static readonly CONTAINER_WIDTH_REGEX = /^(\d+px|%|\d+rem|100vw)$/;
  private static readonly CSS_UNIT_REGEX = /^(\d+)(px|rem|em|%|vh|vw)$/;

  /**
   * Validate entire CMS settings object
   */
  static validateSettings(settings: any, tenantId?: string): string[] {
    const errors: string[] = [];

    if (!settings || typeof settings !== 'object') {
      errors.push('Settings must be a valid object');
      return errors;
    }

    if (settings.colors) {
      errors.push(...this.validateColors(settings.colors));
    }

    if (settings.typography) {
      errors.push(...this.validateTypography(settings.typography));
    }

    if (settings.layout) {
      errors.push(...this.validateLayout(settings.layout));
    }

    if (settings.components) {
      errors.push(...this.validateComponents(settings.components));
    }

    if (settings.content) {
      errors.push(...this.validateContent(settings.content));
    }

    return errors;
  }

  /**
   * Validate color customization (Requirement 1.3)
   * Accepts hex, RGB, and HSL formats
   */
  static validateColors(colors: any): string[] {
    const errors: string[] = [];

    if (!colors || typeof colors !== 'object') {
      errors.push('Colors must be a valid object');
      return errors;
    }

    const validColorKeys = ['primary', 'secondary', 'accent', 'background', 'text', 'borders'];

    for (const [key, value] of Object.entries(colors)) {
      if (!validColorKeys.includes(key)) {
        errors.push(`Invalid color key: ${key}`);
        continue;
      }

      if (typeof value !== 'string') {
        errors.push(`Color ${key} must be a string`);
        continue;
      }

      if (!this.isValidColor(value)) {
        errors.push(
          `Color ${key} has invalid format. Must be hex (#RRGGBB), RGB, or HSL format`
        );
      }
    }

    return errors;
  }

  /**
   * Validate typography customization (Requirement 3.3, 3.4, 3.5)
   */
  static validateTypography(typography: any): string[] {
    const errors: string[] = [];

    if (!typography || typeof typography !== 'object') {
      errors.push('Typography must be a valid object');
      return errors;
    }

    // Validate headings
    if (typography.headings) {
      errors.push(...this.validateTypographySection('headings', typography.headings));
    }

    // Validate body
    if (typography.body) {
      errors.push(...this.validateTypographySection('body', typography.body));
    }

    return errors;
  }

  /**
   * Validate individual typography section
   */
  private static validateTypographySection(section: string, data: any): string[] {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
      errors.push(`Typography ${section} must be a valid object`);
      return errors;
    }

    // Validate font family
    if (data.fontFamily !== undefined) {
      if (typeof data.fontFamily !== 'string') {
        errors.push(`Typography ${section} fontFamily must be a string`);
      } else if (!this.FONT_FAMILY_REGEX.test(data.fontFamily) || data.fontFamily.trim() === '') {
        errors.push(
          `Typography ${section} fontFamily contains invalid characters or is empty`
        );
      }
    }

    // Validate font sizes
    if (data.fontSize !== undefined) {
      if (section === 'headings' && typeof data.fontSize === 'object') {
        // For headings, validate h1, h2, h3
        for (const [heading, size] of Object.entries(data.fontSize)) {
          if (heading.match(/^h[1-3]$/)) {
            if (!Number.isInteger(size) || (size as number) < 14 || (size as number) > 96) {
              errors.push(
                `Typography headings fontSize.${heading} must be integer between 14-96px`
              );
            }
          } else {
            errors.push(`Invalid heading level: ${heading}`);
          }
        }
      } else if (section === 'body' && typeof data.fontSize === 'number') {
        // For body, single size value
        if (!Number.isInteger(data.fontSize) || data.fontSize < 10 || data.fontSize > 24) {
          errors.push(
            `Typography body fontSize must be integer between 10-24px`
          );
        }
      } else {
        errors.push(
          `Typography ${section} fontSize format is invalid`
        );
      }
    }

    // Validate font weight
    if (data.fontWeight !== undefined) {
      if (!Number.isInteger(data.fontWeight) || data.fontWeight < 100 || data.fontWeight > 900 || data.fontWeight % 100 !== 0) {
        errors.push(
          `Typography ${section} fontWeight must be 100-900 in 100 increments`
        );
      }
    }

    // Validate line height
    if (data.lineHeight !== undefined) {
      if (typeof data.lineHeight !== 'number' || data.lineHeight < 1 || data.lineHeight > 3) {
        errors.push(
          `Typography ${section} lineHeight must be number between 1-3`
        );
      }
    }

    return errors;
  }

  /**
   * Validate layout and spacing (Requirement 4.2, 4.3, 4.4, 4.5)
   */
  static validateLayout(layout: any): string[] {
    const errors: string[] = [];

    if (!layout || typeof layout !== 'object') {
      errors.push('Layout must be a valid object');
      return errors;
    }

    // Validate container width
    if (layout.containerWidth !== undefined) {
      if (typeof layout.containerWidth !== 'string') {
        errors.push('Layout containerWidth must be a string');
      } else if (!this.CONTAINER_WIDTH_REGEX.test(layout.containerWidth)) {
        errors.push(
          'Layout containerWidth must be valid CSS size (e.g., 1200px, 100%, 100vw)'
        );
      }
    }

    // Validate container layout
    if (layout.containerLayout !== undefined) {
      const validLayouts = ['full-width', 'centered', 'sidebar'];
      if (!validLayouts.includes(layout.containerLayout)) {
        errors.push(
          `Layout containerLayout must be one of: ${validLayouts.join(', ')}`
        );
      }
    }

    // Validate padding
    if (layout.padding) {
      errors.push(...this.validateNumericObject('layout.padding', layout.padding, 0, 200));
    }

    // Validate margins
    if (layout.margins) {
      errors.push(...this.validateNumericObject('layout.margins', layout.margins, 0, 300));
    }

    // Validate gaps
    if (layout.gaps) {
      errors.push(...this.validateNumericObject('layout.gaps', layout.gaps, 0, 200));
    }

    return errors;
  }

  /**
   * Validate numeric object values (padding, margins, gaps)
   */
  private static validateNumericObject(
    path: string,
    obj: any,
    min: number,
    max: number
  ): string[] {
    const errors: string[] = [];

    if (!obj || typeof obj !== 'object') {
      errors.push(`${path} must be a valid object`);
      return errors;
    }

    for (const [key, value] of Object.entries(obj)) {
      if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
        errors.push(
          `${path}.${key} must be integer between ${min}-${max}`
        );
      }
    }

    return errors;
  }

  /**
   * Validate component settings (Requirement 5.2, 5.3, 5.4)
   */
  static validateComponents(components: any): string[] {
    const errors: string[] = [];

    if (!components || typeof components !== 'object') {
      errors.push('Components must be a valid object');
      return errors;
    }

    const validComponents = [
      'navigation', 'hero', 'features', 'testimonials', 'ctaSection', 'contact', 'footer'
    ];

    for (const [key, component] of Object.entries(components)) {
      if (!validComponents.includes(key)) {
        // Allow unknown components but validate structure
        continue;
      }

      if (typeof component !== 'object' || component === null) {
        errors.push(`Component ${key} must be a valid object`);
        continue;
      }

      // Validate enabled property
      if ('enabled' in component && typeof component.enabled !== 'boolean') {
        errors.push(`Component ${key}.enabled must be boolean`);
      }

      // Validate component-specific properties
      if (key === 'hero' && component) {
        if ('height' in component && typeof component.height !== 'string') {
          errors.push(`Component hero.height must be string`);
        }
        if ('overlayColor' in component && typeof component.overlayColor === 'string' && !this.isValidColor(component.overlayColor)) {
          errors.push(`Component hero.overlayColor must be valid color`);
        }
      }

      if (key === 'features' && component) {
        if ('columns' in component) {
          const columns = component.columns;
          if (!Number.isInteger(columns) || (columns as number) < 1 || (columns as number) > 6) {
            errors.push(`Component features.columns must be integer between 1-6`);
          }
        }
      }
    }

    return errors;
  }

  /**
   * Validate content customization (Requirement 6.1, 6.2, 6.3)
   */
  static validateContent(content: any): string[] {
    const errors: string[] = [];

    if (!content || typeof content !== 'object') {
      errors.push('Content must be a valid object');
      return errors;
    }

    // Validate hero content
    if (content.hero) {
      errors.push(...this.validateContentSection('hero', content.hero));
    }

    // Validate mission/vision
    if (content.missionVision) {
      errors.push(...this.validateContentSection('missionVision', content.missionVision));
    }

    // Validate features array
    if (content.features && Array.isArray(content.features)) {
      for (let i = 0; i < content.features.length; i++) {
        errors.push(...this.validateContentSection(`features[${i}]`, content.features[i]));
      }
    }

    // Validate testimonials array
    if (content.testimonials && Array.isArray(content.testimonials)) {
      for (let i = 0; i < content.testimonials.length; i++) {
        errors.push(...this.validateContentSection(`testimonials[${i}]`, content.testimonials[i]));
      }
    }

    // Validate contact info
    if (content.contact) {
      errors.push(...this.validateContactInfo(content.contact));
    }

    return errors;
  }

  /**
   * Validate content section (text fields)
   */
  private static validateContentSection(name: string, section: any): string[] {
    const errors: string[] = [];

    if (!section || typeof section !== 'object') {
      return errors; // Allow missing sections
    }

    const textFields = ['heading', 'subheading', 'ctaText', 'title', 'description', 'text', 'author', 'vision'];

    for (const field of textFields) {
      if (field in section) {
        const value = section[field];
        if (value !== undefined && value !== null && typeof value !== 'string') {
          errors.push(`Content ${name}.${field} must be string or null`);
        } else if (typeof value === 'string' && value.length > 2000) {
          errors.push(`Content ${name}.${field} must not exceed 2000 characters`);
        }
      }
    }

    return errors;
  }

  /**
   * Validate contact information
   */
  private static validateContactInfo(contact: any): string[] {
    const errors: string[] = [];

    if (!contact || typeof contact !== 'object') {
      return errors;
    }

    // Validate email format
    if (contact.email && typeof contact.email === 'string') {
      if (!this.isValidEmail(contact.email)) {
        errors.push('Contact email must be valid email format');
      }
    }

    // Validate phone format (simple check)
    if (contact.phone && typeof contact.phone === 'string') {
      if (contact.phone.length < 10 || contact.phone.length > 20 || !/^[0-9+\-\s()]+$/.test(contact.phone)) {
        errors.push('Contact phone must be 10-20 characters with valid phone format');
      }
    }

    // Validate social links are URLs
    if (contact.socialLinks && typeof contact.socialLinks === 'object') {
      for (const [, url] of Object.entries(contact.socialLinks)) {
        if (typeof url === 'string' && url && !this.isValidUrl(url)) {
          errors.push('Contact social links must be valid URLs');
        }
      }
    }

    return errors;
  }

  /**
   * Helper: Check if value is valid color
   */
  private static isValidColor(value: string): boolean {
    return (
      this.COLOR_HEX_REGEX.test(value) ||
      this.COLOR_RGB_REGEX.test(value) ||
      this.COLOR_HSL_REGEX.test(value)
    );
  }

  /**
   * Helper: Check if email is valid
   */
  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 255;
  }

  /**
   * Helper: Check if URL is valid
   */
  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate numeric input (for spacing, sizes, etc.)
   */
  static validateNumeric(
    fieldName: string,
    value: any,
    min: number,
    max: number
  ): string[] {
    const errors: string[] = [];

    if (!Number.isInteger(value)) {
      errors.push(`${fieldName} must be an integer`);
    } else if (value < min) {
      errors.push(`${fieldName} must be at least ${min}`);
    } else if (value > max) {
      errors.push(`${fieldName} must not exceed ${max}`);
    }

    return errors;
  }

  /**
   * Validate string input (for text fields)
   */
  static validateString(
    fieldName: string,
    value: any,
    minLength?: number,
    maxLength?: number
  ): string[] {
    const errors: string[] = [];

    if (typeof value !== 'string') {
      errors.push(`${fieldName} must be a string`);
      return errors;
    }

    if (minLength !== undefined && value.length < minLength) {
      errors.push(`${fieldName} must be at least ${minLength} characters`);
    }

    if (maxLength !== undefined && value.length > maxLength) {
      errors.push(`${fieldName} must not exceed ${maxLength} characters`);
    }

    return errors;
  }
}
