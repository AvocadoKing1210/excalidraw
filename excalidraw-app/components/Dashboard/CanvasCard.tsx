import React, { useEffect, useRef } from "react";
import clsx from "clsx";

import type { Canvas } from "../../data/canvasTypes";

import "./CanvasCard.scss";

export interface ContextMenuState {
    canvasId: string;
    x: number;
    y: number;
}

interface CanvasCardProps {
    canvas: Canvas;
    isActive?: boolean;
    onClick: () => void;
    onRename: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onContextMenu: (canvasId: string, x: number, y: number) => void;
    contextMenuState: ContextMenuState | null;
    onCloseContextMenu: () => void;
}

export const CanvasCard: React.FC<CanvasCardProps> = ({
    canvas,
    isActive,
    onClick,
    onRename,
    onDuplicate,
    onDelete,
    onContextMenu,
    contextMenuState,
    onCloseContextMenu,
}) => {


    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            if (diffHours === 0) {
                const diffMinutes = Math.floor(diffMs / (1000 * 60));
                if (diffMinutes < 2) {
                    return "Just now";
                }
                return `${diffMinutes} min ago`;
            }
            if (diffHours === 1) {
                return "1 hour ago";
            }
            return `${diffHours} hours ago`;
        }
        if (diffDays === 1) {
            return "Yesterday";
        }
        if (diffDays < 7) {
            return `${diffDays} days ago`;
        }

        return date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
        });
    };

    const handleActionClick = (
        e: React.MouseEvent,
        action: () => void,
    ) => {
        e.stopPropagation();
        action();
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(canvas.id, e.clientX, e.clientY);
    };

    const handleDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData("application/x-excalidraw-canvas-id", canvas.id);
        e.dataTransfer.effectAllowed = "move";

        // Create custom drag preview
        const dragPreview = document.createElement("div");
        dragPreview.innerText = canvas.name;

        // Apply styles for a clean card look
        Object.assign(dragPreview.style, {
            position: "absolute",
            top: "-9999px",
            left: "-9999px",
            padding: "12px 16px",
            background: "var(--island-bg-color, #ffffff)",
            color: "var(--text-primary-color, #000000)",
            border: "1px solid var(--button-gray-2, #e0e0e0)",
            borderRadius: "8px",
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.15)",
            fontFamily: "Assistant, sans-serif",
            fontSize: "0.9375rem",
            fontWeight: "600",
            maxWidth: "200px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            zIndex: "99999",
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
        });

        document.body.appendChild(dragPreview);

        // Set drag image with slight offset so it feels like grabbing the card
        e.dataTransfer.setDragImage(dragPreview, 16, 20);

        // Cleanup
        setTimeout(() => {
            if (document.body.contains(dragPreview)) {
                document.body.removeChild(dragPreview);
            }
        }, 0);
    };

    return (
        <div
            className={clsx("canvas-card", {
                "canvas-card--active": isActive,
            })}
            onClick={onClick}
            onContextMenu={handleContextMenu}
            draggable
            onDragStart={handleDragStart}
        >
            <div className="canvas-card__thumbnail">
                {canvas.thumbnail ? (
                    <img src={canvas.thumbnail} alt={canvas.name} />
                ) : (
                    <div className="canvas-card__placeholder">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <line x1="3" y1="9" x2="21" y2="9" />
                            <line x1="9" y1="3" x2="9" y2="21" />
                        </svg>
                    </div>
                )}
            </div>

            <div className="canvas-card__actions">
                <button
                    className="canvas-card__action-btn"
                    onClick={(e) => handleActionClick(e, onRename)}
                    title="Rename"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                </button>
                <button
                    className="canvas-card__action-btn"
                    onClick={(e) => handleActionClick(e, onDuplicate)}
                    title="Duplicate"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                </button>
                <button
                    className="canvas-card__action-btn canvas-card__action-btn--delete"
                    onClick={(e) => handleActionClick(e, onDelete)}
                    title="Delete"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3,6 5,6 21,6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                </button>
            </div>

            <div className="canvas-card__info">
                <h3 className="canvas-card__name">{canvas.name}</h3>
                <span className="canvas-card__date">
                    Edited {formatDate(canvas.updatedAt)}
                </span>
            </div>
        </div>
    );
};
