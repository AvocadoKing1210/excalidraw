import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";
import type { AppState, BinaryFileData } from "@excalidraw/excalidraw/types";

/**
 * Metadata for a canvas (lightweight, used in lists)
 */
export interface Canvas {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    thumbnail?: string; // Base64 PNG for preview
    isDeleted?: boolean;
    deletedAt?: number;
    collectionId?: string;
}

/**
 * Full canvas data including elements and state
 */
export interface CanvasData {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    elements: readonly ExcalidrawElement[];
    appState: Partial<AppState>;
    files: Record<FileId, BinaryFileData>;
}

/**
 * Default canvas ID for migration and fallback
 */
export const DEFAULT_CANVAS_ID = "default";

/**
 * Creates a new canvas metadata object
 */
export const createCanvasMetadata = (
    id: string,
    name: string,
): Canvas => ({
    id,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isDeleted: false,
});
