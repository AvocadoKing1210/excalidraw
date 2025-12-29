import { createStore, get, set, del, entries, keys } from "idb-keyval";
import { nanoid } from "nanoid";

import { STORAGE_KEYS } from "../app_constants";

import type { Canvas, CanvasData } from "./canvasTypes";
import { DEFAULT_CANVAS_ID, createCanvasMetadata } from "./canvasTypes";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFileData } from "@excalidraw/excalidraw/types";

// IndexedDB stores for canvas management
const canvasMetaStore = createStore(
    `${STORAGE_KEYS.IDB_CANVASES}-db`,
    `${STORAGE_KEYS.IDB_CANVASES}-store`,
);

const canvasDataStore = createStore(
    `${STORAGE_KEYS.IDB_CANVAS_DATA}-db`,
    `${STORAGE_KEYS.IDB_CANVAS_DATA}-store`,
);

const collectionStore = createStore(
    `${STORAGE_KEYS.IDB_CANVASES}-collections-db`,
    `collections-store`,
);

export interface Collection {
    id: string;
    name: string;
    createdAt: number;
}

/**
 * CanvasManager - handles CRUD operations for multiple canvases
 * Stores canvas metadata and data in IndexedDB
 */
export class CanvasManager {
    /**
     * Get the currently active canvas ID from localStorage
     */
    static getActiveCanvasId(): string {
        return (
            localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACTIVE_CANVAS) ||
            DEFAULT_CANVAS_ID
        );
    }

    /**
     * Set the active canvas ID in localStorage
     */
    static setActiveCanvasId(id: string): void {
        localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_ACTIVE_CANVAS, id);
    }

    /**
     * List all canvases (metadata only)
     */
    static async listCanvases(): Promise<Canvas[]> {
        try {
            const allEntries = await entries<string, Canvas>(canvasMetaStore);
            return allEntries
                .map(([_, canvas]) => canvas)
                .sort((a, b) => b.updatedAt - a.updatedAt);
        } catch (error) {
            console.error("Error listing canvases:", error);
            return [];
        }
    }

    /**
     * Get canvas metadata by ID
     */
    static async getCanvasMeta(id: string): Promise<Canvas | null> {
        try {
            return (await get<Canvas>(id, canvasMetaStore)) || null;
        } catch (error) {
            console.error("Error getting canvas meta:", error);
            return null;
        }
    }

    /**
     * Get full canvas data by ID
     */
    static async getCanvasData(id: string): Promise<CanvasData | null> {
        try {
            return (await get<CanvasData>(id, canvasDataStore)) || null;
        } catch (error) {
            console.error("Error getting canvas data:", error);
            return null;
        }
    }

    /**
     * Check if a canvas name already exists (case-insensitive)
     */
    static async checkNameExists(name: string): Promise<boolean> {
        const canvases = await this.listCanvases();
        return canvases.some(
            (c) => !c.isDeleted && c.name.toLowerCase() === name.toLowerCase(),
        );
    }

    /**
     * Create a new canvas
     */
    static async createCanvas(name: string = "Untitled"): Promise<Canvas> {
        if (await this.checkNameExists(name)) {
            throw new Error(`A canvas with the name "${name}" already exists.`);
        }

        const id = nanoid();
        const canvas = createCanvasMetadata(id, name);

        await set(id, canvas, canvasMetaStore);

        // Initialize with empty data
        const canvasData: CanvasData = {
            ...canvas,
            elements: [],
            appState: {},
            files: {},
        };
        await set(id, canvasData, canvasDataStore);

        return canvas;
    }

    /**
     * Save canvas data
     */
    static async saveCanvas(
        id: string,
        elements: readonly ExcalidrawElement[],
        appState: Partial<AppState>,
        files: Record<string, BinaryFileData>,
    ): Promise<void> {
        try {
            // Update metadata
            const meta = await this.getCanvasMeta(id);
            if (meta) {
                meta.updatedAt = Date.now();
                await set(id, meta, canvasMetaStore);
            }

            // Save data
            const canvasData: CanvasData = {
                id,
                name: meta?.name || "Untitled",
                createdAt: meta?.createdAt || Date.now(),
                updatedAt: Date.now(),
                elements,
                appState,
                files,
            };
            await set(id, canvasData, canvasDataStore);
        } catch (error) {
            console.error("Error saving canvas:", error);
            throw error;
        }
    }

    /**
     * Rename a canvas
     */
    static async renameCanvas(id: string, name: string): Promise<void> {
        const meta = await this.getCanvasMeta(id);
        if (meta) {
            meta.name = name;
            meta.updatedAt = Date.now();
            await set(id, meta, canvasMetaStore);
        }
    }

    /**
     * Move a canvas to trash (Soft Delete)
     */
    static async moveToTrash(id: string): Promise<void> {
        const meta = await this.getCanvasMeta(id);
        if (meta) {
            meta.isDeleted = true;
            meta.deletedAt = Date.now();
            meta.updatedAt = Date.now();
            await set(id, meta, canvasMetaStore);
        }

        // If active canvas is moved to trash, switch to another
        if (this.getActiveCanvasId() === id) {
            await this.switchToAvailableCanvas(id);
        }
    }

    /**
     * Get a unique name for a canvas (appends number if needed)
     */
    static async getUniqueName(baseName: string): Promise<string> {
        let name = baseName;
        let counter = 1;

        while (await this.checkNameExists(name)) {
            name = `${baseName} (${counter})`;
            counter++;
        }

        return name;
    }

    /**
     * Restore a canvas from trash
     */
    static async restoreCanvas(id: string): Promise<void> {
        const meta = await this.getCanvasMeta(id);
        if (meta) {
            // Check for name collision and resolve
            const newName = await this.getUniqueName(meta.name);
            if (newName !== meta.name) {
                meta.name = newName;
            }

            meta.isDeleted = false;
            meta.deletedAt = undefined;
            meta.updatedAt = Date.now();
            await set(id, meta, canvasMetaStore);
        }
    }

    /**
     * Delete a canvas permanently (Hard Delete)
     */
    static async deleteCanvas(id: string): Promise<void> {
        await del(id, canvasMetaStore);
        await del(id, canvasDataStore);

        // If deleted canvas was active (shouldn't usually happen if it was in trash, but safe to check)
        if (this.getActiveCanvasId() === id) {
            await this.switchToAvailableCanvas(id);
        }
    }

    /**
     * Helper to switch to an available canvas (ignoring trash if possible)
     */
    private static async switchToAvailableCanvas(excludeId: string): Promise<void> {
        const all = await this.listCanvases();
        // Prefer non-deleted canvases
        const available = all.filter(c => c.id !== excludeId && !c.isDeleted);

        if (available.length > 0) {
            this.setActiveCanvasId(available[0].id);
        } else {
            // If all are deleted or none exist, try any canvas
            const any = all.filter(c => c.id !== excludeId);
            if (any.length > 0) {
                this.setActiveCanvasId(any[0].id);
            } else {
                // Create a new default canvas
                const newCanvas = await this.createCanvas("Default");
                this.setActiveCanvasId(newCanvas.id);
            }
        }
    }

    /**
     * Empty the trash (delete all soft-deleted canvases)
     */
    static async emptyTrash(): Promise<void> {
        const all = await this.listCanvases();
        const trash = all.filter(c => c.isDeleted);

        for (const canvas of trash) {
            await this.deleteCanvas(canvas.id);
        }
    }

    /**
     * Duplicate a canvas
     */
    static async duplicateCanvas(id: string): Promise<Canvas | null> {
        const original = await this.getCanvasData(id);
        if (!original) {
            return null;
        }

        const newId = nanoid();
        const newCanvas = createCanvasMetadata(newId, `${original.name} (Copy)`);

        await set(newId, newCanvas, canvasMetaStore);

        const newData: CanvasData = {
            ...original,
            id: newId,
            name: newCanvas.name,
            createdAt: newCanvas.createdAt,
            updatedAt: newCanvas.updatedAt,
        };
        await set(newId, newData, canvasDataStore);

        return newCanvas;
    }

    /**
     * Check if any canvases exist
     */
    static async hasCanvases(): Promise<boolean> {
        const allKeys = await keys(canvasMetaStore);
        return allKeys.length > 0;
    }

    /**
     * Initialize with default canvas if none exist
     * Also handles migration from legacy localStorage
     */
    static async initialize(): Promise<string> {
        const hasAny = await this.hasCanvases();

        if (!hasAny) {
            // Check for legacy localStorage data
            const legacyElements = localStorage.getItem(
                STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
            );
            const legacyAppState = localStorage.getItem(
                STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
            );

            const canvas = createCanvasMetadata(DEFAULT_CANVAS_ID, "Default");
            await set(DEFAULT_CANVAS_ID, canvas, canvasMetaStore);

            const canvasData: CanvasData = {
                ...canvas,
                elements: legacyElements ? JSON.parse(legacyElements) : [],
                appState: legacyAppState ? JSON.parse(legacyAppState) : {},
                files: {},
            };
            await set(DEFAULT_CANVAS_ID, canvasData, canvasDataStore);

            this.setActiveCanvasId(DEFAULT_CANVAS_ID);
            return DEFAULT_CANVAS_ID;
        }

        // Return active canvas ID or first canvas
        const activeId = this.getActiveCanvasId();
        const activeMeta = await this.getCanvasMeta(activeId);
        if (activeMeta) {
            return activeId;
        }

        // Active canvas doesn't exist, use first available
        const canvases = await this.listCanvases();
        if (canvases.length > 0) {
            this.setActiveCanvasId(canvases[0].id);
            return canvases[0].id;
        }

        // Shouldn't happen, but create default as fallback
        const canvas = await this.createCanvas("Default");
        this.setActiveCanvasId(canvas.id);
        return canvas.id;
    }

    static async updateThumbnail(id: string, thumbnail: string): Promise<void> {
        const meta = await this.getCanvasMeta(id);
        if (meta) {
            meta.thumbnail = thumbnail;
            await set(id, meta, canvasMetaStore);
        }
    }

    /**
     * List all collections
     */
    static async listCollections(): Promise<Collection[]> {
        try {
            const allEntries = await entries<string, Collection>(collectionStore);
            return allEntries
                .map(([_, collection]) => collection)
                .sort((a, b) => b.createdAt - a.createdAt);
        } catch (error) {
            console.error("Error listing collections:", error);
            return [];
        }
    }

    /**
     * Create a new collection
     */
    static async createCollection(name: string): Promise<Collection> {
        const id = nanoid();
        const collection: Collection = {
            id,
            name,
            createdAt: Date.now(),
        };
        await set(id, collection, collectionStore);
        return collection;
    }

    /**
     * Delete a collection
     */
    static async deleteCollection(id: string): Promise<void> {
        await del(id, collectionStore);
        // Remove collectionId from canvases in this collection
        const canvases = await this.listCanvases();
        const inCollection = canvases.filter(c => c.collectionId === id);
        for (const canvas of inCollection) {
            canvas.collectionId = undefined;
            await set(canvas.id, canvas, canvasMetaStore);
        }
    }

    /**
     * Move canvas to collection
     */
    static async moveCanvasToCollection(canvasId: string, collectionId: string | undefined): Promise<void> {
        const meta = await this.getCanvasMeta(canvasId);
        if (meta) {
            meta.collectionId = collectionId;
            // Don't update updatedAt so we don't mess up the sort order
            await set(canvasId, meta, canvasMetaStore);
        }
    }
}
