---
name: Technical Precision
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#424751'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#737783'
  outline-variant: '#c2c6d3'
  surface-tint: '#255dad'
  primary: '#00346f'
  on-primary: '#ffffff'
  primary-container: '#004a99'
  on-primary-container: '#9bbdff'
  inverse-primary: '#abc7ff'
  secondary: '#625e51'
  on-secondary: '#ffffff'
  secondary-container: '#e6dfce'
  on-secondary-container: '#666355'
  tertiary: '#363535'
  on-tertiary: '#ffffff'
  tertiary-container: '#4c4c4c'
  on-tertiary-container: '#bebcbc'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d7e2ff'
  primary-fixed-dim: '#abc7ff'
  on-primary-fixed: '#001b3f'
  on-primary-fixed-variant: '#00458f'
  secondary-fixed: '#e8e2d1'
  secondary-fixed-dim: '#ccc6b5'
  on-secondary-fixed: '#1e1c11'
  on-secondary-fixed-variant: '#4a473a'
  tertiary-fixed: '#e5e2e1'
  tertiary-fixed-dim: '#c8c6c5'
  on-tertiary-fixed: '#1b1c1c'
  on-tertiary-fixed-variant: '#474746'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
  brand-red: '#C81C2E'
  blueprint-blue: '#003366'
  surface-border: '#E2E8F0'
  success: '#10B981'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  technical-label:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  button:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.01em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  sidebar-width: 260px
  container-max: 1440px
  gutter: 24px
  section-padding: 32px
  card-gap: 16px
---

## Brand & Style

This design system is engineered for technical workflows, specifically tailored for architects and engineers. It evolves the traditional corporate identity into a high-performance admin environment that feels sophisticated, orderly, and modern.

The visual direction is **Corporate / Modern** with a strong leaning toward **Minimalism**. It prioritizes information density without clutter, using generous whitespace to frame complex technical data. The aesthetic is "precise"—evoking the feeling of a well-organized blueprint or a high-end CAD software interface. The interface should feel reliable and heavy-duty, yet approachable enough for daily project management.

## Colors

The palette is anchored by the heritage corporate blue, which serves as the primary driver for actions and brand recognition. 

- **Primary Blue (#004A99):** Used for primary buttons, active navigation states, and key interactive elements.
- **Secondary Warm Grey (#A8A393):** Employed for subtle UI accents, inactive icons, and secondary metadata to provide a softer contrast than pure black.
- **Backgrounds:** The primary background uses a very light neutral gray (#F8F9FA) to separate the interface from white content cards, reducing eye strain during long technical sessions.
- **Accent Red (#C81C2E):** Reserved strictly for destructive actions (delete), critical alerts, or highlighting architectural discrepancies.

## Typography

The typographic system utilizes a three-font hierarchy to balance modern aesthetics with technical utility:

1.  **Hanken Grotesk (Headlines):** A sharp, contemporary grotesque that provides a "modernized" professional feel for page titles and section headers.
2.  **Inter (Body):** The workhorse for the admin panel, chosen for its exceptional legibility in data-heavy environments.
3.  **JetBrains Mono (Technical Labels):** A monospaced font used specifically for file names (e.g., .DWG files), coordinates, version numbers, and architectural metadata. This reinforces the technical nature of the platform.

**Scaling:** On mobile devices, `display-lg` should scale down to 32px, and `headline-lg` to 24px to maintain readability within the viewport.

## Layout & Spacing

The layout follows a **Fixed-Fluid Hybrid** model. A fixed-width left sidebar (260px) provides persistent navigation, while the main content area occupies the remaining width with a maximum constraint of 1440px to ensure line lengths remain readable on ultra-wide monitors.

A strict **8px grid system** governs all spacing.
- **Margins:** Desktop views use 32px margins; mobile views scale down to 16px.
- **Gutters:** Standardized at 24px to provide "breathing room" between complex data widgets.
- **Technical Reflow:** On tablet, the sidebar collapses into a hamburger menu or a condensed icon rail to prioritize the viewing area for technical drawings or data tables.

## Elevation & Depth

To achieve a "sophisticated UI," this design system moves away from heavy shadows in favor of **Tonal Layers** and **Low-Contrast Outlines**.

- **Level 0 (Background):** The neutral light gray (#F8F9FA) serves as the canvas.
- **Level 1 (Cards/Panels):** Pure white (#FFFFFF) surfaces with a subtle 1px border (#E2E8F0).
- **Level 2 (Dropdowns/Modals):** These elements use an "Ambient Shadow"—a very soft, diffused shadow (0px 10px 25px rgba(0, 74, 153, 0.08)) that incorporates a tiny hint of the brand blue to maintain color harmony.
- **Interaction:** Hover states on interactive cards should subtly lift the element by increasing the shadow spread and darkening the border slightly.

## Shapes

The shape language is **Soft** (4px - 12px radii), striking a balance between the rigid "square" look of traditional engineering software and the "rounded" friendliness of modern SaaS.

- **Standard Elements (Buttons, Inputs):** 4px (`rounded-sm`) for a sharp, disciplined look.
- **Containers (Cards, Modals):** 8px (`rounded-lg`) to soften the overall layout.
- **Status Pills:** Fully rounded (pill-shaped) to distinguish them from functional buttons.

## Components

- **Buttons:** Primary buttons use the solid Brand Blue with white text. Secondary buttons use a transparent background with a 1px border of the same blue. Use "Technical Mono" labels for buttons that execute script-like actions (e.g., "EXPORT_DWG").
- **Inputs:** Input fields must be clean with a 1px border. Focus states utilize a 2px blue ring with 50% opacity. Label text should always be visible above the field (no floating labels) to maintain technical clarity.
- **Cards:** White backgrounds, 8px corner radius, and 1px borders. Header sections within cards should have a subtle bottom border to separate titles from content.
- **File Lists:** Designed for DWG/PDF management. Use monospaced font for file sizes and dates. Include a distinctive icon set that differentiates file types clearly.
- **Chips/Status:** Use low-saturation background tints of the status color (e.g., light green background with dark green text for "Approved") to keep the interface professional and avoid "traffic light" visual fatigue.
- **Navigation:** The sidebar should use high-contrast text against a white background or a very dark "Navy" variation of the brand blue for a more executive feel.