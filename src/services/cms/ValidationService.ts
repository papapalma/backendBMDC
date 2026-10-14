/**
 * ValidationService - Input validation for CMS customization settings
 * Validates colors, typography, layout, components, and content formats
 * Returns array of validation errors with field paths for clarity
 *
 * Validates Requirements: 1.3, 3.3, 4.2, 5.2, 6.1, 14.1, 14.2, 14.3
 */

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

export class ValidationService {
  /**
   * Validates color format - supports hex, RGB, HSL
   * Formats: #RGB, #RRGGBB (hex), rgb(r,g,b), rgba(r,g,b,a), hsl(h,s,l), hsla(h,s,l,a)
   */
  private isValidColorFormat(color: string): boolean {
    if (typeof color !== 'string') return false;

    const trimmed = color.trim();

    // Hex format: #RGB or #RRGGBB
    const hexPattern = /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/;
    if (hexPattern.test(trimmed)) return true;

    // RGB format: rgb(r, g, b) where r,g,b are 0-255
    const rgbPattern = /^rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+))?\s*\)$/;
    const rgbMatch = trimmed.match(rgbPattern);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1], 10);
      const g = parseInt(rgbMatch[2], 10);
      const b = parseInt(rgbMatch[3], 10);
      const a = rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1;

      if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255 && a >= 0 && a <= 1) {
        return true;
      }
    }

    // HSL format: hsl(h, s%, l%) or hsla(h, s%, l%, a)
    const hslPattern = /^hsla?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*(?:,\s*(0|1|0?\.\d+))?\s*\)$/;
    const hslMatch = trimmed.match(hslPattern);
    if (hslMatch) {
      const h = parseInt(hslMatch[1], 10);
      const s = parseInt(hslMatch[2], 10);
      const l = parseInt(hslMatch[3], 10);
      const a = hslMatch[4] ? parseFloat(hslMatch[4]) : 1;

      if (h >= 0 && h <= 360 && s >= 0 && s <= 100 && l >= 0 && l <= 100 && a >= 0 && a <= 1) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validates colors object
   * Expects: { primary, secondary, accent, background, text, borders }
   * Each color must be valid hex, RGB, or HSL format
   */
  public validateColors(colors: any): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!colors || typeof colors !== 'object') {
      errors.push({
        field: 'colors',
        message: 'Colors must be an object',
        value: colors,
      });
      return errors;
    }

    const requiredColors = ['primary', 'secondary', 'accent', 'background', 'text', 'borders'];

    for (const colorKey of requiredColors) {
      if (!(colorKey in colors)) {
        errors.push({
          field: `colors.${colorKey}`,
          message: `Required color '${colorKey}' is missing`,
        });
      } else if (!this.isValidColorFormat(colors[colorKey])) {
        errors.push({
          field: `colors.${colorKey}`,
          message: `Invalid color format for '${colorKey}'. Accepted formats: hex (#RGB, #RRGGBB), rgb(r,g,b), rgba(r,g,b,a), hsl(h,s,l), hsla(h,s,l,a)`,
          value: colors[colorKey],
        });
      }
    }

    return errors;
  }

  /**
   * Validates typography object
   * Checks font family strings, font sizes (numeric px values), font weights (100-900), line heights
   */
  public validateTypography(typography: any): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!typography || typeof typography !== 'object') {
      errors.push({
        field: 'typography',
        message: 'Typography must be an object',
        value: typography,
      });
      return errors;
    }

    // Validate headings section
    if (typography.headings) {
      if (typeof typography.headings !== 'object') {
        errors.push({
          field: 'typography.headings',
          message: 'Headings must be an object',
        });
      } else {
        // Validate fontFamily
        if (typography.headings.fontFamily && typeof typography.headings.fontFamily !== 'string') {
          errors.push({
            field: 'typography.headings.fontFamily',
            message: 'Font family must be a string',
            value: typography.headings.fontFamily,
          });
        }

        // Validate fontSize
        if (typography.headings.fontSize) {
          if (typeof typography.headings.fontSize !== 'object') {
            errors.push({
              field: 'typography.headings.fontSize',
              message: 'Font sizes must be an object with h1, h2, h3 properties',
            });
          } else {
            const headingSizes = ['h1', 'h2', 'h3'];
            for (const size of headingSizes) {
              if (size in typography.headings.fontSize) {
                const value = typography.headings.fontSize[size];
                if (typeof value !== 'number' || value <= 0) {
                  errors.push({
                    field: `typography.headings.fontSize.${size}`,
                    message: 'Font size must be a positive number (in pixels)',
                    value,
                  });
                }
              }
            }
          }
        }

        // Validate fontWeight
        if (typography.headings.fontWeight !== undefined) {
          const weight = typography.headings.fontWeight;
          const validWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
          if (typeof weight !== 'number' || !validWeights.includes(weight)) {
            errors.push({
              field: 'typography.headings.fontWeight',
              message: 'Font weight must be a number between 100 and 900 (in increments of 100)',
              value: weight,
            });
          }
        }

        // Validate lineHeight
        if (typography.headings.lineHeight !== undefined) {
          const lineHeight = typography.headings.lineHeight;
          if (typeof lineHeight !== 'number' || lineHeight <= 0) {
            errors.push({
              field: 'typography.headings.lineHeight',
              message: 'Line height must be a positive number (e.g., 1.2 or 1.5)',
              value: lineHeight,
            });
          }
        }
      }
    }

    // Validate body section
    if (typography.body) {
      if (typeof typography.body !== 'object') {
        errors.push({
          field: 'typography.body',
          message: 'Body typography must be an object',
        });
      } else {
        // Validate fontFamily
        if (typography.body.fontFamily && typeof typography.body.fontFamily !== 'string') {
          errors.push({
            field: 'typography.body.fontFamily',
            message: 'Font family must be a string',
            value: typography.body.fontFamily,
          });
        }

        // Validate fontSize
        if (typography.body.fontSize !== undefined) {
          const size = typography.body.fontSize;
          if (typeof size !== 'number' || size <= 0) {
            errors.push({
              field: 'typography.body.fontSize',
              message: 'Font size must be a positive number (in pixels)',
              value: size,
            });
          }
        }

        // Validate fontWeight
        if (typography.body.fontWeight !== undefined) {
          const weight = typography.body.fontWeight;
          const validWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
          if (typeof weight !== 'number' || !validWeights.includes(weight)) {
            errors.push({
              field: 'typography.body.fontWeight',
              message: 'Font weight must be a number between 100 and 900 (in increments of 100)',
              value: weight,
            });
          }
        }

        // Validate lineHeight
        if (typography.body.lineHeight !== undefined) {
          const lineHeight = typography.body.lineHeight;
          if (typeof lineHeight !== 'number' || lineHeight <= 0) {
            errors.push({
              field: 'typography.body.lineHeight',
              message: 'Line height must be a positive number (e.g., 1.2 or 1.5)',
              value: lineHeight,
            });
          }
        }
      }
    }

    return errors;
  }

  /**
   * Validates layout object
   * Checks containerWidth, padding, margins, gaps - numeric validation for sizes
   */
  public validateLayout(layout: any): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!layout || typeof layout !== 'object') {
      errors.push({
        field: 'layout',
        message: 'Layout must be an object',
        value: layout,
      });
      return errors;
    }

    // Validate containerWidth (can be px or %)
    if (layout.containerWidth !== undefined) {
      const width = layout.containerWidth;
      if (typeof width !== 'string') {
        errors.push({
          field: 'layout.containerWidth',
          message: 'Container width must be a string (e.g., "1200px" or "100%")',
          value: width,
        });
      } else {
        // Parse and validate numeric part
        const pxMatch = width.match(/^(\d+)px$/i);
        const percentMatch = width.match(/^(\d+)%$/);
        if (!pxMatch && !percentMatch) {
          errors.push({
            field: 'layout.containerWidth',
            message: 'Container width must be in format "123px" or "100%"',
            value: width,
          });
        } else if (pxMatch && parseInt(pxMatch[1], 10) <= 0) {
          errors.push({
            field: 'layout.containerWidth',
            message: 'Container width must be a positive number',
            value: width,
          });
        } else if (percentMatch && parseInt(percentMatch[1], 10) > 100) {
          errors.push({
            field: 'layout.containerWidth',
            message: 'Container width percentage cannot exceed 100%',
            value: width,
          });
        }
      }
    }

    // Validate containerLayout
    if (layout.containerLayout !== undefined) {
      const validLayouts = ['full-width', 'centered', 'sidebar'];
      if (!validLayouts.includes(layout.containerLayout)) {
        errors.push({
          field: 'layout.containerLayout',
          message: `Container layout must be one of: ${validLayouts.join(', ')}`,
          value: layout.containerLayout,
        });
      }
    }

    // Validate padding
    if (layout.padding && typeof layout.padding === 'object') {
      for (const [key, value] of Object.entries(layout.padding)) {
        if (typeof value !== 'number' || value < 0) {
          errors.push({
            field: `layout.padding.${key}`,
            message: 'Padding must be a non-negative number (in pixels)',
            value,
          });
        }
      }
    }

    // Validate margins
    if (layout.margins && typeof layout.margins === 'object') {
      for (const [key, value] of Object.entries(layout.margins)) {
        if (typeof value !== 'number' || value < 0) {
          errors.push({
            field: `layout.margins.${key}`,
            message: 'Margin must be a non-negative number (in pixels)',
            value,
          });
        }
      }
    }

    // Validate gaps
    if (layout.gaps && typeof layout.gaps === 'object') {
      for (const [key, value] of Object.entries(layout.gaps)) {
        if (typeof value !== 'number' || value < 0) {
          errors.push({
            field: `layout.gaps.${key}`,
            message: 'Gap must be a non-negative number (in pixels)',
            value,
          });
        }
      }
    }

    return errors;
  }

  /**
   * Validates components object
   * Checks structure and boolean flags for component visibility
   */
  public validateComponents(components: any): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!components || typeof components !== 'object') {
      errors.push({
        field: 'components',
        message: 'Components must be an object',
        value: components,
      });
      return errors;
    }

    const componentKeys = ['navigation', 'hero', 'features', 'testimonials', 'ctaSection', 'contact', 'footer'];

    for (const componentKey of componentKeys) {
      if (componentKey in components) {
        const component = components[componentKey];

        if (typeof component !== 'object') {
          errors.push({
            field: `components.${componentKey}`,
            message: `Component '${componentKey}' must be an object`,
            value: component,
          });
          continue;
        }

        // Check if 'enabled' property is boolean
        if ('enabled' in component && typeof component.enabled !== 'boolean') {
          errors.push({
            field: `components.${componentKey}.enabled`,
            message: 'Component enabled property must be a boolean',
            value: component.enabled,
          });
        }

        // Validate component-specific properties
        if (componentKey === 'hero') {
          if (component.height !== undefined) {
            if (typeof component.height !== 'string') {
              errors.push({
                field: `components.${componentKey}.height`,
                message: 'Hero height must be a string (e.g., "500px")',
                value: component.height,
              });
            } else {
              const pxMatch = component.height.match(/^(\d+)px$/i);
              if (!pxMatch || parseInt(pxMatch[1], 10) <= 0) {
                errors.push({
                  field: `components.${componentKey}.height`,
                  message: 'Hero height must be in format "123px" with positive value',
                  value: component.height,
                });
              }
            }
          }

          if (component.overlayColor !== undefined && !this.isValidColorFormat(component.overlayColor)) {
            errors.push({
              field: `components.${componentKey}.overlayColor`,
              message: 'Hero overlay color must be a valid color format',
              value: component.overlayColor,
            });
          }
        }

        if (componentKey === 'features') {
          if (component.columns !== undefined) {
            if (typeof component.columns !== 'number' || component.columns <= 0) {
              errors.push({
                field: `components.${componentKey}.columns`,
                message: 'Features columns must be a positive number',
                value: component.columns,
              });
            }
          }
        }

        if (componentKey === 'testimonials') {
          if (component.displayCount !== undefined) {
            if (typeof component.displayCount !== 'number' || component.displayCount <= 0) {
              errors.push({
                field: `components.${componentKey}.displayCount`,
                message: 'Testimonials display count must be a positive number',
                value: component.displayCount,
              });
            }
          }
        }

        if (componentKey === 'contact') {
          if (component.formFields !== undefined) {
            if (!Array.isArray(component.formFields)) {
              errors.push({
                field: `components.${componentKey}.formFields`,
                message: 'Contact form fields must be an array',
                value: component.formFields,
              });
            } else {
              const validFields = ['email', 'phone', 'message', 'name', 'subject'];
              for (let i = 0; i < component.formFields.length; i++) {
                if (typeof component.formFields[i] !== 'string') {
                  errors.push({
                    field: `components.${componentKey}.formFields[${i}]`,
                    message: 'Form field name must be a string',
                    value: component.formFields[i],
                  });
                } else if (!validFields.includes(component.formFields[i])) {
                  errors.push({
                    field: `components.${componentKey}.formFields[${i}]`,
                    message: `Form field must be one of: ${validFields.join(', ')}`,
                    value: component.formFields[i],
                  });
                }
              }
            }
          }
        }

        if (componentKey === 'footer') {
          if (component.linkColumns !== undefined) {
            if (typeof component.linkColumns !== 'number' || component.linkColumns <= 0) {
              errors.push({
                field: `components.${componentKey}.linkColumns`,
                message: 'Footer link columns must be a positive number',
                value: component.linkColumns,
              });
            }
          }
        }
      }
    }

    return errors;
  }

  /**
   * Validates content object
   * Checks text length limits, email/phone formats, URL validation for social links
   */
  public validateContent(content: any): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!content || typeof content !== 'object') {
      errors.push({
        field: 'content',
        message: 'Content must be an object',
        value: content,
      });
      return errors;
    }

    // Validate hero section
    if (content.hero && typeof content.hero === 'object') {
      if (content.hero.heading !== undefined) {
        if (typeof content.hero.heading !== 'string') {
          errors.push({
            field: 'content.hero.heading',
            message: 'Hero heading must be a string',
            value: content.hero.heading,
          });
        } else if (content.hero.heading.length > 120) {
          errors.push({
            field: 'content.hero.heading',
            message: 'Hero heading must not exceed 120 characters',
            value: content.hero.heading,
          });
        }
      }

      if (content.hero.subheading !== undefined) {
        if (typeof content.hero.subheading !== 'string') {
          errors.push({
            field: 'content.hero.subheading',
            message: 'Hero subheading must be a string',
            value: content.hero.subheading,
          });
        } else if (content.hero.subheading.length > 200) {
          errors.push({
            field: 'content.hero.subheading',
            message: 'Hero subheading must not exceed 200 characters',
            value: content.hero.subheading,
          });
        }
      }

      if (content.hero.ctaText !== undefined) {
        if (typeof content.hero.ctaText !== 'string') {
          errors.push({
            field: 'content.hero.ctaText',
            message: 'Hero CTA text must be a string',
            value: content.hero.ctaText,
          });
        } else if (content.hero.ctaText.length > 50) {
          errors.push({
            field: 'content.hero.ctaText',
            message: 'Hero CTA text must not exceed 50 characters',
            value: content.hero.ctaText,
          });
        }
      }
    }

    // Validate mission/vision section
    if (content.missionVision && typeof content.missionVision === 'object') {
      if (content.missionVision.title !== undefined) {
        if (typeof content.missionVision.title !== 'string') {
          errors.push({
            field: 'content.missionVision.title',
            message: 'Mission/vision title must be a string',
            value: content.missionVision.title,
          });
        } else if (content.missionVision.title.length > 100) {
          errors.push({
            field: 'content.missionVision.title',
            message: 'Mission/vision title must not exceed 100 characters',
            value: content.missionVision.title,
          });
        }
      }

      if (content.missionVision.description !== undefined) {
        if (typeof content.missionVision.description !== 'string') {
          errors.push({
            field: 'content.missionVision.description',
            message: 'Mission/vision description must be a string',
            value: content.missionVision.description,
          });
        } else if (content.missionVision.description.length > 500) {
          errors.push({
            field: 'content.missionVision.description',
            message: 'Mission/vision description must not exceed 500 characters',
            value: content.missionVision.description,
          });
        }
      }

      if (content.missionVision.vision !== undefined) {
        if (typeof content.missionVision.vision !== 'string') {
          errors.push({
            field: 'content.missionVision.vision',
            message: 'Vision statement must be a string',
            value: content.missionVision.vision,
          });
        } else if (content.missionVision.vision.length > 500) {
          errors.push({
            field: 'content.missionVision.vision',
            message: 'Vision statement must not exceed 500 characters',
            value: content.missionVision.vision,
          });
        }
      }
    }

    // Validate features array
    if (content.features !== undefined) {
      if (!Array.isArray(content.features)) {
        errors.push({
          field: 'content.features',
          message: 'Features must be an array',
          value: content.features,
        });
      } else {
        for (let i = 0; i < content.features.length; i++) {
          const feature = content.features[i];
          if (typeof feature !== 'object') {
            errors.push({
              field: `content.features[${i}]`,
              message: 'Feature must be an object',
              value: feature,
            });
            continue;
          }

          if (feature.title && typeof feature.title !== 'string') {
            errors.push({
              field: `content.features[${i}].title`,
              message: 'Feature title must be a string',
              value: feature.title,
            });
          } else if (feature.title && feature.title.length > 100) {
            errors.push({
              field: `content.features[${i}].title`,
              message: 'Feature title must not exceed 100 characters',
              value: feature.title,
            });
          }

          if (feature.description && typeof feature.description !== 'string') {
            errors.push({
              field: `content.features[${i}].description`,
              message: 'Feature description must be a string',
              value: feature.description,
            });
          } else if (feature.description && feature.description.length > 300) {
            errors.push({
              field: `content.features[${i}].description`,
              message: 'Feature description must not exceed 300 characters',
              value: feature.description,
            });
          }
        }
      }
    }

    // Validate testimonials array
    if (content.testimonials !== undefined) {
      if (!Array.isArray(content.testimonials)) {
        errors.push({
          field: 'content.testimonials',
          message: 'Testimonials must be an array',
          value: content.testimonials,
        });
      } else {
        for (let i = 0; i < content.testimonials.length; i++) {
          const testimonial = content.testimonials[i];
          if (typeof testimonial !== 'object') {
            errors.push({
              field: `content.testimonials[${i}]`,
              message: 'Testimonial must be an object',
              value: testimonial,
            });
            continue;
          }

          if (testimonial.text && typeof testimonial.text !== 'string') {
            errors.push({
              field: `content.testimonials[${i}].text`,
              message: 'Testimonial text must be a string',
              value: testimonial.text,
            });
          } else if (testimonial.text && testimonial.text.length > 500) {
            errors.push({
              field: `content.testimonials[${i}].text`,
              message: 'Testimonial text must not exceed 500 characters',
              value: testimonial.text,
            });
          }

          if (testimonial.author && typeof testimonial.author !== 'string') {
            errors.push({
              field: `content.testimonials[${i}].author`,
              message: 'Testimonial author must be a string',
              value: testimonial.author,
            });
          } else if (testimonial.author && testimonial.author.length > 100) {
            errors.push({
              field: `content.testimonials[${i}].author`,
              message: 'Testimonial author must not exceed 100 characters',
              value: testimonial.author,
            });
          }
        }
      }
    }

    // Validate contact section
    if (content.contact && typeof content.contact === 'object') {
      if (content.contact.email !== undefined) {
        if (typeof content.contact.email !== 'string') {
          errors.push({
            field: 'content.contact.email',
            message: 'Contact email must be a string',
            value: content.contact.email,
          });
        } else if (!this.isValidEmail(content.contact.email)) {
          errors.push({
            field: 'content.contact.email',
            message: 'Contact email must be a valid email format',
            value: content.contact.email,
          });
        }
      }

      if (content.contact.phone !== undefined) {
        if (typeof content.contact.phone !== 'string') {
          errors.push({
            field: 'content.contact.phone',
            message: 'Contact phone must be a string',
            value: content.contact.phone,
          });
        } else if (!this.isValidPhone(content.contact.phone)) {
          errors.push({
            field: 'content.contact.phone',
            message: 'Contact phone must be a valid format (e.g., +1-555-000-0000 or 555-000-0000)',
            value: content.contact.phone,
          });
        }
      }

      if (content.contact.address !== undefined) {
        if (typeof content.contact.address !== 'string') {
          errors.push({
            field: 'content.contact.address',
            message: 'Contact address must be a string',
            value: content.contact.address,
          });
        } else if (content.contact.address.length > 200) {
          errors.push({
            field: 'content.contact.address',
            message: 'Contact address must not exceed 200 characters',
            value: content.contact.address,
          });
        }
      }

      if (content.contact.socialLinks && typeof content.contact.socialLinks === 'object') {
        for (const [platform, url] of Object.entries(content.contact.socialLinks)) {
          if (typeof url !== 'string') {
            errors.push({
              field: `content.contact.socialLinks.${platform}`,
              message: 'Social link URL must be a string',
              value: url,
            });
          } else if (!this.isValidUrl(url)) {
            errors.push({
              field: `content.contact.socialLinks.${platform}`,
              message: 'Social link must be a valid URL',
              value: url,
            });
          }
        }
      }
    }

    return errors;
  }

  /**
   * Helper method to validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(email);
  }

  /**
   * Helper method to validate phone format
   * Accepts formats like: +1-555-000-0000, 555-000-0000, +1 555 000 0000, etc.
   */
  private isValidPhone(phone: string): boolean {
    // Pattern allows for:
    // - Optional + and country code (1-3 digits)
    // - Area code (3 digits) optionally in parentheses
    // - Exchange (3 digits)
    // - Subscriber (4 digits)
    // Separators can be: - (hyphen), space, or . (dot)
    const phonePattern = /^[+]?[0-9]{0,3}[-.\s]?[(]?[0-9]{3}[)]?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}$/;
    return phonePattern.test(phone);
  }

  /**
   * Helper method to validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}
