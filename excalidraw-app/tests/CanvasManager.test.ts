import { describe, it, expect, vi, beforeEach } from "vitest";
import { CanvasManager } from "../data/CanvasManager";
import * as idb from "idb-keyval";
import { DEFAULT_CANVAS_ID } from "../data/canvasTypes";

// Mock idb-keyval
vi.mock("idb-keyval", () => ({
    createStore: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    entries: vi.fn(),
    keys: vi.fn(),
}));

describe("CanvasManager", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("restoreCanvas", () => {
        it("should restore a canvas without rename if no collision", async () => {
            const mockCanvas = {
                id: "canvas-1",
                name: "Test Canvas",
                isDeleted: true,
                updatedAt: 1000,
            };

            // Mock getCanvasMeta to return our deleted canvas
            vi.mocked(idb.get).mockResolvedValueOnce(mockCanvas);

            // Mock listCanvases (via entries) for checkNameExists
            // Return empty list so no collision
            vi.mocked(idb.entries).mockResolvedValue([]);

            await CanvasManager.restoreCanvas("canvas-1");

            expect(idb.set).toHaveBeenCalledWith(
                "canvas-1",
                expect.objectContaining({
                    id: "canvas-1",
                    name: "Test Canvas",
                    isDeleted: false,
                }),
                expect.anything()
            );
        });

        it("should rename canvas on restore if name collision exists", async () => {
            const mockCanvas = {
                id: "canvas-restore",
                name: "Collision",
                isDeleted: true,
                updatedAt: 1000,
            };

            // 1. getCanvasMeta called inside restoreCanvas
            vi.mocked(idb.get).mockResolvedValueOnce(mockCanvas);

            // 2. checkNameExists("Collision") called inside getUniqueName
            // Should find "Collision" existing (active)
            vi.mocked(idb.entries).mockResolvedValueOnce([
                ["active-id", { id: "active-id", name: "Collision", isDeleted: false }]
            ]);

            // 3. checkNameExists("Collision (1)") called inside getUniqueName
            // Should NOT find it
            vi.mocked(idb.entries).mockResolvedValueOnce([
                ["active-id", { id: "active-id", name: "Collision", isDeleted: false }]
            ]);

            await CanvasManager.restoreCanvas("canvas-restore");

            expect(idb.set).toHaveBeenCalledWith(
                "canvas-restore",
                expect.objectContaining({
                    id: "canvas-restore",
                    name: "Collision (1)",
                    isDeleted: false,
                }),
                expect.anything()
            );
        });

        it("should handle multiple collisions", async () => {
            const mockCanvas = {
                id: "canvas-restore",
                name: "Collision",
                isDeleted: true,
                updatedAt: 1000,
            };

            // 1. getCanvasMeta
            vi.mocked(idb.get).mockResolvedValueOnce(mockCanvas);

            // 2. checkNameExists("Collision") -> True
            vi.mocked(idb.entries).mockResolvedValueOnce([
                ["1", { id: "1", name: "Collision", isDeleted: false }],
                ["2", { id: "2", name: "Collision (1)", isDeleted: false }]
            ]);

            // 3. checkNameExists("Collision (1)") -> True
            vi.mocked(idb.entries).mockResolvedValueOnce([
                ["1", { id: "1", name: "Collision", isDeleted: false }],
                ["2", { id: "2", name: "Collision (1)", isDeleted: false }]
            ]);

            // 4. checkNameExists("Collision (2)") -> False
            vi.mocked(idb.entries).mockResolvedValueOnce([
                ["1", { id: "1", name: "Collision", isDeleted: false }],
                ["2", { id: "2", name: "Collision (1)", isDeleted: false }]
            ]);


            await CanvasManager.restoreCanvas("canvas-restore");

            expect(idb.set).toHaveBeenCalledWith(
                "canvas-restore",
                expect.objectContaining({
                    id: "canvas-restore",
                    name: "Collision (2)",
                    isDeleted: false,
                }),
                expect.anything()
            );
        });
    });
});
