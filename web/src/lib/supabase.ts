// Re-export browser client for backward compatibility (upload page uses this)
import { createClient } from "@/lib/supabase/client";

export const supabase = createClient();
