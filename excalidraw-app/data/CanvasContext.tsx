import { createContext, useContext } from "react";

interface CanvasContextValue {
    canvasId: string | null;
    onNavigateToDashboard: () => void;
}

export const CanvasContext = createContext<CanvasContextValue>({
    canvasId: null,
    onNavigateToDashboard: () => { },
});

export const useCanvasContext = () => useContext(CanvasContext);
