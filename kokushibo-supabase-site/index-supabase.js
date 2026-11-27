import { getKokuSupabase } from "./supabase-client.js";

const supabase = getKokuSupabase();
const $ = (id) => document.getElementById(id);
const safe = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

if (!supabase) {
  window.kokuSupabaseReady = false;
  if ($("chatStatus")) $("chatStatus").textContent = "Local preview only · connect Supabase for shared chat";
  if ($("authMessage")) { $("authMessage").textContent = "Supabase is not connected yet. Add the project URL and publishable key to supabase-config.js, then enable Google in Supabase Auth."; }
  const st = $("apiStatus");
  if (st) st.textContent += " · Supabase not configured";
} else {
  window.kokuSupabaseReady = true;
  window.kokuSupabase = supabase;

  window.kokuGoogleSignIn = async () => {
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, queryParams: { prompt: "select_account" } } });
    if (error && $("authMessage")) { $("authMessage").textContent = error.message; }
  };
  window.kokuGoogleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error && $("authMessage")) $("authMessage").textContent = error.message;
  };

  function paintAccount(user) {
    const nav = $("googleNavButton"), box = $("authAccount"), signIn = $("googleSignInAction"), signOut = $("googleSignOutAction");
    if (user) {
      if ($("chatStatus")) { $("chatStatus").textContent = "Google signed in · shared chat enabled"; $("chatStatus").className = "status good"; }
      const label = user.user_metadata?.full_name || user.email || "Account";
      if (nav) nav.textContent = "✓ " + label.slice(0, 16);
      if (box) { box.style.display = "block"; box.textContent = "Signed in as " + (user.email || label); }
      if (signIn) signIn.style.display = "none";
      if (signOut) signOut.style.display = "inline-block";
      if ($("authMessage")) { $("authMessage").textContent = "Google account connected through Supabase."; $("authMessage").className = "status good"; }
    } else {
      if ($("chatStatus")) { $("chatStatus").textContent = window.kokuSupabaseReady ? "Sign in with Google for shared chat" : "Local preview only · connect Supabase for shared chat"; $("chatStatus").className = "status warn"; }
      if (nav) nav.textContent = "G  SIGN IN";
      if (box) box.style.display = "none";
      if (signIn) signIn.style.display = "block";
      if (signOut) signOut.style.display = "none";
    }
  }

  async function syncProfile(user) {
    if (!user) return;
    const meta = user.user_metadata || {};
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      email: user.email || null,
      display_name: meta.full_name || meta.name || user.email || "Anime fan",
      avatar_url: meta.avatar_url || meta.picture || null
    }, { onConflict: "id" });
    if (error) console.warn("Profile sync:", error.message);
  }

  // Shared database-backed chat. Users must sign in before sending messages.
  let chatChannel = null;
  window.kokuLoadSharedChat = async (roomSlug = "general") => {
    if (!window.kokuSharedChatEnabled) return;
    const log = $("chatLog");
    if (!log) return;
    const { data, error } = await supabase.from("chat_messages").select("id,room_slug,display_name,body,created_at").eq("room_slug", roomSlug).order("created_at", { ascending: true }).limit(100);
    if (error) { log.textContent = "Chat is unavailable: " + error.message; return; }
    log.innerHTML = (data || []).map(m => `<div class="message"><div class="avatar">${safe((m.display_name || "A").slice(0,1).toUpperCase())}</div><div class="message-content"><div class="message-meta">${safe(m.display_name || "Fan")} · ${new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</div><div class="message-text">${safe(m.body)}</div></div></div>`).join("") || '<div class="empty">No messages yet. Start the conversation.</div>';
    log.scrollTop = log.scrollHeight;
    if (chatChannel) { await supabase.removeChannel(chatChannel); chatChannel = null; }
    chatChannel = supabase.channel("koku-chat-" + roomSlug).on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: "room_slug=eq." + roomSlug }, () => window.kokuLoadSharedChat(roomSlug)).subscribe();
  };
  window.kokuSendSharedChat = async (roomSlug, body) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { if (typeof openAuthModal === "function") openAuthModal(); else alert("Sign in with Google to chat."); return true; }
    const name = user.user_metadata?.full_name || user.email?.split("@")[0] || "Anime fan";
    const { error } = await supabase.from("chat_messages").insert({ room_slug: roomSlug, user_id: user.id, display_name: name, body });
    if (error) { alert("Message not sent: " + error.message); return true; }
    window.kokuLoadSharedChat(roomSlug);
    return true;
  };

  async function loadAnnouncements() {
    const { data, error } = await supabase.from("announcements").select("id,title,body,published_at").eq("is_published", true).order("published_at", { ascending: false }).limit(3);
    if (error || !data?.length) return;
    document.getElementById("liveAnnouncement")?.remove();
    const node = document.createElement("div"); node.id = "liveAnnouncement"; node.className = "wrap";
    node.innerHTML = data.map(a => `<div class="notice" style="margin-top:12px"><b>ANNOUNCEMENT · ${safe(a.title)}</b><div>${safe(a.body)}</div></div>`).join("");
    document.querySelector("#discover .search-panel")?.after(node);
  }

  async function loadPublicSettings() {
    const { data } = await supabase.from("site_settings").select("key,value").eq("is_public", true);
    const settings = Object.fromEntries((data || []).map(x => [x.key, x.value]));
    const heroTitle = settings.hero_title;
    const heroSubtitle = settings.hero_subtitle;
    if (heroTitle && document.querySelector(".hero h1")) document.querySelector(".hero h1").innerHTML = safe(String(heroTitle).slice(0, 80)).replace(/ANIME/i, '<span>ANIME</span>');
    if (heroSubtitle && document.querySelector(".hero .hero-copy, .hero p")) document.querySelector(".hero .hero-copy, .hero p").textContent = String(heroSubtitle).slice(0, 300);
    if (settings.maintenance_mode === true || settings.maintenance_mode === "true") {
      const banner = document.createElement("div"); banner.className = "wrap";
      banner.innerHTML = `<div class="notice" style="margin-top:12px">${safe(settings.maintenance_text || "Some website features are temporarily being updated.")}</div>`;
      document.querySelector("main")?.prepend(banner);
    }
  }

  function mapCatalogRow(row) {
    const kind = row.kind === "character" ? "characters" : row.kind;
    const numericId = parseInt(String(row.id).replace(/-/g, "").slice(0, 7), 16) || Date.now();
    return { id: numericId, mal_id: numericId, db_id: row.id, type: kind, _kind: kind,
      title: row.title, title_english: row.title, name: row.title, image: row.image_url || "",
      synopsis: row.summary || "", about: row.summary || "", animeName: row.related_anime || "",
      anime_title: row.related_anime || "", genres: (row.genres || []).map(g => ({ name: g })),
      score: Number(row.score || 0), format: row.status || "", subtitle: row.kind.toUpperCase(), is_featured: !!row.is_featured };
  }
  async function loadCustomCatalogue() {
    const { data, error } = await supabase.from("catalog_entries").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) { console.warn("Custom catalogue:", error.message); return; }
    window.kokuCustomCatalog = (data || []).map(mapCatalogRow);
    const targets = { anime: "animeGrid", characters: "characterGrid", manga: "mangaGrid", manhwa: "manhwaGrid" };
    for (const [kind, target] of Object.entries(targets)) {
      const grid = document.getElementById(target);
      const items = window.kokuCustomCatalog.filter(x => x.type === kind && x.is_featured);
      if (!grid || !items.length || typeof cardHTML !== "function") continue;
      const html = items.map(x => cardHTML(x, kind)).join("");
      grid.insertAdjacentHTML("afterbegin", html);
      if (typeof animateInsertedCards === "function") animateInsertedCards(grid);
    }
  }

  supabase.auth.getSession().then(async ({ data: { session } }) => {
    paintAccount(session?.user || null);
    if (session?.user) {
      await syncProfile(session.user);
      window.kokuSharedChatEnabled = true;
      if (typeof renderChat === "function") renderChat();
    }
    await Promise.all([loadAnnouncements(), loadPublicSettings(), loadCustomCatalogue()]);
  });
  supabase.auth.onAuthStateChange(async (_event, session) => {
    const user = session?.user || null;
    paintAccount(user);
    window.kokuSharedChatEnabled = !!user;
    if (user) await syncProfile(user);
    if (typeof renderChat === "function") renderChat();
  });
}

// Personal favorites: save anime titles to each user's private account.
window.kokuSaveFavorite = async item => {
 const {data:{user}}=await supabase.auth.getUser(); if(!user){alert("Sign in with Google to save favorites.");return;}
 const {error}=await supabase.from("favorites").upsert({user_id:user.id,entry_kind:item.type||"anime",external_id:String(item.id||item.mal_id||item.title),title:item.title||item.name||"Favorite",image_url:item.image||item.images?.jpg?.image_url||null},{onConflict:"user_id,entry_kind,external_id"});
 if(error)alert("Favorite save failed: "+error.message);else alert("Saved to your personal favorites!");
};
