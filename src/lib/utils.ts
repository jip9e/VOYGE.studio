/**
 * @fileoverview Utility Helpers
 *
 * Shared utility functions used across the VOYGE application.
 *
 * ## `cn(...inputs)`
 *
 * Merges Tailwind CSS class names intelligently by combining two libraries:
 *
 * - **[clsx](https://github.com/lukeed/clsx)** — Conditionally joins class
 *   name strings. Accepts strings, arrays, objects (where keys are class
 *   names and values are booleans), and falsy values (which are ignored).
 *
 * - **[tailwind-merge](https://github.com/dcastil/tailwind-merge)** — Resolves
 *   Tailwind CSS class conflicts by keeping only the last class when two
 *   utilities target the same CSS property. For example, `cn("p-4", "p-2")`
 *   correctly resolves to `"p-2"` rather than the broken `"p-4 p-2"`.
 *
 * ### Usage
 *
 * ```ts
 * // Conditional classes
 * cn("base-class", isActive && "active", hasError ? "error" : "ok")
 * // → "base-class active ok"  (when isActive=true, hasError=false)
 *
 * // Conflict resolution
 * cn("px-4 py-2", "px-6")
 * // → "py-2 px-6"  (px-4 is overridden by px-6)
 *
 * // Object syntax
 * cn({ "font-bold": isBold, "text-sm": isSmall })
 * ```
 *
 * @module utils
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind CSS class names, resolving conflicts via `tailwind-merge`
 * and handling conditional logic via `clsx`.
 *
 * @param inputs - Any number of class values: strings, arrays, objects, or
 *   falsy values. Falsy values (`false`, `null`, `undefined`, `0`, `""`) are
 *   safely ignored.
 * @returns A single merged class name string with Tailwind conflicts resolved.
 *
 * @example
 * cn("p-4 text-white", isActive && "bg-blue-500", "p-2")
 * // → "text-white bg-blue-500 p-2"  (p-4 overridden by p-2)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
