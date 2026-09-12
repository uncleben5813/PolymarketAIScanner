const GAMMA='https://gamma-api.polymarket.com', CLOB='https://clob.polymarket.com';
function arr(v){if(Array.isArray(v))return v;try{return JSON.parse(v||'[]')}catch{return[]}}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function price(m){let o=arr(m.outcomePrices),n=arr(m.outcomes),i=n.findIndex(x=>String(x).toLowerCase()==='yes');return Number(o[i>=0?i:0])}
function token(m){return arr(m.clobTokenIds)[0]||null}
async function hist(t){if(!t)return[];try{let u=new URL(CLOB+'/prices-history');u.searchParams.set('market',t);u.searchParams.set('interval','1d');u.searchParams.set('fidelity','60');let r=await fetch(u);if(!r.ok)return[];let j=await r.json();return Array.isArray(j.history)?j.history:[]}catch{return[]}}
function calc(m,h){
 let p=clamp(price(m),.001,.999), pts=h.map(x=>+x.p).filter(Number.isFinite), mom=0,vol=0;
 if(pts.length>=4){let r=pts.slice(-6),o=pts.slice(-12,-6);mom=clamp(r.reduce((a,b)=>a+b,0)/r.length-(o.length?o.reduce((a,b)=>a+b,0)/o.length:pts[0]),-.15,.15);let d=[];for(let i=1;i<pts.length;i++)d.push(pts[i]-pts[i-1]);vol=Math.sqrt(d.reduce((a,b)=>a+b*b,0)/Math.max(1,d.length))}
 let liq=Math.max(0,+m.liquidity||0),volume=Math.max(0,+m.volume||0),depth=clamp(Math.log10(liq+1)/6,0,1),sample=clamp(pts.length/24,0,1),noise=clamp(vol*4,0,1);
 let uncertainty=clamp(.045+(1-sample)*.045+noise*.08-depth*.018,.018,.13);
 let raw=clamp(p+mom*.22,.001,.999),edge=(raw-p)*clamp(.85-uncertainty*2,.55,.85)*(1-uncertainty*2.5);
 let conf=clamp(Math.round(52+depth*15+sample*18+(1-noise)*12-uncertainty*55),50,90);
 return {marketYes:p,modelYes:clamp(p+edge,.001,.999),edge,confidence:conf,momentum:mom,uncertainty,liquidity:liq,volume,dataQuality:pts.length>=12?'history+liquidity':pts.length>=4?'short history':'market baseline'}
}
function metrics(){return {brier:null,logLoss:null,resolved:0,note:'V3 stores schema-ready prediction data; resolved outcome tracking can be connected to a persistent store next.'}}
export default async function handler(req,res){try{
 let lim=Math.min(300,Math.max(20,+req.query.limit||300)),u=new URL(GAMMA+'/markets');u.searchParams.set('active','true');u.searchParams.set('closed','false');u.searchParams.set('limit','100');u.searchParams.set('offset','0');u.searchParams.set('order','volume');u.searchParams.set('ascending','false');
 let r=await fetch(u,{headers:{accept:'application/json'}});if(!r.ok)throw Error('Gamma HTTP '+r.status);let ms=await r.json();if(!Array.isArray(ms))ms=ms.markets||[];ms=ms.slice(0,lim);
 let out=await Promise.all(ms.slice(0,60).map(async m=>({...m,...calc(m,await hist(token(m)))})));
 res.status(200).json({ok:true,activeMarkets:ms.length,analysed:out.length,markets:out,metrics:metrics(),updatedAt:Date.now()})
}catch(e){res.status(500).json({ok:false,error:e.message})}}