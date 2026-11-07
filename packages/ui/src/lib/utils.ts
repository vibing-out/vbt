import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the token names, so `text-display` (a size) and `text-ink` (a color) don't
// cancel each other out, and custom radius and shadow names merge correctly.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "title", "body-lg", "label", "heading", "body", "small", "code-lg", "code"],
      radius: ["pill"],
      shadow: ["card", "overlay"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
