import { createContext, useContext } from "react";
import type { User, Session } from "@supabase/supabase-js";

export interface AuthContextType {
    user: User | null;
    session: Session | null;
    loading: boolean;
    error: string | null;
    signIn: (email: string, password: string) => Promise<{ error: string | null }>;
    signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
};
