# Changelog

All notable changes to VOYGE.studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-06

### Added

#### Intelligence Engine
- Link & Omni-Search: paste Reel/TikTok links or search for locations directly with real-time Mapbox Searchbox suggestions.
- AI Enhancement: automatic generation of descriptions, category classifications, and vibes for every spot using GPT-4o.
- Visual Engine: Pexels API integration for automatic high-quality hero images on every saved location.

#### Mobile-First "Roamy" Experience
- High-fidelity Framer Motion-powered interactive Bottom Sheet mimicking native iOS gestures.
- Category Chips for instant filtering by Attractions, Museums, Food, and more.
- Deep Grouping: spots organized by Country > City/Region with dynamic emoji flags.

#### Mathematical Mapping
- Master Map: unified dark-mode globe view of every saved spot.
- Route Optimization powered by the Mapbox Optimization Engine to eliminate travel zig-zagging.
- Smooth Fly-To animations and glowing pathing systems.

#### Desktop Parity
- Bottom sheet logic translated into a refined Drawer layout for desktop users.

#### Ecosystem Integrations
- Telegram Bot (@Voygevercelbot): forward Reels directly to your bot and teleport them to your map.
- iOS Shortcut support for one-tap syncing from the Apple Share Sheet.

#### Infrastructure
- Next.js App Router with Vercel Serverless Functions.
- Firebase Firestore & Firebase Auth for database and authentication.
- Mapbox GL JS v3 with Searchbox API and Optimization API.
- GitHub Models (GPT-4o) for AI intelligence.
- Supabase integration.
