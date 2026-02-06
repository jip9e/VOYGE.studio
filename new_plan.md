# Voyge UI Overhaul: The Roamy Evolution

## Goal:
Transform the Voyge dashboard from a static sidebar layout into a high-fidelity, mobile-first travel companion inspired by Roamy.

## Phases

### 1. The Mobile Architecture (Bottom Sheet) ✅
- **Task 1.1:** Implement a Framer Motion-powered interactive Bottom Sheet for mobile devices. ✅
- **Task 1.2:** Create the "Category Chips" header (All, Museum, Attractions, etc.) at the top of the sheet. ✅
- **Task 1.3:** Move the search bar into the bottom sheet's resting state. ✅

### 2. Deep Nested Grouping ✅
- **Task 2.1:** Update logic to group `TravelSpot` data by **Country > City/Region**. ✅
- **Task 2.2:** Build collapsible "City Headers" with spot counts (e.g., "Rome (14)"). ✅

### 3. Visual Content Engine (The "Image" API) ✅
- **Task 3.1:** Integrate the **Pexels API** to fetch high-quality travel images for spots. ✅
- **Task 3.2:** Update `TravelSpot` schema to include a `description` snippet. ✅
- **Task 3.3:** Redesign list items: image on the right, icon on the left, snippet below the name. ✅

### 4. Floating Interaction Menu ✅
- **Task 4.1:** Implement a persistent bottom navigation bar. ✅
- **Task 4.2:** Create the centered Floating Action Button (+) with a popover menu: ✅
    - **"Create New Trip"** ✅
    - **"Add Spots"** (Triggers analyzer) ✅

### 5. Desktop Parity ✅
- **Task 5.1:** Translate the bottom sheet logic into a refined "Drawer" for desktop users to keep the UX consistent. ✅

### 6. Search & Intelligence Expansion ✅
- **Task 6.1:** Implement "Omni-Search" in the search bar (handles both URLs and plain-text location names). ✅
- **Task 6.2:** Integrate a Place Search API (Mapbox Searchbox) to provide real-time suggestions as the user types. ✅
- **Task 6.3:** Build an AI "Enhancer" flow: when a spot is picked from search, the AI generates the description, category, and vibe automatically. ✅
- **Task 6.4:** Add dynamic country flags to the grouping headers using emoji mapping. ✅
