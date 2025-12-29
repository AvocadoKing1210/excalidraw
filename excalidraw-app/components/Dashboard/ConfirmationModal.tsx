import React, { useEffect, useRef } from "react";
import "./RenameModal.scss"; // Reuse existing styles

interface ConfirmationModalProps {
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmVariant?: "primary" | "danger";
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    title,
    message,
    onConfirm,
    onCancel,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    confirmVariant = "primary",
}) => {
    const modalRef = useRef<HTMLDivElement>(null);

    // Handle ESC key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onCancel();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [onCancel]);

    // Handle click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
                onCancel();
            }
        };

        const timeoutId = setTimeout(() => {
            document.addEventListener("mousedown", handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [onCancel]);

    return (
        <div className="rename-modal-overlay">
            <div ref={modalRef} className="rename-modal">
                <h2 className="rename-modal__title">{title}</h2>
                <p style={{ marginBottom: "1.5rem", color: "var(--text-primary-color)" }}>
                    {message}
                </p>

                <div className="rename-modal__actions">
                    <button
                        type="button"
                        className="rename-modal__btn rename-modal__btn--cancel"
                        onClick={onCancel}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        className={`rename-modal__btn rename-modal__btn--${confirmVariant === "danger" ? "delete" : "submit"}`} // Mapping danger to delete class if exists, or reuse submit might be weird if blue. Let's check RenameModal.scss or just use inline style for now if class missing.
                        // Actually, let's stick to standard classes. If RenameModal.scss only has submit/cancel, we might need to add one or reuse.
                        // Assuming 'rename-modal__btn--submit' is primary.
                        // If danger, we might want red.
                        style={confirmVariant === "danger" ? { backgroundColor: "var(--color-danger)" } : {}}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
