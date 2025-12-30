import { useState, type FormEvent } from "react";
import { ExcalLogo } from "@excalidraw/excalidraw/components/icons";
import { useAuth } from "./AuthContext";

import "./Auth.scss";

export const LoginPage = () => {
    const { signIn, loading, error } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [localError, setLocalError] = useState<string | null>(null);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setLocalError(null);

        if (!email || !password) {
            setLocalError("Please enter both email and password");
            return;
        }

        const { error: signInError } = await signIn(email, password);

        if (signInError) {
            setLocalError(signInError);
        }
    };

    const displayError = localError || error;

    return (
        <div className="login-page excalidraw">
            <div className="login-container">
                <div className="login-header">
                    <div className="login-logo">
                        {ExcalLogo}
                    </div>
                    <h1 className="login-title">Sign in to Excalidraw</h1>
                    <p className="login-subtitle">Enter your credentials to continue</p>
                </div>

                <form className="login-form" onSubmit={handleSubmit}>
                    {displayError && (
                        <div className="login-error">
                            <svg
                                className="login-error-icon"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                            </svg>
                            <span>{displayError}</span>
                        </div>
                    )}

                    <div className="form-group">
                        <label htmlFor="email" className="form-label">
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            className="form-input"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={loading}
                            autoComplete="email"
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password" className="form-label">
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            className="form-input"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                            autoComplete="current-password"
                        />
                    </div>

                    <button
                        type="submit"
                        className="login-button"
                        disabled={loading}
                    >
                        <span className="login-button-text">
                            {loading ? (
                                <>
                                    <span className="login-spinner" />
                                    Signing in...
                                </>
                            ) : (
                                "Sign in"
                            )}
                        </span>
                    </button>
                </form>
            </div>
        </div>
    );
};

export default LoginPage;
