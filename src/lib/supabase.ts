import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseEnabled = Boolean(url && key && url.startsWith("https://"));

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
export const supabase = isSupabaseEnabled ? createClient(url!, key!) : null;
