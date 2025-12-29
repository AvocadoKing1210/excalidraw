import React, { useState } from "react";
import clsx from "clsx";

import "./Sidebar.scss";

export type ViewType = "dashboard" | "recent" | "trash" | "collection";

interface Collection {
    id: string;
    name: string;
}

interface SidebarProps {
    currentView: ViewType;
    currentCollectionId?: string;
    collections: Collection[];
    onViewChange: (view: ViewType, collectionId?: string) => void;
    onCreateCollection: () => void;
    onRenameCollection?: (id: string, name: string) => void;
    onDeleteCollection?: (id: string) => void;
    onMoveCanvas: (canvasId: string, collectionId?: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    currentView,
    currentCollectionId,
    collections,
    onViewChange,
    onCreateCollection,
    onMoveCanvas,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [dragOverId, setDragOverId] = useState<string | null>(null);

    const handleDragOver = (e: React.DragEvent, id: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverId(id);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOverId(null);
    };

    const handleDrop = (e: React.DragEvent, collectionId?: string) => {
        e.preventDefault();
        const canvasId = e.dataTransfer.getData("application/x-excalidraw-canvas-id");
        if (canvasId) {
            onMoveCanvas(canvasId, collectionId);
        }
        setDragOverId(null);
    };

    const handleNavClick = (view: ViewType, collectionId?: string) => {
        onViewChange(view, collectionId);
        setIsOpen(false);
    };

    return (
        <div className="dashboard-sidebar-container">
            {/* Mobile hamburger button */}
            <button
                className="dashboard-sidebar__toggle"
                onClick={() => setIsOpen(!isOpen)}
                aria-label="Toggle sidebar"
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {isOpen ? (
                        <>
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </>
                    ) : (
                        <>
                            <line x1="3" y1="6" x2="21" y2="6" />
                            <line x1="3" y1="12" x2="21" y2="12" />
                            <line x1="3" y1="18" x2="21" y2="18" />
                        </>
                    )}
                </svg>
            </button>

            {/* Mobile overlay */}
            {isOpen && (
                <div
                    className="dashboard-sidebar__overlay"
                    onClick={() => setIsOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={clsx("dashboard-sidebar", { "dashboard-sidebar--open": isOpen })}>
                {/* User profile section */}
                <div className="dashboard-sidebar__profile">
                    <div className="dashboard-sidebar__avatar">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="8" r="4" />
                            <path d="M12 14c-6 0-9 3-9 6v1h18v-1c0-3-3-6-9-6z" />
                        </svg>
                    </div>
                    <div className="dashboard-sidebar__user-info">
                        <span className="dashboard-sidebar__username">My Workspace</span>
                        <span className="dashboard-sidebar__email">Local Storage</span>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="dashboard-sidebar__nav">
                    <div className="dashboard-sidebar__section">
                        <button
                            className={clsx("dashboard-sidebar__nav-item", {
                                "dashboard-sidebar__nav-item--active": currentView === "dashboard",
                            })}
                            onClick={() => handleNavClick("dashboard")}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="7" height="7" rx="1" />
                                <rect x="14" y="3" width="7" height="7" rx="1" />
                                <rect x="3" y="14" width="7" height="7" rx="1" />
                                <rect x="14" y="14" width="7" height="7" rx="1" />
                            </svg>
                            All Canvases
                        </button>
                        <button
                            className={clsx("dashboard-sidebar__nav-item", {
                                "dashboard-sidebar__nav-item--active": currentView === "recent",
                            })}
                            onClick={() => handleNavClick("recent")}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="9" />
                                <polyline points="12,6 12,12 16,14" />
                            </svg>
                            Recently Opened
                        </button>
                        <button
                            className={clsx("dashboard-sidebar__nav-item", {
                                "dashboard-sidebar__nav-item--active": currentView === "trash",
                            })}
                            onClick={() => handleNavClick("trash")}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3,6 5,6 21,6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                            Trash
                        </button>
                    </div>

                    {/* Collections */}
                    <div className="dashboard-sidebar__section">
                        <div className="dashboard-sidebar__section-header">
                            <span>Collections</span>
                            <button
                                className="dashboard-sidebar__add-btn"
                                onClick={onCreateCollection}
                                title="Create collection"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="12" y1="5" x2="12" y2="19" />
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                            </button>
                        </div>

                        {collections.length === 0 ? (
                            <p className="dashboard-sidebar__empty-hint">
                                No collections yet
                            </p>
                        ) : (
                            collections.map((collection) => (
                                <button
                                    key={collection.id}
                                    className={clsx("dashboard-sidebar__nav-item", {
                                        "dashboard-sidebar__nav-item--active":
                                            currentView === "collection" &&
                                            currentCollectionId === collection.id,
                                        "dashboard-sidebar__nav-item--drag-over": dragOverId === collection.id,
                                    })}
                                    onClick={() => handleNavClick("collection", collection.id)}
                                    onDragOver={(e) => handleDragOver(e, collection.id)}
                                    onDragLeave={handleDragLeave}
                                    onDrop={(e) => handleDrop(e, collection.id)}
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                    </svg>
                                    {collection.name}
                                </button>
                            ))
                        )}
                    </div>
                </nav>
            </aside>
        </div>
    );
};


