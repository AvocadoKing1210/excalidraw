import { exportToCanvas } from "@excalidraw/utils/export";
import type { ExcalidrawElement, NonDeleted } from "@excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

// Higher resolution for crisp thumbnails
const THUMBNAIL_MAX_SIZE = 600;

/**
 * Generate a thumbnail for a canvas
 * Returns a base64 data URL or null if canvas is empty
 */
export const generateThumbnail = async (
    elements: readonly NonDeleted<ExcalidrawElement>[],
    files: BinaryFiles | null,
): Promise<string | null> => {
    // Filter out deleted elements
    const visibleElements = elements.filter((el) => !el.isDeleted);

    if (visibleElements.length === 0) {
        return null;
    }

    try {
        const canvas = await exportToCanvas({
            elements: visibleElements,
            appState: {
                exportBackground: true,
                viewBackgroundColor: "#ffffff",
                exportScale: 2, // 2x scale for retina clarity
            },
            files,
            maxWidthOrHeight: THUMBNAIL_MAX_SIZE,
        });

        // Use PNG for crisp vector graphics (no compression artifacts)
        return canvas.toDataURL("image/png");
    } catch (error) {
        console.error("Error generating thumbnail:", error);
        return null;
    }
};
