import React, { useEffect, useState, useCallback } from "react";

import { CanvasManager } from "../../data/CanvasManager";
import type { Canvas } from "../../data/canvasTypes";
import { CanvasCard, type ContextMenuState } from "./CanvasCard";
import { RenameModal } from "./RenameModal";
import { ConfirmationModal } from "./ConfirmationModal";
import { Toast } from "./Toast";
import { Sidebar, type ViewType } from "./Sidebar";

import "./Dashboard.scss";

interface DashboardProps {
    onCanvasSelect: (canvasId: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onCanvasSelect }) => {
    const [canvases, setCanvases] = useState<Canvas[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeCanvasId, setActiveCanvasId] = useState<string>("");
    const [searchQuery, setSearchQuery] = useState("");

    // Sidebar state
    const [currentView, setCurrentView] = useState<ViewType>("dashboard");
    const [collections, setCollections] = useState<{ id: string; name: string }[]>([]);
    const [currentCollectionId, setCurrentCollectionId] = useState<string | undefined>();
    const [toastMessage, setToastMessage] = useState<string | null>(null);

    // Global context menu state
    const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null);

    // Modal states
    const [renameModal, setRenameModal] = useState<{ id: string; name: string } | null>(null);
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [createCollectionModalOpen, setCreateCollectionModalOpen] = useState(false);

    // Delete/Empty Trash confirmation state
    const [confirmationModal, setConfirmationModal] = useState<{
        title: string;
        message: string;
        onConfirm: () => Promise<void>;
        confirmVariant?: "primary" | "danger";
        confirmLabel?: string;
    } | null>(null);

    const loadCanvases = useCallback(async () => {
        setLoading(true);
        try {
            const [list, cols] = await Promise.all([
                CanvasManager.listCanvases(),
                CanvasManager.listCollections(),
            ]);
            setCanvases(list);
            setCollections(cols);
            setActiveCanvasId(CanvasManager.getActiveCanvasId());
        } catch (error) {
            console.error("Error loading canvases:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadCanvases();
    }, [loadCanvases]);

    // Close context menu on interaction
    useEffect(() => {
        const handleInteraction = (e: Event) => {
            // Check if click is inside context menu
            const target = e.target as HTMLElement;
            if (target.closest('.dashboard-context-menu')) return;
            setContextMenuState(null);
        };

        window.addEventListener("scroll", handleInteraction, true);
        window.addEventListener("click", handleInteraction, true);
        window.addEventListener("contextmenu", (e) => {
            // Allow context menu opening, don't close immediately if it's the trigger
            // But if specific logic needed: actually existing logic sets state on context menu
            // This might conflict.
            // Let's rely on the fact that if we click OUTSIDE, it closes.
        });

        return () => {
            window.removeEventListener("scroll", handleInteraction, true);
            window.removeEventListener("click", handleInteraction, true);
        };
    }, []);

    const handleContextMenu = useCallback((canvasId: string, x: number, y: number) => {
        setContextMenuState({ canvasId, x, y });
    }, []);

    const handleCloseContextMenu = useCallback(() => {
        setContextMenuState(null);
    }, []);

    const handleViewChange = useCallback((view: ViewType, collectionId?: string) => {
        setCurrentView(view);
        setCurrentCollectionId(collectionId);
    }, []);

    const handleCreateCollection = useCallback(() => {
        setCreateCollectionModalOpen(true);
    }, []);

    const handleCreateCollectionSubmit = useCallback(async (name: string) => {
        if (name) {
            await CanvasManager.createCollection(name);
            await loadCanvases();
            setCreateCollectionModalOpen(false);
        }
    }, [loadCanvases]);

    const handleMoveCanvas = useCallback(async (canvasId: string, targetCollectionId?: string) => {
        await CanvasManager.moveCanvasToCollection(canvasId, targetCollectionId);
        await loadCanvases();

        let message = "Canvas removed from collection";
        if (targetCollectionId) {
            const col = collections.find(c => c.id === targetCollectionId);
            if (col) {
                message = `Moved to "${col.name}"`;
            }
        }
        setToastMessage(message);
    }, [loadCanvases, collections]);

    const handleCreateCanvas = async () => {
        setCreateModalOpen(true);
    };

    const handleCreateSubmit = async (name: string) => {
        try {
            if (name) {
                const canvas = await CanvasManager.createCanvas(name);
                setCreateModalOpen(false);
                await loadCanvases();
                onCanvasSelect(canvas.id);
            }
        } catch (error: any) {
            // Replace simple alert with a better UI in future, or just keep alert for error handling edge case
            alert(error.message);
            // Keep modal open
        }
    };

    const handleRenameCanvas = async (id: string, currentName: string) => {
        setRenameModal({ id, name: currentName });
        setContextMenuState(null);
    };

    const handleRenameSubmit = async (newName: string) => {
        if (renameModal && newName && newName !== renameModal.name) {
            await CanvasManager.renameCanvas(renameModal.id, newName);
            await loadCanvases();
        }
        setRenameModal(null);
    };

    const handleDuplicateCanvas = async (id: string) => {
        await CanvasManager.duplicateCanvas(id);
        await loadCanvases();
        setContextMenuState(null);
    };

    const handleRestoreCanvas = async (id: string) => {
        await CanvasManager.restoreCanvas(id);
        await loadCanvases();
        setContextMenuState(null);
    };

    const handleDeleteCanvas = async (id: string, name: string) => {
        setContextMenuState(null);

        if (currentView === "trash") {
            setConfirmationModal({
                title: "Delete Forever?",
                message: `Are you sure you want to permanently delete "${name}"? This cannot be undone.`,
                confirmLabel: "Delete Forever",
                confirmVariant: "danger",
                onConfirm: async () => {
                    await CanvasManager.deleteCanvas(id);
                    await loadCanvases();
                    setConfirmationModal(null);
                }
            });
        } else {
            // Soft delete
            setConfirmationModal({
                title: "Move to Trash?",
                message: `Are you sure you want to move "${name}" to trash?`,
                confirmLabel: "Move to Trash",
                confirmVariant: "danger",
                onConfirm: async () => {
                    await CanvasManager.moveToTrash(id);
                    await loadCanvases();
                    setConfirmationModal(null);
                }
            });
        }
    };

    const handleEmptyTrash = async () => {
        setConfirmationModal({
            title: "Empty Trash?",
            message: "Are you sure you want to empty the trash? All items will be permanently deleted.",
            confirmLabel: "Empty Trash",
            confirmVariant: "danger",
            onConfirm: async () => {
                await CanvasManager.emptyTrash();
                await loadCanvases();
                setConfirmationModal(null);
            }
        });
    };

    // Calculate menu position with viewport boundary detection
    const getMenuStyle = (): React.CSSProperties => {
        if (!contextMenuState) {
            return {};
        }

        const menuWidth = 180;
        const menuHeight = 140;
        const padding = 8;

        let x = contextMenuState.x;
        let y = contextMenuState.y;

        // Adjust if menu would overflow right edge
        if (x + menuWidth + padding > window.innerWidth) {
            x = window.innerWidth - menuWidth - padding;
        }

        // Adjust if menu would overflow bottom edge
        if (y + menuHeight + padding > window.innerHeight) {
            y = window.innerHeight - menuHeight - padding;
        }

        return {
            left: x,
            top: y,
        };
    };

    // Filter canvases based on current view and search
    const getFilteredCanvases = () => {
        let result = canvases;

        // Apply view filter
        switch (currentView) {
            case "recent":
                // Non-deleted, sort by update
                result = result.filter(c => !c.isDeleted).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
                break;
            case "trash":
                result = result.filter(c => c.isDeleted);
                break;
            case "collection":
                // Non-deleted + collection filter
                result = result.filter(c => !c.isDeleted && c.collectionId === currentCollectionId);
                break;
            case "dashboard":
            default:
                // All non-deleted
                result = result.filter(c => !c.isDeleted);
                break;
        }

        // Apply search filter
        if (searchQuery) {
            result = result.filter((canvas) =>
                canvas.name.toLowerCase().includes(searchQuery.toLowerCase()),
            );
        }

        return result;
    };

    const filteredCanvases = getFilteredCanvases();

    const getViewTitle = () => {
        switch (currentView) {
            case "recent":
                return "Recently Opened";
            case "trash":
                return "Trash";
            case "collection":
                const col = collections.find(c => c.id === currentCollectionId);
                return col?.name || "Collection";
            default:
                return "All Canvases";
        }
    };

    if (loading) {
        return (
            <div className="excalidraw dashboard dashboard--loading">
                <div className="dashboard__spinner" />
            </div>
        );
    }

    // Helper to get canvas name for context menu context
    const getContextMenuCanvasName = () => {
        if (!contextMenuState) return "";
        const canvas = canvases.find((c) => c.id === contextMenuState.canvasId);
        return canvas ? canvas.name : "";
    };

    const contextMenuCanvasName = getContextMenuCanvasName();

    return (
        <div className="excalidraw dashboard dashboard--with-sidebar">
            <Sidebar
                currentView={currentView}
                currentCollectionId={currentCollectionId}
                collections={collections}
                onViewChange={handleViewChange}
                onCreateCollection={handleCreateCollection}
                onMoveCanvas={handleMoveCanvas}
            />

            <div className="dashboard__main">
                <header className="dashboard__header">
                    <h1 className="dashboard__title">{getViewTitle()}</h1>
                    <div className="dashboard__actions">
                        <input
                            type="text"
                            className="dashboard__search"
                            placeholder="Search canvases..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {currentView !== "trash" ? (
                            <button className="dashboard__create-btn" onClick={handleCreateCanvas}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <line x1="12" y1="5" x2="12" y2="19" />
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                                New Canvas
                            </button>
                        ) : (
                            <button
                                className="dashboard__create-btn dashboard__create-btn--danger"
                                onClick={handleEmptyTrash}
                                disabled={filteredCanvases.length === 0}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M3 6h18" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" />
                                    <line x1="10" y1="11" x2="10" y2="17" />
                                    <line x1="14" y1="11" x2="14" y2="17" />
                                </svg>
                                Empty Trash
                            </button>
                        )}
                    </div>
                </header>

                <main className="dashboard__content">
                    {filteredCanvases.length === 0 ? (
                        <div className="dashboard__empty">
                            <div className="dashboard__empty-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    {currentView === "trash" ? (
                                        <>
                                            <polyline points="3,6 5,6 21,6" />
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                        </>
                                    ) : (
                                        <>
                                            <rect x="3" y="3" width="18" height="18" rx="2" />
                                            <line x1="3" y1="9" x2="21" y2="9" />
                                            <line x1="9" y1="3" x2="9" y2="21" />
                                        </>
                                    )}
                                </svg>
                            </div>
                            <p>
                                {searchQuery
                                    ? "No canvases match your search"
                                    : currentView === "trash"
                                        ? "Trash is empty"
                                        : currentView === "collection"
                                            ? "No canvases in this collection"
                                            : "No canvases yet"}
                            </p>
                            {!searchQuery && currentView === "dashboard" && (
                                <button onClick={handleCreateCanvas}>
                                    Create your first canvas
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="dashboard__grid">
                            {filteredCanvases.map((canvas) => (
                                <CanvasCard
                                    key={canvas.id}
                                    canvas={canvas}
                                    isActive={canvas.id === activeCanvasId}
                                    onClick={() => onCanvasSelect(canvas.id)}
                                    onRename={() => handleRenameCanvas(canvas.id, canvas.name)}
                                    onDuplicate={() => handleDuplicateCanvas(canvas.id)}
                                    onDelete={() => handleDeleteCanvas(canvas.id, canvas.name)}
                                    onContextMenu={handleContextMenu}
                                    contextMenuState={contextMenuState}
                                    onCloseContextMenu={handleCloseContextMenu}
                                />
                            ))}
                        </div>
                    )}
                </main>

                <footer className="dashboard__footer">
                    <button
                        className="dashboard__back-btn"
                        onClick={() => onCanvasSelect(activeCanvasId)}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="19" y1="12" x2="5" y2="12" />
                            <polyline points="12,19 5,12 12,5" />
                        </svg>
                        Back to Canvas
                    </button>
                </footer>
            </div>

            {/* Global Context Menu */}
            {contextMenuState && (
                <>
                    <div
                        className="dashboard-context-menu"
                        style={getMenuStyle()}
                    >
                        {currentView === "trash" ? (
                            <>
                                <button onClick={() => handleRestoreCanvas(contextMenuState.canvasId)}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M3 10h10a5 5 0 0 1 5 5v2" />
                                        <path d="M3 10l6-6" />
                                        <path d="M3 10l6 6" />
                                    </svg>
                                    Restore
                                </button>
                                <button
                                    className="dashboard-context-menu-delete"
                                    onClick={() => handleDeleteCanvas(contextMenuState.canvasId, contextMenuCanvasName)}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M3 6h18" />
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" />
                                        <line x1="10" y1="11" x2="10" y2="17" />
                                        <line x1="14" y1="11" x2="14" y2="17" />
                                    </svg>
                                    Delete Forever
                                </button>
                            </>
                        ) : (
                            <>
                                <button onClick={() => handleRenameCanvas(contextMenuState.canvasId, contextMenuCanvasName)}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                    </svg>
                                    Rename
                                </button>
                                <button onClick={() => handleDuplicateCanvas(contextMenuState.canvasId)}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
                                    Duplicate
                                </button>
                                <button
                                    className="dashboard-context-menu-delete"
                                    onClick={() => handleDeleteCanvas(contextMenuState.canvasId, contextMenuCanvasName)}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="3,6 5,6 21,6" />
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" />
                                    </svg>
                                    Move to Trash
                                </button>
                                {canvases.find(c => c.id === contextMenuState.canvasId)?.collectionId && (
                                    <button
                                        onClick={async () => {
                                            await handleMoveCanvas(contextMenuState.canvasId, undefined);
                                            setContextMenuState(null);
                                        }}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <line x1="18" y1="6" x2="6" y2="18" />
                                            <line x1="6" y1="6" x2="18" y2="18" />
                                        </svg>
                                        Remove from Collection
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </>
            )
            }

            {
                renameModal && (
                    <RenameModal
                        currentName={renameModal.name}
                        onSubmit={handleRenameSubmit}
                        onClose={() => setRenameModal(null)}
                        title="Rename canvas"
                        submitLabel="Rename"
                    />
                )
            }

            {
                createModalOpen && (
                    <RenameModal
                        currentName=""
                        onSubmit={handleCreateSubmit}
                        onClose={() => setCreateModalOpen(false)}
                        title="Create new canvas"
                        submitLabel="Create canvas"
                    />
                )
            }

            {
                createCollectionModalOpen && (
                    <RenameModal
                        currentName=""
                        onSubmit={handleCreateCollectionSubmit}
                        onClose={() => setCreateCollectionModalOpen(false)}
                        title="Create New Collection"
                        submitLabel="Create Collection"
                    />
                )
            }

            {
                confirmationModal && (
                    <ConfirmationModal
                        title={confirmationModal.title}
                        message={confirmationModal.message}
                        onConfirm={confirmationModal.onConfirm}
                        onCancel={() => setConfirmationModal(null)}
                        confirmVariant={confirmationModal.confirmVariant}
                        confirmLabel={confirmationModal.confirmLabel}
                    />
                )
            }

            {toastMessage && (
                <Toast
                    message={toastMessage}
                    onClose={() => setToastMessage(null)}
                />
            )}
        </div >
    );
};

