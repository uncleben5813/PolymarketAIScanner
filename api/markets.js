const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';

function arr(v){ if(Array.isArray(v)) return v; try{return JSON.parse(v||'[]')}catch{return[]} }
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function daysTo(end){const t=Date.parse(end||''); return Number.isFinite(t)?Math.max(0,(t-Date.now())/86400000):30}
function parsePrice(m){
  const o=arr(m.outcomePrices), names=arr(m.outcomes);
  const i=names.findIndex(x=>String(x).toLowerCase()==='yes');
  return Number(o[i>=0?i:0]);
}
function tokens(m){const a=arr(m.clobTokenIds); return a[0]||null}

async function history(token){
  if(!token) return [];
  try{
    const u=new URL(CLOB+'/prices-history');
    u.searchParams.set('market',token); u.searchParams.set('interval','1d'); u.searchParams.set('fidelity','60');
    const r=await fetch(u,{headers:{accept:'application/json'}});
    if(!r.ok)return[];
    const j=await r.json(); return Array.isArray(j.history)?j.history:[];
  }catch{return[]}
}

/*
 V2 model:
 - market price is the prior, NOT something we blindly beat.
 - momentum is a small Bayesian-style adjustment derived from recent price movement.
 - uncertainty shrinks edge when the history is short/noisy.
 - liquidity/volume affect confidence only, not direction.
 This is deliberately transparent; it is not claimed to be a trained ML model.
*/
function model(m,h){
  const p=clamp(parsePrice(m),.001,.999);
  const pts=h.filter(x=>Number.isFinite(Number(x.p))).map(x=>Number(x.p));
  let momentum=0, vol=0, samples=pts.length;
  if(samples>=4){
    const recent=pts.slice(-6), old=pts.slice(-12,-6);
    const ra=recent.reduce((a,b)=>a+b,0)/recent.length;
    const oa=old.length?old.reduce((a,b)=>a+b,0)/old.length:pts[0];
    momentum=clamp(ra-oa,-.15,.15);
    const diffs=[]; for(let i=1;i<pts.length;i++)diffs.push(pts[i]-pts[i-1]);
    vol=Math.sqrt(diffs.reduce((a,b)=>a+b*b,0)/Math.max(1,diffs.length));
  }
  const liq=Math.max(0,Number(m.liquidity)||0), volume=Math.max(0,Number(m.volume)||0);
  const depth=clamp(Math.log10(liq+1)/6,0,1);
  const sample=clamp(samples/24,0,1);
  const noise=clamp(vol*4,0,1);
  const uncertainty=clamp(.045 + (1-sample)*.045 + noise*.08 - depth*.018,.018,.13);
  const raw=clamp(p + momentum*.22, .001, .999);
  const adjusted=p + (raw-p)*clamp(.85-uncertainty*2,.55,.85);
  const edge=(adjusted-p) * (1-uncertainty*2.5);
  const confidence=clamp(Math.round(52 + depth*15 + sample*18 + (1-noise)*12 - uncertainty*55),50,90);
  const quality=samples>=12?'history+liquidity':samples>=4?'short history':'market baseline';
  return {marketYes:p,modelYes:clamp(p+edge,.001,.999),edge,confidence,momentum,uncertainty,liquidity:liq,volume,dataQuality:quality};
}

export default async function handler(req,res){
  try{
    const limit=Math.min(300,Math.max(20,Number(req.query.limit)||300));
    const u=new URL(GAMMA+'/markets');
    u.searchParams.set('active','true');u.searchParams.set('closed','false');
    u.searchParams.set('limit','100');u.searchParams.set('offset','0');
    u.searchParams.set('order','volume');u.searchParams.set('ascending','false');
    const r=await fetch(u,{headers:{accept:'application/json'}});
    if(!r.ok) throw new Error('Gamma HTTP '+r.status);
    let markets=await r.json(); if(!Array.isArray(markets)) markets=markets.markets||[];
    markets=markets.slice(0,limit);

    // History calls are intentionally capped to keep refresh fast and within API limits.
    const selected=markets.slice(0,60);
    const analysed=await Promise.all(selected.map(async m=>{
      const h=await history(tokens(m)); return {...m,...model(m,h)};
    }));
    return res.status(200).json({ok:true,activeMarkets:markets.length,analysed:analysed.length,markets:analysed,updatedAt:Date.now()});
  }catch(e){return res.status(500).json({ok:false,error:e.message})}
}