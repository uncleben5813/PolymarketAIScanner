export default async function handler(req,res){
  try{
    const url='https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1000';
    const r=await fetch(url,{headers:{accept:'application/json'}});
    if(!r.ok) throw new Error(`Polymarket API ${r.status}`);
    const raw=await r.json();
    const markets=Array.isArray(raw)?raw:(raw.markets||[]);
    const out=[];
    for(const m of markets){
      const question=m.question||m.title;
      if(!question) continue;
      let prices=parseArray(m.outcomePrices);
      let marketYes=prices.length?Number(prices[0]):Number(m.lastTradePrice);
      if(!Number.isFinite(marketYes)||marketYes<0||marketYes>1) continue;
      const ai=estimate(marketYes,m);
      out.push({
        id:m.id,question,category:m.category||m.groupItemTitle||'Market',
        marketYes,aiYes:ai.prob,edge:(ai.prob-marketYes)*100,
        confidence:ai.confidence,volume:Number(m.volume)||0
      });
    }
    out.sort((a,b)=>b.edge-a.edge);
    res.status(200).json({ok:true,markets:out});
  }catch(e){res.status(500).json({ok:false,error:e.message})}
}
function parseArray(v){try{if(Array.isArray(v))return v.map(Number);if(typeof v==='string')return JSON.parse(v).map(Number)}catch{}return[]}
function estimate(p,m){
  // V1 is a transparent statistical baseline, not a claimed trained AI.
  const vol=Math.min(1,Math.log10(Math.max(10,Number(m.volume)||10))/7);
  const spreadPenalty=Math.abs(p-.5);
  const nudge=(0.5-p)*0.035*(0.5+vol);
  const prob=Math.max(.01,Math.min(.99,p+nudge));
  const confidence=Math.round(50+vol*22+spreadPenalty*20);
  return {prob,confidence:Math.min(95,confidence)}
}
