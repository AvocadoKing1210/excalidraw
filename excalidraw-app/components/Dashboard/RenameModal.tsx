import React, { useEffect, useRef, useState } from "react";

import "./RenameModal.scss";

export interface RenameModalProps {
    currentName: string;
    onSubmit: (newName: string) => void;
    onClose: () => void;
    title?: string;
    submitLabel?: string;
}

export const RenameModal: React.FC<RenameModalProps> = ({
    currentName,
    onSubmit,
    onClose,
    title = "Rename canvas",
    submitLabel = "Rename canvas",
}) => {
    const [name, setName] = useState(currentName);
    const inputRef = useRef<HTMLInputElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);

    // Auto-focus and select input text
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, []);

    // Handle ESC key to close
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    // Handle click outside to close
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        // Delay to prevent immediate close
        const timeoutId = setTimeout(() => {
            document.addEventListener("mousedown", handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [onClose]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            onSubmit(name.trim());
        }
    };

    return (
        <div className="rename-modal-overlay">
            <div ref={modalRef} className="rename-modal">
                <h2 className="rename-modal__title">{title}</h2>

                <form onSubmit={handleSubmit}>
                    <label className="rename-modal__label" htmlFor="rename-input">
                        Name
                    </label>
                    <input
                        ref={inputRef}
                        id="rename-input"
                        type="text"
                        className="rename-modal__input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter name"
                    />

                    <div className="rename-modal__actions">
                        <button
                            type="button"
                            className="rename-modal__btn rename-modal__btn--cancel"
                            onClick={onClose}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="rename-modal__btn rename-modal__btn--submit"
                            disabled={!name.trim()}
                        >
                            {submitLabel}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
