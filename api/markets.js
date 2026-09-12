const GAMMA='https://gamma-api.polymarket.com',CLOB='https://clob.polymarket.com';
function arr(v){if(Array.isArray(v))return v;try{return JSON.parse(v||'[]')}catch{return[]}}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function yes(m){let o=arr(m.outcomes),p=arr(m.outcomePrices),i=o.findIndex(x=>String(x).toLowerCase()==='yes');return i>=0?Number(p[i]):NaN}
function binary(m){let o=arr(m.outcomes).map(x=>String(x).toLowerCase());return o.length===2&&o.includes('yes')&&o.includes('no')}
function token(m){let a=arr(m.clobTokenIds);let o=arr(m.outcomes),i=o.findIndex(x=>String(x).toLowerCase()==='yes');return a[i>=0?i:0]||null}
async function hist(t){if(!t)return[];try{let u=new URL(CLOB+'/prices-history');u.searchParams.set('market',t);u.searchParams.set('interval','1d');u.searchParams.set('fidelity','60');let r=await fetch(u);if(!r.ok)return[];let j=await r.json();return Array.isArray(j.history)?j.history:[]}catch{return[]}}
async function sqlExec(q,params=[]){let {neon}=await import('@neondatabase/serverless');let sql=neon(process.env.DATABASE_URL);return sql(q,params)}
async function ensure(){await sqlExec(`CREATE TABLE IF NOT EXISTS predictions(id BIGSERIAL PRIMARY KEY, market_id TEXT NOT NULL, question TEXT, predicted_at TIMESTAMPTZ NOT NULL, model_p DOUBLE PRECISION NOT NULL, market_p DOUBLE PRECISION NOT NULL, confidence INT, edge DOUBLE PRECISION, outcome INT, resolved_at TIMESTAMPTZ, UNIQUE(market_id,predicted_at))`)}
async function loadDB(){await ensure();let rows=await sqlExec(`SELECT market_id,question,predicted_at,model_p,market_p,confidence,edge,outcome FROM predictions WHERE outcome IS NOT NULL ORDER BY predicted_at DESC LIMIT 3000`);let all=await sqlExec(`SELECT count(*)::int AS n FROM predictions`);return {resolved:rows,tracked:all[0]?.n||0}}
function localKey(){return 'pm_v6_local_ledger'}
function localRead(){try{return JSON.parse(globalThis.localStorage?.getItem(localKey())||'[]')}catch{return[]}}
function calc(z){if(!z.length)return{tracked:0,resolvedRecords:[]};return{tracked:z.length,resolvedRecords:z.filter(x=>x.outcome===0||x.outcome===1).map(x=>({p:x.model_p??x.p,m:x.market_p??x.m,y:x.outcome,conf:x.confidence??50}))}}
function baseModel(m,h,cal){let p=clamp(yes(m),.001,.999),pts=h.map(x=>+x.p).filter(Number.isFinite),mom=0,vol=0;
if(pts.length>=4){let r=pts.slice(-6),o=pts.slice(-12,-6);mom=clamp(r.reduce((a,b)=>a+b,0)/r.length-(o.length?o.reduce((a,b)=>a+b,0)/o.length:pts[0]),-.15,.15);let d=[];for(let i=1;i<pts.length;i++)d.push(pts[i]-pts[i-1]);vol=Math.sqrt(d.reduce((a,b)=>a+b*b,0)/Math.max(1,d.length))}
let liq=Math.max(0,+m.liquidity||0),depth=clamp(Math.log10(liq+1)/6,0,1),sample=clamp(pts.length/24,0,1),noise=clamp(vol*4,0,1),unc=clamp(.045+(1-sample)*.045+noise*.08-depth*.018,.018,.13);
let raw=clamp(p+mom*.22,.001,.999),edge=(raw-p)*clamp(.85-unc*2,.55,.85)*(1-unc*2.5),candidate=clamp(p+edge,.001,.999);
let bucket=Math.min(90,Math.floor(candidate*100/10)*10), adj=cal[bucket]; if(adj&&adj.n>=20) candidate=clamp(candidate+(adj.actual-adj.predicted)*.35,.001,.999);
edge=candidate-p;let conf=clamp(Math.round(52+depth*15+sample*18+(1-noise)*12-unc*55),50,90);
return{marketYes:p,modelYes:candidate,edge,confidence:conf,momentum:mom,uncertainty:unc,liquidity:liq,volume:+m.volume||0,dataQuality:pts.length>=12?'history+liquidity':pts.length>=4?'short history':'market baseline'} }
function calibration(rows){let b={};for(let x of rows){let p=x.model_p??x.p,y=x.outcome;if(p==null||y==null)continue;let k=Math.min(90,Math.floor(p*100/10)*10);b[k]??={n:0,p:0,y:0};b[k].n++;b[k].p+=p;b[k].y+=y}for(let k in b){b[k].predicted=b[k].p/b[k].n;b[k].actual=b[k].y/b[k].n}return b}
async function getClosed(ids){if(!ids.length)return[];let out=[];for(let id of ids.slice(0,100)){try{let r=await fetch(GAMMA+'/markets/'+encodeURIComponent(id));if(!r.ok)continue;let m=await r.json();if(!binary(m))continue;let p=yes(m);let y=null;if(m.closed&&(p>=.99||p<=.01))y=p>=.99?1:0;if(y!==null)out.push({id:String(id),outcome:y})}catch{}}return out}
async function handler(req,res){try{
let storage=process.env.DATABASE_URL?'database':'local';let db=storage==='database'?await loadDB():calc(localRead());let cal=calibration(db.resolved);
let u=new URL(GAMMA+'/markets');u.searchParams.set('active','true');u.searchParams.set('closed','false');u.searchParams.set('limit','100');u.searchParams.set('order','volume');u.searchParams.set('ascending','false');
let r=await fetch(u);if(!r.ok)throw Error('Gamma HTTP '+r.status);let ms=await r.json();if(!Array.isArray(ms))ms=ms.markets||[];ms=ms.filter(binary).slice(0,Math.min(300,+req.query.limit||300));
let out=[];for(let m of ms.slice(0,80)){let x=baseModel(m,await hist(token(m)),cal);out.push({...x,id:m.id,question:m.question,endDate:m.endDate})}
if(storage==='database'){
let now=new Date();let trackedIds=[];
for(let x of out){await sqlExec(`INSERT INTO predictions(market_id,question,predicted_at,model_p,market_p,confidence,edge) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(market_id,predicted_at) DO NOTHING`,[String(x.id),x.question,now.toISOString(),x.modelYes,x.marketYes,x.confidence,x.edge]);trackedIds.push(String(x.id))}
let closed=await getClosed(trackedIds);for(let c of closed)await sqlExec(`UPDATE predictions SET outcome=$1,resolved_at=NOW() WHERE market_id=$2 AND outcome IS NULL`,[c.outcome,c.id]);
db=await loadDB()
}else{
let led=localRead(),now=Date.now();for(let x of out){let hour=Math.floor(now/3600000);if(!led.some(z=>z.market_id===String(x.id)&&z.hour===hour))led.push({market_id:String(x.id),question:x.question,model_p:x.modelYes,market_p:x.marketYes,confidence:x.confidence,edge:x.edge,outcome:null,hour})}
let closed=await getClosed(out.map(x=>String(x.id)));for(let c of closed)for(let z of led)if(z.market_id===c.id)z.outcome=c.outcome;
try{globalThis.localStorage?.setItem(localKey(),JSON.stringify(led.slice(-5000)))}catch{}db=calc(led)
}
let rr=db.resolved.map(x=>({p:x.model_p??x.p,m:x.market_p??x.m,y:x.outcome,conf:x.confidence??50}));
res.status(200).json({ok:true,storage,activeMarkets:ms.length,analysed:out.length,markets:out,metrics:{tracked:db.tracked,resolvedRecords:rr},updatedAt:Date.now()})
}catch(e){res.status(500).json({ok:false,error:e.message})}}
export default handler
