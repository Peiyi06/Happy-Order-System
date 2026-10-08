import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://nkiflkroazrlsczeqncd.supabase.co";
const supabasePublishableKey = "sb_publishable_axMGTKBMcpiWjqoKviDlTw_nCx1pn-q";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
