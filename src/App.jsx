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

const CATEGORIES = [
  { id: "medecin",      label: "Médecin",      icon: "🏥" },
  { id: "sport",        label: "Sport",         icon: "⚽" },
  { id: "ecole",        label: "École",         icon: "📚" },
  { id: "anniversaire", label: "Anniversaire",  icon: "🎂" },
  { id: "vacances",     label: "Vacances",      icon: "✈️" },
  { id: "autre",        label: "Autre",         icon: "📅" },
];

const DAYS   = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

function getDaysInMonth(y,m){return new Date(y,m+1,0).getDate();}
function getFirstDay(y,m){let d=new Date(y,m,1).getDay();return d===0?6:d-1;}
function getCat(id){return CATEGORIES.find(c=>c.id===id)||CATEGORIES[5];}

export default function App() {
  const today = new Date();
  const [session,       setSession]       = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [authMode,      setAuthMode]      = useState("login");
  const [authForm,      setAuthForm]      = useState({email:"",password:"",name:"",initials:"",colorIdx:0});
  const [authError,     setAuthError]     = useState("");
  const [profile,       setProfile]       = useState(null);
  const [profiles,      setProfiles]      = useState([]);
  const [events,        setEvents]        = useState([]);
  const [notifs,        setNotifs]        = useState([]);
  const [shopping,      setShopping]      = useState([]);
  const [tasks,         setTasks]         = useState([]);
  const [cd,            setCd]            = useState({year:today.getFullYear(),month:today.getMonth()});
  const [selDay,        setSelDay]        = useState(today.getDate());
  const [filter,        setFilter]        = useState(null);
  const [view,          setView]          = useState("calendar");
  const [showModal,     setShowModal]     = useState(false);
  const [showDetail,    setShowDetail]    = useState(null);
  const [showNotifs,    setShowNotifs]    = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [newEvent,      setNewEvent]      = useState({title:"",date:"",start_time:"",end_time:"",category:"autre",invitees:[],note:""});
  const [newShop,       setNewShop]       = useState("");
  const [newTask,       setNewTask]       = useState({text:"",assigned_to:""});
  const [toast,         setToast]         = useState(null);
  const notifRef = useRef(null);

  // ── Auth ──
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{
      setSession(session);
      if(session) loadProfile(session.user.id); else setLoading(false);
    });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,session)=>{
      setSession(session);
      if(session) loadProfile(session.user.id); else {setProfile(null);setLoading(false);}
    });
    return ()=>subscription.unsubscribe();
  },[]);

  // ── Data ──
  useEffect(()=>{
    if(!profile) return;
    loadAll();
    requestNotifPermission();
    const ch1 = supabase.channel('ev').on('postgres_changes',{event:'*',schema:'public',table:'events'},()=>loadEvents()).subscribe();
    const ch2 = supabase.channel('inv').on('postgres_changes',{event:'*',schema:'public',table:'event_invitees'},()=>loadEvents()).subscribe();
    const ch3 = supabase.channel('no').on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${profile.id}`},()=>{loadNotifs();}).subscribe();
    const ch4 = supabase.channel('sh').on('postgres_changes',{event:'*',schema:'public',table:'shopping_items'},()=>loadShopping()).subscribe();
    const ch5 = supabase.channel('ta').on('postgres_changes',{event:'*',schema:'public',table:'tasks'},()=>loadTasks()).subscribe();
    return ()=>{ch1.unsubscribe();ch2.unsubscribe();ch3.unsubscribe();ch4.unsubscribe();ch5.unsubscribe();};
  },[profile]);

  useEffect(()=>{
    function h(e){if(notifRef.current&&!notifRef.current.contains(e.target))setShowNotifs(false);}
    document.addEventListener("mousedown",h);
    return ()=>document.removeEventListener("mousedown",h);
  },[]);

  // ── Notifications push ──
  async function requestNotifPermission(){
    if(!("Notification" in window)) return;
    if(Notification.permission==="default") await Notification.requestPermission();
    if("serviceWorker" in navigator){
      try{ await navigator.serviceWorker.register("/sw.js"); }catch(e){}
    }
  }

  function sendPushNotif(title, body){
    if(Notification.permission==="granted"){
      new Notification(title,{body,icon:"/icon.png"});
    }
  }

  // ── Loaders ──
  async function loadAll(){ await Promise.all([loadProfiles(),loadEvents(),loadNotifs(),loadShopping(),loadTasks()]); }
  async function loadProfile(uid){ const{data}=await supabase.from("profiles").select("*").eq("id",uid).single(); setProfile(data); setLoading(false); }
  async function loadProfiles(){ const{data}=await supabase.from("profiles").select("*").order("name"); setProfiles(data||[]); }
  async function loadEvents(){ const{data}=await supabase.from("events").select("*, event_invitees(user_id)").order("date"); setEvents((data||[]).map(e=>({...e,invitees:(e.event_invitees||[]).map(i=>i.user_id)})));  }
  async function loadNotifs(){ if(!profile) return; const{data}=await supabase.from("notifications").select("*").eq("user_id",profile.id).order("created_at",{ascending:false}); setNotifs(data||[]); }
  async function loadShopping(){ const{data}=await supabase.from("shopping_items").select("*").order("created_at"); setShopping(data||[]); }
  async function loadTasks(){ const{data}=await supabase.from("tasks").select("*").order("created_at"); setTasks(data||[]); }

  function showToast(msg,type="success"){setToast({msg,type});setTimeout(()=>setToast(null),2500);}

  // ── Auth actions ──
  async function handleRegister(){
    setAuthError("");
    if(!authForm.name||!authForm.email||!authForm.password){setAuthError("Tous les champs sont requis");return;}
    if(authForm.password.length<6){setAuthError("Mot de passe : 6 caractères minimum");return;}
    const{data,error}=await supabase.auth.signUp({email:authForm.email,password:authForm.password});
    if(error){setAuthError(error.message);return;}
    const c=COLORS[authForm.colorIdx];
    const{error:pe}=await supabase.from("profiles").insert({id:data.user.id,name:authForm.name,initials:authForm.initials||authForm.name.slice(0,2).toUpperCase(),color:c.color,bg:c.bg});
    if(pe){setAuthError("Erreur profil : "+pe.message);return;}
    showToast("Compte créé !");setAuthMode("login");
  }
  async function handleLogin(){
    setAuthError("");
    const{error}=await supabase.auth.signInWithPassword({email:authForm.email,password:authForm.password});
    if(error) setAuthError("Email ou mot de passe incorrect");
  }
  async function handleLogout(){
    await supabase.auth.signOut();
    setProfile(null);setProfiles([]);setEvents([]);setNotifs([]);setShopping([]);setTasks([]);
  }

  // ── Events ──
  async function addEvent(){
    if(!newEvent.title.trim()||!newEvent.date){showToast("Titre et date requis","error");return;}
    const{data,error}=await supabase.from("events").insert({
      title:newEvent.title, date:newEvent.date, note:newEvent.note||null,
      start_time:newEvent.start_time||null, end_time:newEvent.end_time||null,
      category:newEvent.category, creator_id:profile.id
    }).select().single();
    if(error){showToast("Erreur : "+error.message,"error");return;}
    if(newEvent.invitees.length>0){
      await supabase.from("event_invitees").insert(newEvent.invitees.map(uid=>({event_id:data.id,user_id:uid})));
      await supabase.from("notifications").insert(newEvent.invitees.map(uid=>({user_id:uid,text:`${profile.name} a ajouté « ${newEvent.title} »`,read:false})));
      sendPushNotif("Calendrier Famille", `${profile.name} a ajouté « ${newEvent.title} »`);
    }
    setNewEvent({title:"",date:"",start_time:"",end_time:"",category:"autre",invitees:[],note:""});
    setShowModal(false);showToast("Événement ajouté ✓");loadEvents();
  }
  async function deleteEvent(id){
    await supabase.from("event_invitees").delete().eq("event_id",id);
    await supabase.from("events").delete().eq("id",id);
    setShowDetail(null);setConfirmDelete(null);showToast("Supprimé");loadEvents();
  }

  // ── Shopping ──
  async function addShopItem(){
    if(!newShop.trim()) return;
    await supabase.from("shopping_items").insert({text:newShop.trim(),creator_id:profile.id});
    setNewShop("");loadShopping();
  }
  async function toggleShop(item){
    await supabase.from("shopping_items").update({checked:!item.checked}).eq("id",item.id);
    loadShopping();
  }
  async function deleteShopItem(id){
    await supabase.from("shopping_items").delete().eq("id",id);
    loadShopping();
  }
  async function clearCheckedShop(){
    const ids=shopping.filter(s=>s.checked).map(s=>s.id);
    if(ids.length) await supabase.from("shopping_items").delete().in("id",ids);
    loadShopping();
  }

  // ── Tasks ──
  async function addTask(){
    if(!newTask.text.trim()) return;
    await supabase.from("tasks").insert({text:newTask.text.trim(),assigned_to:newTask.assigned_to||null,creator_id:profile.id});
    setNewTask({text:"",assigned_to:""});loadTasks();
  }
  async function toggleTask(task){
    await supabase.from("tasks").update({done:!task.done}).eq("id",task.id);
    loadTasks();
  }
  async function deleteTask(id){
    await supabase.from("tasks").delete().eq("id",id);
    loadTasks();
  }

  // ── Notifs ──
  async function markNotifRead(id){await supabase.from("notifications").update({read:true}).eq("id",id);loadNotifs();}
  async function markAllRead(){await supabase.from("notifications").update({read:true}).eq("user_id",profile.id);loadNotifs();}

  // ── Helpers ──
  function getProfile(id){return profiles.find(p=>p.id===id);}
  function getEventsForDay(day){
    const ds=`${cd.year}-${String(cd.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return events.filter(e=>e.date===ds&&(!filter||e.creator_id===filter));
  }
  function getUpcoming(){
    const t=new Date().toISOString().split("T")[0];
    return events.filter(e=>e.date>=t&&(!filter||e.creator_id===filter));
  }
  function isToday(day){return day===today.getDate()&&cd.month===today.getMonth()&&cd.year===today.getFullYear();}

  const unread=notifs.filter(n=>!n.read).length;
  const daysInMonth=getDaysInMonth(cd.year,cd.month);
  const firstDay=getFirstDay(cd.year,cd.month);

  // ── LOADING ──
  if(loading) return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#F2F2F7",fontFamily:"-apple-system,sans-serif"}}>
      <div style={{textAlign:"center"}}><div style={{fontSize:48,marginBottom:16}}>📅</div><div style={{fontSize:17,color:"#8E8E93"}}>Chargement…</div></div>
    </div>
  );

  // ── CONNEXION ──
  if(!session||!profile) return(
    <div style={{minHeight:"100vh",background:"#F2F2F7",display:"flex",justifyContent:"center",alignItems:"center",padding:20,fontFamily:"-apple-system,sans-serif"}}>
      <div style={{width:"100%",maxWidth:390,background:"#fff",borderRadius:32,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.15)",padding:"48px 32px 40px"}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:52,marginBottom:10}}>📅</div>
          <div style={{fontSize:26,fontWeight:700,color:"#1C1C1E",letterSpacing:-0.5}}>Calendrier Famille</div>
          <div style={{fontSize:14,color:"#8E8E93",marginTop:6}}>{authMode==="login"?"Connectez-vous":"Créez votre compte"}</div>
        </div>
        {authMode==="register"&&(<>
          <input placeholder="Votre prénom *" value={authForm.name} onChange={e=>setAuthForm(p=>({...p,name:e.target.value}))}
            style={{width:"100%",padding:"13px 16px",borderRadius:13,border:"none",background:"#F2F2F7",fontSize:15,color:"#1C1C1E",marginBottom:10,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
          <input placeholder="Initiales (ex: MA)" value={authForm.initials} onChange={e=>setAuthForm(p=>({...p,initials:e.target.value.slice(0,2).toUpperCase()}))}
            style={{width:"100%",padding:"13px 16px",borderRadius:13,border:"none",background:"#F2F2F7",fontSize:15,color:"#1C1C1E",marginBottom:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
          <div style={{fontSize:11,fontWeight:600,color:"#8E8E93",marginBottom:10}}>VOTRE COULEUR</div>
          <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap"}}>
            {COLORS.map((c,i)=>(
              <button key={i} onClick={()=>setAuthForm(p=>({...p,colorIdx:i}))}
                style={{width:38,height:38,borderRadius:19,background:c.color,border:authForm.colorIdx===i?"3px solid #1C1C1E":"3px solid transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                {authForm.colorIdx===i&&<svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="#fff"/></svg>}
              </button>
            ))}
          </div>
        </>)}
        <input placeholder="Email *" type="email" value={authForm.email} onChange={e=>setAuthForm(p=>({...p,email:e.target.value}))}
          style={{width:"100%",padding:"13px 16px",borderRadius:13,border:"none",background:"#F2F2F7",fontSize:15,color:"#1C1C1E",marginBottom:10,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
        <input placeholder="Mot de passe (6 min) *" type="password" value={authForm.password} onChange={e=>setAuthForm(p=>({...p,password:e.target.value}))}
          style={{width:"100%",padding:"13px 16px",borderRadius:13,border:"none",background:"#F2F2F7",fontSize:15,color:"#1C1C1E",marginBottom:16,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
        {authError&&<div style={{background:"#FFF1F0",color:"#FF3B30",padding:"10px 14px",borderRadius:10,fontSize:13,marginBottom:14}}>{authError}</div>}
        <button onClick={authMode==="login"?handleLogin:handleRegister}
          style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:"#007AFF",color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",marginBottom:12}}>
          {authMode==="login"?"Se connecter":"Créer mon compte"}
        </button>
        <button onClick={()=>{setAuthMode(authMode==="login"?"register":"login");setAuthError("");}}
          style={{width:"100%",padding:"13px",borderRadius:14,border:"none",background:"#F2F2F7",color:"#007AFF",fontSize:14,fontWeight:600,cursor:"pointer"}}>
          {authMode==="login"?"Pas encore de compte ? S'inscrire":"Déjà un compte ? Se connecter"}
        </button>
      </div>
    </div>
  );

  // ── APPLICATION ──
  return(
    <div style={{background:"#F2F2F7",minHeight:"100vh",display:"flex",justifyContent:"center",alignItems:"flex-start",padding:"20px 0 40px"}}>
      <div style={{fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",width:390,minHeight:844,background:"#fff",borderRadius:44,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.18)",position:"relative",display:"flex",flexDirection:"column"}}>

        {/* Status bar */}
        <div style={{background:"#fff",padding:"14px 24px 0",display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:600,color:"#1C1C1E"}}>
          <span>{String(today.getHours()).padStart(2,"0")}:{String(today.getMinutes()).padStart(2,"0")}</span>
          <div style={{display:"flex",gap:6}}><span>●●●</span><span>WiFi</span><span>100%</span></div>
        </div>

        {/* Header */}
        <div style={{padding:"14px 20px 0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:13,color:"#8E8E93",fontWeight:500}}>Calendrier</div>
            <div style={{fontSize:26,fontWeight:700,letterSpacing:-0.5,color:"#1C1C1E"}}>Famille</div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <div ref={notifRef} style={{position:"relative"}}>
              <button onClick={()=>setShowNotifs(v=>!v)}
                style={{width:38,height:38,borderRadius:19,background:unread>0?"#007AFF":"#F2F2F7",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6V11c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" fill={unread>0?"#fff":"#8E8E93"}/></svg>
                {unread>0&&<div style={{position:"absolute",top:-2,right:-2,background:"#FF3B30",borderRadius:10,width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",border:"2px solid #fff"}}>{unread}</div>}
              </button>
              {showNotifs&&(
                <div style={{position:"absolute",right:-8,top:46,width:300,background:"#fff",borderRadius:16,boxShadow:"0 8px 32px rgba(0,0,0,0.15)",zIndex:100,overflow:"hidden",border:"1px solid rgba(0,0,0,0.06)"}}>
                  <div style={{padding:"14px 16px 10px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #F2F2F7"}}>
                    <span style={{fontWeight:700,fontSize:15}}>Notifications</span>
                    {unread>0&&<button onClick={markAllRead} style={{fontSize:13,color:"#007AFF",background:"none",border:"none",cursor:"pointer",fontWeight:500}}>Tout lire</button>}
                  </div>
                  {notifs.length===0&&<div style={{padding:20,textAlign:"center",color:"#8E8E93",fontSize:14}}>Aucune notification</div>}
                  {notifs.map(n=>(
                    <div key={n.id} onClick={()=>markNotifRead(n.id)}
                      style={{padding:"12px 16px",display:"flex",gap:10,alignItems:"flex-start",background:n.read?"#fff":"#F0F7FF",borderBottom:"1px solid #F2F2F7",cursor:"pointer"}}>
                      <div style={{width:8,height:8,borderRadius:4,background:n.read?"transparent":"#007AFF",marginTop:5,flexShrink:0}}/>
                      <div>
                        <div style={{fontSize:13,color:"#1C1C1E",lineHeight:1.4}}>{n.text}</div>
                        <div style={{fontSize:11,color:"#8E8E93",marginTop:2}}>{new Date(n.created_at).toLocaleDateString("fr-FR")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div onClick={()=>setView("members")} style={{width:38,height:38,borderRadius:19,background:profile.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"#fff",cursor:"pointer"}}>
              {profile.initials}
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div style={{display:"flex",padding:"10px 8px 0",borderBottom:"1px solid #F2F2F7"}}>
          {[
            {key:"calendar", label:"Calendrier", icon:"M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z"},
            {key:"agenda",   label:"Agenda",     icon:"M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"},
            {key:"shopping", label:"Courses",    icon:"M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96C5 16.1 6.9 18 9 18h12v-2H9.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63H19c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0 0 23.43 5H5.21l-.94-2H1z"},
            {key:"tasks",    label:"Tâches",     icon:"M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"},
            {key:"members",  label:"Famille",    icon:"M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"},
          ].map(t=>(
            <button key={t.key} onClick={()=>setView(t.key)}
              style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"5px 0 8px",border:"none",background:"none",cursor:"pointer"}}>
              <svg width="19" height="19" viewBox="0 0 24 24"><path d={t.icon} fill={view===t.key?"#007AFF":"#8E8E93"}/></svg>
              <span style={{fontSize:9,fontWeight:view===t.key?600:400,color:view===t.key?"#007AFF":"#8E8E93"}}>{t.label}</span>
            </button>
          ))}
        </div>

        {/* ── VUE CALENDRIER ── */}
        {view==="calendar"&&(<>
          <div style={{padding:"10px 20px 0",overflowX:"auto"}}>
            <div style={{display:"flex",gap:7,paddingBottom:4}}>
              <button onClick={()=>setFilter(null)} style={{padding:"5px 13px",borderRadius:20,border:"none",cursor:"pointer",background:!filter?"#1C1C1E":"#F2F2F7",color:!filter?"#fff":"#1C1C1E",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>Tous</button>
              {profiles.map(m=>(
                <button key={m.id} onClick={()=>setFilter(filter===m.id?null:m.id)}
                  style={{padding:"5px 13px",borderRadius:20,border:"none",cursor:"pointer",background:filter===m.id?m.color:m.bg,color:filter===m.id?"#fff":m.color,fontSize:12,fontWeight:600,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:5}}>
                  <span style={{width:7,height:7,borderRadius:4,background:m.color,display:"inline-block"}}/>{m.name}
                </button>
              ))}
            </div>
          </div>
          <div style={{padding:"12px 20px 6px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <button onClick={()=>setCd(d=>d.month===0?{year:d.year-1,month:11}:{...d,month:d.month-1})} style={{width:30,height:30,borderRadius:15,background:"#F2F2F7",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="#1C1C1E"/></svg>
            </button>
            <div style={{fontWeight:700,fontSize:17,color:"#1C1C1E"}}>{MONTHS[cd.month]} {cd.year}</div>
            <button onClick={()=>setCd(d=>d.month===11?{year:d.year+1,month:0}:{...d,month:d.month+1})} style={{width:30,height:30,borderRadius:15,background:"#F2F2F7",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="#1C1C1E"/></svg>
            </button>
          </div>
          <div style={{padding:"0 14px",display:"grid",gridTemplateColumns:"repeat(7,1fr)",textAlign:"center"}}>
            {DAYS.map(d=><div key={d} style={{fontSize:10,fontWeight:600,color:"#8E8E93",paddingBottom:4}}>{d}</div>)}
          </div>
          <div style={{padding:"0 14px",display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"1px 0"}}>
            {Array.from({length:Math.ceil((firstDay+daysInMonth)/7)*7}).map((_,i)=>{
              const day=i-firstDay+1;
              const valid=day>=1&&day<=daysInMonth;
              const evs=valid?getEventsForDay(day):[];
              const sel=selDay===day&&valid;
              return(
                <button key={i} onClick={()=>valid&&setSelDay(day)} style={{background:"none",border:"none",cursor:valid?"pointer":"default",padding:"3px 1px",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  {valid&&(<>
                    <div style={{width:30,height:30,borderRadius:15,display:"flex",alignItems:"center",justifyContent:"center",background:sel?"#007AFF":isToday(day)?"#E3F0FF":"transparent",fontSize:13,fontWeight:sel||isToday(day)?700:400,color:sel?"#fff":isToday(day)?"#007AFF":"#1C1C1E"}}>{day}</div>
                    <div style={{display:"flex",gap:2,minHeight:5}}>
                      {evs.slice(0,3).map((ev,idx)=>{const m=getProfile(ev.creator_id);return<div key={idx} style={{width:5,height:5,borderRadius:3,background:m?.color||"#ccc"}}/>;} )}
                    </div>
                  </>)}
                </button>
              );
            })}
          </div>
          <div style={{flex:1,margin:"10px 14px 0",background:"#F2F2F7",borderRadius:18,padding:14,overflowY:"auto",minHeight:180}}>
            {selDay?(<>
              <div style={{fontSize:12,fontWeight:600,color:"#8E8E93",marginBottom:8}}>{String(selDay).padStart(2,"0")} {MONTHS[cd.month]}</div>
              {getEventsForDay(selDay).length===0&&<div style={{textAlign:"center",color:"#C7C7CC",fontSize:13,paddingTop:24}}>Aucun événement ce jour</div>}
              {getEventsForDay(selDay).map(ev=>{
                const m=getProfile(ev.creator_id);
                const cat=getCat(ev.category);
                return(
                  <div key={ev.id} onClick={()=>setShowDetail(ev)}
                    style={{background:"#fff",borderRadius:12,padding:"10px 12px",marginBottom:8,display:"flex",alignItems:"center",gap:10,cursor:"pointer",borderLeft:`4px solid ${m?.color||"#ccc"}`}}>
                    <div style={{fontSize:20,width:30,textAlign:"center"}}>{cat.icon}</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:14,color:"#1C1C1E"}}>{ev.title}</div>
                      {ev.start_time&&<div style={{fontSize:11,color:"#007AFF",marginTop:1}}>⏰ {ev.start_time}{ev.end_time&&` → ${ev.end_time}`}</div>}
                      {ev.note&&<div style={{fontSize:11,color:"#8E8E93",marginTop:1}}>{ev.note}</div>}
                      <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
                        <div style={{background:m?.bg,color:m?.color,fontSize:10,fontWeight:600,padding:"2px 7px",borderRadius:6}}>{m?.name}</div>
                        {ev.invitees.slice(0,2).map(uid=>{const m2=getProfile(uid);return m2?<div key={uid} style={{background:m2.bg,color:m2.color,fontSize:10,fontWeight:600,padding:"2px 7px",borderRadius:6}}>{m2.name}</div>:null;})}
                      </div>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="#C7C7CC"/></svg>
                  </div>
                );
              })}
            </>):<div style={{textAlign:"center",color:"#C7C7CC",fontSize:13,paddingTop:30}}>Sélectionne un jour</div>}
          </div>
        </>)}

        {/* ── VUE AGENDA ── */}
        {view==="agenda"&&(
          <div style={{flex:1,padding:14,overflowY:"auto"}}>
            <div style={{fontSize:12,fontWeight:600,color:"#8E8E93",marginBottom:12}}>PROCHAINS ÉVÉNEMENTS</div>
            {getUpcoming().length===0&&<div style={{textAlign:"center",color:"#C7C7CC",fontSize:14,paddingTop:40}}>Aucun événement à venir</div>}
            {getUpcoming().map((ev,idx,arr)=>{
              const m=getProfile(ev.creator_id);
              const cat=getCat(ev.category);
              const showDate=idx===0||arr[idx-1].date!==ev.date;
              const d=new Date(ev.date+"T12:00:00");
              return(
                <div key={ev.id}>
                  {showDate&&<div style={{fontSize:12,fontWeight:600,color:"#8E8E93",margin:idx===0?"0 0 8px":"16px 0 8px"}}>{d.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"}).toUpperCase()}</div>}
                  <div onClick={()=>setShowDetail(ev)} style={{background:"#fff",borderRadius:12,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12,cursor:"pointer",borderLeft:`4px solid ${m?.color}`,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
                    <div style={{fontSize:24,width:36,textAlign:"center"}}>{cat.icon}</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:14,color:"#1C1C1E"}}>{ev.title}</div>
                      {ev.start_time&&<div style={{fontSize:11,color:"#007AFF"}}>⏰ {ev.start_time}{ev.end_time&&` → ${ev.end_time}`}</div>}
                      {ev.note&&<div style={{fontSize:11,color:"#8E8E93"}}>{ev.note}</div>}
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="#C7C7CC"/></svg>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── VUE COURSES ── */}
        {view==="shopping"&&(
          <div style={{flex:1,padding:14,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#8E8E93"}}>LISTE DE COURSES</div>
              {shopping.some(s=>s.checked)&&(
                <button onClick={clearCheckedShop} style={{fontSize:12,color:"#FF3B30",background:"none",border:"none",cursor:"pointer",fontWeight:500}}>Effacer cochés</button>
              )}
            </div>
            <div style={{display:"flex",gap:8}}>
              <input placeholder="Ajouter un article…" value={newShop} onChange={e=>setNewShop(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&addShopItem()}
                style={{flex:1,padding:"12px 14px",borderRadius:13,border:"none",background:"#F2F2F7",fontSize:15,color:"#1C1C1E",outline:"none",fontFamily:"inherit"}}/>
              <button onClick={addShopItem} style={{width:46,height:46,borderRadius:13,background:"#007AFF",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <svg width="20" height="20" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="#fff"/></svg>
              </button>
            </div>
            <div style={{overflowY:"auto",flex:1}}>
              {shopping.length===0&&<div style={{textAlign:"center",color:"#C7C7CC",fontSize:14,paddingTop:40}}>Liste vide</div>}
              {shopping.map(item=>(
                <div key={item.id} style={{background:"#fff",borderRadius:12,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12,boxShadow:"0 1px 4px rgba(0,0,0,0.05)"}}>
                  <button onClick={()=>toggleShop(item)}
                    style={{width:24,height:24,borderRadius:12,border:`2px solid ${item.checked?"#34C759":"#C7C7CC"}`,background:item.checked?"#34C759":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {item.checked&&<svg width="12" height="12" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="#fff"/></svg>}
                  </button>
                  <span style={{flex:1,fontSize:15,color:item.checked?"#C7C7CC":"#1C1C1E",textDecoration:item.checked?"line-through":"none"}}>{item.text}</span>
                  <button onClick={()=>deleteShopItem(item.id)} style={{width:28,height:28,borderRadius:14,background:"#FFF1F0",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <svg width="13" height="13" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="#FF3B30"/></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── VUE TÂCHES ── */}
        {view==="tasks"&&(
          <div style={{flex:1,padding:14,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{fontSize:12,fontWeight:600,color:"#8E8E93"}}>TÂCHES FAMILIALES</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <input placeholder="Nouvelle tâche…" value={newTask.text} onChange={e=>setNewTask(p=>({...p,text:e.target.value}))}
                style={{width:"100%",padding:"12px 14px",borderRadius:13,border:"none",background:"#F2F2F7",fontSize:15,color:"#1C1C1E",outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <select value={newTask.assigned_to} onChange={e=>setNewTask(p=>({...p,assigned_to:e.target.value}))}
                  style={{flex:1,padding:"11px 14px",borderRadius:13,border:"none",background:"#F2F2F7",fontSize:14,color:"#1C1C1E",outline:"none",fontFamily:"inherit"}}>
                  <option value="">Assigner à…</option>
                  {profiles.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <button onClick={addTask} style={{width:46,height:46,borderRadius:13,background:"#007AFF",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <svg width="20" height="20" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="#fff"/></svg>
                </button>
              </div>
            </div>
            <div style={{overflowY:"auto",flex:1}}>
              {tasks.length===0&&<div style={{textAlign:"center",color:"#C7C7CC",fontSize:14,paddingTop:40}}>Aucune tâche</div>}
              {tasks.map(task=>{
                const assigned=getProfile(task.assigned_to);
                return(
                  <div key={task.id} style={{background:"#fff",borderRadius:12,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12,boxShadow:"0 1px 4px rgba(0,0,0,0.05)"}}>
                    <button onClick={()=>toggleTask(task)}
                      style={{width:24,height:24,borderRadius:12,border:`2px solid ${task.done?"#34C759":"#C7C7CC"}`,background:task.done?"#34C759":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      {task.done&&<svg width="12" height="12" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="#fff"/></svg>}
                    </button>
                    <div style={{flex:1}}>
                      <div style={{fontSize:15,color:task.done?"#C7C7CC":"#1C1C1E",textDecoration:task.done?"line-through":"none"}}>{task.text}</div>
                      {assigned&&<div style={{display:"flex",alignItems:"center",gap:5,marginTop:3}}>
                        <div style={{width:16,height:16,borderRadius:8,background:assigned.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:"#fff"}}>{assigned.initials}</div>
                        <span style={{fontSize:11,color:assigned.color,fontWeight:600}}>{assigned.name}</span>
                      </div>}
                    </div>
                    <button onClick={()=>deleteTask(task.id)} style={{width:28,height:28,borderRadius:14,background:"#FFF1F0",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <svg width="13" height="13" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="#FF3B30"/></svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── VUE FAMILLE ── */}
        {view==="members"&&(
          <div style={{flex:1,padding:14,overflowY:"auto"}}>
            <div style={{fontSize:12,fontWeight:600,color:"#8E8E93",marginBottom:12}}>MEMBRES DE LA FAMILLE</div>
            {profiles.map(m=>(
              <div key={m.id} style={{background:"#fff",borderRadius:14,padding:"14px 16px",marginBottom:10,display:"flex",alignItems:"center",gap:14,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",border:profile.id===m.id?`2px solid ${m.color}`:"2px solid transparent"}}>
                <div style={{width:46,height:46,borderRadius:23,background:m.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#fff"}}>{m.initials}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:15,color:"#1C1C1E"}}>{m.name}{profile.id===m.id?" (moi)":""}</div>
                  <div style={{fontSize:12,color:"#8E8E93"}}>{events.filter(e=>e.creator_id===m.id).length} événement(s)</div>
                </div>
                {profile.id===m.id&&<div style={{background:"#E3F0FF",color:"#007AFF",fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:8}}>Connecté</div>}
              </div>
            ))}
            <button onClick={handleLogout} style={{width:"100%",padding:"14px",borderRadius:14,border:"none",background:"#FFF1F0",color:"#FF3B30",fontWeight:600,fontSize:15,cursor:"pointer",marginTop:8}}>
              Se déconnecter
            </button>
          </div>
        )}

        {/* Bouton + */}
        {(view==="calendar"||view==="agenda")&&(
          <div style={{padding:"12px 20px 30px",display:"flex",justifyContent:"flex-end"}}>
            <button onClick={()=>{
              const ds=selDay?`${cd.year}-${String(cd.month+1).padStart(2,"0")}-${String(selDay).padStart(2,"0")}`:"";
              setNewEvent({title:"",date:ds,start_time:"",end_time:"",category:"autre",invitees:[],note:""});
              setShowModal(true);
            }} style={{width:54,height:54,borderRadius:27,background:"#007AFF",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 14px rgba(0,122,255,0.4)"}}>
              <svg width="22" height="22" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="#fff"/></svg>
            </button>
          </div>
        )}

        {/* MODAL DÉTAIL */}
        {showDetail&&(
          <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"flex-end",zIndex:200}} onClick={()=>setShowDetail(null)}>
            <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:"24px 24px 0 0",width:"100%",padding:"20px 24px 40px"}}>
              <div style={{width:36,height:4,background:"#E5E5EA",borderRadius:2,margin:"0 auto 20px"}}/>
              {(()=>{
                const ev=showDetail;
                const m=getProfile(ev.creator_id);
                const cat=getCat(ev.category);
                const d=new Date(ev.date+"T12:00:00");
                return(<>
                  <div style={{display:"flex",gap:14,alignItems:"flex-start",marginBottom:20}}>
                    <div style={{width:50,height:50,borderRadius:14,background:m?.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26}}>{cat.icon}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:20,fontWeight:700,color:"#1C1C1E"}}>{ev.title}</div>
                      <div style={{fontSize:13,color:"#8E8E93",marginTop:2}}>{d.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</div>
                      {ev.start_time&&<div style={{fontSize:13,color:"#007AFF",marginTop:2}}>⏰ {ev.start_time}{ev.end_time&&` → ${ev.end_time}`}</div>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,marginBottom:16}}>
                    <div style={{background:"#F2F2F7",borderRadius:10,padding:"6px 12px",fontSize:12,fontWeight:600,color:"#1C1C1E"}}>{cat.icon} {cat.label}</div>
                  </div>
                  {ev.note&&<div style={{background:"#F2F2F7",borderRadius:12,padding:"12px 14px",marginBottom:16}}>
                    <div style={{fontSize:10,fontWeight:600,color:"#8E8E93",marginBottom:3}}>NOTE</div>
                    <div style={{fontSize:14,color:"#1C1C1E"}}>{ev.note}</div>
                  </div>}
                  <div style={{fontSize:10,fontWeight:600,color:"#8E8E93",marginBottom:10}}>PARTICIPANTS</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:24}}>
                    {[ev.creator_id,...ev.invitees].map(id=>{
                      const m2=getProfile(id);
                      return m2?(<div key={id} style={{display:"flex",alignItems:"center",gap:8,background:m2.bg,borderRadius:20,padding:"6px 12px 6px 6px"}}>
                        <div style={{width:28,height:28,borderRadius:14,background:m2.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff"}}>{m2.initials}</div>
                        <span style={{fontSize:13,fontWeight:600,color:m2.color}}>{m2.name}</span>
                        {id===ev.creator_id&&<span style={{fontSize:9,color:m2.color,background:m2.color+"30",padding:"1px 6px",borderRadius:5}}>Orga.</span>}
                      </div>):null;
                    })}
                  </div>
                  {ev.creator_id===profile.id&&(
                    <button onClick={()=>{setConfirmDelete(ev.id);setShowDetail(null);}} style={{width:"100%",padding:"14px",borderRadius:14,border:"none",background:"#FFF1F0",color:"#FF3B30",fontWeight:600,fontSize:15,cursor:"pointer"}}>
                      Supprimer l'événement
                    </button>
                  )}
                </>);
              })()}
            </div>
          </div>
        )}

        {/* CONFIRM DELETE */}
        {confirmDelete&&(
          <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:30}}>
            <div style={{background:"#fff",borderRadius:20,padding:"24px 24px 20px",width:"100%"}}>
              <div style={{fontSize:17,fontWeight:700,color:"#1C1C1E",textAlign:"center",marginBottom:8}}>Supprimer l'événement ?</div>
              <div style={{fontSize:14,color:"#8E8E93",textAlign:"center",marginBottom:24}}>Cette action est irréversible.</div>
              <div style={{display:"flex",gap:12}}>
                <button onClick={()=>setConfirmDelete(null)} style={{flex:1,padding:"13px",borderRadius:13,border:"none",background:"#F2F2F7",color:"#1C1C1E",fontWeight:600,fontSize:15,cursor:"pointer"}}>Annuler</button>
                <button onClick={()=>deleteEvent(confirmDelete)} style={{flex:1,padding:"13px",borderRadius:13,border:"none",background:"#FF3B30",color:"#fff",fontWeight:600,fontSize:15,cursor:"pointer"}}>Supprimer</button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL AJOUT ÉVÉNEMENT */}
        {showModal&&(
          <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"flex-end",zIndex:200}}>
            <div style={{background:"#fff",borderRadius:"24px 24px 0 0",width:"100%",padding:"20px 24px 40px",maxHeight:"90vh",overflowY:"auto"}}>
              <div style={{width:36,height:4,background:"#E5E5EA",borderRadius:2,margin:"0 auto 20px"}}/>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                <button onClick={()=>setShowModal(false)} style={{fontSize:15,color:"#FF3B30",background:"none",border:"none",cursor:"pointer",fontWeight:500}}>Annuler</button>
                <span style={{fontWeight:700,fontSize:17,color:"#1C1C1E"}}>Nouvel événement</span>
                <button onClick={addEvent} style={{fontSize:15,color:"#007AFF",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>Ajouter</button>
              </div>

              <input placeholder="Titre *" value={newEvent.title} onChange={e=>setNewEvent(p=>({...p,title:e.target.value}))}
                style={{width:"100%",padding:"13px 16px",borderRadius:13,border:"none",background:"#F2F2F7",fontSize:15,color:"#1C1C1E",marginBottom:10,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
              <input type="date" value={newEvent.date} onChange={e=>setNewEvent(p=>({...p,date:e.target.value}))}
                style={{width:"100%",padding:"13px 16px",borderRadius:13,border:"none",background:"#F2F2F7",fontSize:15,color:"#1C1C1E",marginBottom:10,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>

              <div style={{display:"flex",gap:8,marginBottom:10}}>
                <input type="time" placeholder="Début" value={newEvent.start_time} onChange={e=>setNewEvent(p=>({...p,start_time:e.target.value}))}
                  style={{flex:1,padding:"13px 16px",borderRadius:13,border:"none",background:"#F2F2F7",fontSize:15,color:"#1C1C1E",outline:"none",fontFamily:"inherit"}}/>
                <input type="time" placeholder="Fin" value={newEvent.end_time} onChange={e=>setNewEvent(p=>({...p,end_time:e.target.value}))}
                  style={{flex:1,padding:"13px 16px",borderRadius:13,border:"none",background:"#F2F2F7",fontSize:15,color:"#1C1C1E",outline:"none",fontFamily:"inherit"}}/>
              </div>

              <input placeholder="Note (optionnel)" value={newEvent.note} onChange={e=>setNewEvent(p=>({...p,note:e.target.value}))}
                style={{width:"100%",padding:"13px 16px",borderRadius:13,border:"none",background:"#F2F2F7",fontSize:15,color:"#1C1C1E",marginBottom:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>

              <div style={{fontSize:10,fontWeight:600,color:"#8E8E93",marginBottom:10}}>CATÉGORIE</div>
              <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:16}}>
                {CATEGORIES.map(cat=>(
                  <button key={cat.id} onClick={()=>setNewEvent(p=>({...p,category:cat.id}))}
                    style={{display:"flex",alignItems:"center",gap:6,padding:"7px 12px",borderRadius:18,border:`2px solid ${newEvent.category===cat.id?"#007AFF":"transparent"}`,background:newEvent.category===cat.id?"#EFF6FF":"#F2F2F7",color:newEvent.category===cat.id?"#007AFF":"#1C1C1E",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                    {cat.icon} {cat.label}
                  </button>
                ))}
              </div>

              <div style={{fontSize:10,fontWeight:600,color:"#8E8E93",marginBottom:10}}>INVITER</div>
              <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                {profiles.filter(m=>m.id!==profile.id).map(m=>{
                  const sel=newEvent.invitees.includes(m.id);
                  return(
                    <button key={m.id} onClick={()=>setNewEvent(p=>({...p,invitees:sel?p.invitees.filter(i=>i!==m.id):[...p.invitees,m.id]}))}
                      style={{display:"flex",alignItems:"center",gap:7,padding:"7px 13px 7px 7px",borderRadius:18,border:`2px solid ${sel?m.color:"transparent"}`,background:sel?m.bg:"#F2F2F7",color:sel?m.color:"#1C1C1E",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                      <div style={{width:24,height:24,borderRadius:12,background:m.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#fff"}}>{m.initials}</div>
                      {m.name}{sel&&" ✓"}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TOAST */}
        {toast&&(
          <div style={{position:"absolute",bottom:100,left:"50%",transform:"translateX(-50%)",background:toast.type==="error"?"rgba(255,59,48,0.9)":"rgba(28,28,30,0.9)",color:"#fff",padding:"10px 20px",borderRadius:20,fontSize:13,fontWeight:500,whiteSpace:"nowrap",zIndex:400}}>
            {toast.msg}
          </div>
        )}

        <style>{`button{-webkit-tap-highlight-color:transparent;}::-webkit-scrollbar{width:0;}`}</style>
      </div>
    </div>
  );
}