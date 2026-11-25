import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.2";

export function getKokuSupabase() {
  if (window.__kokuSupabase) return window.__kokuSupabase;
  const config = window.KOKU_SUPABASE_CONFIG || {};
  const url = String(config.url || "").trim();
  const key = String(config.publishableKey || "").trim();
  if (!/^https:\/\//i.test(url) || /YOUR_PROJECT_REF|REPLACE_WITH_YOUR_KEY/.test(url + key) || !key) return null;
  window.__kokuSupabase = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    realtime: { params: { eventsPerSecond: 5 } }
  });
  return window.__kokuSupabase;
}
