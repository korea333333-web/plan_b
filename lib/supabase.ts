import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

let browserClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabasePublishableKey);
}

export function getSupabaseConfigurationError(): string | null {
  if (supabaseUrl && supabasePublishableKey) {
    return null;
  }

  return "Supabase 연결 정보가 없습니다. 환경 변수를 확인해 주세요.";
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabasePublishableKey) {
    return null;
  }

  if (!browserClient) {
    browserClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  }

  return browserClient;
}
