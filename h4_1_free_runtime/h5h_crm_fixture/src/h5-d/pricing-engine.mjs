// H5-D isolated financial engine: amounts are INTEGER CENTAVOS, rates are integer basis points.
// Discount calculation requires explicitly injected TEST-ONLY approval; no policy inferred from spec 1.0.
const validCents=n=>Number.isSafeInteger(n)&&n>=0;
const requireCents=(n,label)=>{if(!validCents(n))throw Error('INVALID_'+label);return n;};
const requireBps=n=>{if(!Number.isSafeInteger(n)||n<0||n>10000)throw Error('INVALID_RATE_BPS');return n;};
const multiply=(a,b)=>{const n=BigInt(a)*BigInt(b);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('MONETARY_OVERFLOW');return Number(n);};
const roundedRate=(cents,bps)=>{const numerator=BigInt(cents)*BigInt(bps);const total=(numerator+5000n)/10000n;if(total>BigInt(Number.MAX_SAFE_INTEGER))throw Error('MONETARY_OVERFLOW');return Number(total);};
// Half-up at the cent is only the isolated fixture choice for fractional percentage results: NOT an approved canonical rounding contract.
export function calculateDraft(draft,catalog,pricing,{discountPolicy=null}={}){
 if(!Array.isArray(draft?.items))throw Error('INVALID_ITEMS');
 let subtotal=0;const byCategory={},lines=[];
 for(const item of draft.items){
  const p=catalog.get(item.productId);
  if(!p||p.category!==item.category||!Number.isSafeInteger(item.quantity)||item.quantity<1)throw Error('INVALID_COMMERCIAL_LINE');
  const rate=pricing?.unitPrices?.[item.productId];requireCents(rate,'UNIT_PRICE');const lineSubtotal=multiply(rate,item.quantity);
  if(!Number.isSafeInteger(subtotal+lineSubtotal))throw Error('MONETARY_OVERFLOW');
  subtotal+=lineSubtotal;byCategory[item.category]=(byCategory[item.category]||0)+lineSubtotal;
  lines.push({lineId:item.lineId,productId:item.productId,quantity:item.quantity,unitCents:rate,subtotalCents:lineSubtotal});
 }
 const disc=pricing?.discount||{mode:'none'},mode=disc.mode||'none';let discountCents=0;
 if(mode!=='none'){
  if(!discountPolicy||discountPolicy.fixtureApproved!==true)throw Error('PENDING_APPROVED_DISCOUNT_RULE');
  if(mode==='absolute'){discountCents=requireCents(disc.cents,'DISCOUNT');}
  else if(mode==='percent'){requireBps(disc.bps);discountCents=roundedRate(subtotal,disc.bps);}
  else throw Error('INVALID_DISCOUNT_MODE');
  if(discountCents>subtotal)throw Error('DISCOUNT_EXCEEDS_SUBTOTAL');
  if(discountPolicy.maxDiscountCents!=null&&discountCents>requireCents(discountPolicy.maxDiscountCents,'DISCOUNT_LIMIT'))throw Error('DISCOUNT_LIMIT_EXCEEDED');
 }
 const freight=pricing?.freight||{incoterm:'FOB',mode:'none'};let freightCents=0;
 if(freight.incoterm==='FOB')freightCents=0;
 else if(freight.incoterm==='CIF'){
  if(freight.mode==='manual')freightCents=requireCents(freight.cents,'FREIGHT');
  else if(freight.mode==='regional_percent'){requireBps(freight.bps);if(!freight.authorizedRegionalFixture)throw Error('PENDING_APPROVED_REGIONAL_FREIGHT');freightCents=roundedRate(subtotal,freight.bps);}
  else if(freight.mode==='historical'){if(!freight.quoteDate||!freight.confirmedManually)throw Error('HISTORICAL_FREIGHT_REQUIRES_CONFIRMATION');freightCents=requireCents(freight.cents,'FREIGHT');}
  else throw Error('INVALID_FREIGHT_MODE');
 }else throw Error('INVALID_INCOTERM');
 const total=subtotal-discountCents+freightCents;if(!Number.isSafeInteger(total))throw Error('MONETARY_OVERFLOW');
 return {lines,byCategory,subtotalCents:subtotal,discountCents,freightCents,totalCents:total,calculationBasis:'ISOLATED_FIXTURE_HALF_UP',pendingRules:['CANONICAL_PRICE_SOURCE','DISCOUNT_POLICY','CANONICAL_ROUNDING','COMMISSION_RULE','CANONICAL_PERMISSION_MATRIX']};
}
export const moneyBRL=cents=>(requireCents(cents,'MONEY')/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
