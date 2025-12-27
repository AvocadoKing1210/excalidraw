import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { debounce } from "@excalidraw/common";

import type { FontFamilyValues } from "@excalidraw/element/types";

import {
    GoogleFontsService,
    type GoogleFont,
} from "../../fonts/GoogleFontsService";
import { Dialog } from "../Dialog";
import Spinner from "../Spinner";

import "./GoogleFontsBrowser.scss";

interface GoogleFontsBrowserProps {
    onClose: () => void;
    onFontSelect: (fontFamily: FontFamilyValues) => void;
}

type FontCategory =
    | "all"
    | "serif"
    | "sans-serif"
    | "display"
    | "handwriting"
    | "monospace";

const CATEGORIES: { value: FontCategory; label: string }[] = [
    { value: "all", label: "All" },
    { value: "sans-serif", label: "Sans Serif" },
    { value: "serif", label: "Serif" },
    { value: "display", label: "Display" },
    { value: "handwriting", label: "Handwriting" },
    { value: "monospace", label: "Monospace" },
];

export const GoogleFontsBrowser = React.memo(
    ({ onClose, onFontSelect }: GoogleFontsBrowserProps) => {
        const [loading, setLoading] = useState(true);
        const [refreshing, setRefreshing] = useState(false);
        const [error, setError] = useState<string | null>(null);
        const [searchQuery, setSearchQuery] = useState("");
        const [searchResults, setSearchResults] = useState<GoogleFont[]>([]);
        const [showDropdown, setShowDropdown] = useState(false);
        const [selectedCategory, setSelectedCategory] = useState<FontCategory>("all");
        const [sampleText, setSampleText] = useState(() => GoogleFontsService.getRandomSampleText());
        const [installingFont, setInstallingFont] = useState<string | null>(null);
        const [loadingSearchFont, setLoadingSearchFont] = useState<string | null>(null);
        const [installedFonts, setInstalledFonts] = useState<Set<string>>(
            () => new Set(GoogleFontsService.getInstalledFonts()),
        );
        const [curatedFonts, setCuratedFonts] = useState<GoogleFont[]>([]);
        const searchInputRef = useRef<HTMLInputElement>(null);

        // Fetch fonts and load curated CSS on mount
        useEffect(() => {
            const init = async () => {
                setLoading(true);
                setError(null);
                try {
                    await GoogleFontsService.fetchFonts();
                    await GoogleFontsService.loadCuratedFontCSS();
                    setCuratedFonts(GoogleFontsService.getCuratedFonts(selectedCategory));
                } catch (err) {
                    setError("Failed to load fonts. Please try again.");
                } finally {
                    setLoading(false);
                }
            };
            init();
        }, []);

        // Update curated fonts when category changes and load their CSS
        useEffect(() => {
            if (!loading) {
                const fonts = GoogleFontsService.getCuratedFonts(selectedCategory);
                setCuratedFonts(fonts);

                // Load CSS for these specific fonts
                if (fonts.length > 0) {
                    const fontFamilies = fonts
                        .map((f) => f.family.replace(/ /g, "+"))
                        .join("&family=");

                    const linkId = "google-fonts-category-preview";
                    let link = document.getElementById(linkId) as HTMLLinkElement | null;

                    if (!link) {
                        link = document.createElement("link");
                        link.id = linkId;
                        link.rel = "stylesheet";
                        document.head.appendChild(link);
                    }

                    link.href = `https://fonts.googleapis.com/css2?family=${fontFamilies}&display=swap`;
                }
            }
        }, [selectedCategory, loading]);

        // Debounced search handler
        const handleSearch = useMemo(
            () =>
                debounce((query: string) => {
                    if (query.trim()) {
                        const results = GoogleFontsService.searchFonts(query, 8);
                        setSearchResults(results);
                        setShowDropdown(results.length > 0);
                    } else {
                        setSearchResults([]);
                        setShowDropdown(false);
                    }
                }, 200),
            [],
        );

        const onSearchChange = useCallback(
            (value: string) => {
                setSearchQuery(value);
                handleSearch(value);
            },
            [handleSearch],
        );

        // Handle refresh cache
        const handleRefresh = useCallback(async () => {
            setRefreshing(true);
            try {
                await GoogleFontsService.refreshCache();
                await GoogleFontsService.loadCuratedFontCSS();
                setCuratedFonts(GoogleFontsService.getCuratedFonts(selectedCategory));
            } catch (err) {
                console.error("Failed to refresh fonts:", err);
            } finally {
                setRefreshing(false);
            }
        }, [selectedCategory]);

        // Handle selecting font from search dropdown (loads the font first)
        const handleSearchSelect = useCallback(async (font: GoogleFont) => {
            setShowDropdown(false);
            setSearchQuery("");
            setLoadingSearchFont(font.family);

            try {
                // Load the font CSS for preview
                const link = document.createElement("link");
                link.rel = "stylesheet";
                link.href = `https://fonts.googleapis.com/css2?family=${font.family.replace(/ /g, "+")}&display=swap`;
                document.head.appendChild(link);

                // Wait a bit for font to load
                await new Promise(resolve => setTimeout(resolve, 500));

                // Add to curated fonts temporarily for preview
                setCuratedFonts(prev => {
                    if (prev.find(f => f.family === font.family)) return prev;
                    return [font, ...prev];
                });
            } finally {
                setLoadingSearchFont(null);
            }
        }, []);

        // Handle font installation
        const handleInstallFont = useCallback(
            async (font: GoogleFont) => {
                setInstallingFont(font.family);
                try {
                    await GoogleFontsService.loadFont(font.family);
                    GoogleFontsService.saveInstalledFont(font.family);
                    setInstalledFonts((prev) => new Set([...prev, font.family]));

                    const fontId = GoogleFontsService.getFontId(font.family);
                    onFontSelect(fontId);
                    onClose();
                } catch (err) {
                    console.error(`Failed to install font "${font.family}":`, err);
                } finally {
                    setInstallingFont(null);
                }
            },
            [onFontSelect, onClose],
        );

        // Handle selecting already installed font
        const handleSelectFont = useCallback(
            (font: GoogleFont) => {
                const fontId = GoogleFontsService.getFontId(font.family);
                onFontSelect(fontId);
                onClose();
            },
            [onFontSelect, onClose],
        );

        return (
            <Dialog
                onCloseRequest={onClose}
                title={
                    <div className="GoogleFontsBrowser__titleRow">
                        <span>Browse Google Fonts</span>
                        <div className="GoogleFontsBrowser__titleActions">
                            <button
                                type="button"
                                className="GoogleFontsBrowser__refreshBtn"
                                onClick={handleRefresh}
                                disabled={refreshing}
                                title="Refresh font list"
                            >
                                {refreshing ? <Spinner size="1em" /> : (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M23 4v6h-6M1 20v-6h6" />
                                        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                                    </svg>
                                )}
                            </button>
                            <a
                                href="https://fonts.google.com"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="GoogleFontsBrowser__externalBtn"
                                title="Browse more fonts on Google Fonts"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                                </svg>
                            </a>
                        </div>
                    </div>
                }
                size="wide"
                className="GoogleFontsBrowser"
            >
                <div className="GoogleFontsBrowser__header">
                    <div className="GoogleFontsBrowser__searchWrapper">
                        <input
                            ref={searchInputRef}
                            type="text"
                            className="GoogleFontsBrowser__searchInput"
                            placeholder="Search fonts..."
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                            onFocus={() => searchQuery && setShowDropdown(searchResults.length > 0)}
                        />
                        {loadingSearchFont && (
                            <div className="GoogleFontsBrowser__searchLoading">
                                <Spinner size="1em" />
                            </div>
                        )}
                        {showDropdown && (
                            <div className="GoogleFontsBrowser__dropdown">
                                {searchResults.map((font) => (
                                    <button
                                        key={font.family}
                                        type="button"
                                        className="GoogleFontsBrowser__dropdownItem"
                                        onClick={() => handleSearchSelect(font)}
                                    >
                                        <span>{font.family}</span>
                                        <span className="GoogleFontsBrowser__dropdownCategory">
                                            {font.category}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>



                <div className="GoogleFontsBrowser__categories">
                    {CATEGORIES.map((category) => (
                        <button
                            key={category.value}
                            type="button"
                            className={`GoogleFontsBrowser__category ${selectedCategory === category.value
                                ? "GoogleFontsBrowser__category--active"
                                : ""
                                }`}
                            onClick={() => setSelectedCategory(category.value)}
                        >
                            {category.label}
                        </button>
                    ))}
                </div>

                <div className="GoogleFontsBrowser__content">
                    {loading && (
                        <div className="GoogleFontsBrowser__loading">
                            <Spinner />
                            <span>Loading fonts...</span>
                        </div>
                    )}

                    {error && <div className="GoogleFontsBrowser__error">{error}</div>}

                    {!loading && !error && (
                        <div className="GoogleFontsBrowser__list">
                            {curatedFonts.map((font) => {
                                const isInstalled = installedFonts.has(font.family);
                                const isInstalling = installingFont === font.family;

                                return (
                                    <div
                                        key={font.family}
                                        className={`GoogleFontsBrowser__fontRow ${isInstalled ? "GoogleFontsBrowser__fontRow--installed" : ""
                                            }`}
                                    >
                                        <div className="GoogleFontsBrowser__fontHeader">
                                            <span className="GoogleFontsBrowser__fontName">
                                                {font.family}
                                            </span>
                                            <span className="GoogleFontsBrowser__fontMeta">
                                                {font.category}
                                            </span>
                                        </div>
                                        <div
                                            className="GoogleFontsBrowser__fontPreview"
                                            style={{
                                                fontFamily: `"${font.family}", sans-serif`,
                                            }}
                                        >
                                            {sampleText || font.family}
                                        </div>
                                        <button
                                            type="button"
                                            className="GoogleFontsBrowser__downloadBtn"
                                            onClick={() =>
                                                isInstalled
                                                    ? handleSelectFont(font)
                                                    : handleInstallFont(font)
                                            }
                                            disabled={isInstalling}
                                            title={isInstalled ? "Use this font" : "Install font"}
                                        >
                                            {isInstalling ? (
                                                <Spinner size="1.25em" />
                                            ) : isInstalled ? (
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                                                </svg>
                                            ) : (
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {!loading && !error && curatedFonts.length === 0 && (
                        <div className="GoogleFontsBrowser__empty">
                            No fonts available for this category.
                        </div>
                    )}
                </div>
            </Dialog>
        );
    },
);
