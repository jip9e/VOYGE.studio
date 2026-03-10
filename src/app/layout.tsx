/**
 * @fileoverview Root Layout — Next.js App Shell
 *
 * Defines the top-level HTML document structure shared by every page in the
 * VOYGE application. This is the outermost layout in the Next.js App Router
 * hierarchy and is rendered on every route without remounting.
 *
 * ## Fonts
 *
 * Two [Geist](https://vercel.com/font) font variants are loaded via
 * `next/font/google` and injected as CSS custom properties:
 *
 * | Variable              | Font Family  | Usage                         |
 * |-----------------------|--------------|-------------------------------|
 * | `--font-geist-sans`   | Geist Sans   | Primary UI text, headings      |
 * | `--font-geist-mono`   | Geist Mono   | Code snippets, monospace text  |
 *
 * Both are subset to `latin` characters only to minimise font bundle size.
 * The variables are applied to `<body>` via Tailwind's `antialiased` utility
 * alongside the font variable class names.
 *
 * ## Metadata
 *
 * Static metadata exported for Next.js to inject into `<head>`:
 *
 * | Field         | Value                                              |
 * |---------------|----------------------------------------------------|
 * | `title`       | `"VOYGE | Next-Gen Travel"`                        |
 * | `description` | `"Your social media saves, mathematically perfected."` |
 *
 * ## Viewport Settings
 *
 * The `viewport` metadata field sets:
 * ```
 * width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0
 * ```
 * Pinch-to-zoom is intentionally disabled (`maximum-scale=1,
 * user-scalable=0`) to prevent accidental zoom on the map canvas and
 * bottom sheet gestures on mobile devices.
 *
 * ## Structure
 *
 * ```html
 * <html lang="en">
 *   <body class="[geist-sans] [geist-mono] antialiased">
 *     {children}   ← page.tsx or nested layout.tsx content
 *   </body>
 * </html>
 * ```
 *
 * @module app/layout
 */
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VOYGE | Next-Gen Travel",
  description: "Your social media saves, mathematically perfected.",
  viewport:
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
