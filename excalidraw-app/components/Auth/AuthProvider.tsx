import { useState, useEffect, useCallback, type ReactNode } from "react";
import { supabase } from "../../data/supabase";
import { AuthContext, type AuthContextType } from "./AuthContext";
import type { User, Session, AuthChangeEvent } from "@supabase/supabase-js";

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Get initial session
        const initializeAuth = async () => {
            try {
                const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();

                if (sessionError) {
                    console.error("Error getting session:", sessionError);
                    setError(sessionError.message);
                } else {
                    setSession(currentSession);
                    setUser(currentSession?.user ?? null);
                }
            } catch (err) {
                console.error("Failed to initialize auth:", err);
                setError("Failed to initialize authentication");
            } finally {
                setLoading(false);
            }
        };

        initializeAuth();

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event: AuthChangeEvent, currentSession: Session | null) => {
                console.log("Auth state changed:", event);
                setSession(currentSession);
                setUser(currentSession?.user ?? null);
                setError(null);

                // Handle token refresh events
                if (event === "TOKEN_REFRESHED") {
                    console.log("Session token refreshed successfully");
                }

                // Handle sign out
                if (event === "SIGNED_OUT") {
                    setSession(null);
                    setUser(null);
                }
            }
        );

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    // Periodically check and refresh session (every 4 minutes)
    useEffect(() => {
        const refreshInterval = setInterval(async () => {
            if (session) {
                const { data: { session: refreshedSession }, error: refreshError } =
                    await supabase.auth.refreshSession();

                if (refreshError) {
                    console.error("Session refresh failed:", refreshError);
                } else if (refreshedSession) {
                    console.log("Session proactively refreshed");
                }
            }
        }, 4 * 60 * 1000); // 4 minutes

        return () => clearInterval(refreshInterval);
    }, [session]);

    const signIn = useCallback(async (email: string, password: string): Promise<{ error: string | null }> => {
        try {
            setLoading(true);
            setError(null);

            const { error: signInError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (signInError) {
                setError(signInError.message);
                return { error: signInError.message };
            }

            return { error: null };
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unexpected error occurred";
            setError(errorMessage);
            return { error: errorMessage };
        } finally {
            setLoading(false);
        }
    }, []);

    const signOut = useCallback(async () => {
        try {
            setLoading(true);
            const { error: signOutError } = await supabase.auth.signOut();

            if (signOutError) {
                console.error("Sign out error:", signOutError);
                setError(signOutError.message);
            }
        } catch (err) {
            console.error("Sign out failed:", err);
            setError("Failed to sign out");
        } finally {
            setLoading(false);
        }
    }, []);

    const value: AuthContextType = {
        user,
        session,
        loading,
        error,
        signIn,
        signOut,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthProvider;
