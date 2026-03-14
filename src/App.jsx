import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

const COLORS = [
  { color: "#FF6B9D", bg: "#FFF0F6" },
  { color: "#4A90D9", bg: "#EFF6FF" },
  { color: "#34C759", bg: "#F0FFF4" },
  { color: "#FF9500", bg: "#FFF8EB" },
  { color: "#AF52DE", bg: "#F9F0FF" },
  { color: "#FF3B30", bg: "#FFF1F0" },
  { color: "#00C7BE", bg: "#E8FFFD" },
  { color: "#5856D6", bg: "#EFEDFF" },
];

const DAYS = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

function getDaysInMonth(y,m){return new Date(y,m+1,0).getDate();}
function getFirstDay(y,m){let d=new Date(y,m,1).getDay();return d===0?6:d-1;}

export default function App() {
  const today = new Date();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email:"", password:"", name:"", initials:"", colorIdx:0 });
  const [authError, setAuthError] = useState("");
  const [profile, setProfile] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [events, setEvents] = useState([]);
  const [notifs, setNotifs] = useState([]);
  const [cd, setCd] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selDay, setSelDay] = useState(today.getDate());
  const [filter, setFilter] = useState(null);
  const [view, setView] = useState("calendar");
  const [showModal, setShowModal] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [newEvent, setNewEvent] = useState({ title:"", date:"", invitees:[], note:"" });
  const [toast, setToast] = useState(null);
  const notifRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else { setProfile(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!profile) return;
    loadProfiles();
    loadEvents();
    loadNotifs();
    const evSub = supabase.channel('events-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, loadEvents)
      .subscribe();
    const invSub = supabase.channel('invitees-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_invitees' }, loadEvents)
      .subscribe();
    const notifSub = supabase.channel('notifs-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` }, loadNotifs)
      .subscribe();
    return () => { evSub.unsubscribe(); invSub.unsubscribe(); notifSub.unsubscribe(); };
  }, [profile]);

  useEffect(() => {
    function h(e) { if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  async function loadProfile(userId) {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    setProfile(data);
    setLoading(false);
  }

  async function loadProfiles() {
    const { data } = await supabase.from("profiles").select("*").order("name");
    setProfiles(data || []);
  }

  async function loadEvents() {
    const { data } = await supabase.from("events").select("*, event_invitees(user_id)").order("date");
    setEvents((data || []).map(e => ({ ...e, invitees: (e.event_invitees || []).map(i => i.user_id) })));
  }

  async function loadNotifs() {
    if (!profile) return;
    const { data } = await supabase.from("notifications").select("*").eq("user_id", profile.id).order("created_at", { ascending: false });
    setNotifs(data || []);
  }

  function showToast(msg, type="success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleRegister() {
    setAuthError("");
    if (!authForm.name || !authForm.email || !authForm.password) { setAuthError("Tous les champs sont requis"); return; }
    if (authForm.password.length < 6) { setAuthError("Mot de passe : 6 caractères minimum"); return; }
    const { data, error } = await supabase.auth.signUp({ email: authForm.email, password: authForm.password });
    if (error) { setAuthError(error.message); return; }
    const c = COLORS[authForm.colorIdx];
    const { error: profileError } = await supabase.from("profiles").insert({
      id: data.user.id,
      name: authForm.name,
      initials: authForm.initials || authForm.name.slice(0,2).toUpperCase(),
      color: c.color,
      bg: c.bg,
    });
    if (profileError) { setAuthError("Erreur création profil : " + profileError.message); return; }
    showToast("Compte créé ! Connectez-vous.");
    setAuthMode("login");
  }

  async function handleLogin() {
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password });
    if (error) setAuthError("Email ou mot de passe incorrect");
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setProfile(null);
    setProfiles([]);
    setEvents([]);
    setNotifs([]);
  }

  async function addEvent() {
    if (!newEvent.title.trim() || !newEvent.date) { showToast("Titre et date requis", "error"); return; }
    const { data, error } = await supabase.from("events")
      .insert({ title: newEvent.title, date: newEvent.date, note: newEvent.note || null, creator_id: profile.id })
      .select().single();
    if (error) { showToast("Erreur : " + error.message, "error"); return; }
    if (newEvent.invitees.length > 0) {
      await supabase.from("event_invitees").insert(newEvent.invitees.map(uid => ({ event_id: data.id, user_id: uid })));
      await supabase.from("notifications").insert(newEvent.invitees.map(uid => ({
        user_id: uid,
        text: `${profile.name} vous a invité à « ${newEvent.title} »`,
        read: false
      })));
    }
    setNewEvent({ title:"", date:"", invitees:[], note:"" });
    setShowModal(false);
    showToast("Événement ajouté ✓");
    loadEvents();
  }

  async function deleteEvent(id) {
    await supabase.from("event_invitees").delete().eq("event_id", id);
    await supabase.from("events").delete().eq("id", id);
    setShowDetail(null);
    setConfirmDelete(null);
    showToast("Événement supprimé");
    loadEvents();
  }

  async function markNotifRead(id) {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    loadNotifs();
  }

  async function markAllRead() {
    await supabase.from("notifications").update({ read: true }).eq("user_id", profile.id);
    loadNotifs();
  }

  function getProfile(id) { return profiles.find(p => p.id === id); }

  function getEventsForDay(day) {
    const ds = `${cd.year}-${String(cd.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return events.filter(e => e.date === ds && (!filter || e.creator_id === filter));
  }

  function getUpcoming() {
    const t = new Date().toISOString().split("T")[0];
    return events.filter(e => e.date >= t && (!filter || e.creator_id === filter));
  }

  function isToday(day) {
    return day === today.getDate() && cd.month === today.getMonth() && cd.year === today.getFullYear();
  }

  const unread = notifs.filter(n => !n.read).length;
  const daysInMonth = getDaysInMonth(cd.year, cd.month);
  const firstDay = getFirstDay(cd.year, cd.month);

  // ── CHARGEMENT ──
  if (loading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#F2F2F7", fontFamily:"-apple-system,sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:16 }}>📅</div>
        <div style={{ fontSize:17, color:"#8E8E93" }}>Chargement…</div>
      </div>
    </div>
  );

  // ── CONNEXION ──
  if (!session || !profile) return (
    <div style={{ minHeight:"100vh", background:"#F2F2F7", display:"flex", justifyContent:"center", alignItems:"center", padding:"20px", fontFamily:"-apple-system,sans-serif" }}>
      <div style={{ width:"100%", maxWidth:390, background:"#fff", borderRadius:32, overflow:"hidden", boxShadow:"0 20px 60px rgba(0,0,0,0.15)", padding:"48px 32px 40px" }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontSize:52, marginBottom:10 }}>📅</div>
          <div style={{ fontSize:26, fontWeight:700, color:"#1C1C1E", letterSpacing:-0.5 }}>Calendrier Famille</div>
          <div style={{ fontSize:14, color:"#8E8E93", marginTop:6 }}>
            {authMode==="login" ? "Connectez-vous à votre compte" : "Créez votre compte famille"}
          </div>
        </div>

        {authMode==="register" && (<>
          <input placeholder="Votre prénom *" value={authForm.name}
            onChange={e => setAuthForm(p=>({...p, name:e.target.value}))}
            style={{ width:"100%", padding:"13px 16px", borderRadius:13, border:"none", background:"#F2F2F7", fontSize:15, color:"#1C1C1E", marginBottom:10, outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/>
          <input placeholder="Initiales (ex: MA)" value={authForm.initials}
            onChange={e => setAuthForm(p=>({...p, initials:e.target.value.slice(0,2).toUpperCase()}))}
            style={{ width:"100%", padding:"13px 16px", borderRadius:13, border:"none", background:"#F2F2F7", fontSize:15, color:"#1C1C1E", marginBottom:14, outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/>
          <div style={{ fontSize:11, fontWeight:600, color:"#8E8E93", marginBottom:10 }}>VOTRE COULEUR</div>
          <div style={{ display:"flex", gap:10, marginBottom:18, flexWrap:"wrap" }}>
            {COLORS.map((c,i) => (
              <button key={i} onClick={() => setAuthForm(p=>({...p, colorIdx:i}))}
                style={{ width:38, height:38, borderRadius:19, background:c.color, border:authForm.colorIdx===i?"3px solid #1C1C1E":"3px solid transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                {authForm.colorIdx===i && <svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="#fff"/></svg>}
              </button>
            ))}
          </div>
        </>)}

        <input placeholder="Email *" type="email" value={authForm.email}
          onChange={e => setAuthForm(p=>({...p, email:e.target.value}))}
          style={{ width:"100%", padding:"13px 16px", borderRadius:13, border:"none", background:"#F2F2F7", fontSize:15, color:"#1C1C1E", marginBottom:10, outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/>
        <input placeholder="Mot de passe (6 caractères min) *" type="password" value={authForm.password}
          onChange={e => setAuthForm(p=>({...p, password:e.target.value}))}
          style={{ width:"100%", padding:"13px 16px", borderRadius:13, border:"none", background:"#F2F2F7", fontSize:15, color:"#1C1C1E", marginBottom:16, outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/>

        {authError && (
          <div style={{ background:"#FFF1F0", color:"#FF3B30", padding:"10px 14px", borderRadius:10, fontSize:13, marginBottom:14 }}>{authError}</div>
        )}

        <button onClick={authMode==="login" ? handleLogin : handleRegister}
          style={{ width:"100%", padding:"15px", borderRadius:14, border:"none", background:"#007AFF", color:"#fff", fontSize:16, fontWeight:700, cursor:"pointer", marginBottom:12 }}>
          {authMode==="login" ? "Se connecter" : "Créer mon compte"}
        </button>

        <button onClick={() => { setAuthMode(authMode==="login"?"register":"login"); setAuthError(""); }}
          style={{ width:"100%", padding:"13px", borderRadius:14, border:"none", background:"#F2F2F7", color:"#007AFF", fontSize:14, fontWeight:600, cursor:"pointer" }}>
          {authMode==="login" ? "Pas encore de compte ? S'inscrire" : "Déjà un compte ? Se connecter"}
        </button>
      </div>
    </div>
  );

  // ── APPLICATION ──
  return (
    <div style={{ background:"#F2F2F7", minHeight:"100vh", display:"flex", justifyContent:"center", alignItems:"flex-start", padding:"20px 0 40px" }}>
      <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif", width:390, minHeight:844, background:"#fff", borderRadius:44, overflow:"hidden", boxShadow:"0 20px 60px rgba(0,0,0,0.18)", position:"relative", display:"flex", flexDirection:"column" }}>

        {/* Status bar */}
        <div style={{ background:"#fff", padding:"14px 24px 0", display:"flex", justifyContent:"space-between", fontSize:12, fontWeight:600, color:"#1C1C1E" }}>
          <span>{String(today.getHours()).padStart(2,"0")}:{String(today.getMinutes()).padStart(2,"0")}</span>
          <div style={{ display:"flex", gap:6 }}><span>●●●</span><span>WiFi</span><span>100%</span></div>
        </div>

        {/* Header */}
        <div style={{ padding:"14px 20px 0", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:13, color:"#8E8E93", fontWeight:500 }}>Calendrier</div>
            <div style={{ fontSize:26, fontWeight:700, letterSpacing:-0.5, color:"#1C1C1E" }}>Famille</div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            {/* Notifications */}
            <div ref={notifRef} style={{ position:"relative" }}>
              <button onClick={() => setShowNotifs(v=>!v)}
                style={{ width:38, height:38, borderRadius:19, background:unread>0?"#007AFF":"#F2F2F7", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6V11c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" fill={unread>0?"#fff":"#8E8E93"}/></svg>
                {unread>0 && <div style={{ position:"absolute", top:-2, right:-2, background:"#FF3B30", borderRadius:10, width:18, height:18, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#fff", border:"2px solid #fff" }}>{unread}</div>}
              </button>
              {showNotifs && (
                <div style={{ position:"absolute", right:-8, top:46, width:300, background:"#fff", borderRadius:16, boxShadow:"0 8px 32px rgba(0,0,0,0.15)", zIndex:100, overflow:"hidden", border:"1px solid rgba(0,0,0,0.06)" }}>
                  <div style={{ padding:"14px 16px 10px", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid #F2F2F7" }}>
                    <span style={{ fontWeight:700, fontSize:15 }}>Notifications</span>
                    {unread>0 && <button onClick={markAllRead} style={{ fontSize:13, color:"#007AFF", background:"none", border:"none", cursor:"pointer", fontWeight:500 }}>Tout lire</button>}
                  </div>
                  {notifs.length===0 && <div style={{ padding:20, textAlign:"center", color:"#8E8E93", fontSize:14 }}>Aucune notification</div>}
                  {notifs.map(n => (
                    <div key={n.id} onClick={() => markNotifRead(n.id)}
                      style={{ padding:"12px 16px", display:"flex", gap:10, alignItems:"flex-start", background:n.read?"#fff":"#F0F7FF", borderBottom:"1px solid #F2F2F7", cursor:"pointer" }}>
                      <div style={{ width:8, height:8, borderRadius:4, background:n.read?"transparent":"#007AFF", marginTop:5, flexShrink:0 }}/>
                      <div>
                        <div style={{ fontSize:13, color:"#1C1C1E", lineHeight:1.4 }}>{n.text}</div>
                        <div style={{ fontSize:11, color:"#8E8E93", marginTop:2 }}>{new Date(n.created_at).toLocaleDateString("fr-FR")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Avatar */}
            <div onClick={() => setView("members")}
              style={{ width:38, height:38, borderRadius:19, background:profile.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer" }}>
              {profile.initials}
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div style={{ display:"flex", padding:"10px 20px 0", borderBottom:"1px solid #F2F2F7" }}>
          {[
            { key:"calendar", label:"Calendrier", path:"M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z" },
            { key:"agenda", label:"Agenda", path:"M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" },
            { key:"members", label:"Famille", path:"M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" },
          ].map(t => (
            <button key={t.key} onClick={() => setView(t.key)}
              style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"6px 0 10px", border:"none", background:"none", cursor:"pointer" }}>
              <svg width="20" height="20" viewBox="0 0 24 24"><path d={t.path} fill={view===t.key?"#007AFF":"#8E8E93"}/></svg>
              <span style={{ fontSize:10, fontWeight:view===t.key?600:400, color:view===t.key?"#007AFF":"#8E8E93" }}>{t.label}</span>
            </button>
          ))}
        </div>

        {/* VUE CALENDRIER */}
        {view==="calendar" && (<>
          <div style={{ padding:"10px 20px 0", overflowX:"auto" }}>
            <div style={{ display:"flex", gap:7, paddingBottom:4 }}>
              <button onClick={() => setFilter(null)}
                style={{ padding:"5px 13px", borderRadius:20, border:"none", cursor:"pointer", background:!filter?"#1C1C1E":"#F2F2F7", color:!filter?"#fff":"#1C1C1E", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>
                Tous
              </button>
              {profiles.map(m => (
                <button key={m.id} onClick={() => setFilter(filter===m.id?null:m.id)}
                  style={{ padding:"5px 13px", borderRadius:20, border:"none", cursor:"pointer", background:filter===m.id?m.color:m.bg, color:filter===m.id?"#fff":m.color, fontSize:12, fontWeight:600, whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:5 }}>
                  <span style={{ width:7, height:7, borderRadius:4, background:m.color, display:"inline-block" }}/>{m.name}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding:"12px 20px 6px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <button onClick={() => setCd(d => d.month===0?{year:d.year-1,month:11}:{...d,month:d.month-1})}
              style={{ width:30, height:30, borderRadius:15, background:"#F2F2F7", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="#1C1C1E"/></svg>
            </button>
            <div style={{ fontWeight:700, fontSize:17, color:"#1C1C1E" }}>{MONTHS[cd.month]} {cd.year}</div>
            <button onClick={() => setCd(d => d.month===11?{year:d.year+1,month:0}:{...d,month:d.month+1})}
              style={{ width:30, height:30, borderRadius:15, background:"#F2F2F7", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="#1C1C1E"/></svg>
            </button>
          </div>

          <div style={{ padding:"0 14px", display:"grid", gridTemplateColumns:"repeat(7,1fr)", textAlign:"center" }}>
            {DAYS.map(d => <div key={d} style={{ fontSize:10, fontWeight:600, color:"#8E8E93", paddingBottom:4 }}>{d}</div>)}
          </div>

          <div style={{ padding:"0 14px", display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:"1px 0" }}>
            {Array.from({ length: Math.ceil((firstDay+daysInMonth)/7)*7 }).map((_,i) => {
              const day = i - firstDay + 1;
              const valid = day>=1 && day<=daysInMonth;
              const evs = valid ? getEventsForDay(day) : [];
              const sel = selDay===day && valid;
              return (
                <button key={i} onClick={() => valid && setSelDay(day)}
                  style={{ background:"none", border:"none", cursor:valid?"pointer":"default", padding:"3px 1px", display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                  {valid && (<>
                    <div style={{ width:30, height:30, borderRadius:15, display:"flex", alignItems:"center", justifyContent:"center", background:sel?"#007AFF":isToday(day)?"#E3F0FF":"transparent", fontSize:13, fontWeight:sel||isToday(day)?700:400, color:sel?"#fff":isToday(day)?"#007AFF":"#1C1C1E" }}>{day}</div>
                    <div style={{ display:"flex", gap:2, minHeight:5 }}>
                      {evs.slice(0,3).map((ev,idx) => {
                        const m = getProfile(ev.creator_id);
                        return <div key={idx} style={{ width:5, height:5, borderRadius:3, background:m?.color||"#ccc" }}/>;
                      })}
                    </div>
                  </>)}
                </button>
              );
            })}
          </div>

          <div style={{ flex:1, margin:"10px 14px 0", background:"#F2F2F7", borderRadius:18, padding:14, overflowY:"auto", minHeight:180 }}>
            {selDay ? (<>
              <div style={{ fontSize:12, fontWeight:600, color:"#8E8E93", marginBottom:8 }}>{String(selDay).padStart(2,"0")} {MONTHS[cd.month]}</div>
              {getEventsForDay(selDay).length===0 && <div style={{ textAlign:"center", color:"#C7C7CC", fontSize:13, paddingTop:24 }}>Aucun événement ce jour</div>}
              {getEventsForDay(selDay).map(ev => {
                const m = getProfile(ev.creator_id);
                return (
                  <div key={ev.id} onClick={() => setShowDetail(ev)}
                    style={{ background:"#fff", borderRadius:12, padding:"10px 12px", marginBottom:8, display:"flex", alignItems:"center", gap:10, cursor:"pointer", borderLeft:`4px solid ${m?.color||"#ccc"}` }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:600, fontSize:14, color:"#1C1C1E" }}>{ev.title}</div>
                      {ev.note && <div style={{ fontSize:11, color:"#8E8E93", marginTop:1 }}>{ev.note}</div>}
                      <div style={{ display:"flex", gap:4, marginTop:5, flexWrap:"wrap" }}>
                        <div style={{ background:m?.bg, color:m?.color, fontSize:10, fontWeight:600, padding:"2px 7px", borderRadius:6 }}>{m?.name}</div>
                        {ev.invitees.slice(0,2).map(uid => { const m2=getProfile(uid); return m2?<div key={uid} style={{ background:m2.bg, color:m2.color, fontSize:10, fontWeight:600, padding:"2px 7px", borderRadius:6 }}>{m2.name}</div>:null; })}
                        {ev.invitees.length>2 && <div style={{ background:"#F2F2F7", color:"#8E8E93", fontSize:10, fontWeight:600, padding:"2px 7px", borderRadius:6 }}>+{ev.invitees.length-2}</div>}
                      </div>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="#C7C7CC"/></svg>
                  </div>
                );
              })}
            </>) : <div style={{ textAlign:"center", color:"#C7C7CC", fontSize:13, paddingTop:30 }}>Sélectionne un jour</div>}
          </div>
        </>)}

        {/* VUE AGENDA */}
        {view==="agenda" && (
          <div style={{ flex:1, padding:14, overflowY:"auto" }}>
            <div style={{ fontSize:12, fontWeight:600, color:"#8E8E93", marginBottom:12 }}>PROCHAINS ÉVÉNEMENTS</div>
            {getUpcoming().length===0 && <div style={{ textAlign:"center", color:"#C7C7CC", fontSize:14, paddingTop:40 }}>Aucun événement à venir</div>}
            {getUpcoming().map((ev, idx, arr) => {
              const m = getProfile(ev.creator_id);
              const showDate = idx===0 || arr[idx-1].date!==ev.date;
              const d = new Date(ev.date+"T12:00:00");
              return (
                <div key={ev.id}>
                  {showDate && <div style={{ fontSize:12, fontWeight:600, color:"#8E8E93", margin:idx===0?"0 0 8px":"16px 0 8px" }}>{d.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"}).toUpperCase()}</div>}
                  <div onClick={() => setShowDetail(ev)}
                    style={{ background:"#fff", borderRadius:12, padding:"12px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:12, cursor:"pointer", borderLeft:`4px solid ${m?.color}`, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                    <div style={{ width:36, height:36, borderRadius:10, background:m?.bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:m?.color }}>{m?.initials}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:600, fontSize:14, color:"#1C1C1E" }}>{ev.title}</div>
                      {ev.note && <div style={{ fontSize:11, color:"#8E8E93" }}>{ev.note}</div>}
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="#C7C7CC"/></svg>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* VUE FAMILLE */}
        {view==="members" && (
          <div style={{ flex:1, padding:14, overflowY:"auto" }}>
            <div style={{ fontSize:12, fontWeight:600, color:"#8E8E93", marginBottom:12 }}>MEMBRES DE LA FAMILLE</div>
            {profiles.map(m => (
              <div key={m.id} style={{ background:"#fff", borderRadius:14, padding:"14px 16px", marginBottom:10, display:"flex", alignItems:"center", gap:14, boxShadow:"0 1px 4px rgba(0,0,0,0.06)", border:profile.id===m.id?`2px solid ${m.color}`:"2px solid transparent" }}>
                <div style={{ width:46, height:46, borderRadius:23, background:m.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:700, color:"#fff" }}>{m.initials}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600, fontSize:15, color:"#1C1C1E" }}>{m.name}{profile.id===m.id?" (moi)":""}</div>
                  <div style={{ fontSize:12, color:"#8E8E93" }}>{events.filter(e=>e.creator_id===m.id).length} événement(s) créé(s)</div>
                </div>
                {profile.id===m.id && <div style={{ background:"#E3F0FF", color:"#007AFF", fontSize:11, fontWeight:600, padding:"4px 10px", borderRadius:8 }}>Connecté</div>}
              </div>
            ))}
            <button onClick={handleLogout}
              style={{ width:"100%", padding:"14px", borderRadius:14, border:"none", background:"#FFF1F0", color:"#FF3B30", fontWeight:600, fontSize:15, cursor:"pointer", marginTop:8 }}>
              Se déconnecter
            </button>
          </div>
        )}

        {/* BOUTON + */}
        {(view==="calendar"||view==="agenda") && (
          <div style={{ padding:"12px 20px 30px", display:"flex", justifyContent:"flex-end" }}>
            <button onClick={() => {
              const ds = selDay ? `${cd.year}-${String(cd.month+1).padStart(2,"0")}-${String(selDay).padStart(2,"0")}` : "";
              setNewEvent({ title:"", date:ds, invitees:[], note:"" });
              setShowModal(true);
            }} style={{ width:54, height:54, borderRadius:27, background:"#007AFF", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 14px rgba(0,122,255,0.4)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="#fff"/></svg>
            </button>
          </div>
        )}

        {/* MODAL DÉTAIL */}
        {showDetail && (
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"flex-end", zIndex:200 }} onClick={() => setShowDetail(null)}>
            <div onClick={e => e.stopPropagation()} style={{ background:"#fff", borderRadius:"24px 24px 0 0", width:"100%", padding:"20px 24px 40px" }}>
              <div style={{ width:36, height:4, background:"#E5E5EA", borderRadius:2, margin:"0 auto 20px" }}/>
              {(() => {
                const ev = showDetail;
                const m = getProfile(ev.creator_id);
                const d = new Date(ev.date+"T12:00:00");
                return (<>
                  <div style={{ display:"flex", gap:14, alignItems:"flex-start", marginBottom:20 }}>
                    <div style={{ width:50, height:50, borderRadius:14, background:m?.bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>📅</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:20, fontWeight:700, color:"#1C1C1E" }}>{ev.title}</div>
                      <div style={{ fontSize:13, color:"#8E8E93", marginTop:2 }}>{d.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</div>
                    </div>
                  </div>
                  {ev.note && <div style={{ background:"#F2F2F7", borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
                    <div style={{ fontSize:10, fontWeight:600, color:"#8E8E93", marginBottom:3 }}>NOTE</div>
                    <div style={{ fontSize:14, color:"#1C1C1E" }}>{ev.note}</div>
                  </div>}
                  <div style={{ fontSize:10, fontWeight:600, color:"#8E8E93", marginBottom:10 }}>PARTICIPANTS</div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:24 }}>
                    {[ev.creator_id, ...ev.invitees].map(id => {
                      const m2 = getProfile(id);
                      return m2 ? (
                        <div key={id} style={{ display:"flex", alignItems:"center", gap:8, background:m2.bg, borderRadius:20, padding:"6px 12px 6px 6px" }}>
                          <div style={{ width:28, height:28, borderRadius:14, background:m2.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#fff" }}>{m2.initials}</div>
                          <span style={{ fontSize:13, fontWeight:600, color:m2.color }}>{m2.name}</span>
                          {id===ev.creator_id && <span style={{ fontSize:9, color:m2.color, background:m2.color+"30", padding:"1px 6px", borderRadius:5 }}>Orga.</span>}
                        </div>
                      ) : null;
                    })}
                  </div>
                  {ev.creator_id===profile.id && (
                    <button onClick={() => { setConfirmDelete(ev.id); setShowDetail(null); }}
                      style={{ width:"100%", padding:"14px", borderRadius:14, border:"none", background:"#FFF1F0", color:"#FF3B30", fontWeight:600, fontSize:15, cursor:"pointer" }}>
                      Supprimer l'événement
                    </button>
                  )}
                </>);
              })()}
            </div>
          </div>
        )}

        {/* CONFIRMATION SUPPRESSION */}
        {confirmDelete && (
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, padding:30 }}>
            <div style={{ background:"#fff", borderRadius:20, padding:"24px 24px 20px", width:"100%" }}>
              <div style={{ fontSize:17, fontWeight:700, color:"#1C1C1E", textAlign:"center", marginBottom:8 }}>Supprimer l'événement ?</div>
              <div style={{ fontSize:14, color:"#8E8E93", textAlign:"center", marginBottom:24 }}>Cette action est irréversible.</div>
              <div style={{ display:"flex", gap:12 }}>
                <button onClick={() => setConfirmDelete(null)} style={{ flex:1, padding:"13px", borderRadius:13, border:"none", background:"#F2F2F7", color:"#1C1C1E", fontWeight:600, fontSize:15, cursor:"pointer" }}>Annuler</button>
                <button onClick={() => deleteEvent(confirmDelete)} style={{ flex:1, padding:"13px", borderRadius:13, border:"none", background:"#FF3B30", color:"#fff", fontWeight:600, fontSize:15, cursor:"pointer" }}>Supprimer</button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL AJOUT ÉVÉNEMENT */}
        {showModal && (
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"flex-end", zIndex:200 }}>
            <div style={{ background:"#fff", borderRadius:"24px 24px 0 0", width:"100%", padding:"20px 24px 40px", maxHeight:"88vh", overflowY:"auto" }}>
              <div style={{ width:36, height:4, background:"#E5E5EA", borderRadius:2, margin:"0 auto 20px" }}/>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                <button onClick={() => setShowModal(false)} style={{ fontSize:15, color:"#FF3B30", background:"none", border:"none", cursor:"pointer", fontWeight:500 }}>Annuler</button>
                <span style={{ fontWeight:700, fontSize:17, color:"#1C1C1E" }}>Nouvel événement</span>
                <button onClick={addEvent} style={{ fontSize:15, color:"#007AFF", background:"none", border:"none", cursor:"pointer", fontWeight:600 }}>Ajouter</button>
              </div>
              {[{p:"Titre *",f:"title",t:"text"},{p:"Date *",f:"date",t:"date"},{p:"Note (optionnel)",f:"note",t:"text"}].map(({p,f,t}) => (
                <input key={f} type={t} placeholder={p} value={newEvent[f]||""}
                  onChange={e => setNewEvent(prev=>({...prev,[f]:e.target.value}))}
                  style={{ width:"100%", padding:"13px 16px", borderRadius:13, border:"none", background:"#F2F2F7", fontSize:15, color:"#1C1C1E", marginBottom:10, outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/>
              ))}
              <div style={{ fontSize:10, fontWeight:600, color:"#8E8E93", marginBottom:10 }}>INVITER</div>
              <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
                {profiles.filter(m => m.id!==profile.id).map(m => {
                  const sel = newEvent.invitees.includes(m.id);
                  return (
                    <button key={m.id} onClick={() => setNewEvent(p=>({...p, invitees:sel?p.invitees.filter(i=>i!==m.id):[...p.invitees,m.id]}))}
                      style={{ display:"flex", alignItems:"center", gap:7, padding:"7px 13px 7px 7px", borderRadius:18, border:`2px solid ${sel?m.color:"transparent"}`, background:sel?m.bg:"#F2F2F7", color:sel?m.color:"#1C1C1E", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                      <div style={{ width:24, height:24, borderRadius:12, background:m.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff" }}>{m.initials}</div>
                      {m.name}{sel&&" ✓"}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TOAST */}
        {toast && (
          <div style={{ position:"absolute", bottom:100, left:"50%", transform:"translateX(-50%)", background:toast.type==="error"?"rgba(255,59,48,0.9)":"rgba(28,28,30,0.9)", color:"#fff", padding:"10px 20px", borderRadius:20, fontSize:13, fontWeight:500, whiteSpace:"nowrap", zIndex:400 }}>
            {toast.msg}
          </div>
        )}

        <style>{`button{-webkit-tap-highlight-color:transparent;}::-webkit-scrollbar{width:0;}`}</style>
      </div>
    </div>
  );
}
