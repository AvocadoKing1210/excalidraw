import React, { useEffect } from "react";
import "./Toast.scss";

interface ToastProps {
    message: string;
    onClose: () => void;
    duration?: number;
}

export const Toast: React.FC<ToastProps> = ({ message, onClose, duration = 3000 }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, duration);

        return () => clearTimeout(timer);
    }, [onClose, duration]);

    return (
        <div className="dashboard-toast">
            <div className="dashboard-toast__content">
                {message}
            </div>
        </div>
    );
};
