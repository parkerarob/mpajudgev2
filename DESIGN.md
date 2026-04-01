# Design System Reference

This document documents the CSS custom properties, typography, spacing, color palette, and component patterns defined in `public/styles.css`. Use this as a reference to maintain design consistency and prevent CSS variable drift.

## CSS Custom Properties (Root Variables)

All design tokens are defined in `:root {}` in `public/styles.css` (lines 0-39). Always use these variables instead of hardcoding values.

### Typography

```css
--font-ui: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
--font-display: "Fraunces", "Georgia", serif;

--text-xs: 12px;
--text-sm: 14px;
--text-base: 15px;
--text-lg: 17px;

--lh-tight: 1.2;
--lh-normal: 1.45;
--lh-relaxed: 1.6;
```

**Usage:**
- **`--font-ui`**: The default UI sans-serif stack for all body copy, buttons, labels, and form elements. Applied globally to `body` and all inputs/buttons.
- **`--font-display`**: Decorative serif font (Fraunces) for headings and emphasis. Use for `h1`, large stat values, hero text.
- **`--text-xs` through `--text-lg`**: Font size tokens. Always use these instead of hardcoding pixel values.
- **`--lh-tight`, `--lh-normal`, `--lh-relaxed`**: Line height tokens. Use `--lh-normal` (1.45) as default for most body copy.

### Spacing Scale

```css
--space-1: 6px;
--space-2: 8px;
--space-3: 10px;
--space-4: 12px;
--space-5: 16px;
--space-6: 20px;
```

**Usage:**
- Build padding, margin, and gap with these tokens.
- For larger spacing (28px, 32px, 44px), use multiples or hardcode with a comment explaining the exception.
- Common patterns:
  - `gap: var(--space-2)` for compact grids
  - `padding: var(--space-4) var(--space-5)` for panel interior
  - `gap: var(--space-6)` for section-level spacing
  - Body padding: `28px` (double the standard in practice; larger in practice)

### Color Palette

#### Grayscale & Neutrals
```css
--bg: #09101a;                                        /* Page background */
--panel: rgba(14, 20, 32, 0.72);                     /* Semi-transparent panel background */
--panel2: rgba(16, 23, 38, 0.94);                    /* Slightly more opaque panel (auth status) */
--surface: rgba(14, 20, 32, 0.72);                   /* General surface background (same as --panel) */
--surface-solid: #111a29;                            /* Solid surface without transparency */
--surface-elevated: rgba(23, 33, 54, 0.9);           /* Elevated surfaces (above standard surface) */
--text: rgba(255, 255, 255, 0.92);                   /* Primary text color (near-white at 92% opacity) */
--muted: rgba(219, 229, 255, 0.66);                  /* Secondary/muted text (66% opacity, slightly blue-tinted) */
```

#### Accent & Brand
```css
--accent: #4d83ff;                                   /* Primary action color (blue) */
--blue: #4d83ff;                                     /* Alias for --accent */
--gold: #ddb56b;                                     /* Secondary accent for highlights/badges */
```

#### Borders & Lines
```css
--border: rgba(187, 208, 255, 0.13);                 /* Standard border (light blue at 13%) */
--hairline: rgba(187, 208, 255, 0.12);               /* Very subtle border (12%) */
--line-soft: rgba(187, 208, 255, 0.12);              /* Alias for --hairline */
--line-strong: rgba(118, 157, 255, 0.34);            /* Stronger line for emphasis (34%) */
```

#### Status Colors (Semantic)
These are hardcoded for specific cases:
- **Error/Danger**: `rgba(248, 113, 113, 0.25)` background, `#fca5a5` text (red-based)
- **Success/Gold**: `--gold: #ddb56b` (warm accent)

### Border Radius

```css
--radius-lg: 24px;    /* Large rounds: hero sections, large panels */
--radius-md: 18px;    /* Medium rounds: standard panels, cards */
--radius-sm: 12px;    /* Small rounds: buttons, form inputs, badges */
```

**Usage:**
- Panels: `border-radius: var(--radius-md)` (18px)
- Buttons: `border-radius: 12px` (often hardcoded; use `var(--radius-sm)`)
- Form inputs: `border-radius: 12px` (use `var(--radius-sm)`)
- Pill shapes (badges, segmented control): `border-radius: 999px`

### Shadows

```css
--shadow: 0 24px 60px rgba(2, 8, 22, 0.34);         /* Large shadow for prominent elevation */
--shadow-soft: 0 12px 28px rgba(2, 8, 22, 0.22);    /* Subtle shadow for panels */
```

**Usage:**
- Panels include `box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), var(--shadow-soft);` (inset highlight + soft shadow)
- Buttons: `box-shadow: 0 10px 18px rgba(20, 44, 104, 0.28);`
- Use shadows sparingly in dark theme; prefer borders and backgrounds for definition.

### Layout

```css
--app-width: 1240px;                                 /* Max container width */
```

## Typography Choices & Font Assignments

### Font Families
- **Body/UI**: Use `var(--font-ui)` for all body copy, form elements, buttons, labels.
- **Display/Headings**: Use `var(--font-display)` for:
  - Main page headings (`h1`)
  - Hero/large stats values
  - Section titles when visual weight matters
  - Avoid overuse; reserve for emphasis.

### Font Sizes
All sizes are defined as variables; prefer using `var(--text-xs)` etc. over hardcoding.

**Text Scale:**
- **`12px` (`--text-xs`)**: Labels, small badges, helper text, form hints
- **`14px` (`--text-sm`)**: Secondary text, table cells, small data
- **`15px` (`--text-base`)**: Default body copy, most UI text
- **`17px` (`--text-lg`)**: Slightly emphasized copy, director names

**Display Sizes (hardcoded in specific contexts):**
- **`28px`**: Public program day headings (responsive down to 24px on mobile)
- **`24px`**: `h2`, admin panel titles
- **`20px`**: Some stat values
- **`18px`**: Ensemble names, ensemble program entries
- **`16px`**: `h3`, sub-headings
- **`clamp(22px, 3vw, 32px)`**: Responsive `h1` (scales with viewport)
- **`clamp(30px, 4vw, 44px)` / `clamp(40px, 6vw, 66px)`**: Hero headings (responsive)

### Line Heights
- **`--lh-tight: 1.2`**: Use for headings, dense copy
- **`--lh-normal: 1.45`**: Default for body copy, form inputs, most UI text
- **`--lh-relaxed: 1.6`**: Use for long-form text, detailed descriptions, accessibility

## Spacing Tokens & Scale

See **Spacing Scale** above for the six-step system.

**Common spacing patterns in use:**
- Compact lists/grids: `gap: var(--space-2)` or `gap: 8px`
- Standard panels: `padding: 18px 20px`
- Form field padding: `11px 13px`
- Button padding: `10px 14px` (primary/default)
- Section margins: `gap: 16px`, `margin-bottom: 18px`

**Responsive spacing adjustments:**
- Most spacing is viewport-agnostic (same on all sizes).
- Exception: padding on `.panel` changes only on mobile (body padding reduces from 28px to 16px).
- Mobile breakpoint: `@media (max-width: 768px)`

## Color Palette

The system uses a **dark theme** with blue-tinted neutrals and accent colors.

### Semantic Intent

| Token | Intent | Example Use |
|-------|--------|------------|
| `--bg` | Canvas / page background | Body background |
| `--panel`, `--surface` | Card/panel background | `.panel`, cards |
| `--surface-elevated` | Above-panel elevation | Elevated UI, toasts |
| `--text` | Primary copy | All readable text |
| `--muted` | Secondary/de-emphasized text | Labels, hints, subtext |
| `--accent` / `--blue` | Primary action | Button fills, links |
| `--gold` | Secondary/highlight | Badges, emphasis icons |
| `--border` | Standard divider | Card borders, lines |
| `--line-strong` | Emphasis divider | Strong separations |

### Semantic Colors (Status)
Not CSS vars; used in-line for specific cases:
- **Error/Danger**: `#fca5a5` (red), `rgba(248, 113, 113, 0.25)` background
- **Warning**: `--gold` (warm)
- **Selected**: `rgba(120, 165, 255, 0.6)` (blue accent)

## Border Radius System

Three-tier system:

| Token | Size | Use |
|-------|------|-----|
| `--radius-lg` | 24px | Hero sections, prominent cards |
| `--radius-md` | 18px | Standard panels, cards, larger components |
| `--radius-sm` | 12px | Buttons, form inputs, small elements |
| `999px` | Pill | Badges, segmented controls, rounded pill shapes |

**Application rule**: Match the radius to the component's prominence. Small UI elements (buttons, inputs) use `--radius-sm`. Large containers (panels) use `--radius-md` or `--radius-lg`.

## Button Variants and States

### Default Button Style

```css
button {
  padding: 10px 14px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(180deg, rgba(96, 145, 255, 0.96), rgba(67, 110, 224, 0.94));
  color: var(--text);
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.06s ease, filter 0.15s ease, box-shadow 0.15s ease;
  box-shadow: 0 10px 18px rgba(20, 44, 104, 0.28);
  min-height: 42px;
}
```

**States:**
- **`:hover:not(:disabled)`**: `filter: brightness(1.05)`, larger shadow
- **`:active:not(:disabled)`**: `transform: translateY(1px)`, reduced shadow
- **`:disabled`**: `opacity: 0.5`, `cursor: not-allowed`

### Button Variants

#### Primary Button (`.btn--primary`)
```css
.btn--primary {
  background: var(--accent);
}
```
Use for main CTA buttons.

#### Secondary Button (`.btn--secondary`)
```css
.btn--secondary {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.01)), rgba(11, 17, 29, 0.6);
  border: 1px solid rgba(187, 208, 255, 0.16);
}
```
Use for supporting actions, less visual weight than primary.

#### Danger Button (`.btn--danger`)
```css
.btn--danger {
  background: rgba(248, 113, 113, 0.25);
  border: 1px solid rgba(248, 113, 113, 0.6);
}
```
Use for destructive actions (delete, remove). Pair with confirmation dialog.

#### Ghost Button (`button.ghost`)
```css
button.ghost {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(187, 208, 255, 0.14);
  color: var(--text);
  box-shadow: none;
}

button.ghost:hover,
button.ghost:focus-visible {
  border-color: rgba(118, 157, 255, 0.34);
  background: rgba(255, 255, 255, 0.045);
}

button.ghost.danger {
  border-color: rgba(248, 113, 113, 0.6);
  color: #fca5a5;
}
```
Use for secondary/tertiary actions. Transparent base with border. Apply `.danger` modifier for danger ghost buttons.

#### Size Variants

| Class | Padding | Font Size |
|-------|---------|-----------|
| Default | `10px 14px` | `var(--text-base)` (15px) |
| `.btn--sm` | `6px 10px` | `12px` |
| `.btn--lg` | `10px 18px` | `15px` |

**Usage:**
```html
<button class="btn--lg">Submit</button>
<button class="btn--secondary btn--sm">Cancel</button>
<button class="btn--danger ghost">Delete</button>
```

### Loading State

```css
button.is-loading {
  pointer-events: none;
  animation: pulse 1s ease-in-out infinite;
}

button.is-loading .button-spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(243, 246, 255, 0.35);
  border-top-color: var(--text);
  border-radius: 50%;
  margin-left: 8px;
  animation: spin 0.8s linear infinite;
}
```

Apply `is-loading` class to disable interaction and add pulsing effect with spinner.

## Form Input Styling

```css
input, textarea, select {
  padding: 11px 13px;
  border-radius: 12px;
  border: 1px solid rgba(187, 208, 255, 0.16);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.015)), rgba(11, 17, 29, 0.92);
  color: var(--text);
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

input::placeholder, textarea::placeholder {
  color: var(--muted);
}

input:hover, textarea:hover, select:hover {
  border-color: rgba(187, 208, 255, 0.24);
}

input:focus, textarea:focus, select:focus {
  border-color: rgba(118, 157, 255, 0.48);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02)), rgba(12, 19, 31, 0.98);
  box-shadow: 0 0 0 4px rgba(77, 131, 255, 0.12);
}
```

**States:**
- **Default**: Subtle border, frosted background
- **`:hover`**: Border brightens
- **`:focus`**: Border color becomes more blue, focus ring added (`box-shadow`)

## Component Patterns and Styling

### Panels (`.panel`)

```css
.panel {
  border: 1px solid rgba(187, 208, 255, 0.13);
  border-radius: 20px;
  padding: 18px 20px;
  background: radial-gradient(circle at top right, rgba(77, 131, 255, 0.08), transparent 32%), 
              linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.012)), 
              rgba(13, 20, 33, 0.9);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), var(--shadow-soft);
}
```

**Purpose**: Standard container for grouped content (forms, summaries, sections).

**Details:**
- Radius: 20px (medium-to-large)
- Padding: `18px 20px` (symmetric with slight width bias)
- Background: Layered gradient with inset highlight for depth
- Border: Subtle light blue line
- Shadow: Inset highlight + soft outer shadow

**Pattern**: Wrap content sections in `.panel`. Never hardcode border/background; always use this style.

### List Items (`.list li`)

```css
.list {
  list-style: none;
  display: grid;
  gap: 8px;
  padding: 0;
}

.list li {
  border: 1px solid rgba(187, 208, 255, 0.13);
  border-radius: 14px;
  padding: 12px;
  font-size: var(--text-base);
  display: grid;
  gap: 8px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.008)), rgba(13, 20, 33, 0.9);
}

.list li.is-selected {
  border-color: rgba(120, 165, 255, 0.6);
  box-shadow: inset 0 0 0 1px rgba(120, 165, 255, 0.3);
}

.list li:hover {
  border-color: rgba(187, 208, 255, 0.2);
}
```

**Purpose**: Semantic list styling for selectable/interactive items.

**States:**
- **Default**: Subtle border, frosted background
- **`:hover`**: Border brightens
- **`.is-selected`**: Border becomes blue, inset highlight

### Cards (`.card`) — Generic
`.card` is used as an alias for `.panel` in many contexts. Use `.panel` for clarity.

### Badges and Decorative Elements

#### Status Badge (`.status-badge`)
```css
.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: rgba(148, 163, 184, 0.14);
  color: rgba(231, 238, 255, 0.92);
  border: 1px solid rgba(187, 208, 255, 0.14);
}
```

#### Roster Selected Badge (`.roster-selected-badge`)
```css
.roster-selected-badge {
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--text);
  background: rgba(120, 165, 255, 0.2);
  border: 1px solid rgba(120, 165, 255, 0.4);
}
```

Use for inline badges marking selection state. Always use pill shape (`border-radius: 999px`).

### Segmented Controls (`.segmented-control`)

```css
.segmented-control {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.segmented-control .segment {
  background: rgba(18, 20, 36, 0.7);
  border: 1px solid var(--border);
  padding: 8px 12px;
  border-radius: 999px;
  min-height: 44px;
}

.segmented-control .segment.is-active {
  background: rgba(90, 140, 240, 0.4);
  border-color: rgba(90, 140, 240, 0.7);
}
```

Use for grouped, mutually-exclusive options (filters, view toggles).

### Progress Bars (`.progress-bar`)

```css
.progress-bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(248, 250, 252, 0.08);
  overflow: hidden;
}

.progress-bar span {
  display: block;
  height: 100%;
  width: 0%;
  background: rgba(120, 165, 255, 0.7);
}
```

Use for visual progress indication. Height is `6px` (subtle). Inject width via inline styles or JS.

## Component Guidelines

### When Building New Components

1. **Use CSS variables first.** Before hardcoding any color, spacing, or size, check if a token exists.
2. **Match the dark theme.** All backgrounds should relate to `--bg`, `--surface`, `--panel`, or `--surface-elevated`. Text should use `--text` or `--muted`.
3. **Apply consistent spacing.** Use `gap` and `padding` from the spacing scale.
4. **Use `--radius-sm`, `--radius-md`, or `--radius-lg`** depending on prominence. Never use random radius values.
5. **Borders should use `--border` or `--line-strong`** unless there's a semantic reason (error, selection).
6. **Typography.** Prefer `var(--text-*)` font sizes. Use `--lh-normal` as default line height.
7. **Avoid hardcoding shadows.** Use `--shadow` or `--shadow-soft` if you need elevation.
8. **Buttons should extend the button base styles.** Use modifier classes (`.btn--primary`, `.btn--danger`, `.btn--sm`) rather than creating new button classes.

### Common Anti-Patterns to Avoid

- ❌ `border-radius: 16px` instead of `var(--radius-sm)` (12px) or `var(--radius-md)` (18px)
- ❌ `background: rgba(8, 12, 22, 0.42)` instead of `var(--panel)` or `var(--surface)`
- ❌ `color: #fff` instead of `var(--text)`
- ❌ `padding: 20px` in new components without explaining why (usually should be `var(--space-5)` or `var(--space-6)`)
- ❌ `font-size: 16px` instead of using `var(--text-lg)` or `var(--text-base)`

## Responsive Design

The design system adapts for mobile via media queries.

### Mobile Breakpoints

- **`@media (max-width: 480px)`**: Small phones (applies to some grids)
- **`@media (max-width: 720px)`**: Mobile layout (program page)
- **`@media (max-width: 768px)`**: Tablet/larger mobile (most major adjustments)
- **`@media (min-width: 769px)`**: Tablet/desktop (base for sticky-bottom, nav)
- **`@media (min-width: 900px)`**: Larger displays (full-width grids)
- **`@media (max-width: 900px)`**: Responsive narrowing

### Responsive Spacing Pattern

Most spacing is mobile-first and static. Exceptions:
- Body padding: `28px` on desktop, `16px` on mobile (via media query)
- Panel layout: Single column on mobile, multi-column on desktop (via `grid-template-columns`)
- Font sizes use `clamp()` for gradual scaling (e.g., `clamp(22px, 3vw, 32px)` for `h1`)

### Accessibility

- All interactive elements have `:focus-visible` states (borders, shadows, color changes)
- Focus ring uses `box-shadow: 0 0 0 4px rgba(77, 131, 255, 0.12);` (subtle blue glow)
- Disabled buttons have `opacity: 0.5` and `cursor: not-allowed`
- Form fields show `:hover` state (border brightens)
- Screen reader text uses semantic HTML (`<label>`, `<button>`, form elements)
- Aria-labels can be added to stat cards and other non-semantic elements

## Animation & Motion

### Transitions

- Buttons: `transition: transform 0.06s ease, filter 0.15s ease, box-shadow 0.15s ease;`
- Form inputs: `transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;`
- General: Most UI elements use `0.15s ease` for state changes

### Keyframe Animations

- **`spin`**: Used for spinner animation (loading indicator). `animation: spin 0.8s linear infinite;`
- **`pulse`**: Used for loading button feedback. `animation: pulse 1s ease-in-out infinite;`

See `styles.css` for the full keyframe definitions.

## Safety Modes & Fallbacks

The design system includes fallback styling for accessibility and stability:

- **`.safe-render`**: Disables animations and compositing effects for performance/stability
- **`.judge-open-recording-safe`**: Disables all transforms and effects when recording video (prevents codec issues)
- **`.stability-mode`**: Disables heavy compositing in admin views on unstable systems

These modes override normal styles to prevent crashes. **Don't use these classes for styling design intent**; they're emergency fallbacks only.

## Maintenance Notes

### Drift Prevention

This document is the source of truth. When you:
- Add a new color, define it here and update `styles.css`
- Change a spacing value, update both files
- Add a component variant, document it here with examples

### Audit Checklist

Before committing new CSS:
- [ ] All colors use CSS vars (unless semantic status color)
- [ ] All spacing uses the space scale or is explained
- [ ] All border-radius uses the radius system
- [ ] All font sizes use `var(--text-*)` or are justified
- [ ] All new components follow the `.panel` or button patterns
- [ ] All interactive elements have `:hover`, `:focus-visible`, `:active` states
- [ ] Tested on mobile (`@media (max-width: 768px)`)

### Version History

Created: 2026-03-31 from extraction of `public/styles.css`.

---

**Next steps**: When building new features, reference this document to stay consistent. If you find yourself hardcoding a color or spacing value, check this guide first.
