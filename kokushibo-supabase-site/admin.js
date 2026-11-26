// Admin portal authentication is handled by the same-origin serverless API.
// Admin email/password and the Supabase service key are server environment variables,
// never browser code. Supabase remains the database and public member-login provider.
const config = window.KOKU_SUPABASE_CONFIG || {};
const supabaseUrl = String(config.url || "").replace(/\/$/, "");
const $ = id => document.getElementById(id);
let currentUser = null, currentAdmin = false, editKind = "anime", editComicKind = "manga";

class AdminQuery {
  constructor(table) {
    this.table = table; this.method = "GET"; this.params = new URLSearchParams();
    this.body = undefined; this.prefer = ""; this.head = false; this.mode = "";
  }
  select(columns="*", options={}) {
    this.params.set("select", columns);
    if (options.count) this.prefer = [this.prefer, "count=" + options.count].filter(Boolean).join(",");
    if (options.head) { this.method = "GET"; this.head = true; this.params.set("limit", "1"); }
    return this;
  }
  insert(value) { this.method = "POST"; this.body = value; this.prefer = [this.prefer,"return=representation"].filter(Boolean).join(","); return this; }
  upsert(value, options={}) {
    this.method = "POST"; this.body = value;
    this.prefer = [this.prefer,"resolution=merge-duplicates","return=representation"].filter(Boolean).join(",");
    if (options.onConflict) this.params.set("on_conflict", options.onConflict);
    return this;
  }
  update(value) { this.method = "PATCH"; this.body = value; this.prefer = "return=representation"; return this; }
  delete() { this.method = "DELETE"; this.prefer = "return=representation"; return this; }
  eq(column,value) { this.params.append(column, "eq." + String(value)); return this; }
  order(column, options={}) { this.params.set("order", column + "." + (options.ascending === false ? "desc" : "asc")); return this; }
  limit(value) { this.params.set("limit", String(value)); return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  async run() {
    const query = this.params.toString();
    const url = "/api/admin/db/" + encodeURIComponent(this.table) + (query ? "?" + query : "");
    const headers = {};
    if (this.prefer) headers.Prefer = this.prefer;
    if (this.body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(url,{method:this.method,headers,credentials:"same-origin",body:this.body===undefined?undefined:JSON.stringify(this.body)});
    } catch (error) { return {data:null,error:{message:error.message},count:null}; }
    let payload = null;
    const raw = await response.text();
    if (raw) { try { payload = JSON.parse(raw); } catch { payload = {message:raw}; } }
    if (!response.ok) return {data:null,error:{message:payload?.message || payload?.error || "Database request failed ("+response.status+").",details:payload},count:null};
    if (this.head) { const range=response.headers.get("content-range")||""; const count=range.includes("/")?Number(range.split("/").pop()):Number(payload?.count||0); return {data:null,error:null,count:Number.isFinite(count)?count:0}; }
    let data = payload;
    if (this.mode === "single") {
      if (Array.isArray(data)) data = data[0] ?? null;
      if (data === null) return {data:null,error:{message:"Expected one row, but none was returned."},count:null};
    } else if (this.mode === "maybe") {
      if (Array.isArray(data)) data = data[0] ?? null;
    }
    return {data,error:null,count:null};
  }
  then(resolve,reject) { return this.run().then(resolve,reject); }
}

const sb = {
  from(table) { return new AdminQuery(table); },
  storage: {
    from(bucket) {
      return {
        async upload(path,file,options={}) {
          try {
            const response = await fetch("/api/admin/storage/" + encodeURIComponent(bucket) + "/" + path.split("/").map(encodeURIComponent).join("/"), {
              method:"POST", credentials:"same-origin",
              headers:{"Content-Type":file.type || "application/octet-stream","x-upsert":options.upsert?"true":"false"},
              body:file
            });
            const data = await response.json().catch(()=>({}));
            return response.ok ? {data,error:null} : {data:null,error:{message:data.message||data.error||"Image upload failed."}};
          } catch(error) { return {data:null,error:{message:error.message}}; }
        },
        getPublicUrl(path) {
          const encoded = path.split("/").map(encodeURIComponent).join("/");
          return {data:{publicUrl:supabaseUrl + "/storage/v1/object/public/" + encodeURIComponent(bucket) + "/" + encoded}};
        }
      };
    }
  }
};

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const slugify = s => String(s||"").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80) || crypto.randomUUID();
function status(id,msg,kind=""){const el=$(id);if(el){el.textContent=msg;el.className="status "+kind}}
function gate(message,kind=""){ $("gate").classList.remove("hidden"); $("dashboard").classList.add("hidden"); status("gateStatus",message,kind); }
function showDashboard(){ $("gate").classList.add("hidden"); $("dashboard").classList.remove("hidden"); $("signOut").classList.remove("hidden"); $("adminIdentity").textContent=currentUser?.email||"Admin session"; }
async function loadDashboard(){
  currentAdmin=true;showDashboard();
  await loadOverview();await loadCatalog("anime");await loadCatalog("manga");await loadAnnouncements();await loadCommunity();await loadMembers();await loadSettings();
}
async function checkExistingSession(){
  if(!supabaseUrl || /YOUR_PROJECT_REF/.test(supabaseUrl)) { gate("Set the Supabase Project URL in supabase-config.js, and set SUPABASE_URL plus the server-only service key in Vercel environment variables.","bad"); return; }
  try {
    const response = await fetch("/api/admin/session",{credentials:"same-origin"});
    const data = await response.json().catch(()=>({}));
    if(response.ok && data.user){currentUser=data.user;await loadDashboard();}
    else gate("Sign in with your administrator email and password.");
  } catch(error) { gate("Could not reach the admin server. Deploy this site with the included Vercel API functions. "+error.message,"bad"); }
}
$("adminLogin").addEventListener("click", async () => {
  const email = $("adminEmail").value.trim().toLowerCase();
  const password = $("adminPassword").value;
  if (!email || !password) { status("gateStatus","Enter the admin email and password.","bad"); return; }
  const button=$("adminLogin");button.disabled=true;status("gateStatus","Verifying administrator credentials…");
  try {
    const response=await fetch("/api/admin/login",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok) { status("gateStatus",data.error||"Admin sign-in failed.","bad"); return; }
    $("adminPassword").value="";currentUser=data.user;await loadDashboard();
  } catch(error) { status("gateStatus","Admin server error: "+error.message,"bad"); }
  finally { button.disabled=false; }
});
$("adminPassword").addEventListener("keydown", e => { if (e.key === "Enter") $("adminLogin").click(); });
$("adminEmail").addEventListener("keydown", e => { if (e.key === "Enter") $("adminLogin").click(); });
$("signOut").addEventListener("click", async()=>{
  await fetch("/api/admin/logout",{method:"POST",credentials:"same-origin"});
  currentUser=null;currentAdmin=false;location.href="admin.html";
});
checkExistingSession();

// Sidebar navigation.
document.querySelectorAll("[data-tab]").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===btn));document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.id==="tab-"+btn.dataset.tab));}));
async function count(table){const {count,error}=await sb.from(table).select("*",{count:"exact",head:true});if(error)throw error;return count||0;}
async function loadOverview(){try{$("countCatalog").textContent=await count("catalog_entries");$("countAnnouncements").textContent=await count("announcements");$("countMessages").textContent=await count("chat_messages");$("countMembers").textContent=await count("profiles");}catch(e){console.error(e);}}

function renderCatalogRows(target,rows,kind){const el=$(target);if(!rows?.length){el.innerHTML='<div class="empty">No entries yet. Use NEW ENTRY to add one.</div>';return;}el.innerHTML=`<div class="listwrap"><table class="table"><thead><tr><th>Cover</th><th>Title</th><th>Kind</th><th>Featured</th><th>Actions</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.image_url?`<img class="thumb" src="${esc(r.image_url)}" alt="">`:"—"}</td><td><b>${esc(r.title)}</b><div class="muted">${esc(r.slug)}</div></td><td><span class="pill">${esc(r.kind)}</span></td><td>${r.is_featured?"Yes":"No"}</td><td><div class="row"><button class="btn" data-edit="${r.id}" data-kind="${kind}">EDIT</button><button class="btn danger" data-delete="${r.id}" data-kind="${kind}">DELETE</button></div></td></tr>`).join("")}</tbody></table></div>`;el.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>editEntry(b.dataset.kind,b.dataset.edit)));el.querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",()=>deleteEntry(b.dataset.kind,b.dataset.delete)));}
async function loadCatalog(kind){const target=(kind==="manga"||kind==="manhwa")?"comicArea":"catalogArea";const {data,error}=await sb.from("catalog_entries").select("*").eq("kind",kind).order("created_at",{ascending:false}).limit(300);if(error){$(target).textContent=error.message;return;}renderCatalogRows(target,data,kind);}
function showForm(kind,entry=null){const comic=(kind==="manga"||kind==="manhwa");const p=$(comic?"comicFormPanel":"catalogFormPanel");p.classList.remove("hidden");if(comic){editComicKind=kind;$("comicFormTitle").textContent=entry?"Edit "+kind:"Add "+kind;$("comicId").value=entry?.id||"";$("comicTitle").value=entry?.title||"";$("comicSlug").value=entry?.slug||"";$("comicGenres").value=(entry?.genres||[]).join(", ");$("comicStatus").value=entry?.status||"";$("comicImage").value=entry?.image_url||"";$("comicSummary").value=entry?.summary||"";$("comicFeatured").checked=!!entry?.is_featured;$("comicFile").value="";}else{editKind=kind;$("catalogFormTitle").textContent=entry?"Edit "+kind:"Add "+kind;$("catalogId").value=entry?.id||"";$("catalogTitle").value=entry?.title||"";$("catalogSlug").value=entry?.slug||"";$("catalogAnime").value=entry?.related_anime||"";$("catalogGenres").value=(entry?.genres||[]).join(", ");$("catalogImage").value=entry?.image_url||"";$("catalogBanner").value=entry?.banner_url||"";$("catalogScore").value=entry?.score||"";$("catalogSummary").value=entry?.summary||"";$("catalogFeatured").checked=!!entry?.is_featured;$("catalogFile").value="";}p.scrollIntoView({behavior:"smooth",block:"center"});}
async function editEntry(kind,id){const {data,error}=await sb.from("catalog_entries").select("*").eq("id",id).single();if(error){alert(error.message);return;}showForm(kind,data);}
async function uploadImage(file,kind){if(!file)return null;if(!file.type.startsWith("image/"))throw new Error("Choose an image file.");if(file.size>5*1024*1024)throw new Error("Images must be 5 MB or smaller.");const ext=file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";const path=`${kind}/${Date.now()}-${crypto.randomUUID()}.${ext}`;const {error}=await sb.storage.from("site-media").upload(path,file,{upsert:false,contentType:file.type});if(error)throw error;return sb.storage.from("site-media").getPublicUrl(path).data.publicUrl;}
async function saveCatalog(comic=false){const kind=comic?editComicKind:editKind;const id=$(comic?"comicId":"catalogId").value;const title=$(comic?"comicTitle":"catalogTitle").value.trim();if(!title){status(comic?"comicFormStatus":"catalogFormStatus","A title is required.","bad");return;}const file=$(comic?"comicFile":"catalogFile").files[0];let image_url=$(comic?"comicImage":"catalogImage").value.trim();try{if(file)image_url=await uploadImage(file,kind);if(image_url&&!/^https:\/\//i.test(image_url))throw new Error("Image URL must use https://");const row={kind,slug:slugify($(comic?"comicSlug":"catalogSlug").value||title),title,image_url:image_url||null,summary:$(comic?"comicSummary":"catalogSummary").value.trim()||null,genres:$(comic?"comicGenres":"catalogGenres").value.split(",").map(x=>x.trim()).filter(Boolean),is_featured:$(comic?"comicFeatured":"catalogFeatured").checked,source:"admin",updated_at:new Date().toISOString()};if(comic)row.status=$("comicStatus").value.trim()||null;else{row.related_anime=$("catalogAnime").value.trim()||null;row.banner_url=$("catalogBanner").value.trim()||null;row.score=$("catalogScore").value?Number($("catalogScore").value):null;}const result=id?await sb.from("catalog_entries").update(row).eq("id",id):await sb.from("catalog_entries").insert(row);if(result.error)throw result.error;status(comic?"comicFormStatus":"catalogFormStatus","Saved successfully.","good");$(comic?"comicFormPanel":"catalogFormPanel").classList.add("hidden");await loadCatalog(kind);await loadOverview();}catch(e){status(comic?"comicFormStatus":"catalogFormStatus",e.message||"Save failed.","bad");}}
async function deleteEntry(kind,id){if(!confirm("Delete this catalogue entry?"))return;const {error}=await sb.from("catalog_entries").delete().eq("id",id);if(error){alert(error.message);return;}await loadCatalog(kind);await loadOverview();}
$("catalogKind").addEventListener("change",e=>loadCatalog(e.target.value));$("comicKind").addEventListener("change",e=>loadCatalog(e.target.value));
$("newCatalog").onclick=()=>showForm($("catalogKind").value);$("newComic").onclick=()=>showForm($("comicKind").value);
$("reloadCatalog").onclick=()=>loadCatalog($("catalogKind").value);$("reloadComics").onclick=()=>loadCatalog($("comicKind").value);
$("saveCatalog").onclick=()=>saveCatalog(false);$("saveComic").onclick=()=>saveCatalog(true);
$("cancelCatalog").onclick=()=> $("catalogFormPanel").classList.add("hidden");$("cancelComic").onclick=()=> $("comicFormPanel").classList.add("hidden");

async function loadAnnouncements(){const {data,error}=await sb.from("announcements").select("*").order("created_at",{ascending:false}).limit(100);if(error){$("announcementArea").textContent=error.message;return;}$("announcementArea").innerHTML=(data||[]).map(a=>`<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:12px 0"><div><b>${esc(a.title)}</b><div class="muted">${esc(a.body)}</div><span class="pill">${a.is_published?"Published":"Draft"}</span></div><div class="row"><button class="btn" data-toggle="${a.id}" data-pub="${a.is_published}">${a.is_published?"UNPUBLISH":"PUBLISH"}</button><button class="btn danger" data-ann-delete="${a.id}">DELETE</button></div></div>`).join("")||'<div class="empty">No announcements yet.</div>';$("announcementArea").querySelectorAll("[data-toggle]").forEach(b=>b.onclick=async()=>{const {error}=await sb.from("announcements").update({is_published:b.dataset.pub!=="true",published_at:b.dataset.pub==="true"?null:new Date().toISOString()}).eq("id",b.dataset.toggle);if(error)alert(error.message);await loadAnnouncements();await loadOverview();});$("announcementArea").querySelectorAll("[data-ann-delete]").forEach(b=>b.onclick=async()=>{if(!confirm("Delete announcement?"))return;const {error}=await sb.from("announcements").delete().eq("id",b.dataset.annDelete);if(error)alert(error.message);await loadAnnouncements();await loadOverview();});}
$("publishAnnouncement").onclick=async()=>{const title=$("announcementTitle").value.trim(),body=$("announcementBody").value.trim();if(!title||!body){status("announcementStatus","Enter both a title and message.","bad");return;}const {error}=await sb.from("announcements").insert({title,body,is_published:true,published_at:new Date().toISOString(),created_by:null});if(error){status("announcementStatus",error.message,"bad");return;}$("announcementTitle").value="";$("announcementBody").value="";status("announcementStatus","Announcement published.","good");await loadAnnouncements();await loadOverview();};$("reloadAnnouncements").onclick=loadAnnouncements;

async function loadCommunity(){const [rooms,messages,reports]=await Promise.all([sb.from("chat_rooms").select("*").order("title"),sb.from("chat_messages").select("id,room_slug,display_name,body,created_at").order("created_at",{ascending:false}).limit(100),sb.from("content_reports").select("*").order("created_at",{ascending:false}).limit(100)]);
 if(rooms.error){$("roomsArea").textContent=rooms.error.message;}else{$("roomsArea").innerHTML=(rooms.data||[]).map(r=>`<div class="row" style="justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line)"><span><b>${esc(r.title)}</b> <span class="pill">${esc(r.room_slug)}</span></span><button class="btn" data-room="${esc(r.room_slug)}" data-active="${r.is_active}">${r.is_active?"ARCHIVE":"ACTIVATE"}</button></div>`).join("")||"No rooms.";$("roomsArea").querySelectorAll("[data-room]").forEach(b=>b.onclick=async()=>{const {error}=await sb.from("chat_rooms").update({is_active:b.dataset.active!=="true"}).eq("room_slug",b.dataset.room);if(error)alert(error.message);await loadCommunity();});}
 if(messages.error){$("messagesArea").textContent=messages.error.message;}else{$("messagesArea").innerHTML=`<table class="table"><thead><tr><th>Room</th><th>Member</th><th>Message</th><th>Time</th><th>Action</th></tr></thead><tbody>${(messages.data||[]).map(m=>`<tr><td>${esc(m.room_slug)}</td><td>${esc(m.display_name)}</td><td>${esc(m.body)}</td><td>${new Date(m.created_at).toLocaleString()}</td><td><button class="btn danger" data-msg-delete="${m.id}">DELETE</button></td></tr>`).join("")}</tbody></table>`;$("messagesArea").querySelectorAll("[data-msg-delete]").forEach(b=>b.onclick=async()=>{if(!confirm("Remove this chat message?"))return;const {error}=await sb.from("chat_messages").delete().eq("id",b.dataset.msgDelete);if(error)alert(error.message);await loadCommunity();await loadOverview();});}
 if(reports.error){$("reportsArea").textContent=reports.error.message;}else{$("reportsArea").innerHTML=(reports.data||[]).map(r=>`<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:9px 0"><span>${esc(r.reason)} <span class="pill">${esc(r.status)}</span></span><select class="field" style="max-width:160px" data-report="${r.id}"><option value="open" ${r.status==='open'?'selected':''}>Open</option><option value="reviewed" ${r.status==='reviewed'?'selected':''}>Reviewed</option><option value="dismissed" ${r.status==='dismissed'?'selected':''}>Dismissed</option><option value="actioned" ${r.status==='actioned'?'selected':''}>Actioned</option></select></div>`).join("")||'<div class="empty">No reports yet.</div>';$("reportsArea").querySelectorAll("[data-report]").forEach(sel=>sel.onchange=async()=>{const {error}=await sb.from("content_reports").update({status:sel.value}).eq("id",sel.dataset.report);if(error)alert(error.message);});}}
$("reloadCommunity").onclick=loadCommunity;

async function loadMembers(){const {data,error}=await sb.from("profiles").select("id,email,display_name,avatar_url,created_at").order("created_at",{ascending:false}).limit(300);if(error){$("membersArea").textContent=error.message;return;}$("membersArea").innerHTML=`<table class="table"><thead><tr><th>Member</th><th>Email</th><th>Joined</th></tr></thead><tbody>${(data||[]).map(m=>`<tr><td>${esc(m.display_name)}</td><td>${esc(m.email)}</td><td>${new Date(m.created_at).toLocaleDateString()}</td></tr>`).join("")}</tbody></table>`;}
$("reloadMembers").onclick=loadMembers;

async function loadSettings(){const {data,error}=await sb.from("site_settings").select("key,value,is_public");if(error){status("settingsStatus",error.message,"bad");return;}const s=Object.fromEntries((data||[]).map(x=>[x.key,x.value]));$("settingHeroTitle").value=String(s.hero_title||"").replace(/^"|"$/g,"");$("settingHeroSubtitle").value=String(s.hero_subtitle||"").replace(/^"|"$/g,"");$("settingMaintenance").checked=s.maintenance_mode===true||s.maintenance_mode==='true';$("settingMaintenanceText").value=String(s.maintenance_text||"").replace(/^"|"$/g,"");}
$("saveSettings").onclick=async()=>{const values=[{key:"hero_title",value:$("settingHeroTitle").value.trim(),is_public:true},{key:"hero_subtitle",value:$("settingHeroSubtitle").value.trim(),is_public:true},{key:"maintenance_mode",value:$("settingMaintenance").checked,is_public:false},{key:"maintenance_text",value:$("settingMaintenanceText").value.trim(),is_public:false}].map(x=>({...x,updated_by:null,updated_at:new Date().toISOString()}));const {error}=await sb.from("site_settings").upsert(values,{onConflict:"key"});status("settingsStatus",error?error.message:"Website settings saved.",error?"bad":"good");};
