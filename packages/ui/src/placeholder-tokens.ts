// Placeholder design tokens until the design system lands. Plain values so any app can use them
// in inline styles or CSS without a build step.
export const tokens = {
  color: {
    text: "#1a1a2e",
    muted: "#5c5c70",
    background: "#ffffff",
    accent: "#1d4ed8",
  },
  font: {
    body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  space: {
    sm: "0.5rem",
    md: "1rem",
    lg: "2rem",
  },
} as const;

export type Tokens = typeof tokens;
