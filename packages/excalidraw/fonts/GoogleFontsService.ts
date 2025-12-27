/**
 * Google Fonts Service - handles fetching, caching, and loading Google Fonts on-demand.
 */

import { googleFontsRegistry } from "@excalidraw/common";

// Types for Google Fonts API response
export interface GoogleFont {
    family: string;
    variants: string[];
    subsets: string[];
    category: "serif" | "sans-serif" | "display" | "handwriting" | "monospace";
    files: Record<string, string>;
}

interface GoogleFontsAPIResponse {
    items: GoogleFont[];
}

// Storage key for installed fonts
const INSTALLED_FONTS_KEY = "excalidraw-google-fonts-installed";

// Storage key for font list cache
const FONTS_CACHE_KEY = "excalidraw-google-fonts-cache";
const CURATED_FONTS_CSS_KEY = "excalidraw-google-fonts-curated-loaded";
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Number of fonts to show per category
const CURATED_FONTS_COUNT = 10;

// Poem excerpts for font preview
export const SAMPLE_POEMS = [
    "Two roads diverged in a wood, and I took the one less traveled by",
    "Hope is the thing with feathers that perches in the soul",
    "I wandered lonely as a cloud that floats on high",
    "Do not go gentle into that good night",
    "The woods are lovely, dark and deep",
    "To see a world in a grain of sand",
    "Shall I compare thee to a summer's day?",
    "I have measured out my life with coffee spoons",
];

// Offset for Google Font IDs to avoid collision with built-in fonts
export const GOOGLE_FONT_ID_OFFSET = 10000;

/**
 * Simple string hash function to generate consistent IDs from font names.
 * Uses djb2 algorithm for good distribution.
 */
function hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return Math.abs(hash);
}

export class GoogleFontsService {
    private static API_KEY = import.meta.env.VITE_GOOGLE_FONTS_API_KEY || "";
    private static cache: GoogleFont[] = [];
    private static loadedFonts = new Set<string>();
    private static fetchPromise: Promise<GoogleFont[]> | null = null;

    /**
     * Fetch all fonts from Google Fonts API.
     * Results are cached to avoid repeated API calls.
     */
    static async fetchFonts(): Promise<GoogleFont[]> {
        // Return cached fonts if available
        if (this.cache.length > 0) {
            return this.cache;
        }

        // Return existing promise if fetch is in progress
        if (this.fetchPromise) {
            return this.fetchPromise;
        }

        // Start new fetch
        this.fetchPromise = this.doFetchFonts();

        try {
            this.cache = await this.fetchPromise;
            return this.cache;
        } finally {
            this.fetchPromise = null;
        }
    }

    // Filter out icon fonts (Material Icons, Material Symbols, etc.)
    private static filterIconFonts(fonts: GoogleFont[]): GoogleFont[] {
        const ICON_FONT_KEYWORDS = ["icons", "symbols", "emoji"];
        return fonts.filter((font) => {
            const lowerName = font.family.toLowerCase();
            return !ICON_FONT_KEYWORDS.some((keyword) => lowerName.includes(keyword));
        });
    }

    private static async doFetchFonts(): Promise<GoogleFont[]> {
        // Try to load from localStorage cache first
        try {
            const cached = localStorage.getItem(FONTS_CACHE_KEY);
            if (cached) {
                const { fonts, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_EXPIRY_MS) {
                    // Apply icon font filter to cached data
                    return this.filterIconFonts(fonts);
                }
            }
        } catch (e) {
            // Ignore cache errors
        }

        if (!this.API_KEY) {
            console.warn(
                "Google Fonts API key not configured. Set VITE_GOOGLE_FONTS_API_KEY environment variable.",
            );
            return [];
        }

        try {
            const response = await fetch(
                `https://www.googleapis.com/webfonts/v1/webfonts?key=${this.API_KEY}&sort=popularity`,
            );

            if (!response.ok) {
                throw new Error(`Google Fonts API error: ${response.status}`);
            }

            const data: GoogleFontsAPIResponse = await response.json();
            const fonts = this.filterIconFonts(data.items || []);

            // Cache to localStorage
            try {
                localStorage.setItem(FONTS_CACHE_KEY, JSON.stringify({
                    fonts,
                    timestamp: Date.now(),
                }));
            } catch (e) {
                // Ignore cache save errors (quota exceeded, etc.)
            }

            return fonts;
        } catch (error) {
            console.error("Failed to fetch Google Fonts:", error);
            return [];
        }
    }

    /**
     * Load a font on-demand by injecting a Google Fonts CSS link.
     */
    static async loadFont(family: string): Promise<void> {
        // Skip if already loaded
        if (this.loadedFonts.has(family)) {
            return;
        }

        // Create and inject the font link
        const link = document.createElement("link");
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}&display=swap`;
        link.rel = "stylesheet";
        document.head.appendChild(link);

        // Wait for font to be ready
        try {
            await document.fonts.load(`16px "${family}"`);
            this.loadedFonts.add(family);

            // Register the font in the global registry so getFontFamilyString can find it
            const fontId = this.getFontId(family);
            googleFontsRegistry.set(fontId, family);
        } catch (error) {
            console.error(`Failed to load font "${family}":`, error);
            throw error;
        }
    }

    /**
     * Check if a font is already loaded.
     */
    static isFontLoaded(family: string): boolean {
        return this.loadedFonts.has(family);
    }

    /**
     * Generate a consistent ID from font family name.
     * IDs start at GOOGLE_FONT_ID_OFFSET to avoid collision with built-in fonts.
     */
    static getFontId(family: string): number {
        return GOOGLE_FONT_ID_OFFSET + (hashString(family) % 1000000);
    }

    /**
     * Get font family name from ID.
     * Returns null if not a valid Google Font ID or font not found.
     */
    static getFontFamilyFromId(
        fontId: number,
        installedFonts: string[],
    ): string | null {
        if (fontId < GOOGLE_FONT_ID_OFFSET) {
            return null; // Not a Google Font ID
        }

        // Search installed fonts for matching ID
        for (const family of installedFonts) {
            if (this.getFontId(family) === fontId) {
                return family;
            }
        }

        return null;
    }

    /**
     * Check if a font ID is a Google Font.
     */
    static isGoogleFontId(fontId: number): boolean {
        return fontId >= GOOGLE_FONT_ID_OFFSET;
    }

    /**
     * Get installed Google Fonts from localStorage.
     */
    static getInstalledFonts(): string[] {
        try {
            const stored = localStorage.getItem(INSTALLED_FONTS_KEY);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.error("Failed to read installed fonts:", error);
        }
        return [];
    }

    /**
     * Save a font to the installed fonts list.
     */
    static saveInstalledFont(family: string): void {
        try {
            const installed = this.getInstalledFonts();
            if (!installed.includes(family)) {
                installed.push(family);
                localStorage.setItem(INSTALLED_FONTS_KEY, JSON.stringify(installed));
            }
        } catch (error) {
            console.error("Failed to save installed font:", error);
        }
    }

    /**
     * Remove a font from the installed fonts list.
     */
    static removeInstalledFont(family: string): void {
        try {
            const installed = this.getInstalledFonts();
            const index = installed.indexOf(family);
            if (index > -1) {
                installed.splice(index, 1);
                localStorage.setItem(INSTALLED_FONTS_KEY, JSON.stringify(installed));
            }
        } catch (error) {
            console.error("Failed to remove installed font:", error);
        }
    }

    /**
     * Load all installed fonts.
     * Call this on app initialization.
     */
    static async loadInstalledFonts(): Promise<void> {
        const installed = this.getInstalledFonts();
        await Promise.all(
            installed.map((family) =>
                this.loadFont(family).catch((err) =>
                    console.warn(`Failed to load installed font "${family}":`, err),
                ),
            ),
        );
    }

    /**
     * Load missing Google Fonts for given font IDs.
     * Used when loading a diagram that uses Google Fonts.
     */
    static async loadMissingFonts(fontIds: number[]): Promise<void> {
        const installed = this.getInstalledFonts();
        const googleFontIds = fontIds.filter((id) => this.isGoogleFontId(id));

        for (const fontId of googleFontIds) {
            const family = this.getFontFamilyFromId(fontId, installed);
            if (family && !this.isFontLoaded(family)) {
                await this.loadFont(family);
            }
        }
    }

    /**
     * Get curated fonts for a category (top 20 fonts).
     * Returns fonts sorted by popularity (API returns them in popularity order).
     */
    static getCuratedFonts(
        category: "all" | "serif" | "sans-serif" | "display" | "handwriting" | "monospace",
    ): GoogleFont[] {
        const allFonts = this.cache;
        if (category === "all") {
            return allFonts.slice(0, CURATED_FONTS_COUNT);
        }
        return allFonts
            .filter((font) => font.category === category)
            .slice(0, CURATED_FONTS_COUNT);
    }

    /**
     * Search fonts by name (for autocomplete dropdown).
     */
    static searchFonts(query: string, limit = 10): GoogleFont[] {
        if (!query.trim()) return [];
        const lowerQuery = query.toLowerCase();
        return this.cache
            .filter((font) => font.family.toLowerCase().includes(lowerQuery))
            .slice(0, limit);
    }

    /**
     * Force refresh the font cache from API.
     */
    static async refreshCache(): Promise<GoogleFont[]> {
        // Clear localStorage cache
        try {
            localStorage.removeItem(FONTS_CACHE_KEY);
            localStorage.removeItem(CURATED_FONTS_CSS_KEY);
        } catch (e) {
            // Ignore
        }
        // Clear memory cache
        this.cache = [];
        // Fetch fresh data
        return this.fetchFonts();
    }

    /**
     * Load CSS for curated fonts (pre-load for instant preview).
     * Call this on first dialog open.
     */
    static async loadCuratedFontCSS(): Promise<void> {
        // Check if already loaded this session
        try {
            if (sessionStorage.getItem(CURATED_FONTS_CSS_KEY)) {
                return;
            }
        } catch (e) {
            // Ignore
        }

        const fonts = await this.fetchFonts();
        const curatedFonts = fonts.slice(0, CURATED_FONTS_COUNT);

        if (curatedFonts.length === 0) return;

        // Inject CSS link for curated fonts
        const fontFamilies = curatedFonts
            .map((f) => f.family.replace(/ /g, "+"))
            .join("&family=");

        const link = document.createElement("link");
        link.id = "google-fonts-curated";
        link.rel = "stylesheet";
        link.href = `https://fonts.googleapis.com/css2?family=${fontFamilies}&display=swap`;
        document.head.appendChild(link);

        // Mark as loaded for this session
        try {
            sessionStorage.setItem(CURATED_FONTS_CSS_KEY, "true");
        } catch (e) {
            // Ignore
        }
    }

    /**
     * Get a random poem excerpt for font preview.
     */
    static getRandomSampleText(): string {
        return SAMPLE_POEMS[Math.floor(Math.random() * SAMPLE_POEMS.length)];
    }
}
