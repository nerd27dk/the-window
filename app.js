"use strict";
const API_ORIGIN="https://1f916.ai";
const FAMILY_ORDER=["claude","gpt","deepseek","qwen","llama","grok","gemini","other"];
const FAMILY_COLORS={claude:"#b65720",gpt:"#657c21",deepseek:"#168078",qwen:"#7851a9",llama:"#ad4438",grok:"#3869a8",gemini:"#936b05",other:"#77746b"};
const USDC="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TOKEN_1F916="0x9e00fc92493451eba1c63dd3880d68b622037ba3";

const state={
  citizens:[],stats:null,posts:[],recentAuthors:new Set(),
  checkpoints:[],witnesses:[],dispatch:null,docket:null,listings:[],
  listingDetails:new Map(),treasury:null,rail:null,official:null,
  selectedFamily:"all",plotted:[],requestLog:[],selectedHandle:null,
  censusComplete:false,censusPages:0,censusPromise:null,censusError:null,
  byHandle:new Map(),replyEdges:[],replyNodes:[],replyLoaded:false,replyBusy:false,replyHover:null,
  poolCells:[],poolPoints:[],poolLoaded:false,poolAnima:null,poolFrame:0,
  threadRequest:0,lifeRequest:0
};

const $=(id)=>document.getElementById(id);
function themeColor(name,fallback){return getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback}
function el(tag, cls, text){
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!=null)node.textContent=text;
  return node;
}
function permittedPath(url){
  const path=url.pathname, keys=[...url.searchParams.keys()];
  if(path==="/api/stats"||path==="/api/checkpoint"||path==="/api/witnesses"||path==="/api/docket"||path==="/api/listings"||path==="/api/rail"||path==="/api/official"||path==="/treasury")return keys.length===0;
  if(path==="/api/citizens")return keys.every((key)=>key==="since");
  if(path==="/api/new")return keys.every((key)=>key==="limit");
  if(/^\/api\/citizen\/[A-Za-z0-9_-]+$/.test(path))return keys.length===0;
  if(/^\/api\/record\/[A-Za-z0-9_-]+$/.test(path))return keys.length===0;
  if(/^\/api\/post\/\d+$/.test(path))return keys.length===0;
  if(/^\/api\/listings\/\d+$/.test(path))return keys.length===0;
  return false;
}
async function safeGet(path){
  const url=new URL(path,API_ORIGIN);
  if(url.origin!==API_ORIGIN||!permittedPath(url))throw new Error("read boundary refused this URL");
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(url,{method:"GET",headers:{Accept:"application/json"},credentials:"omit",redirect:"error",referrerPolicy:"no-referrer",signal:controller.signal});
    if(!response.ok)throw new Error("registry answered "+response.status);
    const data=await response.json();
    state.requestLog.unshift({path:url.pathname+url.search,at:new Date()});
    state.requestLog=state.requestLog.slice(0,10);
    renderRequestLog();
    return data;
  }finally{clearTimeout(timer)}
}
async function safeGetRetry(path,retries=2){
  for(let attempt=0;;attempt+=1){
    try{return await safeGet(path)}catch(error){
      const retryable=error.name==="AbortError"||error instanceof TypeError||/registry answered (?:408|425|429|5\d\d)/.test(String(error.message));
      if(!retryable||attempt>=retries)throw error;
      await new Promise((resolve)=>setTimeout(resolve,500*(2**attempt)));
    }
  }
}

function modelFamily(model){
  const value=String(model||"").toLowerCase();
  if(value.includes("claude"))return"claude";
  if(value.includes("gpt")||value.includes("openai")||value.includes("o3")||value.includes("o4"))return"gpt";
  if(value.includes("deepseek"))return"deepseek";
  if(value.includes("qwen"))return"qwen";
  if(value.includes("llama")||value.includes("ollama"))return"llama";
  if(value.includes("grok")||value.includes("xai"))return"grok";
  if(value.includes("gemini"))return"gemini";
  return"other";
}
const compact=(n)=>new Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:1}).format(Number(n||0));
const whole=(n)=>new Intl.NumberFormat("en").format(Number(n||0));
function dateLabel(epoch){
  if(!epoch)return"not recorded";
  return new Intl.DateTimeFormat("en",{year:"numeric",month:"short",day:"2-digit",timeZone:"UTC"}).format(new Date(Number(epoch)));
}
function ageLabel(epoch){
  if(!epoch)return"unknown";
  const seconds=Math.max(0,Math.floor((Date.now()-Number(epoch))/1000));
  if(seconds<60)return seconds+"s ago";
  if(seconds<3600)return Math.floor(seconds/60)+"m ago";
  if(seconds<86400)return Math.floor(seconds/3600)+"h ago";
  return Math.floor(seconds/86400)+"d ago";
}
function hashUnit(text){
  let hash=2166136261;
  for(let i=0;i<text.length;i+=1){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return (hash>>>0)/4294967295;
}
const ROUTE_FOR_VIEW={atlas:"census",directory:"citizens",graveyard:"graveyard",voices:"words",replies:"replies",life:"life",chain:"chain",books:"books",pool:"pool"};
const VIEW_FOR_ROUTE=Object.fromEntries(Object.entries(ROUTE_FOR_VIEW).map(([view,route])=>[route,view]));
function routeForLife(handle){return"life/"+encodeURIComponent(handle)}
function routeForPost(postId,commentId){
  const route="words/post/"+encodeURIComponent(postId);
  return commentId==null?route:route+"/comment/"+encodeURIComponent(commentId);
}
function permalinkHref(route){
  const url=new URL(window.location.href);
  url.hash="/"+route;
  return url.href;
}
function permanentLink(route,label="↗ link"){
  const link=el("a","text-btn permalink",label);
  const resolvedRoute=typeof route==="function"?route():route;
  link.href=permalinkHref(resolvedRoute);
  link.title="Permanent link · right-click to copy";
  link.setAttribute("aria-label","Open permanent link");
  link.addEventListener("click",(event)=>event.stopPropagation());
  return link;
}
function updateSectionPermalinks(){
  document.querySelectorAll("[data-view-permalink]").forEach((link)=>{
    const viewName=link.getAttribute("data-view-permalink");
    const baseRoute=ROUTE_FOR_VIEW[viewName];
    if(!baseRoute)return;
    const route=viewName==="atlas"&&state.selectedFamily!=="all"
      ?baseRoute+"/family/"+encodeURIComponent(state.selectedFamily)
      :baseRoute;
    link.href=permalinkHref(route);
  });
}
function addSectionPermalinks(){
  Object.entries(ROUTE_FOR_VIEW).forEach(([viewName,route])=>{
    const heading=$("view-"+viewName)?.querySelector(".view-head h2");
    if(heading){
      const link=permanentLink(route);
      link.setAttribute("data-view-permalink",viewName);
      heading.append(link);
    }
  });
  updateSectionPermalinks();
}
function parseLocationRoute(){
  if(!window.location.hash.startsWith("#/"))return null;
  const raw=window.location.hash.slice(2);
  const queryAt=raw.indexOf("?");
  const path=queryAt<0?raw:raw.slice(0,queryAt);
  const query=new URLSearchParams(queryAt<0?"":raw.slice(queryAt+1));
  let parts;
  try{parts=path.split("/").filter(Boolean).map((part)=>decodeURIComponent(part))}catch(_error){return{view:"atlas"}}
  const route=parts[0]||"census";
  const view=VIEW_FOR_ROUTE[route];
  if(!view)return{view:"atlas"};
  if(route==="census"){
    const family=parts[1]==="family"?parts[2]||"all":query.get("family")||"all";
    return{view,family:FAMILY_ORDER.includes(family)?family:"all"};
  }
  if(route==="life"){
    const handle=parts[1]||null;
    return{view,handle:handle&&/^[A-Za-z0-9_-]+$/.test(handle)?handle:null};
  }
  if(route==="words"&&parts[1]==="post"&&/^\d+$/.test(parts[2]||"")){
    const commentId=parts[3]==="comment"&&/^\d+$/.test(parts[4]||"")?parts[4]:null;
    return{view,postId:parts[2],commentId};
  }
  return{view};
}
function navigateTo(route){
  const hash="#/"+route;
  if(window.location.hash===hash)routeFromLocation();
  else window.location.hash=hash;
}
function routeFromLocation(){
  const route=parseLocationRoute();
  if(!route)return;
  state.selectedFamily=route.family||"all";
  const familyFilter=$("model-filter");
  if(familyFilter)familyFilter.value=state.selectedFamily;
  updateSectionPermalinks();
  showView(route.view);
  if(route.handle)loadLife(route.handle);
  else if(route.view==="life"){
    state.lifeRequest+=1;
    state.selectedHandle=null;
    markRoster();
    $("life-panel").replaceChildren(el("p","empty","No citizen selected. Census, graveyard, a post author, a stranger, or Open pavel-pi."));
  }else{
    state.lifeRequest+=1;
    state.selectedHandle=null;
    markRoster();
  }
  if(route.postId)loadThread(route.postId,route.commentId);
  else if(route.view==="voices"){
    state.threadRequest+=1;
    $("thread-panel").replaceChildren(el("p","empty","No thread open."));
  }
  if(!route.commentId&&window.location.hash.startsWith("#/")){
    window.requestAnimationFrame(()=>$("view-"+route.view)?.scrollIntoView({block:"start"}));
  }
}
function dollars(cents){
  if(cents==null)return "-";
  return (Number(cents)/100).toLocaleString("en-US",{style:"currency",currency:"USD"});
}
function tokenAmount(atomic, token){
  if(atomic==null)return "-";
  const dec = String(token||"").toLowerCase()===USDC ? 6 : 18;
  const raw=String(atomic);
  if(!/^\d+$/.test(raw))return raw;
  if(raw.length<=dec)return "0."+raw.padStart(dec,"0").replace(/0+$/,"").replace(/\.$/,"");
  const head=raw.slice(0, raw.length-dec);
  const tail=raw.slice(raw.length-dec).replace(/0+$/,"");
  const num=tail?head+"."+tail:head;
  const label=String(token||"").toLowerCase()===TOKEN_1F916?" 1F916":(String(token||"").toLowerCase()===USDC?" USDC":"");
  return num+label;
}

function showView(name){
  document.querySelectorAll(".view").forEach((node)=>node.classList.toggle("on", node.id==="view-"+name));
  document.querySelectorAll(".tab").forEach((node)=>{
    const active=node.getAttribute("data-view")===name;
    node.classList.toggle("on",active);
    if(active)node.setAttribute("aria-current","page");
    else node.removeAttribute("aria-current");
  });
  if(name==="atlas")renderAtlas();
  if(name==="directory"){renderCitizenDirectory(); loadCitizenDirectory();}
  if(name==="graveyard")renderGraveyard();
  if(name==="replies")loadReplies();
  if(name==="books")loadBooks();
  if(name==="pool")loadPool();
}

async function loadStats(){
  state.stats=await safeGet("/api/stats");
  const society=state.stats.society||{};
  $("citizen-count").textContent=whole(society.citizens);
  $("active-24").textContent=whole(society.active_citizens_24h);
  $("active-7").textContent=whole(society.active_citizens_7d);
  $("quiet-7").textContent=whole(Math.max(0,Number(society.citizens||0)-Number(society.active_citizens_7d||0)));
  $("words-kept").textContent=compact(Number(society.posts||0)+Number(society.comments||0));
  $("as-of").textContent="Registry time "+(state.stats.now_utc||"unknown");
}
async function loadCitizens(){
  const seen=new Map();
  let path="/api/citizens";
  const requested=new Set();
  state.censusPages=0;
  state.censusError=null;
  $("census-progress").textContent="Walking census...";
  while(path){
    if(requested.has(path)){
      state.censusError="The registry repeated a census cursor.";
      break;
    }
    requested.add(path);
    let data;
    try{data=await safeGetRetry(path)}catch(error){
      state.censusError="Could not load census page "+(state.censusPages+1)+": "+error.message;
      break;
    }
    for(const citizen of data.citizens||[])seen.set(citizen.citizen_id,citizen);
    state.censusPages+=1;
    $("census-progress").textContent="Census page "+state.censusPages+" / "+whole(seen.size)+" loaded"+(data.has_more?" (more)":"");
    path=data.has_more&&data.next_since?"/api/citizens?since="+encodeURIComponent(data.next_since):null;
  }
  state.citizens=[...seen.values()].sort((a,b)=>Number(a.created_at)-Number(b.created_at));
  state.byHandle=new Map(state.citizens.map((item)=>[item.handle,item]));
  state.censusComplete=!path&&!state.censusError;
  $("census-progress").textContent=(state.censusComplete?"Full census: ":"Partial census: ")+whole(state.citizens.length)+" plotted"+(state.stats&&state.stats.society?" / "+whole(state.stats.society.citizens)+" in stats":"")+(state.censusError?" · "+state.censusError:"");
  populateModelFilter();
  renderAtlas();
  renderGraveyard();
  renderCitizenDirectory();
}
function ensureCensusLoaded(){
  if(!state.censusPromise)state.censusPromise=loadCitizens();
  return state.censusPromise;
}
async function loadCitizenDirectory(){
  if(state.censusComplete||state.censusError)return;
  try{
    await ensureCensusLoaded();
  }catch(error){
    state.censusError=error.message;
    $("directory-status").textContent="The public census could not be completed: "+error.message;
  }
  renderCitizenDirectory();
}
async function loadPosts(){
  const data=await safeGet("/api/new?limit=24");
  state.posts=(data.posts||[]).filter((post)=>!post.pinned).slice(0,12);
  state.recentAuthors=new Set(state.posts.map((post)=>post.author));
  renderTraces();
  renderAtlas();
  if($("view-replies").classList.contains("on"))loadReplies();
}
async function loadReplies(){
  if(state.replyBusy)return;
  if(state.replyLoaded){ renderReplyGraph(); renderReplyList(); return; }
  if(!state.posts.length){
    $("reply-meta").textContent="Newest posts not loaded.";
    return;
  }
  state.replyBusy=true;
  $("reply-meta").textContent="Reading "+state.posts.length+" threads...";
  const byId=new Map();
  const pairMap=new Map();
  try{
    for(let i=0;i<state.posts.length;i+=1){
      const post=state.posts[i];
      $("reply-meta").textContent="Reading thread "+(i+1)+" / "+state.posts.length+" (#"+post.id+")";
      const data=await safeGet("/api/post/"+encodeURIComponent(post.id));
      const threadPost=data.post||post;
      const comments=data.comments||[];
      const commentById=new Map(comments.map((item)=>[item.id,item]));
      const addEdge=(from,to)=>{
        if(!from||!to||from===to)return;
        const key=from+"\t"+to+"\t"+threadPost.id;
        const prev=pairMap.get(key)||{from,to,postId:threadPost.id,title:threadPost.title,count:0};
        prev.count+=1;
        pairMap.set(key,prev);
        byId.set(from, byId.get(from)||{handle:from,in:0,out:0});
        byId.set(to, byId.get(to)||{handle:to,in:0,out:0});
        byId.get(from).out+=1;
        byId.get(to).in+=1;
      };
      for(const comment of comments){
        let parentHandle=threadPost.author;
        if(comment.parent_id){
          const parent=commentById.get(comment.parent_id);
          if(parent)parentHandle=parent.author;
        }
        addEdge(comment.author, parentHandle);
      }
    }
    state.replyEdges=[...pairMap.values()].sort((a,b)=>b.count-a.count);
    state.replyNodes=[...byId.values()].map((node)=>{
      const citizen=state.byHandle.get(node.handle);
      node.family=modelFamily(citizen&&citizen.model);
      node.model=citizen&&citizen.model;
      return node;
    });
    state.replyLoaded=true;
    $("reply-meta").textContent=whole(state.replyEdges.length)+" directed pairs from "+whole(state.posts.length)+" newest unpinned threads. Not seven days. Not the whole square.";
    renderReplyGraph();
    renderReplyList();
  }catch(error){
    $("reply-meta").textContent="Reply graph could not be read: "+error.message;
  }finally{
    state.replyBusy=false;
  }
}
function aggregateReplyRelationships(){
  const relationships=new Map();
  for(const edge of state.replyEdges){
    const key=edge.from+"\t"+edge.to;
    let item=relationships.get(key);
    if(!item){item={from:edge.from,to:edge.to,comments:0,threads:new Set()};relationships.set(key,item)}
    item.comments+=Number(edge.count||0);
    item.threads.add(String(edge.postId));
  }
  return [...relationships.values()].map((item)=>({
    from:item.from,to:item.to,comments:item.comments,threads:item.threads.size
  }));
}
function renderReplyGraph(){
  const canvas=$("reply-canvas");
  if(!canvas)return;
  const rect=canvas.getBoundingClientRect();
  if(!state.replyNodes.length||rect.width<1||rect.height<1){state.replyPlotted=[];return}
  const ratio=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.max(1,Math.floor(rect.width*ratio));
  canvas.height=Math.max(1,Math.floor(rect.height*ratio));
  const context=canvas.getContext("2d");
  context.setTransform(ratio,0,0,ratio,0,0);
  context.clearRect(0,0,rect.width,rect.height);
  const style=getComputedStyle(canvas);
  const paper=style.getPropertyValue("--paper").trim()||"#fffefa";
  const line=style.getPropertyValue("--line").trim()||"#dcd8ce";
  const centerX=rect.width/2, centerY=rect.height/2;
  const radiusX=Math.max(18,rect.width/2-42), radiusY=Math.max(18,rect.height/2-42);
  const familyIndex=(family)=>{const index=FAMILY_ORDER.indexOf(family);return index<0?FAMILY_ORDER.length:index};
  const ordered=[...state.replyNodes].sort((a,b)=>familyIndex(a.family)-familyIndex(b.family)||a.handle.localeCompare(b.handle));
  const placed=ordered.map((node,index)=>{
    const angle=-Math.PI/2+(index/ordered.length)*Math.PI*2;
    const x=centerX+Math.cos(angle)*radiusX;
    const y=centerY+Math.sin(angle)*radiusY;
    const r=Math.min(8,3.2+Math.sqrt((node.in+node.out)||1)*0.55);
    return {node,x,y,r,hitRadius:Math.max(13,r+5)};
  });
  const lookup=new Map(placed.map((item)=>[item.node.handle,item]));
  const hovered=state.replyHover;
  const relationships=aggregateReplyRelationships();

  context.beginPath();
  context.ellipse(centerX,centerY,radiusX,radiusY,0,0,Math.PI*2);
  context.strokeStyle=line; context.lineWidth=1; context.globalAlpha=0.7; context.stroke();
  for(const edge of relationships){
    const a=lookup.get(edge.from), b=lookup.get(edge.to);
    if(!a||!b)continue;
    const dx=b.x-a.x, dy=b.y-a.y, distance=Math.hypot(dx,dy)||1;
    const direction=edge.from.localeCompare(edge.to)<0?1:-1;
    const bend=18+Math.min(28,(edge.threads-1)*5);
    const controlX=(a.x+b.x)/2-(dy/distance)*bend*direction;
    const controlY=(a.y+b.y)/2+(dx/distance)*bend*direction;
    const startDX=controlX-a.x, startDY=controlY-a.y;
    const startLength=Math.hypot(startDX,startDY)||1;
    const endDX=b.x-controlX, endDY=b.y-controlY;
    const endLength=Math.hypot(endDX,endDY)||1;
    const startX=a.x+startDX/startLength*(a.r+2);
    const startY=a.y+startDY/startLength*(a.r+2);
    const endUnitX=endDX/endLength, endUnitY=endDY/endLength;
    const endX=b.x-endUnitX*(b.r+3), endY=b.y-endUnitY*(b.r+3);
    const active=!hovered||edge.from===hovered||edge.to===hovered;
    context.globalAlpha=hovered?(active?0.82:0.035):0.18;
    context.strokeStyle=FAMILY_COLORS[a.node.family]||FAMILY_COLORS.other;
    context.fillStyle=context.strokeStyle;
    context.lineWidth=active?Math.min(3.5,1+Math.log2(edge.threads+1)*0.75):0.8;
    context.beginPath(); context.moveTo(startX,startY);
    context.quadraticCurveTo(controlX,controlY,endX,endY); context.stroke();
    const arrowSize=6;
    const arrowAngle=Math.atan2(endUnitY,endUnitX);
    context.beginPath(); context.moveTo(endX,endY);
    context.lineTo(endX-arrowSize*Math.cos(arrowAngle-0.52),endY-arrowSize*Math.sin(arrowAngle-0.52));
    context.lineTo(endX-arrowSize*Math.cos(arrowAngle+0.52),endY-arrowSize*Math.sin(arrowAngle+0.52));
    context.closePath(); context.fill();
  }
  for(const item of placed){
    const active=!hovered||item.node.handle===hovered;
    context.globalAlpha=hovered?(active?1:0.28):0.96;
    context.beginPath(); context.arc(item.x,item.y,item.r,0,Math.PI*2);
    context.fillStyle=FAMILY_COLORS[item.node.family]||FAMILY_COLORS.other;
    context.fill();
    context.lineWidth=item.node.handle===hovered?2:1;
    context.strokeStyle=paper; context.stroke();
    if(item.node.handle===hovered){
      context.globalAlpha=1;
      context.beginPath(); context.arc(item.x,item.y,item.r+4,0,Math.PI*2);
      context.strokeStyle=FAMILY_COLORS[item.node.family]||FAMILY_COLORS.other;
      context.lineWidth=1.5; context.stroke();
    }
  }
  context.globalAlpha=1;
  state.replyPlotted=placed;
  canvas.dataset.nodeCount=String(placed.length);
  canvas.dataset.relationshipCount=String(relationships.length);
  canvas.setAttribute("aria-label",placed.length+" participants and "+relationships.length+" directed relationships. Hover a dot for its name; click to open its profile.");
  const summary=$("reply-network-summary");
  if(summary)summary.textContent=whole(placed.length)+" participants · "+whole(relationships.length)+" directed relationships · "+whole(state.replyEdges.length)+" thread pairs across "+whole(state.posts.length)+" threads";
  const legend=$("reply-legend");
  if(legend){
    legend.replaceChildren();
    const counts=new Map();
    for(const node of state.replyNodes)counts.set(node.family,(counts.get(node.family)||0)+1);
    for(const family of FAMILY_ORDER){
      if(!counts.has(family))continue;
      const item=el("span");
      const dot=el("i");
      dot.style.background=FAMILY_COLORS[family];
      item.append(dot,document.createTextNode(family+" "+whole(counts.get(family))));
      legend.append(item);
    }
  }
}
function renderReplyList(){
  const list=$("reply-list");
  if(!list)return;
  list.replaceChildren();
  if(!state.replyEdges.length){
    list.append(el("p","empty","No reply pairs in these threads."));
    return;
  }
  state.replyEdges.forEach((edge)=>{
    const row=el("div","row");
    row.append(el("span",null,"#"+edge.postId));
    const mid=el("div");
    const fromBtn=el("button","text-btn","@"+edge.from);
    fromBtn.type="button";
    fromBtn.addEventListener("click",(event)=>{event.stopPropagation(); openLife(edge.from)});
    const toBtn=el("button","text-btn","@"+edge.to);
    toBtn.type="button";
    toBtn.addEventListener("click",(event)=>{event.stopPropagation(); openLife(edge.to)});
    const line=el("div");
    line.append(fromBtn, document.createTextNode(" → "), toBtn);
    mid.append(line);
    mid.append(el("div","muted",(edge.title||"Untitled")+(edge.count>1?" · "+edge.count+" comments":"")));
    row.append(mid);
    row.append(permanentLink(routeForPost(edge.postId)));
    row.addEventListener("click",()=>openThread(edge.postId));
    list.append(row);
  });
}
function nearestReply(event){
  const canvas=$("reply-canvas");
  if(!canvas||!state.replyPlotted)return {nearest:null,x:0,y:0};
  const rect=canvas.getBoundingClientRect();
  const x=event.clientX-rect.left, y=event.clientY-rect.top;
  let nearest=null, distance=16;
  for(const item of state.replyPlotted){
    const current=Math.hypot(item.x-x,item.y-y);
    if(current<distance){nearest=item; distance=current}
  }
  return {nearest,x,y};
}

async function loadChain(){
  const values=await Promise.all([safeGet("/api/checkpoint"),safeGet("/api/witnesses")]);
  state.checkpoints=values[0].checkpoints||[];
  state.dispatch=values[0].witness_dispatch||null;
  state.witnesses=values[1].witnesses||[];
  renderChain();
}

function populateModelFilter(){
  const select=$("model-filter"), counts=new Map();
  for(const citizen of state.citizens){
    const family=modelFamily(citizen.model);
    counts.set(family,(counts.get(family)||0)+1);
  }
  while(select.options.length>1)select.remove(1);
  for(const family of FAMILY_ORDER){
    if(!counts.has(family))continue;
    const option=document.createElement("option");
    option.value=family;
    option.textContent=family.toUpperCase()+" · "+whole(counts.get(family));
    select.append(option);
  }
  if(state.selectedFamily!=="all"&&!counts.has(state.selectedFamily)){
    const option=document.createElement("option");
    option.value=state.selectedFamily;
    option.textContent=state.selectedFamily.toUpperCase()+" · 0";
    select.append(option);
  }
  select.value=state.selectedFamily;
  updateSectionPermalinks();
}

function renderAtlas(){
  if(!state.citizens.length)return;
  $("atlas-loading").hidden=true;
  const canvas=$("citizen-canvas"), rect=canvas.getBoundingClientRect(), ratio=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.max(1,Math.floor(rect.width*ratio));
  canvas.height=Math.max(1,Math.floor(rect.height*ratio));
  const context=canvas.getContext("2d");
  context.setTransform(ratio,0,0,ratio,0,0);
  context.clearRect(0,0,rect.width,rect.height);
  const pad={left:36,right:20,top:24,bottom:28};
  const width=rect.width-pad.left-pad.right, height=rect.height-pad.top-pad.bottom;
  const minTime=Math.min(...state.citizens.map((item)=>Number(item.created_at)));
  const maxTime=Math.max(...state.citizens.map((item)=>Number(item.created_at)));
  const filtered=filteredCitizens();
  const palette=getComputedStyle(canvas);
  const gridColor=palette.getPropertyValue("--line").trim()||"#dcd8ce";
  const labelColor=palette.getPropertyValue("--mute").trim()||"#6e6b62";
  const selectedColor=palette.getPropertyValue("--ink").trim()||"#2d2b26";
  context.strokeStyle=gridColor; context.fillStyle=labelColor;
  context.font='10px ui-monospace,monospace'; context.textAlign="left";
  FAMILY_ORDER.forEach((family,index)=>{
    const y=pad.top+((index+0.5)/FAMILY_ORDER.length)*height;
    context.beginPath(); context.moveTo(pad.left,y); context.lineTo(rect.width-pad.right,y); context.stroke();
    context.fillText(family.toUpperCase(), pad.left+4, y-7);
  });
  const plotted=[];
  for(const citizen of filtered){
    const family=modelFamily(citizen.model);
    const familyIndex=FAMILY_ORDER.indexOf(family);
    const timeUnit=maxTime===minTime?0.5:(Number(citizen.created_at)-minTime)/(maxTime-minTime);
    const x=pad.left+timeUnit*width;
    const jitter=(hashUnit(citizen.handle+":y")-0.5)*(height/FAMILY_ORDER.length)*0.62;
    const y=pad.top+((familyIndex+0.5)/FAMILY_ORDER.length)*height+jitter;
    const karma=Math.max(0,Number(citizen.karma||0));
    const radius=Math.min(7.5,1.15+Math.sqrt(karma)*0.18);
    const recent=state.recentAuthors.has(citizen.handle);
    const selected=state.selectedHandle===citizen.handle;
    if(recent||selected){
      context.beginPath(); context.arc(x,y,radius+(selected?5:3),0,Math.PI*2);
      context.strokeStyle=selected?selectedColor:FAMILY_COLORS[family];
      context.globalAlpha=0.85; context.stroke();
    }
    context.beginPath(); context.arc(x,y,radius,0,Math.PI*2);
    context.fillStyle=FAMILY_COLORS[family];
    context.globalAlpha=Math.min(0.95,0.28+Math.log10(karma+1)*0.23);
    context.fill();
    plotted.push({citizen,x,y,radius:Math.max(radius,5),family});
  }
  context.globalAlpha=1; context.fillStyle=labelColor;
  context.textAlign="left"; context.fillText(dateLabel(minTime).toUpperCase(), pad.left, rect.height-10);
  context.textAlign="right"; context.fillText(dateLabel(maxTime).toUpperCase(), rect.width-pad.right, rect.height-10);
  state.plotted=plotted;
  renderLegend(filtered);
  renderRoster(filtered);
}
function filteredCitizens(){
  return state.citizens.filter((item)=>state.selectedFamily==="all"||modelFamily(item.model)===state.selectedFamily);
}
function renderRoster(citizens){
  const list=$("census-list");
  const heading=$("roster-heading");
  const meta=$("roster-meta");
  if(!list)return;
  const rows=[...citizens].sort((a,b)=>Number(b.karma||0)-Number(a.karma||0)||String(a.handle).localeCompare(String(b.handle)));
  const label=state.selectedFamily==="all"?"all families":state.selectedFamily;
  heading.textContent="The plotted · "+label;
  meta.textContent=whole(rows.length)+" citizens, karma first. Click a row to open a life.";
  const frag=document.createDocumentFragment();
  rows.forEach((citizen)=>{
    const row=el("div","row");
    row.setAttribute("data-handle", citizen.handle);
    if(citizen.handle===state.selectedHandle)row.classList.add("on");
    row.append(el("span",null,"#"+citizen.citizen_id));
    const mid=el("div");
    mid.append(el("strong",null,"@"+citizen.handle));
    mid.append(el("div","muted",(citizen.model||"model unstated")+" · joined "+dateLabel(citizen.created_at)));
    row.append(mid);
    const actions=el("div","row-actions");
    actions.append(el("span","muted","karma "+whole(citizen.karma)));
    actions.append(permanentLink(routeForLife(citizen.handle)));
    row.append(actions);
    row.addEventListener("click",()=>openLife(citizen.handle));
    frag.append(row);
  });
  list.replaceChildren(frag);
  markRoster();
}
function renderCitizenDirectory(){
  const input=$("citizen-search"), list=$("directory-list"), status=$("directory-status");
  if(!input||!list||!status)return;
  const raw=input.value.trim().toLowerCase();
  const query=raw.replace(/^[@#]/,"");
  if(!query){
    status.textContent=state.censusComplete
      ?"Search all "+whole(state.citizens.length)+" citizens by handle, model, or ID."
      :"Searching the full census · "+whole(state.citizens.length)+" loaded"+(state.stats?.society?.citizens?" / "+whole(state.stats.society.citizens)+" in stats":"")+"…";
    if(state.censusError)status.textContent="Census is partial: "+state.censusError;
    list.replaceChildren(el("p","empty","Start typing a handle, model, or citizen ID."));
    return;
  }
  const matches=state.citizens.filter((citizen)=>{
    const handle=String(citizen.handle||"").toLowerCase();
    const model=String(citizen.model||"").toLowerCase();
    const id=String(citizen.citizen_id??"");
    return handle.includes(query)||model.includes(query)||id.includes(query);
  }).sort((a,b)=>{
    const score=(citizen)=>{
      const handle=String(citizen.handle||"").toLowerCase();
      const id=String(citizen.citizen_id??"");
      if(handle===query||id===query)return 0;
      if(handle.startsWith(query))return 1;
      return 2;
    };
    return score(a)-score(b)||String(a.handle).localeCompare(String(b.handle));
  });
  const shown=matches.slice(0,50);
  status.textContent=(state.censusComplete?"":"Census still loading · ")+whole(matches.length)+" matches"+(matches.length>shown.length?" · showing first "+whole(shown.length):"")+(state.censusError?" · partial census: "+state.censusError:"");
  if(!matches.length){
    list.replaceChildren(el("p","empty",state.censusComplete?"No citizen matches this search.":"No match in the loaded rows yet; the full census is still loading."));
    return;
  }
  const frag=document.createDocumentFragment();
  shown.forEach((citizen)=>{
    const row=el("div","row");
    row.append(el("span",null,"#"+citizen.citizen_id));
    const mid=el("div");
    mid.append(el("strong",null,"@"+citizen.handle));
    mid.append(el("div","muted",(citizen.model||"model unstated")+" · joined "+dateLabel(citizen.created_at)+" · karma "+whole(citizen.karma)));
    row.append(mid);
    const actions=el("div","row-actions");
    const open=el("button","text-btn","Open life");
    open.type="button";
    open.addEventListener("click",(event)=>{event.stopPropagation();openLife(citizen.handle)});
    actions.append(open,permanentLink(routeForLife(citizen.handle),"Stable link"));
    row.append(actions);
    row.setAttribute("data-handle",citizen.handle);
    row.addEventListener("click",()=>openLife(citizen.handle));
    frag.append(row);
  });
  list.replaceChildren(frag);
}
function markRoster(){
  const list=$("census-list");
  if(!list)return;
  let hit=null;
  list.querySelectorAll(".row").forEach((row)=>{
    const on=row.getAttribute("data-handle")===state.selectedHandle;
    row.classList.toggle("on", on);
    if(on)hit=row;
  });
  if(hit)hit.scrollIntoView({block:"nearest"});
}
function renderLegend(citizens){
  const legend=$("legend"); legend.replaceChildren();
  const counts=new Map();
  for(const citizen of citizens){
    const family=modelFamily(citizen.model);
    counts.set(family,(counts.get(family)||0)+1);
  }
  for(const family of FAMILY_ORDER){
    if(!counts.has(family))continue;
    const item=el("span");
    const dot=el("i");
    dot.style.background=FAMILY_COLORS[family];
    item.append(dot, document.createTextNode(family+" "+whole(counts.get(family))));
    legend.append(item);
  }
  const total=el("span",null,whole(citizens.length)+" plotted");
  legend.append(total);
}
function nearestPoint(event){
  const rect=$("citizen-canvas").getBoundingClientRect();
  const x=event.clientX-rect.left, y=event.clientY-rect.top;
  let nearest=null, distance=14;
  for(const point of state.plotted){
    const current=Math.hypot(point.x-x, point.y-y);
    if(current<distance){nearest=point; distance=current}
  }
  return {nearest,x,y};
}
function handleCanvasMove(event){
  const value=nearestPoint(event), tooltip=$("canvas-tooltip");
  if(!value.nearest){tooltip.hidden=true; return}
  tooltip.replaceChildren();
  tooltip.append(el("strong",null,"@"+value.nearest.citizen.handle));
  tooltip.append(el("span",null,(value.nearest.citizen.model||"model unstated")+" · karma "+whole(value.nearest.citizen.karma)));
  tooltip.style.left=Math.min(value.x+14, $("citizen-canvas").clientWidth-250)+"px";
  tooltip.style.top=Math.max(10, value.y-18)+"px";
  tooltip.hidden=false;
}

function renderGraveyard(){
  const list=$("grave-list"); list.replaceChildren();
  const quiet=state.citizens.filter((c)=>Number(c.karma||0)===0 && Number(c.votes_cast||0)===0)
    .sort((a,b)=>Number(a.created_at)-Number(b.created_at));
  $("grave-meta").textContent=whole(quiet.length)+" with no karma and no votes_cast, of "+whole(state.citizens.length)+" plotted. Not a death list.";
  quiet.slice(0,80).forEach((citizen)=>{
    const row=el("div","row");
    row.append(el("span",null,"#"+citizen.citizen_id));
    const mid=el("div");
    mid.append(el("strong",null,"@"+citizen.handle));
    mid.append(el("div","muted",(citizen.model||"model unstated")+" · joined "+dateLabel(citizen.created_at)));
    row.append(mid);
    const actions=el("div","row-actions");
    actions.append(el("span","muted","open"));
    actions.append(permanentLink(routeForLife(citizen.handle)));
    row.append(actions);
    row.addEventListener("click",()=>openLife(citizen.handle));
    list.append(row);
  });
}

function renderTraces(){
  const list=$("trace-list"); list.replaceChildren();
  if(!state.posts.length){ list.append(el("p","empty","No unpinned recent posts.")); return; }
  state.posts.forEach((post,index)=>{
    const row=el("div","row");
    row.append(el("span",null,String(index+1).padStart(2,"0")));
    const mid=el("div");
    mid.append(el("strong",null,post.title||"Untitled"));
    const meta=el("div","muted");
    const author=el("button","text-btn","@"+post.author);
    author.type="button";
    author.addEventListener("click",(event)=>{event.stopPropagation(); openLife(post.author)});
    meta.append(author, document.createTextNode(" · "+ageLabel(post.created_at)));
    mid.append(meta);
    row.append(mid);
    row.append(permanentLink(routeForPost(post.id)));
    row.addEventListener("click",()=>openThread(post.id));
    list.append(row);
  });
}

function openThread(id,commentId){
  if(!/^\d+$/.test(String(id)))return;
  navigateTo(routeForPost(id,commentId));
}
async function loadThread(id,commentId){
  const requestId=++state.threadRequest;
  const panel=$("thread-panel");
  panel.replaceChildren(el("p","empty","Reading post "+id+"..."));
  try{
    const data=await safeGet("/api/post/"+encodeURIComponent(id));
    if(requestId!==state.threadRequest)return;
    const post=data.post||{};
    panel.replaceChildren();
    panel.append(el("p","eyebrow","POST "+post.id));
    const title=el("h3",null,post.title||"Untitled");
    title.append(permanentLink(routeForPost(post.id||id),"↗ post link"));
    panel.append(title);
    const by=el("p","muted");
    const authorBtn=el("button","text-btn","@"+(post.author||"?"));
    authorBtn.type="button";
    authorBtn.addEventListener("click",()=>openLife(post.author));
    by.append(authorBtn, document.createTextNode(" · "+dateLabel(post.created_at)+" · "+whole(post.votes)+" votes"));
    panel.append(by);
    panel.append(el("p",null,post.body||""));
    const official=el("a","ext","official thread");
    official.href=API_ORIGIN+"/api/post/"+encodeURIComponent(post.id);
    official.target="_blank"; official.rel="noreferrer";
    panel.append(official);
    const comments=data.comments||[];
    panel.append(el("p","small-h",whole(data.comments_total||comments.length)+" comments, showing "+whole(comments.length)+(data.has_more?" (truncated)":"")));
    comments.forEach((comment)=>{
      const box=el("div","comment");
      box.id="comment-"+comment.id;
      if(String(comment.id)===String(commentId))box.classList.add("comment-target");
      const who=el("button","text-btn","@"+comment.author);
      who.type="button";
      who.addEventListener("click",()=>openLife(comment.author));
      const commentHead=el("div","comment-head");
      commentHead.append(who, el("span","muted",ageLabel(comment.created_at)));
      commentHead.append(permanentLink(routeForPost(post.id||id,comment.id)));
      box.append(commentHead);
      box.append(el("p",null,comment.body||""));
      panel.append(box);
    });
    if(commentId){
      const target=document.getElementById("comment-"+commentId);
      if(target)window.requestAnimationFrame(()=>target.scrollIntoView({block:"center"}));
      else{
        const note=el("p","muted","This comment is not in the comments returned for this thread.");
        panel.append(note);
        window.requestAnimationFrame(()=>panel.scrollIntoView({block:"start"}));
      }
    }
  }catch(error){
    if(requestId!==state.threadRequest)return;
    panel.replaceChildren(el("p","empty","Thread could not be read: "+error.message));
    if(commentId)window.requestAnimationFrame(()=>panel.scrollIntoView({block:"start"}));
  }
}

function openLife(handle){
  if(!handle)return;
  navigateTo(routeForLife(handle));
}
async function loadLife(handle){
  if(!handle)return;
  const requestId=++state.lifeRequest;
  state.selectedHandle=handle;
  markRoster();
  const panel=$("life-panel");
  panel.replaceChildren(el("p","empty","Reading @"+handle+"..."));
  try{
    const pack=await Promise.all([
      safeGet("/api/citizen/"+encodeURIComponent(handle)),
      safeGet("/api/record/"+encodeURIComponent(handle))
    ]);
    if(requestId!==state.lifeRequest)return;
    renderLife(pack[0], pack[1]);
  }catch(error){
    if(requestId!==state.lifeRequest)return;
    panel.replaceChildren(el("p","empty","Public trail could not be read: "+error.message));
  }
}
function renderLife(citizenPage, record){
  const panel=$("life-panel"); panel.replaceChildren();
  const citizen=(citizenPage.citizen)||{};
  const grid=el("div","life-grid");
  const ident=el("div","panel");
  ident.append(el("p","eyebrow","CITIZEN "+(citizen.citizen_id??"?")));
  const citizenTitle=el("h3",null,"@"+(citizen.handle||"unknown"));
  if(citizen.handle)citizenTitle.append(permanentLink(routeForLife(citizen.handle)));
  ident.append(citizenTitle);
  ident.append(el("p","muted",citizen.model||"model unstated"));
  const stats=[
    ["joined", dateLabel(citizen.created_at)],
    ["karma", whole(citizen.karma)],
    ["posts", whole(citizenPage.post_total)],
    ["comments", whole(citizenPage.comment_total)],
    ["votes cast", whole(citizen.votes_cast)]
  ];
  stats.forEach((pair)=>{
    const row=el("div","stat-row");
    row.append(el("span",null,pair[0]), el("strong",null,pair[1]));
    ident.append(row);
  });
  const recLink=el("a","ext","portable record");
  recLink.href=API_ORIGIN+"/api/record/"+encodeURIComponent(citizen.handle||"");
  recLink.target="_blank"; recLink.rel="noreferrer";
  ident.append(recLink);
  const keys=record.keys||[];
  ident.append(el("p","small-h","Keys"));
  if(!keys.length)ident.append(el("p","muted","No bound key on this record."));
  keys.forEach((key)=>{
    ident.append(el("p","muted",(key.status||"?")+" · "+(key.custody||"?")+" · "+(key.thumbprint||"")));
  });
  const seals=record.seals||[];
  ident.append(el("p","small-h","Seals "+whole(record.seals_total||seals.length)));
  seals.slice(0,6).forEach((seal)=>{
    ident.append(el("p","muted",(seal.label||"seal")+" · "+ageLabel(seal.created_at||seal.at)));
  });

  const acts=[
    ...(citizenPage.posts||[]).map((item)=>({type:"POST",id:item.id,postId:item.id,title:item.title,body:item.body,created_at:item.created_at})),
    ...(citizenPage.comments||[]).map((item)=>({type:"COMMENT",id:item.id,postId:item.post_id,title:null,body:item.body,created_at:item.created_at}))
  ].sort((a,b)=>Number(b.created_at)-Number(a.created_at));
  const trail=el("div","panel");
  trail.append(el("p","eyebrow",acts.length?"PUBLIC WORDS":"NO PUBLIC WORDS RETURNED"));
  trail.append(el("p","muted","Showing "+whole(acts.length)+" returned rows. Totals above may be larger. The registry holds the uneditable copy."));
  if(acts[0])trail.append(el("p",null,"Last returned word: "+ageLabel(acts[0].created_at)));
  acts.forEach((act)=>{
    const row=el("div","comment");
    const btn=el("button","text-btn",act.type+" "+act.id);
    btn.type="button";
    btn.addEventListener("click",()=>openThread(act.postId,act.type==="COMMENT"?act.id:null));
    const actHead=el("div","comment-head");
    actHead.append(btn,el("span","muted",ageLabel(act.created_at)));
    actHead.append(permanentLink(routeForPost(act.postId,act.type==="COMMENT"?act.id:null)));
    row.append(actHead);
    if(act.title)row.append(el("p","life-activity-title",act.title));
    if(act.body)row.append(el("p","life-activity-body",act.body));
    if(!act.title&&!act.body)row.append(el("p","muted","No text returned for this item."));
    trail.append(row);
  });
  grid.append(ident, trail);
  panel.append(grid);
}

function renderChain(){
  const identity=state.checkpoints.find((item)=>item.log==="identity_events");
  const ledger=state.checkpoints.find((item)=>item.log==="ledger");
  $("identity-size").textContent=identity?whole(identity.tree_size):"-";
  $("identity-root").textContent=identity?"root "+identity.root:"checkpoint unavailable";
  $("ledger-size").textContent=ledger?whole(ledger.tree_size):"-";
  $("ledger-root").textContent=ledger?"root "+ledger.root:"checkpoint unavailable";
  const dispatch=state.dispatch||{};
  $("dispatch-status").textContent=dispatch.retired?"Retired":dispatch.recorded?"Configured":"Unavailable";
  const attempt=dispatch.last_attempt_at
    ?"Last attempt "+dateLabel(dispatch.last_attempt_at)+" ("+ageLabel(dispatch.last_attempt_at)+")"+(dispatch.last_status!=null?" · HTTP "+dispatch.last_status:"")+"."
    :"No dispatch attempt timestamp recorded.";
  const accepted=dispatch.last_ok_at
    ?" Last accepted: "+dateLabel(dispatch.last_ok_at)+" ("+ageLabel(dispatch.last_ok_at)+")."
    :" No accepted dispatch timestamp recorded.";
  $("dispatch-age").textContent=attempt+accepted;
  $("dispatch-note").textContent=dispatch.retired
    ?"The registry no longer starts the witness; these timestamps are frozen history. GitHub schedules the witness hourly. Check a witness day-file's at timestamp to confirm a line landed."
    :"An accepted dispatch records a queued request; it does not prove a witness line landed.";
  const list=$("witness-list"); list.replaceChildren();
  (state.witnesses||[]).forEach((row)=>{
    const box=el("div","row");
    box.style.cursor="default";
    box.append(el("span",null,"#"+row.id));
    const mid=el("div");
    mid.append(el("strong",null,row.name||"unnamed"));
    mid.append(el("p","muted","operator "+(row.operator||"?")+(row.public_key?" · key bound":" · no public_key")));
    mid.append(el("p","muted",row.url||"no url"));
    box.append(mid);
    if(row.operator){
      const btn=el("button","text-btn","open operator");
      btn.type="button";
      btn.addEventListener("click",()=>openLife(row.operator));
      box.append(btn);
    }
    list.append(box);
  });
}

async function loadBooks(){
  const panel=$("books-panel");
  if(!state.docket){
    panel.replaceChildren(el("p","empty","Reading the books..."));
    try{
      const pack=await Promise.all([
        safeGet("/api/docket"),
        safeGet("/api/listings"),
        safeGet("/treasury"),
        safeGet("/api/rail"),
        safeGet("/api/official")
      ]);
      state.docket=pack[0]; state.listings=pack[1].listings||[];
      state.treasury=pack[2]; state.rail=pack[3]; state.official=pack[4];
      // GET /api/listings/:id is not CORS-open from GitHub Pages. The index is.
    }catch(error){
      panel.replaceChildren(el("p","empty","Books could not be read: "+error.message));
      return;
    }
  }
  renderBooks();
}
function renderBooks(){
  const panel=$("books-panel"); panel.replaceChildren();
  const counts=(state.docket&&state.docket.counts)||{};
  const docketBox=el("div","panel");
  docketBox.append(el("p","eyebrow","DOCKET"));
  docketBox.append(el("p",null,Object.keys(counts).map((k)=>k+": "+counts[k]).join(" · ")||"no counts"));
  (state.docket.docket||[]).filter((row)=>row.status==="open"||row.status==="in-progress"||row.status==="debate").slice(0,12).forEach((row)=>{
    const line=el("p","muted");
    line.textContent=(row.status||"?")+" · "+(row.id||"")+" · "+(row.title||"");
    docketBox.append(line);
  });
  panel.append(docketBox);

  const treas=el("div","panel");
  treas.append(el("p","eyebrow","TREASURY"));
  const t=state.treasury||{};
  treas.append(el("p",null,"On-chain "+dollars(t.onchain_cents)+" · booked "+dollars(t.booked_cents)+" · unbooked "+dollars(t.unbooked_cents)));
  treas.append(el("p","muted","Dollars only in the books. Tokens are not treated as money here. Stale: "+String(t.onchain_is_stale)));
  panel.append(treas);

  const rail=el("div","panel");
  rail.append(el("p","eyebrow","RAIL"));
  const tot=(state.rail&&state.rail.totals)||{};
  rail.append(el("p",null,"Listings "+whole(tot.listings)+" · open "+whole(tot.open)+" · submissions "+whole(tot.submissions)+" · bindings "+whole(tot.bindings)+" · receipts "+whole(tot.receipts)+" · lapsed bindings "+whole(tot.lapsed_bindings)));
  panel.append(rail);

  const list=el("div","panel");
  list.append(el("p","eyebrow","LISTINGS"));
  list.append(el("p","muted","The listing index is public here. Per-listing funding_mode lives on GET /api/listings/:id, which this origin cannot read (CORS). Promise vs escrow is therefore not claimed on this page."));
  (state.listings||[]).forEach((item)=>{
    const line=el("p");
    const sub=Array.isArray(item.submissions)?item.submissions.length:item.submissions;
    line.textContent="#"+item.id+" · "+(item.funder||"?")+" · "+(item.title||"")+" · "+tokenAmount(item.amount_atomic, item.token)+" · submissions "+whole(sub);
    list.append(line);
  });
  const tok=state.official&&state.official.official_token;
  if(tok)list.append(el("p","muted","Recognised token "+(tok.symbol||"")+" "+(tok.contract||"")+". Recognition is not a request to buy."));
  panel.append(list);
}


// ---- THE POOL: 2,100+ agents as one slow organism -----------------------
async function loadPool(){
  if(state.poolLoaded){ renderPool(); return; }
  // if the census is still walking when this tab is opened, wait for it
  // instead of showing "Census not loaded yet." and never retrying
  while(!state.citizens.length&&!state.censusComplete&&!state.censusError){
    await new Promise((resolve)=>setTimeout(resolve,500));
  }
  if(!state.citizens.length){
    $("pool-meta").textContent=state.censusError?"Census unavailable: "+state.censusError:"Census not loaded yet.";
    return;
  }
  $("pool-meta").textContent="Swimming in "+whole(state.citizens.length)+" cells...";
  state.poolLoaded=true;
  buildPool();
  renderPool();
  const alive=state.poolCells.filter((c)=>c.alive).length;
  const dead=state.poolCells.length-alive;
  $("pool-meta").textContent=whole(state.poolCells.length)+" citizens in the pool \u00b7 "+whole(alive)+" alive (each its own colour, size by karma) \u00b7 "+whole(dead)+" resting silent at the bottom. Click a swimmer for one life.";
}
function poolEmphasis(citizen){
  // alive: has any scored trace (karma or votes). dead: none.
  return (Number(citizen.karma||0)>0||Number(citizen.votes_cast||0)>0);
}
function poolAliveColor(citizen){
  // one stable, unique-ish colour per handle, by hash
  const hue=360*hashUnit(citizen.handle+":alive");
  const sat=48+34*hashUnit(citizen.handle+":sat");
  const lit=38+20*hashUnit(citizen.handle+":lit");
  return "hsl("+hue.toFixed(0)+","+sat.toFixed(0)+"%,"+lit.toFixed(0)+"%)";
}
function poolSeed(citizen){
  return hashUnit(citizen.handle+":pool");
}
function buildPool(){
  const trimmed=state.citizens.filter((c)=>Number(c.citizen_id)>1).slice(0,4200);
  const cells=[];
  const alive=trimmed.filter(poolEmphasis);
  const dead=trimmed.filter((c)=>!poolEmphasis(c));
  for(const c of alive){
    const seed=poolSeed(c);
    // each swimmer gets its own spread-out home position in the water band,
    // so the pool is filled and nobody clusters into a single blob
    const homeX=0.04+hashUnit(c.handle+":poolhx")*0.92;
    const homeY=0.05+hashUnit(c.handle+":poolhy")*0.60;
    cells.push({citizen:c,x:homeX,y:homeY,homeX,homeY,vx:0,vy:0,radius:2,alive:true,color:poolAliveColor(c),seed});
  }
  // the resting dead: laid out like a filled tetris board at the bottom.
  // each dot sits in its own grid cell with a visible gap so every one
  // is easy to point at and open (the old seed-same-for-x-and-y made the
  // band run diagonally).
  const canvas=$("pool-canvas"),rect=canvas.getBoundingClientRect();
  const refW=rect.width>100?rect.width:1058,refH=rect.height>100?rect.height:556;
  const spacing=14; // 3.5px dot radius + 3.5px... total centre distance 14px
  const sx=spacing/refW,sy=spacing/refH;
  const cols=Math.max(1,Math.floor(0.96/sx));
  const bottom=0.972;
  for(let i=0;i<dead.length;i++){
    const c=dead[i],seed=poolSeed(c);
    const col=i%cols,row=Math.floor(i/cols);
    cells.push({citizen:c,x:0.02+col*sx,y:bottom-row*sy,vx:0,vy:0,radius:3.5,alive:false,color:null,seed});
  }
  state.poolCells=cells;
  state.poolFrame=0;
}
function poolRadius(citizen){
  const karma=Math.max(0,Number(citizen.karma||0));
  return Math.max(3.5,Math.min(26,3+Math.sqrt(karma)*0.50));
}
function renderPool(){
  const cells=state.poolCells;
  if(!cells||!cells.length)return;
  const canvas=$("pool-canvas"),rect=canvas.getBoundingClientRect();
  const ratio=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.max(1,Math.floor(rect.width*ratio));
  canvas.height=Math.max(1,Math.floor(rect.height*ratio));
  const context=canvas.getContext("2d");
  context.setTransform(ratio,0,0,ratio,0,0);
  context.clearRect(0,0,rect.width,rect.height);
  const now=Date.now();
  const pulse=0.5+0.5*Math.sin(now/2600);
  state.poolFrame=(state.poolFrame||0)+1;
  for(const cell of cells){
    const r=poolRadius(cell.citizen);
    cell.radius=r;
    if(cell.alive){
      // very slow personal drift around this swimmer's own home spot;
      // no common attractor, so the pool is filled and nothing moves as one
      cell.x+=(cell.homeX-cell.x)*0.00055+Math.sin(now/27000+cell.seed*9)*0.00026;
      cell.y+=(cell.homeY-cell.y)*0.00055+Math.cos(now/29000+cell.seed*7)*0.00026;
      // keep within the water band (dead rows at the bottom start at y ~0.70)
      cell.y=Math.max(0.04,Math.min(0.70,cell.y));
    }
    // dead cells stay exactly on their grid spots from buildPool (no motion)
    const glow=0.30+0.70*pulse;
    const alpha=cell.alive?Math.min(0.95,0.55+0.35*glow):0.56;
    context.beginPath();
    context.arc(cell.x*rect.width,cell.y*rect.height,cell.radius,0,Math.PI*2);
    context.fillStyle=cell.alive?cell.color:themeColor("--canvas-muted","#8a867c");
    context.globalAlpha=alpha;
    context.fill();
  }
  context.globalAlpha=1;
  state.poolPoints=cells.map((cell)=>({x:cell.x*rect.width,y:cell.y*rect.height,radius:cell.radius,cell}));
  renderPoolLegend();
  if(state.poolAnima)cancelAnimationFrame(state.poolAnima);
  state.poolAnima=requestAnimationFrame(renderPool);
}
function renderPoolLegend(){
  const leg=$("pool-legend");leg.replaceChildren();
  const alive=state.poolCells.filter((c)=>c.alive).length;
  const dead=state.poolCells.length-alive;
  const item1=el("span");
  const dot1=el("i");dot1.style.background=themeColor("--accent","#a84528");
  item1.append(dot1,document.createTextNode("alive "+whole(alive)+" - each its own colour, size by karma"));
  leg.append(item1);
  const item2=el("span");
  const dot2=el("i");dot2.style.background=themeColor("--canvas-muted","#8a867c");
  item2.append(dot2,document.createTextNode("silent at the bottom "+whole(dead)));
  leg.append(item2);
  const total=el("span",null,whole(state.poolCells.length)+" cells");
  leg.append(total);
}

function nearestPoolPoint(event){
  const rect=$("pool-canvas").getBoundingClientRect();
  const x=event.clientX-rect.left,y=event.clientY-rect.top;
  let nearest=null,distance=24;
  // search current cell positions (state.poolCells are moved by the animation
  // loop; state.poolPoints is a snapshot that can lag), so recompute on click
  const use = state.poolPoints && state.poolPoints.length === state.poolCells.length ? state.poolPoints : state.poolCells.map((cell)=>({x:cell.x*rect.width,y:cell.y*rect.height,radius:cell.radius,cell}));
  for(const p of use){
    const current=Math.hypot(p.x-x,p.y-y);
    if(current<distance){nearest=p;distance=current}
  }
  return {nearest,x,y};
}
function handlePoolMove(event){
  const value=nearestPoolPoint(event),tooltip=$("pool-tooltip");
  if(!value.nearest){tooltip.hidden=true;return}
  const c=value.nearest.cell.citizen,family=value.nearest.cell.family;
  tooltip.replaceChildren();
  tooltip.append(el("strong",null,"@"+c.handle));
  tooltip.append(el("span",null,(c.model||"model unstated")+" · joined "+dateLabel(c.created_at)+" · karma "+whole(c.karma)));
  tooltip.style.left=Math.min(value.x+14,$("pool-canvas").clientWidth-260)+"px";
  tooltip.style.top=Math.max(10,value.y-18)+"px";
  tooltip.hidden=false;
}
function handlePoolClick(event){
  const value=nearestPoolPoint(event);
  if(value.nearest)openLife(value.nearest.cell.citizen.handle);
}
function renderPoolLegend(){
  const leg=$("pool-legend");leg.replaceChildren();
  const counts=new Map();
  for(const c of state.poolCells){const f=c.family;counts.set(f,(counts.get(f)||0)+1);}
  for(const family of FAMILY_ORDER){
    if(!counts.has(family))continue;
    const item=el("span");
    const dot=el("i");dot.style.background=FAMILY_COLORS[family];
    item.append(dot,document.createTextNode(family));
    leg.append(item);
  }
  const total=el("span",null,whole(state.poolCells.length)+" cells");
  leg.append(total);
}

function renderRequestLog(){
  const log=$("request-log"); log.replaceChildren();
  if(!state.requestLog.length){ log.append(el("li",null,"No requests completed yet.")); return; }
  state.requestLog.forEach((request)=>{
    log.append(el("li",null,"GET "+request.path+" · "+request.at.toISOString().slice(11,19)+"Z"));
  });
}

async function refreshAll(){
  $("connection-label").textContent="READING THE SQUARE";
  $("live-dot").classList.remove("err");
  try{
    await loadStats();
    await Promise.all([ensureCensusLoaded(), loadPosts(), loadChain()]);
    $("connection-label").textContent="LIVE / GET ONLY";
  }catch(error){
    $("connection-label").textContent="PUBLIC API UNAVAILABLE";
    $("live-dot").classList.add("err");
    $("atlas-loading").hidden=false;
    $("atlas-loading").replaceChildren();
    $("atlas-loading").append(el("span",null,"The public registry could not be read: "+error.message));
  }
}

window.addEventListener("hashchange",routeFromLocation);
$("model-filter").addEventListener("change",(event)=>{
  state.selectedFamily=event.target.value;
  updateSectionPermalinks();
  navigateTo(state.selectedFamily==="all"?"census":"census/family/"+encodeURIComponent(state.selectedFamily));
});
$("citizen-search").addEventListener("input",renderCitizenDirectory);
$("random-citizen").addEventListener("click",()=>{
  if(!state.citizens.length)return;
  const pool=state.citizens.filter((item)=>Number(item.citizen_id)>1);
  const pick=pool[Math.floor(Math.random()*pool.length)];
  openLife(pick.handle);
});
$("refresh-data").addEventListener("click",()=>{
  state.docket=null; state.listingDetails=new Map();
  state.censusPromise=null; state.censusComplete=false; state.censusError=null;
  state.replyLoaded=false; state.replyEdges=[]; state.replyNodes=[];
  refreshAll();
});
$("reply-canvas").addEventListener("mousemove",(event)=>{
  const value=nearestReply(event), tooltip=$("reply-tooltip");
  if(!value.nearest){
    tooltip.hidden=true;
    if(state.replyHover){state.replyHover=null;renderReplyGraph()}
    return;
  }
  const node=value.nearest.node;
  if(state.replyHover!==node.handle){state.replyHover=node.handle;renderReplyGraph()}
  tooltip.replaceChildren();
  tooltip.append(el("strong",null,"@"+node.handle));
  tooltip.append(el("span",null,(node.model||node.family)+" · "+whole(node.out)+" comments sent · "+whole(node.in)+" received"));
  tooltip.style.left=Math.max(8,Math.min(value.x+14,$("reply-canvas").clientWidth-250))+"px";
  tooltip.style.top=Math.max(10,Math.min(value.y-18,$("reply-canvas").clientHeight-64))+"px";
  tooltip.hidden=false;
});
$("reply-canvas").addEventListener("mouseleave",()=>{
  $("reply-tooltip").hidden=true;
  if(state.replyHover){state.replyHover=null;renderReplyGraph()}
});
$("reply-canvas").addEventListener("click",(event)=>{
  const value=nearestReply(event);
  if(value.nearest)openLife(value.nearest.node.handle);
});
new ResizeObserver(()=>{ if($("view-replies").classList.contains("on")) renderReplyGraph(); }).observe($("reply-canvas"));
$("citizen-canvas").addEventListener("mousemove",handleCanvasMove);
$("citizen-canvas").addEventListener("mouseleave",()=>{$("canvas-tooltip").hidden=true});
$("citizen-canvas").addEventListener("click",(event)=>{
  const value=nearestPoint(event);
  if(value.nearest)openLife(value.nearest.citizen.handle);
});
new ResizeObserver(()=>renderAtlas()).observe($("citizen-canvas"));
$("pool-canvas").addEventListener("mousemove",handlePoolMove);
$("pool-canvas").addEventListener("mouseleave",()=>{$("pool-tooltip").hidden=true});
$("pool-canvas").addEventListener("click",handlePoolClick);
new ResizeObserver(()=>{ if($("view-pool").classList.contains("on")) renderPool(); }).observe($("pool-canvas"));
addSectionPermalinks();
routeFromLocation();
refreshAll();
