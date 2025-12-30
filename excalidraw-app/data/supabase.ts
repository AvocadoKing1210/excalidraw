import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing Supabase environment variables");
}

export const supabase: SupabaseClient = createClient(
    supabaseUrl || "",
    supabaseAnonKey || "",
    {
        auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
            // Refresh session before it expires (5 minutes before expiry)
            storage: localStorage,
        },
    }
);

export default supabase;
