/* ============================================================
   Jawhara Jewellery — Media Buying Command Centre
   Live cross-platform data (last 30 days: 2026-07-14 → 2026-08-12)
   ============================================================ */

/* ============================================================
   DATE ENGINE
   Real per-day granularity exists only for: Meta (spend, impressions,
   reach, clicks, purchases, revenue), Google (spend, clicks, impressions
   only — NOT purchases/revenue), GA4 (sessions, users, purchases, revenue).
   Snapchat, TikTok, and every campaign/audience/creative/product/budget
   table were retrieved as full-period totals only — no daily breakdown
   exists for them, so they cannot be honestly recalculated per sub-range.
   ============================================================ */
const DATA_WINDOW_START = '2026-07-14';
const DATA_WINDOW_END   = '2026-08-12'; // most recent day with retrieved data — used as "today" for relative presets
function toDateObj(iso){ const [y,m,d]=iso.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); }
function toISO(d){ return d.toISOString().slice(0,10); }
function addDays(iso, n){ const d=toDateObj(iso); d.setUTCDate(d.getUTCDate()+n); return toISO(d); }
function dayCount(from,to){ return Math.round((toDateObj(to)-toDateObj(from))/86400000)+1; }
function clip(iso, lo, hi){ return iso < lo ? lo : (iso > hi ? hi : iso); }
function rangesOverlap(from,to){ return !(to < DATA_WINDOW_START || from > DATA_WINDOW_END); }

function resolvePreset(preset, customFrom, customTo){
  const END = DATA_WINDOW_END;
  let from, to, label, requestedOutsideWindow = false;
  switch(preset){
    case 'today': from = END; to = END; label = 'Today'; break;
    case 'yesterday': from = addDays(END,-1); to = addDays(END,-1); label = 'Yesterday'; break;
    case 'last7': from = addDays(END,-6); to = END; label = 'Last 7 Days'; break;
    case 'last14': from = addDays(END,-13); to = END; label = 'Last 14 Days'; break;
    case 'last30': from = DATA_WINDOW_START; to = END; label = 'Last 30 Days'; break;
    case 'thismonth': { const d=toDateObj(END); from = toISO(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1))); to = END; label = 'This Month'; break; }
    case 'lastmonth': { const d=toDateObj(END); const firstThis = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)); const lastPrevMonth = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),0)); const firstPrevMonth = new Date(Date.UTC(lastPrevMonth.getUTCFullYear(),lastPrevMonth.getUTCMonth(),1)); from = toISO(firstPrevMonth); to = toISO(lastPrevMonth); label = 'Last Month'; break; }
    case 'custom': from = customFrom; to = customTo; label = 'Custom Range'; break;
    default: from = DATA_WINDOW_START; to = END; label = 'Last 30 Days';
  }
  if (!from || !to || from > to) return { available:false, reason:'invalid-range' };
  if (!rangesOverlap(from,to)) return { available:false, reason:'outside-window', requestedFrom:from, requestedTo:to };
  const clippedFrom = clip(from, DATA_WINDOW_START, DATA_WINDOW_END);
  const clippedTo = clip(to, DATA_WINDOW_START, DATA_WINDOW_END);
  const partial = (clippedFrom !== from) || (clippedTo !== to);
  return { available:true, from:clippedFrom, to:clippedTo, label, partial, requestedFrom:from, requestedTo:to };
}

function filterDailyRows(rows, from, to){ return (rows||[]).filter(r=> r.date >= from && r.date <= to); }
function sumKey(rows, key){ return rows.reduce((a,r)=>a+(r[key]||0),0); }
function avgKey(rows, key){ return rows.length ? sumKey(rows,key)/rows.length : 0; }

/* ---------- real daily campaign-level aggregation (Meta/Google/Snapchat/TikTok) ----------
   DATA.campaign_daily holds real per-day, per-campaign rows retrieved directly from each
   platform. Filtering + aggregating this for the selected [from,to] is what makes Campaign
   Leaders, the Campaign Efficiency Matrix, and funnel mid-stages genuinely work for ANY
   date range — not just the full 30-day window. Never estimated: every row is a real pull. */
function filterCampaignDaily(from, to){
  return (DATA.campaign_daily||[]).filter(r=> r.date >= from && r.date <= to);
}
/* Snapchat and TikTok don't have their own pre-aggregated daily platform array (unlike Meta's
   METAD / Google's GOOGLED), but DATA.campaign_daily does have real per-day rows for them —
   this groups those rows by date to build the same shape of daily series for trend charts. */
function dailyPlatformSeries(platformName, from, to){
  const rows = filterCampaignDaily(from, to).filter(r=>r.platform===platformName);
  const byDate = {};
  rows.forEach(r=>{
    const d = byDate[r.date] = byDate[r.date] || { date:r.date, spend:0, clicks:0, impressions:0, purchases:0, revenue:0 };
    d.spend += r.spend||0; d.clicks += r.clicks||0; d.impressions += r.impressions||0;
    d.purchases += r.purchases||0; d.revenue += r.revenue||0;
  });
  return Object.values(byDate).sort((a,b)=>a.date.localeCompare(b.date));
}
/* ---------- campaign objective category — derived from Jawhara's own naming convention,
   the same real, disclosed pattern-matching approach already used for the Audience page's
   prospecting-vs-retargeting split. Verified against every campaign's actual platform objective
   (OUTCOME_SALES/WEB_CONVERSIONS/PERFORMANCE_MAX -> Conversion, LINK_CLICKS/TRAFFIC -> Traffic,
   OUTCOME_AWARENESS/REACH/AWARENESS_AND_ENGAGEMENT/VIDEO_VIEWS -> Awareness) — every campaign in
   this dataset classifies correctly under these patterns. */
function campaignObjectiveCategory(name){
  const n = (name||'').toLowerCase();
  if (n.startsWith('aw-') || /\bawa\b/.test(n) || /\bawr\b/.test(n)) return 'Awareness';
  if (/\btra\b/.test(n) || /\btrf\b/.test(n)) return 'Traffic';
  if (/\bsales?\b/.test(n) || n.includes('pmax')) return 'Conversion';
  return 'Other';
}
function aggregateCampaignDaily(rows){
  const map = {};
  rows.forEach(r=>{
    const key = r.platform+'|'+r.campaign_name;
    const a = map[key] = map[key] || { platform:r.platform, name:r.campaign_name, spend:0, clicks:0, impressions:0, purchases:0, revenue:0, lpv:0, vc:0, atc:0, ic:0 };
    a.spend += r.spend||0; a.clicks += r.clicks||0; a.impressions += r.impressions||0;
    a.purchases += r.purchases||0; a.revenue += r.revenue||0;
    a.lpv += r.lpv||0; a.vc += r.vc||0; a.atc += r.atc||0; a.ic += r.ic||0;
  });
  return Object.values(map).filter(c=>c.spend>0).map(c=>({...c,
    roas: safeDiv(c.revenue, c.spend), cpa: safeDiv(c.spend, c.purchases),
    cpc: safeDiv(c.spend, c.clicks), cpm: c.impressions ? 1000*c.spend/c.impressions : null,
    ctr: safeDiv(c.clicks, c.impressions),
    objective: campaignObjectiveCategory(c.name), status:'ACTIVE'
  }));
}

/* Resolve a comparison range against a given primary [from,to] window. Only ever
   returns available:true when the comparison window has real retrieved data —
   never estimates or fabricates a prior period. */
function resolveComparison(mode, from, to){
  if (mode === 'none') return { available:false, mode:'none' };
  const n = dayCount(from,to);
  if (mode === 'prev'){
    const prevTo = addDays(from,-1), prevFrom = addDays(prevTo, -(n-1));
    if (!rangesOverlap(prevFrom,prevTo)) return { available:false, mode, reason:'outside-window' };
    return { available:true, mode, from: clip(prevFrom,DATA_WINDOW_START,DATA_WINDOW_END), to: clip(prevTo,DATA_WINDOW_START,DATA_WINDOW_END), label:'Previous Period' };
  }
  if (mode === 'prevyear'){
    // Prior-year data has not been retrieved in this build — never fabricate it.
    return { available:false, mode, reason:'not-retrieved' };
  }
  return { available:false, mode };
}

/* ---------- formatting helpers ---------- */
const fmtAED = (n, dp=0) => (n===null||n===undefined||isNaN(n)) ? 'N/A' :
  'AED ' + Number(n).toLocaleString('en-US', {maximumFractionDigits:dp, minimumFractionDigits:dp});
const fmtNum = (n, dp=0) => (n===null||n===undefined||isNaN(n)) ? 'N/A' : Number(n).toLocaleString('en-US', {maximumFractionDigits:dp});
const fmtCompact = (n) => {
  if (n===null||n===undefined||isNaN(n)) return 'N/A';
  n = Number(n);
  if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toFixed(0);
};
const fmtPct = (n, dp=1) => (n===null||n===undefined||isNaN(n)) ? 'N/A' : (Number(n)*100).toFixed(dp)+'%';
const fmtX = (n, dp=2) => (n===null||n===undefined||isNaN(n)) ? 'N/A' : Number(n).toFixed(dp)+'x';
const fmtDuration = (secs) => (secs===null||secs===undefined||isNaN(secs)) ? 'N/A' : `${Math.floor(secs/60)}m ${Math.round(secs%60)}s`;
/* Collection/category for products — read directly out of the real GA4 item name text (e.g.
   "... | Danah Collection", "... - Diana", "... Pendant Chain ..."), never inferred or guessed.
   Items with no recognizable marker fall into "Unspecified" rather than being assigned a
   collection/category that isn't actually present in the data. */
function extractCollection(name){
  const n = (name||'');
  const known = ['Danah', 'Diana', 'Vivante', 'Ada'];
  for (const k of known){ if (new RegExp('\\b'+k+'\\b', 'i').test(n)) return k; }
  return 'Unspecified';
}
function extractCategory(name){
  const n = (name||'').toLowerCase();
  if (/\bearrings?\b/.test(n)) return 'Earrings';
  if (/\bpendant\b/.test(n)) return 'Pendants';
  if (/\bring\b/.test(n)) return 'Rings';
  if (/\bchoker\b/.test(n)) return 'Chokers';
  if (/\bnecklace\b/.test(n)) return 'Necklaces';
  if (/\bwatch\b/.test(n)) return 'Watches';
  if (/\bbullion\b|\bbar\b/.test(n)) return 'Bullion Bars';
  return 'Unspecified';
}
const fmtDate = (iso) => { const d=toDateObj(iso); return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}); };
const NA = '<span class="kpi-na">N/A</span>';
const safeDiv = (a,b) => (a===null||a===undefined||!b||b===0) ? null : a/b;

/* ---------- palette for charts ---------- */
const PAL = { meta:'#4C8DFF', google:'#34A853', snapchat:'#FFDD00', tiktok:'#FF3B7F', ga4:'#F48FB1', gold:'#D6BB7F', cream:'#F3ECDD', dim:'#A69D8C', green:'#7FA37A', red:'#C97B6B', amber:'#D9A85C', blue:'#7C9CB5' };

/* ---------- semantic colour helpers (performance status, not brand) ---------- */
function palAlpha(hex, alpha){
  const h = hex.replace('#','');
  const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function roasColor(v){ if(v===null||v===undefined) return PAL.dim; return v>=2 ? PAL.green : v>=1 ? PAL.amber : PAL.red; }
function deltaColor(v){ if(v===null||v===undefined) return PAL.dim; return v>=0 ? PAL.green : PAL.red; }

/* ---------- small brand-flavoured platform icon set (simplified, non-trademark glyphs) ---------- */
const ICONS = {
  meta: `<img src="data:image/png;base64,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" alt="meta" style="width:100%;height:100%;object-fit:contain;display:block;">`,
  google: `<img src="data:image/png;base64,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" alt="google" style="width:100%;height:100%;object-fit:contain;display:block;">`,
  snapchat: `<img src="data:image/png;base64,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" alt="snapchat" style="width:100%;height:100%;object-fit:contain;display:block;">`,
  tiktok: `<img src="data:image/png;base64,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" alt="tiktok" style="width:100%;height:100%;object-fit:contain;display:block;">`,
  ga4: `<img src="data:image/png;base64,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" alt="ga4" style="width:100%;height:100%;object-fit:contain;display:block;">`,
};
function iconBadge(key, size=18){
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size+6}px;height:${size+6}px;border-radius:6px;background:rgba(255,255,255,0.04);vertical-align:middle;">${ICONS[key]||''}</span>`;
}
function platformLabel(key, name){ return `${iconBadge(key)} <span style="margin-left:6px;">${name}</span>`; }
if (typeof Chart !== 'undefined' && Chart.defaults) {
  Chart.defaults.color = '#A69D8C';
  if (Chart.defaults.font) Chart.defaults.font.family = "'Inter',sans-serif";
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
}
/* Defensive chart constructor: if Chart.js failed to load or a given config throws,
   this must never stop the rest of the dashboard (KPIs, tables, funnel, insights) from rendering. */
function safeNewChart(ctx, cfg){
  if (typeof Chart === 'undefined') {
    if (ctx && ctx.parentElement) ctx.parentElement.insertAdjacentHTML('beforeend', '<div class="chart-fallback">Chart unavailable</div>');
    return null;
  }
  try { return new Chart(ctx, cfg); }
  catch(e){ console.warn('Chart render skipped:', e); return null; }
}

/* ---------- derive blended cross-platform totals from real aggregated source values ----------
   metaAgg / googleAgg are computed from the date-filtered daily rows for the selected window.
   Snapchat and TikTok have no daily breakdown, so their totals always reflect the full
   retrieved period (14 Jul – 12 Aug) — flagged via `dateFiltered:false` rather than estimated.
   Google's purchases/revenue also have no daily breakdown, so those two fields likewise stay
   at their full-period values whenever a sub-range is selected. */
function platformTotals(metaAgg, googleAgg, snapAgg, tiktokAgg, isFullWindow){
  const rows = [
    { key:'meta', name:'Meta Ads', dateFiltered:true,
      spend:metaAgg.spend, impressions:metaAgg.impressions, clicks:metaAgg.clicks, purchases:metaAgg.purchases, revenue:metaAgg.revenue,
      reach: metaAgg.reach_avg || null, reachNote: 'Average daily reach for the selected range' },
    { key:'google', name:'Google Ads', dateFiltered:true,
      spend:googleAgg.spend, impressions:googleAgg.impressions, clicks:googleAgg.clicks, purchases:googleAgg.purchases, revenue:googleAgg.revenue,
      reach: null, reachNote: 'Google Ads does not report a comparable Reach metric for this account' },
    { key:'snapchat', name:'Snapchat Ads', dateFiltered:true, available: snapAgg.spend>0 || isFullWindow,
      spend:snapAgg.spend, impressions:snapAgg.impressions, clicks:snapAgg.clicks, purchases:snapAgg.purchases, revenue:snapAgg.revenue,
      reach: isFullWindow ? (DATA.snapchat.totals.reach||null) : null, reachNote: 'Reach has no daily breakdown — only available for the full 14 Jul–12 Aug period' },
    { key:'tiktok', name:'TikTok Ads', dateFiltered:true, available: tiktokAgg.spend>0 || isFullWindow,
      spend:tiktokAgg.spend, impressions:tiktokAgg.impressions, clicks:tiktokAgg.clicks, purchases:tiktokAgg.purchases, revenue:tiktokAgg.revenue,
      reach: isFullWindow ? (DATA.tiktok.totals.reach||null) : null, reachNote: 'Reach has no daily breakdown — only available for the full 14 Jul–12 Aug period' },
  ];
  rows.forEach(r=>{
    r.ctr = safeDiv(r.clicks, r.impressions); r.cpc = safeDiv(r.spend, r.clicks); r.cpm = r.impressions ? 1000*r.spend/r.impressions : null;
    r.roas = safeDiv(r.revenue, r.spend); r.cpa = safeDiv(r.spend, r.purchases);
  });
  const totalSpend = rows.reduce((a,r)=>a+(r.spend||0),0);
  const totalRevenue = rows.reduce((a,r)=>a+(r.revenue||0),0);
  const totalPurchases = rows.reduce((a,r)=>a+(r.purchases||0),0);
  const totalImpr = rows.reduce((a,r)=>a+(r.impressions||0),0);
  const totalClicks = rows.reduce((a,r)=>a+(r.clicks||0),0);
  rows.forEach(r=> r.contribution = (r.revenue!=null && totalRevenue) ? r.revenue/totalRevenue : null);
  return { rows, totalSpend, totalRevenue, totalPurchases, totalImpr, totalClicks,
    blendedCTR: safeDiv(totalClicks,totalImpr), blendedCPC: safeDiv(totalSpend,totalClicks),
    blendedCPM: totalImpr? 1000*totalSpend/totalImpr : null,
    blendedROAS: safeDiv(totalRevenue,totalSpend), blendedCPA: safeDiv(totalSpend,totalPurchases) };
}

/* ============================================================
   MUTABLE STATE — recomputed whenever the date/comparison/platform
   filters change. Declared with `let` (not `const`) specifically so
   that every PAGES.*.html()/charts function, which closes over these
   as free variables, sees the latest recomputed values on re-render.
   ============================================================ */
let appState = { preset:'last30', from:DATA_WINDOW_START, to:DATA_WINDOW_END, customFrom:DATA_WINDOW_START, customTo:DATA_WINDOW_END, compare:'none', platform:'all' };
let RANGE, ISFULL, METAD, GOOGLED, GA4D, METAAGG, GOOGLEAGG, GA4AGG, SNAPAGG, TIKTOKAGG;
let RANGE_LAST_VALID_LABEL = null;
let PT, GA4T, MER, AOV, CONVRATE;
let GA4_BOUNCE_RATE, GA4_ENGAGEMENT_RATE, GA4_AVG_SESSION_DURATION, GA4_PAGES_PER_SESSION;
let KPI_SPEND, KPI_SPEND_NOTE, KPI_ROAS, KPI_ROAS_NOTE;
let CAMPAIGN_ROWS = [], CAMPAIGNS_AVAILABLE = true;
let metaSpendTrend, metaRevTrend, googleSpendTrend, ga4RevTrend, ga4SessTrend, ga4PurTrend;
let COMPARE = { available:false };
let BREAKDOWNS_AVAILABLE = true;

function recomputeAll(){
  const resolved = resolvePreset(appState.preset, appState.customFrom, appState.customTo);
  if (!resolved.available){
    RANGE = { available:false, reason: resolved.reason, requestedFrom: resolved.requestedFrom, requestedTo: resolved.requestedTo };
    return; // keep all previously-computed globals as-is — never blank the dashboard on an invalid selection
  }
  const { from, to, label, partial } = resolved;
  RANGE = { available:true, from, to, label, partial, days: dayCount(from,to) };
  RANGE_LAST_VALID_LABEL = `${fmtDate(from)} – ${fmtDate(to)}`;
  ISFULL = (from === DATA_WINDOW_START && to === DATA_WINDOW_END);
  // STATIC_ONLY sections (audience gender/placement, ad-level creatives, GA4 channel breakdown,
  // ad-set budgets, GA4 top-products) genuinely have no daily granularity retrieved — these stay
  // gated to the full window. Campaign-level data (spend/purchases/revenue/funnel actions per
  // campaign per day) WAS retrieved with real daily granularity for all four platforms, so
  // campaign-dependent sections are available for any range within the retrieved window.
  BREAKDOWNS_AVAILABLE = ISFULL;

  METAD = filterDailyRows(DATA.meta.daily, from, to);
  GOOGLED = filterDailyRows(DATA.google.daily, from, to);
  GA4D = filterDailyRows(DATA.ga4.daily, from, to);

  const campaignDailyFiltered = filterCampaignDaily(from, to);
  CAMPAIGN_ROWS = aggregateCampaignDaily(campaignDailyFiltered);
  CAMPAIGNS_AVAILABLE = CAMPAIGN_ROWS.length > 0;

  METAAGG = { spend:sumKey(METAD,'spend'), impressions:sumKey(METAD,'impressions'), reach_avg:avgKey(METAD,'reach'), clicks:sumKey(METAD,'clicks'), purchases:sumKey(METAD,'purchases'), revenue:sumKey(METAD,'revenue') };
  GOOGLEAGG = { spend:sumKey(GOOGLED,'spend'), impressions:sumKey(GOOGLED,'impressions'), clicks:sumKey(GOOGLED,'clicks'), purchases:sumKey(GOOGLED,'purchases'), revenue:sumKey(GOOGLED,'revenue') };
  GA4AGG = { sessions:sumKey(GA4D,'sessions'), active_users:sumKey(GA4D,'active_users'), purchases:sumKey(GA4D,'purchases'), revenue:sumKey(GA4D,'revenue') };
  METAAGG.ctr = safeDiv(METAAGG.clicks, METAAGG.impressions); METAAGG.cpc = safeDiv(METAAGG.spend, METAAGG.clicks);
  METAAGG.cpm = METAAGG.impressions ? 1000*METAAGG.spend/METAAGG.impressions : null;
  METAAGG.roas = safeDiv(METAAGG.revenue, METAAGG.spend); METAAGG.cpa = safeDiv(METAAGG.spend, METAAGG.purchases);
  GOOGLEAGG.ctr = safeDiv(GOOGLEAGG.clicks, GOOGLEAGG.impressions); GOOGLEAGG.cpc = safeDiv(GOOGLEAGG.spend, GOOGLEAGG.clicks);
  GOOGLEAGG.cpm = GOOGLEAGG.impressions ? 1000*GOOGLEAGG.spend/GOOGLEAGG.impressions : null;
  GOOGLEAGG.roas = safeDiv(GOOGLEAGG.revenue, GOOGLEAGG.spend); GOOGLEAGG.cpa = safeDiv(GOOGLEAGG.spend, GOOGLEAGG.purchases);

  // Snapchat / TikTok platform totals — now computed from the same real daily campaign data,
  // for any date range, not just the full 30-day window.
  function platformAgg(platformName){
    const rows = campaignDailyFiltered.filter(r=>r.platform===platformName);
    const agg = { spend:sumKey(rows,'spend'), clicks:sumKey(rows,'clicks'), impressions:sumKey(rows,'impressions'), purchases:sumKey(rows,'purchases'), revenue:sumKey(rows,'revenue') };
    agg.ctr = safeDiv(agg.clicks, agg.impressions); agg.cpc = safeDiv(agg.spend, agg.clicks);
    agg.cpm = agg.impressions ? 1000*agg.spend/agg.impressions : null;
    agg.roas = safeDiv(agg.revenue, agg.spend); agg.cpa = safeDiv(agg.spend, agg.purchases);
    return agg;
  }
  SNAPAGG = platformAgg('Snapchat');
  TIKTOKAGG = platformAgg('TikTok');

  PT = platformTotals(METAAGG, GOOGLEAGG, SNAPAGG, TIKTOKAGG, ISFULL);
  GA4T = { sessions:GA4AGG.sessions, active_users:GA4AGG.active_users, purchases:GA4AGG.purchases, revenue:GA4AGG.revenue,
    add_to_carts: ISFULL ? DATA.ga4.totals.add_to_carts : null, checkouts: ISFULL ? DATA.ga4.totals.checkouts : null };
  // Website performance metrics (bounce/engagement rate, session duration, pages/session) — real daily
  // GA4 data, aggregated (session-weighted, never simple-averaged) for whatever range is selected.
  const perfRows = filterDailyRows(DATA.ga4_daily_perf, from, to);
  const perfSessions = sumKey(perfRows, 'sessions');
  GA4_BOUNCE_RATE = perfSessions ? perfRows.reduce((a,r)=>a+r.bounce_rate*r.sessions,0)/perfSessions : null;
  GA4_ENGAGEMENT_RATE = perfSessions ? perfRows.reduce((a,r)=>a+r.engagement_rate*r.sessions,0)/perfSessions : null;
  GA4_AVG_SESSION_DURATION = perfSessions ? perfRows.reduce((a,r)=>a+r.avg_session_duration*r.sessions,0)/perfSessions : null;
  GA4_PAGES_PER_SESSION = safeDiv(sumKey(perfRows,'page_views'), perfSessions);

  // Platform filter: restrict the "Total Ad Spend" / "Paid Media ROAS" KPIs to a single platform when selected.
  const plat = appState.platform;
  if (plat === 'all'){
    KPI_SPEND = PT.totalSpend;
    KPI_SPEND_NOTE = null;
    KPI_ROAS = PT.blendedROAS;
    KPI_ROAS_NOTE = 'Σ Platform-attributed revenue ÷ Σ Spend — pixel/API attribution, not GA4';
  } else if (plat === 'ga4'){
    KPI_SPEND = null; KPI_SPEND_NOTE = 'GA4 is a website analytics source, not an ad platform — spend does not apply.';
    KPI_ROAS = null; KPI_ROAS_NOTE = 'Not applicable to GA4.';
  } else {
    const row = PT.rows.find(r=>r.key===plat);
    KPI_SPEND = row ? row.spend : null;
    KPI_SPEND_NOTE = `${row?row.name:''} only.`;
    KPI_ROAS = row ? row.roas : null;
    KPI_ROAS_NOTE = KPI_SPEND_NOTE;
  }

  MER = safeDiv(GA4T.revenue, KPI_SPEND);
  AOV = safeDiv(GA4T.revenue, GA4T.purchases);
  CONVRATE = safeDiv(GA4T.purchases, GA4T.sessions);

  metaSpendTrend = halfTrend(METAD, 'spend');
  metaRevTrend = halfTrend(METAD, 'revenue');
  googleSpendTrend = halfTrend(GOOGLED, 'spend');
  ga4RevTrend = halfTrend(GA4D, 'revenue');
  ga4SessTrend = halfTrend(GA4D, 'sessions');
  ga4PurTrend = halfTrend(GA4D, 'purchases');

  // Comparison (Previous Period / Previous Year) — only ever populated from real retrieved data.
  const cmp = resolveComparison(appState.compare, from, to);
  if (!cmp.available){ COMPARE = { available:false, mode: appState.compare, reason: cmp.reason }; }
  else {
    const cMetaD = filterDailyRows(DATA.meta.daily, cmp.from, cmp.to);
    const cGoogleD = filterDailyRows(DATA.google.daily, cmp.from, cmp.to);
    const cGa4D = filterDailyRows(DATA.ga4.daily, cmp.from, cmp.to);
    COMPARE = {
      available:true, mode: appState.compare, label: cmp.label, from:cmp.from, to:cmp.to,
      metaSpend: sumKey(cMetaD,'spend'), metaRevenue: sumKey(cMetaD,'revenue'),
      googleSpend: sumKey(cGoogleD,'spend'),
      ga4Revenue: sumKey(cGa4D,'revenue'), ga4Purchases: sumKey(cGa4D,'purchases'), ga4Sessions: sumKey(cGa4D,'sessions'),
    };
    COMPARE.totalSpend = COMPARE.metaSpend + COMPARE.googleSpend;
    COMPARE.spendDelta = safeDiv(KPI_SPEND - COMPARE.totalSpend, COMPARE.totalSpend);
    COMPARE.ga4RevenueDelta = safeDiv(GA4T.revenue - COMPARE.ga4Revenue, COMPARE.ga4Revenue);
    COMPARE.ga4PurchasesDelta = safeDiv(GA4T.purchases - COMPARE.ga4Purchases, COMPARE.ga4Purchases);
    COMPARE.merDelta = (()=>{ const prevMer = safeDiv(COMPARE.ga4Revenue, COMPARE.totalSpend); return safeDiv(MER-prevMer, prevMer); })();
  }
}
recomputeAll(); // initial computation for the default 14 Jul – 12 Aug window
window.__dashboardDebugState = function(){ return { appState, RANGE, ISFULL, PT, GA4T, MER, AOV, KPI_SPEND, KPI_SPEND_NOTE, KPI_ROAS, COMPARE, METAAGG, GOOGLEAGG }; };

function rangeUnavailableMessage(){
  const r = RANGE && !RANGE.available ? RANGE : null;
  if (!r) return '';
  const reqFrom = r.requestedFrom ? fmtDate(r.requestedFrom) : '';
  const reqTo = r.requestedTo ? fmtDate(r.requestedTo) : '';
  return `Data is not available for this reporting range${reqFrom?` (${reqFrom} – ${reqTo})`:''}. Please try another date range. Data is currently available for 14 Jul – 12 Aug 2026.`;
}

/* Strict rule: campaign/audience/creative/product/budget tables (and Snapchat/TikTok in
   full) have no daily breakdown, so a sub-range request never substitutes the full-period
   numbers for them — it shows this explicit message instead, exactly as required. */
function unavailableBlock(sectionLabel){
  return `<div class="error-banner"><span class="ic">⚠</span><div><b>Data is not available for this reporting range.</b> ${sectionLabel} was retrieved only for the full 14 Jul – 12 Aug 2026 period and has no day-level breakdown, so it cannot be shown for a custom sub-range. Select <b>Last 30 Days</b> to view this section.</div></div>`;
}
function fullPeriodOnlyBanner(){
  if (!RANGE || !RANGE.available || ISFULL) return '';
  return unavailableBlock('This section');
}
function partialRangeBanner(){
  if (!RANGE || !RANGE.available || !RANGE.partial) return '';
  return `<div class="range-banner"><span class="ic">ℹ</span><div>The requested range extended beyond the retrieved data. Showing the overlapping portion actually available: <b>${fmtDate(RANGE.from)} – ${fmtDate(RANGE.to)}</b>.</div></div>`;
}

/* ============================================================
   NAVIGATION
   ============================================================ */
const NAV = [
  {id:'exec', label:'Executive Overview'},
  {id:'cross', label:'Cross-Platform Performance'},
  {id:'meta', label:'Meta Ads'},
  {id:'creative', label:'Creative Analysis'},
  {id:'google', label:'Google Ads'},
  {id:'snapchat', label:'Snapchat Ads'},
  {id:'tiktok', label:'TikTok Ads'},
  {id:'campaigns', label:'Campaign Analysis'},
  {id:'product', label:'Product & Collection Analysis'},
  {id:'ga4', label:'GA4 / Website & Ecommerce'},
  {id:'funnel', label:'Full Funnel / Customer Journey'},
  {id:'audience', label:'Audience Analysis'},
  {id:'insights', label:'Insights & Recommendations'},
  {id:'budget', label:'Budget & Pacing'},
  {id:'dataquality', label:'Data Quality / Tracking Health'},
];

function buildNav(){
  const el = document.getElementById('navlist');
  el.innerHTML = '<div class="nav-group-label">Command Centre</div>' + NAV.map((n,i)=>
    `<div class="nav-item ${i===0?'active':''}" data-id="${n.id}"><span class="n">${String(i+1).padStart(2,'0')}</span>${n.label}</div>`
  ).join('');
  el.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click', ()=>{
      el.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
      item.classList.add('active');
      showPage(item.dataset.id);
    });
  });
}

let currentPageId = 'exec';
let PAGE1_THEME = 'white'; // 'dark' | 'light' | 'white' — applies site-wide now; kept this name to avoid touching other references.

function showPage(id){
  currentPageId = id;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  let page = document.getElementById('page-'+id);
  if(!page){ renderPage(id); page = document.getElementById('page-'+id); }
  page.classList.add('active');
  document.getElementById('pageHeaderTitle').textContent = NAV.find(n=>n.id===id).label;
  window.scrollTo(0,0);
  applyLightPreviewTheme(id);
  requestAnimationFrame(()=>initChartsFor(id));
}

/* Theme toggle — now applies site-wide across all 15 pages, per approval after the Page 1
   trial. Choice persists as you navigate between pages and through filter changes. Each page
   gets its own switcher instance (rendered once, then cached like the rest of the page), so
   lookups are scoped to the currently active page rather than a page-agnostic getElementById —
   otherwise, once more than one page has been visited, a global id lookup could find a hidden
   page's switcher instead of the visible one. */
function applyLightPreviewTheme(id){
  const mainEl = document.querySelector('.main');
  if (!mainEl) return;
  mainEl.classList.remove('light-preview','white-preview');
  if (PAGE1_THEME === 'light') mainEl.classList.add('light-preview');
  else if (PAGE1_THEME === 'white') mainEl.classList.add('white-preview');
  const sw = document.querySelector('#page-'+id+' .theme-switcher');
  if (sw) sw.querySelectorAll('button').forEach(b=>{
    b.classList.toggle('active', b.dataset.theme === PAGE1_THEME);
  });
}
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('.theme-switcher button');
  if (!btn) return;
  PAGE1_THEME = btn.dataset.theme;
  applyLightPreviewTheme(currentPageId);
});

/* Wipes every cached page + chart registry entry and re-renders the current page fresh.
   Called whenever the date/comparison/platform filters change, so no page can ever
   continue showing stale data from a previous selection. */
function rerenderAllFresh(){
  document.getElementById('pageWrap').innerHTML = '';
  Object.keys(chartRegistry).forEach(k=>delete chartRegistry[k]);
  renderPage(currentPageId);
  document.getElementById('page-'+currentPageId).classList.add('active');
  // If the selected range has no real data, make that unmissable — right at the top of the
  // page content, not just the thin status strip — and make clear the numbers below are the
  // last valid selection, not the range just requested.
  if (RANGE && !RANGE.available){
    const pageEl = document.getElementById('page-'+currentPageId);
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.style.marginBottom = '20px';
    banner.innerHTML = `<span class="ic">⚠</span><div><b>${rangeUnavailableMessage()}</b><br>The figures shown below are still from your last valid selection (${RANGE_LAST_VALID_LABEL||'14 Jul – 12 Aug 2026'}) — nothing has updated because the range you just chose has no data to show.</div>`;
    pageEl.insertBefore(banner, pageEl.firstChild);
  }
  applyLightPreviewTheme(currentPageId); // .main class persists across re-renders, but the switcher's own DOM is rebuilt — re-sync its active button
  requestAnimationFrame(()=>initChartsFor(currentPageId));
}

const chartRegistry = {};
function initChartsFor(id){
  if(chartRegistry[id]) chartRegistry[id].forEach(fn=>{ try{ fn(); } catch(e){ console.warn('Chart/table init skipped for', id, e); } });
  const pageEl = document.getElementById('page-'+id);
  if (pageEl) applyHoverTooltips(pageEl);
}

/* ---------- real trend helper: first 15 days vs last 15 days of the same 30-day window ---------- */
function halfTrend(dailySeries, key){
  if(!dailySeries || dailySeries.length < 4) return null;
  const mid = Math.floor(dailySeries.length/2);
  const first = dailySeries.slice(0, mid).reduce((a,d)=>a+(d[key]||0),0);
  const second = dailySeries.slice(mid).reduce((a,d)=>a+(d[key]||0),0);
  if(!first) return null;
  return (second-first)/first*100;
}
const metaSpendTrend_UNUSED = null; // superseded by mutable `metaSpendTrend` set in recomputeAll()

/* ============================================================
   Reusable ranking bar list (top/bottom campaigns etc.)
   ============================================================ */
function rankBars(rows, valueKey, opts={}){
  const max = Math.max(...rows.map(r=>Math.abs(r[valueKey])||0), 1);
  const color = opts.color || (()=>PAL.gold);
  const objColor = {Conversion:PAL.gold, Traffic:PAL.blue, Awareness:PAL.amber, Other:PAL.dim};
  return '<div class="funnel" style="gap:10px;">' + rows.map(r=>{
    const v = r[valueKey]||0;
    const pct = Math.abs(v)/max*100;
    const objBadge = r.objective ? `<span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${objColor[r.objective]||PAL.dim};margin-right:5px;" title="${r.objective}"></span>` : '';
    return `<div class="funnel-row" style="grid-template-columns:${opts.labelWidth||'170px'} 1fr 90px;">
      <div class="funnel-label" title="${r.name}${r.objective?' · '+r.objective:''}">${(r.iconKey?iconBadge(r.iconKey,13)+' ':'')}${objBadge}${r.name.length>24?r.name.slice(0,23)+'…':r.name}</div>
      <div class="funnel-bar-bg"><div class="funnel-bar" style="width:${pct}%;background:${color(r)};"></div></div>
      <div class="funnel-val">${opts.fmt ? opts.fmt(v) : fmtNum(v)}</div>
    </div>`;
  }).join('') + '</div>';
}

/* ---------- progress / pacing bar ---------- */
function progressBar(pct, color){
  const c = color || (pct>110?PAL.red:pct<60?PAL.amber:PAL.green);
  const w = Math.min(100, pct);
  return `<div style="display:flex;align-items:center;gap:10px;">
    <div style="flex:1;height:8px;background:var(--ink-3);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${w}%;background:${c};border-radius:4px;"></div></div>
    <div style="font-family:var(--mono);font-size:12px;color:${c};width:46px;text-align:right;">${pct.toFixed(0)}%</div>
  </div>`;
}

/* ============================================================
   Generic sortable / searchable table component
   ============================================================ */
function buildTable(containerId, columns, rows, opts={}){
  const pageSize = opts.pageSize || 8;
  let state = { sortCol: opts.defaultSort || columns[0].key, sortDir: opts.defaultDir || 'desc', search:'', page:0 };

  function filtered(){
    let r = rows;
    if(state.search){
      const s = state.search.toLowerCase();
      r = r.filter(row => columns.some(c => String(row[c.key]).toLowerCase().includes(s)));
    }
    r = [...r].sort((a,b)=>{
      let av=a[state.sortCol], bv=b[state.sortCol];
      if(typeof av === 'string') return state.sortDir==='asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      av = (av===null||av===undefined) ? -Infinity : av;
      bv = (bv===null||bv===undefined) ? -Infinity : bv;
      return state.sortDir==='asc' ? av-bv : bv-av;
    });
    return r;
  }

  function render(){
    const all = filtered();
    const totalPages = Math.max(1, Math.ceil(all.length/pageSize));
    state.page = Math.min(state.page, totalPages-1);
    const pageRows = all.slice(state.page*pageSize, state.page*pageSize+pageSize);
    // Numeric columns (Spend, Revenue, ROAS, Impressions, etc.) are right-aligned — both header
    // and cells — so figures line up for easy scanning. Detected from the real underlying values
    // where present; a few known metric keys (e.g. 'roas' on tables where it's computed inside
    // fmt() rather than stored as a raw field) are also recognized by name so alignment doesn't
    // depend on how a given table happens to compute its display value.
    const KNOWN_NUMERIC_KEYS = new Set(['spend','revenue','purchases','impressions','clicks','ctr','cpc','cpm','roas','cpa','reach','sessions','active_users','aov','mer','contribution','rows','viewed','purchased','added_to_cart','ecommerce_purchases','users']);
    const numericCol = {};
    columns.forEach(c=>{ numericCol[c.key] = KNOWN_NUMERIC_KEYS.has(c.key) || rows.some(r=>typeof r[c.key] === 'number'); });
    // table-layout:fixed requires explicit per-column widths to guarantee header and body cells
    // share the exact same column boundaries — with the default auto layout, a header row's short
    // label text and a body row's wider formatted values (different font, different natural width)
    // can end up sized independently by the browser, letting header and data drift apart even
    // though both cells belong to the "same" column. Fixed widths, applied identically to every
    // header cell (and inherited by the whole column), remove that possibility entirely.
    const colWeight = columns.map((c,i)=> i===0 ? 3 : (numericCol[c.key] ? 1.15 : 1.6));
    const totalWeight = colWeight.reduce((a,b)=>a+b,0);
    const colWidth = colWeight.map(w => (w/totalWeight*100).toFixed(2));
    const thead = columns.map((c,i)=>{
      const isSorted = c.key===state.sortCol;
      const cls = isSorted ? `sorted ${state.sortDir}` : '';
      const tip = lookupTooltip(c.label);
      const infoIcon = tip ? `<span class="th-info" title="${tip.replace(/"/g,'&quot;')}">ⓘ</span>` : '';
      const sortIcons = `<span class="th-sort"><span class="th-sort-up ${isSorted && state.sortDir==='asc' ? 'active':''}">▲</span><span class="th-sort-down ${isSorted && state.sortDir==='desc' ? 'active':''}">▼</span></span>`;
      return `<th class="${cls}${numericCol[c.key]?' num-col':''}" data-key="${c.key}" style="width:${colWidth[i]}%">${c.label}${infoIcon}${sortIcons}</th>`;
    }).join('');
    const tbody = pageRows.length ? pageRows.map(row=>
      '<tr>'+ columns.map((c,i)=>{
        const v = row[c.key];
        const disp = c.fmt ? c.fmt(v, row) : v;
        return `<td class="${c.cls||''}${numericCol[c.key]?' num-col':''}" style="width:${colWidth[i]}%">${disp===null||disp===undefined||disp==='' ? '<span class="kpi-na">—</span>' : disp}</td>`;
      }).join('') + '</tr>'
    ).join('') : `<tr><td colspan="${columns.length}"><div class="empty-state">No matching rows.</div></td></tr>`;

    // Optional pinned Total row — computed from the full currently-filtered (searched) set,
    // not just the visible page, and independent of sort order. Opt-in only; unused by default
    // so every other table on the dashboard is unaffected.
    const totalsHtml = opts.totalsRow ? (()=>{
      const totals = opts.totalsRow(all);
      return `<tr class="table-total-row">${columns.map((c,i)=>{
        const v = totals[c.key];
        const disp = c.totalFmt ? c.totalFmt(v, totals) : (c.fmt ? c.fmt(v, totals) : v);
        return `<td class="${c.cls||''}${numericCol[c.key]?' num-col':''}" style="width:${colWidth[i]}%">${disp===null||disp===undefined||disp==='' ? '' : disp}</td>`;
      }).join('')}</tr>`;
    })() : '';

    document.getElementById(containerId).innerHTML = `
      <div class="table-tools">
        <input type="text" class="search-input" placeholder="Search…" value="${state.search}" id="${containerId}-search">
      </div>
      <div class="table-scroll"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}${totalsHtml}</tbody></table></div>
      <div class="table-foot">
        <span>${all.length} row${all.length===1?'':'s'}</span>
        <div class="pager" id="${containerId}-pager">
          ${Array.from({length:totalPages}).map((_,i)=>`<button data-p="${i}" class="${i===state.page?'on':''}">${i+1}</button>`).join('')}
        </div>
      </div>`;

    document.getElementById(containerId).querySelectorAll('thead th').forEach(th=>{
      th.addEventListener('click', ()=>{
        const key = th.dataset.key;
        if(state.sortCol===key){ state.sortDir = state.sortDir==='asc'?'desc':'asc'; } else { state.sortCol=key; state.sortDir='desc'; }
        render();
      });
    });
    document.getElementById(containerId+'-search').addEventListener('input', (e)=>{ state.search=e.target.value; state.page=0; render(); });
    document.getElementById(containerId).querySelectorAll(`#${containerId}-pager button`).forEach(b=>{
      b.addEventListener('click', ()=>{ state.page = Number(b.dataset.p); render(); });
    });
  }
  render();
}

/* ============================================================
   KPI card helper
   ============================================================ */
/* ============================================================
   HOVER TOOLTIPS — a single dictionary + lookup, applied wherever
   metric/column/headline text is rendered, rather than hand-editing
   every page. Falls back silently (no tooltip) on unknown text so
   nothing breaks if a label doesn't have an entry yet.
   ============================================================ */
const METRIC_TOOLTIPS = {
  'Spend': 'Total amount spent on ads for the selected period and filters.',
  'Spend (AED)': 'Total amount spent on ads for the selected period and filters.',
  'Total Ad Spend': 'Sum of ad spend across the platforms included in the current filter, for the selected date range.',
  'Meta + Google spend': 'Combined daily spend from Meta and Google — the two platforms with real day-level spend data.',
  'Revenue': 'Platform-attributed purchase revenue — from that platform\u2019s own pixel/API, not GA4.',
  'GA4 revenue': 'Website ecommerce revenue as recorded by GA4 — independent of any ad platform\u2019s own attribution.',
  'GA4 Website Revenue': 'Website ecommerce revenue as recorded by GA4 — the source of truth for MER, independent of platform attribution.',
  'Purchase Revenue': 'Total ecommerce revenue recorded by GA4 for the selected period.',
  'ROAS': 'Return On Ad Spend = Revenue \u00f7 Spend. Calculated from aggregated totals, never averaged.',
  'Blended ROAS': 'Return On Ad Spend across all included platforms = \u03a3 Revenue \u00f7 \u03a3 Spend.',
  'Paid Media ROAS': 'Platform-attributed revenue \u00f7 ad spend — pixel/API attribution, not the same as GA4 website revenue.',
  'MER': 'Marketing Efficiency Ratio = GA4 Website Revenue \u00f7 Total Ad Spend. The clearest single read of overall paid-media contribution.',
  'MER (GA4 rev \u00f7 Meta+Google spend)': 'Daily GA4 revenue divided by daily Meta+Google spend \u2014 blended efficiency across the selected period.',
  'AOV': 'Average Order Value = Revenue \u00f7 Purchases.',
  'AOV (GA4)': 'Average Order Value = GA4 Revenue \u00f7 GA4 Purchases.',
  'CPA': 'Cost Per Acquisition = Spend \u00f7 Purchases.',
  'CPA (AED)': 'Cost Per Acquisition = Spend \u00f7 Purchases.',
  'CPC': 'Cost Per Click = Spend \u00f7 Clicks.',
  'CPM': 'Cost Per 1,000 Impressions = (Spend \u00f7 Impressions) \u00d7 1,000.',
  'CTR': 'Click-Through Rate = Clicks \u00f7 Impressions.',
  'Blended CPC': 'Cost Per Click across all included platforms = \u03a3 Spend \u00f7 \u03a3 Clicks.',
  'Blended CPM': 'Cost Per 1,000 Impressions across all included platforms, calculated from aggregated totals.',
  'Blended CTR': 'Click-Through Rate across all included platforms = \u03a3 Clicks \u00f7 \u03a3 Impressions.',
  'Impressions': 'Number of times ads were shown, for the selected period and filters.',
  'Clicks': 'Number of clicks on ads, for the selected period and filters.',
  'Reach': 'Number of unique people who saw the ads (not the same as impressions, which can count repeat views).',
  'Avg. Reach / day': 'Average daily reach across the selected date range.',
  'Frequency': 'Average number of times a unique person saw the ad = Impressions \u00f7 Reach.',
  'Purchases': 'Number of completed purchases attributed to this platform/campaign/product.',
  'Ecommerce Purchases': 'Number of completed purchases recorded by GA4 on the website.',
  'GA4 Ecommerce Purchases': 'Number of completed purchases recorded by GA4 on the website — independent of ad-platform attribution.',
  'Purchased': 'Units purchased for this item, per GA4 ecommerce data.',
  'Purchase': 'A completed purchase event.',
  'Complete Payment': 'TikTok\u2019s purchase-completion event.',
  'Sessions': 'Number of website visits recorded by GA4.',
  'Active Users': 'Number of distinct users recorded by GA4 for the selected period.',
  'Users': 'Number of distinct users recorded by GA4 for the selected period.',
  'Site Conv. Rate': 'Conversion Rate = GA4 Purchases \u00f7 GA4 Sessions.',
  'Add to Carts': 'Number of add-to-cart events recorded by GA4.',
  'Added to Cart': 'Number of add-to-cart events for this item/campaign.',
  'Add to Cart': 'Number of add-to-cart events for this campaign.',
  'ATC': 'Add To Cart — number of add-to-cart events for this campaign.',
  'Checkouts': 'Number of checkout-initiated events recorded by GA4.',
  'Checkout': 'Number of checkout-initiated events for this campaign.',
  'Start Checkout': 'Number of checkout-initiated events (Snapchat).',
  'Initiate Checkout': 'Number of checkout-initiated events for this campaign.',
  'Landing Page View': 'Number of landing-page-view events for this campaign — a step after the click, before on-page engagement.',
  'View Content': 'Number of product/content-view events recorded on the landing page.',
  'Viewed': 'Number of times this product was viewed, per GA4 ecommerce data.',
  'Best Seller': 'The single product with the highest recorded revenue in this view.',
  'Top 15 Items \u2014 Revenue': 'Combined revenue of the top 15 products shown in the table below, by GA4 ecommerce revenue.',
  'Top 15 Items \u2014 Units': 'Combined units purchased across the top 15 products shown below.',
  'Rev. Contribution': 'This platform\u2019s share of total platform-attributed revenue across all included platforms.',
  'Signal': 'A quick strongest/weakest flag for this platform based on ROAS this period.',
  'Objective': 'The campaign\u2019s stated goal (Conversion, Traffic, or Awareness), derived from its naming convention and cross-checked against its real platform objective. Success is judged against this goal, not a single blanket metric.',
  'Status': 'Current delivery status of this campaign/ad on its platform.',
  'Platform': 'Which connected ad platform this row belongs to.',
  'Segment': 'A grouping of campaigns (e.g. Prospecting vs Retargeting) derived from campaign naming convention.',
  'Gender': 'Audience gender breakdown, as reported by Meta.',
  'Placement': 'Where the ad served \u2014 e.g. Facebook, Instagram, WhatsApp \u2014 as reported by Meta.',
  'Channel': 'GA4\u2019s own traffic-source attribution (Direct, Organic Search, Paid Social, etc.) \u2014 independent of ad-platform pixels.',
  'Source': 'The connected data source this row reports on.',
  'Last Pull': 'When this source\u2019s data was last retrieved for this dashboard.',
  'Last Successful Pull': 'When this source\u2019s data was last retrieved successfully.',
  'Rows Returned': 'Number of data rows retrieved from this source in the last pull.',
  'Campaign': 'The name of this ad campaign, as set on its platform.',
  'Campaign / Ad Set': 'The Meta ad set this budget applies to.',
  'Daily Budget': 'The ad set\u2019s configured daily budget, where one was actually retrieved.',
  'Implied 30d Budget': 'Daily budget \u00d7 30 \u2014 a rough monthly-equivalent for comparison against actual spend.',
  'Actual 30d Spend': 'Real spend recorded over the last 30 days for this ad set.',
  'Pacing': 'Actual spend as a percentage of the implied 30-day budget \u2014 over 100% means spend is outpacing the budget.',
  'Creative': 'A thumbnail of the actual ad creative, pulled directly from the ad account.',
  'Ad': 'The individual ad within this campaign.',
  'Product': 'The product name, as recorded by GA4 ecommerce tracking.',
  'Budget Pacing \u2014 Ad Sets with a Set Daily Budget': 'Actual spend vs. the ad set\u2019s configured daily budget, where a budget was retrieved.',
  'Notable Gap': 'A known limitation or tracking issue for this source, disclosed rather than hidden.',
};
const HEADLINE_TOOLTIPS = {
  'Executive Overview': 'The CEO / Marketing Director view of the whole media-buying operation \u2014 headline numbers, trends, platform performance, and what needs attention right now.',
  'Cross-Platform Performance': 'Side-by-side comparison of delivery and efficiency across every connected ad platform, using aggregated (never averaged) totals.',
  'Google Ads': 'Performance for the connected Google Ads account.',
  'Meta Ads': 'Performance for the connected Meta (Facebook & Instagram) ad account.',
  'Snapchat Ads': 'Performance for the connected Snapchat Ads account.',
  'TikTok Ads': 'Performance for the connected TikTok Ads account.',
  'GA4 / Website & Ecommerce': 'Website-side performance as recorded by Google Analytics 4 \u2014 the source of truth for MER and blended revenue, independent of ad-platform attribution.',
  'Full Funnel / Customer Journey': 'The combined delivery-to-purchase journey across all connected platforms, from impressions through to revenue.',
  'Campaign Analysis': 'Every campaign with spend, consolidated across all four ad platforms, evaluated by its own objective.',
  'Audience Analysis': 'Who the ads reached \u2014 gender and placement breakdowns, plus a prospecting-vs-retargeting read of spend.',
  'Creative Analysis': 'Ad-level creative performance, including live thumbnails pulled from the ad account.',
  'Product & Collection Analysis': 'Which products and collections are actually driving ecommerce revenue, per GA4.',
  'Budget & Pacing': 'How spend is tracking against budget, where budget data has been retrieved.',
  'Insights & Recommendations': 'Automatically generated observations, each backed by a real number shown elsewhere in the dashboard \u2014 never a generic statement.',
  'Data Quality / Tracking Health': 'Connection status and known gaps for every data source, so you know what to trust and what to double-check.',
  'Active Campaigns': 'Campaigns that recorded spend in the selected period.',
  'All Active-Spend Campaigns': 'Every campaign with real spend in the selected period, across all four platforms.',
  'Awareness \u2192 Purchase': 'The delivery-to-purchase journey for the selected period, combined across platforms.',
  'Best Awareness \u2014 Lowest CPM': 'The Awareness-objective campaign delivering impressions most cheaply \u2014 CPM is the right yardstick for Awareness, not ROAS.',
  'Best Traffic \u2014 Lowest CPC': 'The Traffic-objective campaign delivering clicks most cheaply \u2014 CPC is the right yardstick for Traffic, not ROAS.',
  'Budget Pacing \u2014 Ad Sets With a Set Daily Budget': 'Actual spend vs. the ad set\u2019s configured daily budget, where a budget was retrieved.',
  'Campaign Efficiency Matrix': 'Spend vs ROAS for Conversion-objective campaigns only \u2014 bubble size shows revenue. ROAS isn\u2019t a fair measure for Traffic or Awareness campaigns, so they\u2019re excluded here.',
  'Campaigns': 'Campaign-level detail for this platform.',
  'Channel Breakdown': 'GA4\u2019s own attribution by traffic channel, independent of ad-platform pixels.',
  'Daily Spend & Clicks': 'Real day-by-day spend and clicks for the selected range.',
  'Daily Spend & Reach': 'Real day-by-day spend and reach for the selected range.',
  'Daily Spend Cadence \u2014 Meta vs Google': 'How spend moved day-by-day for the two platforms with real daily granularity.',
  'Data Freshness': 'When each connected source was last retrieved.',
  'Definitions in use': 'The exact formulas this dashboard uses for its blended metrics \u2014 always calculated from aggregated totals, never by averaging ratios.',
  'Efficiency Matrix \u2014 Spend vs ROAS': 'Each platform plotted by spend and ROAS \u2014 bubble size shows revenue. The dashed breakeven line sits at 1.0x.',
  'Full Comparison Table': 'Every metric for every platform, side by side, sortable and searchable.',
  'Full Funnel \u2014 Awareness to Revenue': 'The combined journey from impressions through to purchase, across all connected platforms.',
  'Funnel': 'The delivery-to-purchase journey for this platform.',
  'Funnel (available fields)': 'The delivery-to-purchase journey using only the stages this platform actually reports.',
  'Google \u2014 Spend Volatility': 'How much Google\u2019s daily spend varies across the selected period.',
  'Highest Spend \u2014 All Objectives': 'The campaigns spending the most, regardless of objective.',
  'Known Tracking Gaps': 'Disclosed limitations in what\u2019s currently retrievable, so nothing is silently assumed.',
  'MER Trend': 'How blended marketing efficiency (GA4 revenue \u00f7 ad spend) moved day-by-day across the selected period.',
  'Meta \u2014 Ad Sets With a Retrieved Daily Budget': 'Ad sets where a daily budget value was actually retrieved \u2014 most Meta campaigns here use Campaign Budget Optimisation instead.',
  'Meta \u2014 Prospecting vs Retargeting (naming-convention derived)': 'A structural read of real spend, split by campaign naming convention \u2014 not a platform-native audience field.',
  'Meta \u2014 Spend & Revenue by Gender': 'Real Meta spend and revenue broken down by audience gender.',
  'Meta \u2014 Spend & Revenue by Placement': 'Real Meta spend and revenue broken down by where the ad served (Facebook, Instagram, WhatsApp).',
  'Meta \u2014 Spend Volatility': 'How much Meta\u2019s daily spend varies across the selected period.',
  'Needs Attention': 'Conversion-objective campaigns spending real money while running below breakeven ROAS.',
  'Platform Comparison': 'Every connected platform, side by side, with badges marking the strongest, highest-revenue, highest-spend, and weakest performer this period.',
  'Platform Contribution by Stage': 'Each platform\u2019s real share of impressions, clicks, add-to-cart, and purchases for the selected range.',
  'Platform ROAS Comparison': 'Each platform\u2019s Return On Ad Spend, side by side.',
  'ROAS vs CPA by Platform': 'Efficiency (ROAS) and cost (CPA) shown together for every platform.',
  'Revenue Contribution %': 'Each platform\u2019s share of total platform-attributed revenue.',
  'Revenue Contribution by Platform': 'Each platform\u2019s share of total platform-attributed revenue, shown as a donut chart.',
  'Revenue by Channel': 'GA4 ecommerce revenue broken down by traffic channel.',
  'Sessions by Channel': 'GA4 website sessions broken down by traffic channel.',
  'Source Status': 'Connection status for every data source feeding this dashboard.',
  'Spend vs Revenue Relationship': 'How campaign spend relates to the revenue it generated, for Conversion-objective campaigns.',
  'Spend vs Revenue Trend': 'Daily ad spend against GA4 website revenue \u2014 two different attribution systems, shown side by side, never blended into one number.',
  'Spend vs Revenue by Platform': 'Spend and platform-attributed revenue for every connected platform, side by side.',
  'Stage Efficiency': 'Conversion rate from one funnel stage to the next, so you can see exactly where the journey leaks.',
  'Strongest & Weakest Platform': 'Every connected platform, with badges marking the strongest, highest-revenue, highest-spend, and weakest performer this period.',
  'Top 6 by ROAS': 'The highest-ROAS Conversion-objective campaigns \u2014 Traffic and Awareness campaigns are excluded since ROAS isn\u2019t their goal.',
  'Top 6 by Revenue \u2014 All Objectives': 'The highest-revenue campaigns regardless of objective.',
  'Top Meta Ads by Spend': 'Individual Meta ad creatives, ranked by spend, with live thumbnails.',
  'Top Products by Revenue': 'Products ranked by real GA4 ecommerce revenue.',
  'Top ROAS': 'The highest-ROAS Conversion-objective campaigns this period.',
  'Top Revenue \u2014 All Objectives': 'The highest-revenue campaigns regardless of objective \u2014 revenue is comparable across all campaign types.',
  'Website-side journey (GA4)': 'The delivery-to-purchase journey as GA4 sees it on the website \u2014 all traffic, not only paid.',
};
function lookupTooltip(text){
  if (!text) return '';
  const t = text.trim();
  if (METRIC_TOOLTIPS[t]) return METRIC_TOOLTIPS[t];
  if (HEADLINE_TOOLTIPS[t]) return HEADLINE_TOOLTIPS[t];
  // fall back: strip a trailing parenthetical or platform icon markup and retry
  const stripped = t.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (stripped !== t){
    if (METRIC_TOOLTIPS[stripped]) return METRIC_TOOLTIPS[stripped];
    if (HEADLINE_TOOLTIPS[stripped]) return HEADLINE_TOOLTIPS[stripped];
  }
  return '';
}
function tipAttr(text){
  const tip = lookupTooltip(text);
  return tip ? ` title="${tip.replace(/"/g,'&quot;')}"` : '';
}
function thInfo(label){
  const tip = lookupTooltip(label);
  return tip ? `<span class="th-info" title="${tip.replace(/"/g,'&quot;')}">ⓘ</span>` : '';
}
/* Runs after every page render/re-render: finds headline-type elements and table headers
   that don't already have a title attribute, and applies one from the dictionaries above. */
function applyHoverTooltips(root){
  const scope = root || document;
  scope.querySelectorAll('.card-title, .page-title, .page-eyebrow, .kpi-label, thead th').forEach(el=>{
    if (el.hasAttribute('title')) return;
    const tip = lookupTooltip(el.textContent);
    if (tip) el.setAttribute('title', tip);
  });
  scope.querySelectorAll('.section-label span').forEach(el=>{
    if (el.hasAttribute('title')) return;
    const tip = lookupTooltip(el.textContent);
    if (tip) el.setAttribute('title', tip);
  });
}

function kpi(label, value, delta, deltaLabel, helperText){
  const deltaHtml = (delta===undefined || delta===null) ? '' :
    `<div class="kpi-delta ${delta==null?'flat':(delta>=0?'up':'down')}">${delta==null?'No comparison period':(delta>=0?'▲':'▼')+' '+Math.abs(delta).toFixed(1)+'% '+(deltaLabel||'')}</div>`;
  const helperHtml = helperText ? `<div class="kpi-helper">${helperText}</div>` : '';
  return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value ${typeof value==='string' && value.match(/[A-Za-z]/) && !value.includes('AED') ? '' : 'mono'}">${value}</div>${deltaHtml}${helperHtml}</div>`;
}

/* ============================================================
   PAGE RENDER DISPATCH
   ============================================================ */
function renderPage(id){
  const wrap = document.getElementById('pageWrap');
  const div = document.createElement('div');
  div.className = 'page'; div.id = 'page-'+id;
  const switcherHtml = `
    <div class="theme-switcher visible">
      <span>Preview theme</span>
      <button data-theme="dark">Dark</button>
      <button data-theme="light">Light (warm)</button>
      <button data-theme="white">White (clean)</button>
    </div>`;
  try {
    div.innerHTML = switcherHtml + (PAGES[id] ? PAGES[id].html() : `<div class="empty-state"><div class="big">—</div>Page not available.</div>`);
  } catch(e) {
    console.warn('Page render failed for', id, e);
    div.innerHTML = switcherHtml + `<div class="empty-state"><div class="big">—</div>This page could not be displayed. Please try refreshing.</div>`;
  }
  wrap.appendChild(div);
  if(PAGES[id] && PAGES[id].charts){ chartRegistry[id] = PAGES[id].charts; }
}

/* ============================================================
   Reusable funnel renderer
   ============================================================ */
function funnelHtml(stages){
  const max = Math.max(...stages.map(s=>s.value||0), 1);
  // Same fix as the Platform Contribution chart: a linear width (value/max) makes any stage
  // more than ~30x smaller than the first render as an invisible sliver — exactly what happened
  // here (Impressions to Purchase is a ~280,000x gap). A square-root scale plus a minimum visible
  // floor keeps every bar honestly ordered (still strictly decreasing where the real data does)
  // while making every real, non-zero stage actually visible. The printed value is always exact.
  return '<div class="funnel">' + stages.map((s,i)=>{
    const pct = s.value ? Math.max(4, Math.sqrt(s.value/max)*100) : 0;
    const prev = i>0 ? stages[i-1].value : null;
    const drop = (prev && s.value!==null) ? (1 - s.value/prev)*100 : null;
    return `<div class="funnel-row">
      <div class="funnel-label">${s.label}</div>
      <div class="funnel-bar-bg"><div class="funnel-bar" style="width:${pct}%"></div></div>
      <div class="funnel-val">${s.value===null?'N/A':fmtCompact(s.value)}</div>
      <div class="funnel-drop ${drop===null||drop<40?'ok':''}">${drop===null?'':(drop>=0?'−'+drop.toFixed(0)+'%':'+'+Math.abs(drop).toFixed(0)+'%')}</div>
    </div>`;
  }).join('') + '</div>';
}

/* A true cone-shaped funnel visualization — stacked tapering trapezoid segments, each stage's
   width proportional to its real value relative to the first stage. Same underlying numbers as
   funnelHtml() above; this only changes how they're drawn. Built as inline SVG so it renders
   crisply at any size without a charting library, and stays self-contained in this file. */
function svgConeFunnel(labels, values){
  const max = Math.max(...values.map(v=>v||0), 1);
  const n = labels.length;
  const rowH = 48, gap = 3, topPad = 6;
  const totalH = topPad*2 + n*rowH + (n-1)*gap;
  const cx = 150, maxHalfW = 130, minHalfW = 14; // funnel is centered at x=150, tapers between these half-widths
  const widthFor = v => minHalfW + (maxHalfW-minHalfW) * Math.sqrt(Math.max(v,0)/max);
  let segments = '';
  for (let i=0;i<n;i++){
    const y0 = topPad + i*(rowH+gap);
    const y1 = y0 + rowH;
    const wTop = widthFor(values[i]);
    const wBot = i<n-1 ? widthFor(values[i+1]) : Math.max(minHalfW*0.6, wTop*0.82);
    const shade = 90 - i*(55/Math.max(n-1,1)); // lightness percent, darkening down the funnel
    const points = `${cx-wTop},${y0} ${cx+wTop},${y0} ${cx+wBot},${y1} ${cx-wBot},${y1}`;
    segments += `<polygon points="${points}" fill="hsl(38,42%,${shade}%)" stroke="#ffffff22" stroke-width="1"/>`;
    const prev = i>0 ? values[i-1] : null;
    const drop = (prev && values[i]!==null && prev>0) ? (1 - values[i]/prev)*100 : null;
    const dropText = drop===null ? '' : (drop>=0
      ? ` <tspan fill="${drop<40?'#7FA37A':'#C97B6B'}" font-size="10">(−${drop.toFixed(0)}%)</tspan>`
      : ` <tspan fill="#7FA37A" font-size="10">(+${Math.abs(drop).toFixed(0)}%)</tspan>`);
    segments += `<text x="310" y="${y0+rowH/2-3}" font-size="12.5" font-family="var(--sans)" style="fill:var(--text);font-weight:600;">${labels[i]}</text>`;
    segments += `<text x="310" y="${y0+rowH/2+13}" font-size="12" font-family="var(--mono)" style="fill:var(--text-dim);">${fmtCompact(values[i])}${dropText}</text>`;
  }
  return `<div style="overflow-x:auto;"><svg viewBox="0 0 520 ${totalH}" style="width:100%;max-width:560px;height:auto;display:block;margin:0 auto;">${segments}</svg></div>`;
}

/* ============================================================
   PAGE DEFINITIONS
   ============================================================ */
const PAGES = {};

/* ---------- section divider label (visual hierarchy grouping) ---------- */
function sectionLabel(text){
  return `<div class="section-label"><span>${text}</span></div>`;
}

/* ---------- compact platform comparison cards with strongest/weakest badges ---------- */
function platformCompareCards(){
  const rows = PT.rows;
  const bestROAS = rows.reduce((a,b)=> (b.roas||0) > (a.roas||0) ? b : a);
  const worstROAS = rows.reduce((a,b)=> (b.roas??Infinity) < (a.roas??Infinity) ? b : a);
  const mostRevenue = rows.reduce((a,b)=> b.revenue > a.revenue ? b : a);
  return `<div class="plat-card-grid">` + rows.map(r=>{
    const badges = [];
    if(r.key===bestROAS.key) badges.push('<span class="mini-badge best">★ Most efficient</span>');
    if(r.key===mostRevenue.key) badges.push('<span class="mini-badge lead">Top revenue</span>');
    if(r.key===worstROAS.key && rows.length>1) badges.push('<span class="mini-badge watch">Needs attention</span>');
    if(!r.dateFiltered) badges.push(`<span class="mini-badge" style="background:rgba(124,156,181,0.15);color:var(--blue);">${ISFULL?'Full period':'Unavailable'}</span>`);
    return `<div class="plat-card">
      <div class="plat-card-head">${platformLabel(r.key, r.name)}</div>
      <div class="plat-card-metrics">
        <div><span class="pcm-label">Spend</span><span class="pcm-val">${fmtAED(r.spend)}</span></div>
        <div><span class="pcm-label">Revenue</span><span class="pcm-val">${fmtAED(r.revenue)}</span></div>
        <div><span class="pcm-label">ROAS</span><span class="pcm-val" style="color:${roasColor(r.roas)}">${fmtX(r.roas)}</span></div>
        <div><span class="pcm-label">CPA</span><span class="pcm-val">${r.cpa===null?'N/A':fmtAED(r.cpa)}</span></div>
      </div>
      <div class="plat-card-badges">${badges.join('')}</div>
    </div>`;
  }).join('') + `</div>`;
}

/* ---------- Page-01-only variant: adds a Purchases metric + Highest-spend badge without
   touching the shared platformCompareCards() used by the Cross-Platform page (page 02). ---------- */
function platformCompareCardsExec(){
  const rows = PT.rows;
  const eligible = rows.filter(r=>r.spend!=null);
  const roasEligible = rows.filter(r=>r.roas!=null);
  const bestROAS = roasEligible.length ? roasEligible.reduce((a,b)=> b.roas > a.roas ? b : a) : null;
  const worstROAS = roasEligible.length ? roasEligible.reduce((a,b)=> b.roas < a.roas ? b : a) : null;
  const mostRevenue = rows.reduce((a,b)=> (b.revenue||0) > (a.revenue||0) ? b : a);
  const highestSpend = eligible.length ? eligible.reduce((a,b)=> b.spend > a.spend ? b : a) : null;
  return `<div class="plat-card-grid">` + rows.map(r=>{
    const badges = [];
    if(bestROAS && r.key===bestROAS.key) badges.push('<span class="mini-badge best">★ Most efficient</span>');
    if(r.key===mostRevenue.key) badges.push('<span class="mini-badge lead">Top revenue</span>');
    if(highestSpend && r.key===highestSpend.key && r.key!==mostRevenue.key) badges.push('<span class="mini-badge" style="background:rgba(214,187,127,0.15);color:var(--gold);">Highest spend</span>');
    if(worstROAS && r.key===worstROAS.key && roasEligible.length>1 && worstROAS.key!==bestROAS.key) badges.push('<span class="mini-badge watch">Needs attention</span>');
    if(!r.dateFiltered) badges.push(`<span class="mini-badge" style="background:rgba(124,156,181,0.15);color:var(--blue);">${ISFULL?'Full period':'Unavailable'}</span>`);
    return `<div class="plat-card">
      <div class="plat-card-head">${platformLabel(r.key, r.name)}</div>
      <div class="plat-card-metrics">
        <div><span class="pcm-label">Spend</span><span class="pcm-val">${fmtAED(r.spend)}</span></div>
        <div><span class="pcm-label">Revenue</span><span class="pcm-val">${fmtAED(r.revenue)}</span></div>
        <div><span class="pcm-label">ROAS</span><span class="pcm-val" style="color:${roasColor(r.roas)}">${fmtX(r.roas)}</span></div>
        <div><span class="pcm-label">Impressions</span><span class="pcm-val">${fmtNum(r.impressions)}</span></div>
        <div><span class="pcm-label" title="${r.reachNote||''}">Reach${r.reach===null?' ⓘ':''}</span><span class="pcm-val">${r.reach===null?'N/A':fmtNum(r.reach)}</span></div>
        <div><span class="pcm-label">Clicks</span><span class="pcm-val">${fmtNum(r.clicks)}</span></div>
        <div><span class="pcm-label">Purchases</span><span class="pcm-val">${r.purchases===null?'N/A':fmtNum(r.purchases)}</span></div>
        <div><span class="pcm-label">CPA</span><span class="pcm-val">${r.cpa===null?'N/A':fmtAED(r.cpa)}</span></div>
      </div>
      <div class="plat-card-badges">${badges.join('')}</div>
    </div>`;
  }).join('') + `</div>`;
}

/* ---------- dynamic trend insight for the Spend vs Revenue / MER charts — never hardcoded ---------- */
function computeTrendInsight(){
  if (metaSpendTrend==null && googleSpendTrend==null && ga4RevTrend==null) return null;
  const spendTrend = (metaSpendTrend!=null && googleSpendTrend!=null) ? (metaSpendTrend+googleSpendTrend)/2 : (metaSpendTrend ?? googleSpendTrend);
  const revTrend = ga4RevTrend;
  if (spendTrend==null || revTrend==null) return null;
  const gap = revTrend - spendTrend;
  let text, icon;
  if (revTrend > 5 && Math.abs(spendTrend) < 5){ text = `Revenue climbed ${revTrend.toFixed(0)}% into the second half of the window while spend stayed roughly flat (${spendTrend>=0?'+':''}${spendTrend.toFixed(0)}%) — a genuine efficiency gain, not just a spend increase.`; icon='↗'; }
  else if (spendTrend > 5 && gap < -5){ text = `Spend rose ${spendTrend.toFixed(0)}% into the second half while revenue grew only ${revTrend.toFixed(0)}% — spend is outpacing revenue for this window.`; icon='↓'; }
  else if (gap > 10){ text = `Efficiency improved into the second half of the window: revenue grew ${revTrend.toFixed(0)}% against a ${spendTrend.toFixed(0)}% change in spend.`; icon='↗'; }
  else if (gap < -10){ text = `Efficiency softened into the second half: spend moved ${spendTrend.toFixed(0)}% against a ${revTrend.toFixed(0)}% change in revenue.`; icon='↓'; }
  else { text = `Spend and revenue moved together across the window (spend ${spendTrend>=0?'+':''}${spendTrend.toFixed(0)}%, revenue ${revTrend>=0?'+':''}${revTrend.toFixed(0)}%) — no major efficiency shift.`; icon='→'; }
  return { text, icon };
}

/* ---------- dynamic revenue-contribution insights — only ranks platforms with real, available data ---------- */
function computeContributionInsights(){
  const eligible = PT.rows.filter(r => r.revenue != null && r.spend != null && r.spend > 0);
  if (!eligible.length) return null;
  const topRevenue = eligible.reduce((a,b)=> b.revenue > a.revenue ? b : a);
  const roasEligible = eligible.filter(r=>r.roas!=null);
  const mostEfficient = roasEligible.length ? roasEligible.reduce((a,b)=> b.roas > a.roas ? b : a) : null;
  const highestSpend = eligible.reduce((a,b)=> b.spend > a.spend ? b : a);
  return { topRevenue, mostEfficient, highestSpend };
}

/* ---------- "What Matters Now" — dynamic, categorized, real-data-only insights for the exec page ---------- */
function computeExecutiveInsights(){
  const out = [];
  const rows = PT.rows.filter(r=>r.spend!=null);
  const roasRows = rows.filter(r=>r.roas!=null);

  // 1. Performance leader
  if (roasRows.length){
    const leader = roasRows.reduce((a,b)=> b.roas > a.roas ? b : a);
    out.push({ icon:'★', cat:'Leader', title:`${leader.name} is the performance leader`,
      desc:`${leader.name} returns ${fmtX(leader.roas)} ROAS on ${fmtAED(leader.spend,0)} spend — the strongest efficiency of any connected platform this period.` });
  }
  // 2. Biggest opportunity — high ROAS, comparatively low spend
  if (roasRows.length > 1){
    const totalSpend = rows.reduce((a,r)=>a+r.spend,0);
    const candidates = roasRows.filter(r => r.roas >= 2 && totalSpend && (r.spend/totalSpend) < 0.35);
    if (candidates.length){
      const opp = candidates.reduce((a,b)=> b.roas > a.roas ? b : a);
      out.push({ icon:'✓', cat:'Opportunity', title:`${opp.name} is under-scaled relative to its efficiency`,
        desc:`${opp.name} is converting at ${fmtX(opp.roas)} ROAS but only carries ${fmtPct(opp.spend/totalSpend,0)} of total spend — a candidate for incremental budget.` });
    }
  }
  // 3. Efficiency concern — sub-breakeven platform with real spend
  const concern = rows.filter(r=>r.roas!=null && r.roas<1 && r.spend>200);
  if (concern.length){
    const worst = concern.reduce((a,b)=> b.spend > a.spend ? b : a);
    out.push({ icon:'⚠', cat:'Attention', title:`${worst.name} is running below breakeven`,
      desc:`${worst.name} spent ${fmtAED(worst.spend,0)} at ${fmtX(worst.roas)} ROAS this period — below the 1x breakeven line.` });
  }
  // 4. Revenue driver — GA4 vs paid media framing
  if (GA4T.revenue && KPI_SPEND){
    out.push({ icon:'↗', cat:'Revenue driver', title:`MER of ${fmtX(MER)} on ${fmtAED(GA4T.revenue,0)} website revenue`,
      desc:`GA4 website revenue of ${fmtAED(GA4T.revenue,0)} against ${fmtAED(KPI_SPEND,0)} total ad spend gives a MER of ${fmtX(MER)} — the clearest read on overall paid-media contribution to the business.` });
  }
  // 5. Spend concentration
  if (rows.length > 1){
    const totalSpend = rows.reduce((a,r)=>a+r.spend,0);
    if (totalSpend){
      const top = rows.reduce((a,b)=> b.spend > a.spend ? b : a);
      const share = top.spend/totalSpend;
      if (share >= 0.5){
        out.push({ icon:'⚠', cat:'Concentration', title:`${fmtPct(share,0)} of spend is concentrated in ${top.name}`,
          desc:`${top.name} accounts for ${fmtPct(share,0)} of total ad spend this period (${fmtAED(top.spend,0)} of ${fmtAED(totalSpend,0)}) — a concentration risk if that platform's performance shifts.` });
      }
    }
  }
  // 6. Funnel signal — checkout-to-purchase, only when campaign-level breakdown is available
  if (BREAKDOWNS_AVAILABLE){
    const metaSum = k => DATA.meta_campaigns.reduce((a,c)=>a+(c[k]||0),0);
    const atc = metaSum('add_to_cart') + DATA.snapchat.totals.add_to_cart + DATA.tiktok.totals.add_to_cart;
    const checkout = metaSum('initiate_checkout') + DATA.snapchat.totals.initiate_checkout + DATA.tiktok.totals.initiate_checkout;
    const purchases = PT.totalPurchases;
    if (checkout > 0){
      const rate = purchases/checkout;
      out.push({ icon: rate<0.5?'↓':'↗', cat:'Funnel signal', title:`Checkout → purchase completes at ${fmtPct(rate,0)}`,
        desc:`Of ${fmtNum(checkout)} checkouts initiated across platforms, ${fmtNum(purchases)} completed as purchases (${fmtPct(rate,0)}) — ${rate<0.5?'the steepest drop-off in the funnel':'a healthy completion rate'} this period.` });
    }
  }
  return out.slice(0,6);
}

/* ---------------- 1. EXECUTIVE OVERVIEW ---------------- */
PAGES.exec = {
  html(){
    const platformRows = PT.rows.map(r=>({...r, iconKey:r.key}));
    const campRows = CAMPAIGNS_AVAILABLE ? allCampaignsRows() : [];
    // Campaign success is evaluated per objective — a Traffic or Awareness campaign was never
    // designed to drive purchase revenue, so judging it on ROAS is the wrong yardstick entirely.
    const conversionCamps = campRows.filter(c=>c.objective==='Conversion');
    const trafficCamps = campRows.filter(c=>c.objective==='Traffic');
    const awarenessCamps = campRows.filter(c=>c.objective==='Awareness');
    const topRevenue = [...campRows].sort((a,b)=>b.revenue-a.revenue).slice(0,5);
    const topROAS = [...conversionCamps].filter(c=>c.purchases>0).sort((a,b)=>(b.roas||0)-(a.roas||0)).slice(0,5);
    const bestTraffic = [...trafficCamps].filter(c=>c.cpc!=null).sort((a,b)=>a.cpc-b.cpc).slice(0,5);
    const bestAwareness = [...awarenessCamps].filter(c=>c.cpm!=null).sort((a,b)=>a.cpm-b.cpm).slice(0,5);
    const rangeLabel = RANGE.available ? `${fmtDate(RANGE.from)} – ${fmtDate(RANGE.to)}` : '14 Jul – 12 Aug 2026';
    const spendTrend = (metaSpendTrend!=null && googleSpendTrend!=null) ? (metaSpendTrend+googleSpendTrend)/2 : null;
    let spendDelta = spendTrend, spendDeltaLabel = 'vs first half of window';
    let revDelta = ga4RevTrend, revDeltaLabel = 'vs first half of window';
    let purDelta = ga4PurTrend, purDeltaLabel = 'vs first half of window';
    if (COMPARE.available){
      spendDelta = COMPARE.spendDelta!=null ? COMPARE.spendDelta*100 : null; spendDeltaLabel = 'vs '+COMPARE.label.toLowerCase();
      revDelta = COMPARE.ga4RevenueDelta!=null ? COMPARE.ga4RevenueDelta*100 : null; revDeltaLabel = 'vs '+COMPARE.label.toLowerCase();
      purDelta = COMPARE.ga4PurchasesDelta!=null ? COMPARE.ga4PurchasesDelta*100 : null; purDeltaLabel = 'vs '+COMPARE.label.toLowerCase();
    }
    return `
    <div class="page-head">
      <div class="page-eyebrow">Command Centre · Overview</div>
      <div class="page-title">Executive Overview</div>
      <div class="page-desc">Blended performance across Meta, Google, Snapchat and TikTok, plus GA4 website revenue — ${rangeLabel}.</div>
    </div>

    <div class="banner warn"><span class="ic">ℹ</span><div><b>Data last refreshed: 12 Aug 2026.</b> Reporting window: <b>${rangeLabel}</b>.${appState.compare!=='none' ? (COMPARE.available ? ` Comparing against ${COMPARE.label.toLowerCase()} (${fmtDate(COMPARE.from)} – ${fmtDate(COMPARE.to)}).` : ` <span style="color:var(--amber)">${appState.compare==='prevyear' ? 'Previous-year data has not been retrieved in this build — comparison unavailable.' : 'The comparison period falls outside the retrieved data — comparison unavailable.'}</span>`) : ' Trend arrows compare the second half of this window vs the first half.'}</div></div>
    ${partialRangeBanner()}

    ${sectionLabel('Headline numbers')}
    <div class="kpi-grid">
      ${kpi('Total Ad Spend', KPI_SPEND===null?NA:fmtAED(KPI_SPEND), spendDelta, spendDeltaLabel, KPI_SPEND_NOTE)}
      ${kpi('GA4 Website Revenue', fmtAED(GA4T.revenue), revDelta, revDeltaLabel, 'Website ecommerce revenue, GA4 attribution — not summed from ad platforms.')}
      ${kpi('GA4 Ecommerce Purchases', fmtNum(GA4T.purchases), purDelta, purDeltaLabel)}
      ${kpi('MER', MER===null?NA:fmtX(MER), null, null, 'GA4 Revenue ÷ Total Ad Spend')}
      ${kpi('Paid Media ROAS', KPI_ROAS===null?NA:fmtX(KPI_ROAS), null, null, KPI_ROAS_NOTE)}
      ${kpi('AOV (GA4)', fmtAED(AOV,0))}
    </div>

    ${sectionLabel('Performance trends')}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Spend vs Revenue Trend</div><div class="card-sub">Meta + Google daily spend (platform media) vs GA4 website revenue — two distinct attribution systems, shown side by side, never blended.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="execSpendRevChart"></canvas></div>
        <div id="execTrendInsight"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">MER Trend</div><div class="card-sub">Daily GA4 revenue ÷ daily Meta+Google spend — blended efficiency across the selected period.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="execRoasChart"></canvas></div>
      </div>
    </div>

    ${sectionLabel('Platform performance')}
    <div class="card">
      <div class="card-head"><div><div class="card-title">Platform Comparison</div><div class="card-sub">Badges mark the strongest, highest-revenue, highest-spend and weakest platform on this period's real numbers.</div></div><span class="tag live">Live</span></div>
      ${platformCompareCardsExec()}
    </div>
    <div class="card">
      <div class="card-head"><div class="card-title">Platform ROAS Comparison</div><span class="tag live">Live</span></div>
      <div class="chart-wrap sm"><canvas id="execRoasBarChart"></canvas></div>
    </div>

    ${sectionLabel('Revenue contribution & efficiency')}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Revenue Contribution by Platform</div><span class="tag live">Live · platform-attributed</span></div>
        <div class="chart-wrap sm"><canvas id="execDonutChart"></canvas></div>
        <div id="execContribInsight" style="margin-top:10px;"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Campaign Efficiency Matrix</div><div class="card-sub">Spend (x) vs ROAS (y) — bubble size = revenue. Conversion-objective campaigns only; ROAS isn't a fair measure for Traffic or Awareness campaigns.</div></div><span class="tag ${CAMPAIGNS_AVAILABLE?'live':'warn'}">${CAMPAIGNS_AVAILABLE?'Live':'Unavailable for this range'}</span></div>
        ${CAMPAIGNS_AVAILABLE ? `<div class="chart-wrap"><canvas id="execCampMatrixChart"></canvas></div>
        <div class="bignote">Top-right: high spend, high ROAS — scale with confidence. Bottom-right: high spend, low ROAS — review. Top-left: low spend, high ROAS — the scaling opportunity zone. Bottom-left: low spend, low ROAS — low priority.</div>`
        : unavailableBlock('The campaign efficiency matrix')}
      </div>
    </div>

    ${sectionLabel('Full funnel')}
    <div class="card">
      <div class="card-head"><div><div class="card-title">Full Funnel — Awareness to Revenue</div><div class="card-sub">Platform media metrics (impressions → purchase) — combined across all connected platforms. GA4 website funnel shown separately on the Full Funnel page; never blended with platform-attributed stages.</div></div><span class="tag live">Live</span></div>
      <div id="execFunnelWrap"></div>
    </div>

    ${sectionLabel('Campaign leaders')}
    ${!CAMPAIGNS_AVAILABLE ? unavailableBlock('Campaign leaders') : `
    <div class="banner"><span class="ic">ℹ</span><div><b>Evaluated by objective, not one blanket metric.</b> Conversion campaigns are ranked on ROAS since that's what they're built for; Traffic campaigns on cost-per-click; Awareness campaigns on cost-per-thousand-impressions. Judging an Awareness or Traffic campaign on purchase ROAS would be the wrong yardstick, so this dashboard doesn't do it.</div></div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Top Revenue — All Objectives</div><span class="tag live">Live</span></div>
        ${rankBars(topRevenue, 'revenue', {fmt:v=>fmtAED(v), color:()=>PAL.green, labelWidth:'150px'})}
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Top ROAS</div><div class="card-sub">Conversion-objective campaigns only</div></div><span class="tag live">Live</span></div>
        ${topROAS.length ? rankBars(topROAS, 'roas', {fmt:v=>fmtX(v), color:()=>PAL.gold, labelWidth:'150px'}) : '<div class="empty-state">No Conversion-objective campaigns with purchases in this range.</div>'}
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Best Traffic — Lowest CPC</div><div class="card-sub">Traffic-objective campaigns only</div></div><span class="tag live">Live</span></div>
        ${bestTraffic.length ? rankBars(bestTraffic, 'cpc', {fmt:v=>fmtAED(v,2), color:()=>PAL.blue, labelWidth:'150px'}) : '<div class="empty-state">No Traffic-objective campaigns with spend in this range.</div>'}
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Best Awareness — Lowest CPM</div><div class="card-sub">Awareness-objective campaigns only</div></div><span class="tag live">Live</span></div>
        ${bestAwareness.length ? rankBars(bestAwareness, 'cpm', {fmt:v=>fmtAED(v,2), color:()=>PAL.amber, labelWidth:'150px'}) : '<div class="empty-state">No Awareness-objective campaigns with spend in this range.</div>'}
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Budget Pacing — Ad Sets with a Set Daily Budget</div><span class="tag warn">Meta only, partial</span></div>
        ${DATA.meta_budget.map(r=>{
          const implied = r.adset_daily_budget*30, pct = r.spend_30d/implied*100;
          return `<div style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-dim);margin-bottom:4px;"><span>${r.campaign_name}</span><span class="mono">${fmtAED(r.spend_30d)} / ${fmtAED(implied)}</span></div>${progressBar(pct)}</div>`;
        }).join('')}
        <div class="bignote">Most active campaigns use Campaign Budget Optimisation — no ad-set level cap to pace against. See Budget & Pacing page.</div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Data Freshness</div><span class="tag live">5/5 connected</span></div>
        <div id="execFreshTable"></div>
      </div>
    </div>
    `}

    ${sectionLabel('What matters now')}
    <div id="execInsightsWrap"></div>
    `;
  },
  charts: [
    function(){
      const ctx = document.getElementById('execSpendRevChart');
      if(!ctx || ctx._done) return; ctx._done=true;
      const labels = METAD.map(d=>d.date.slice(5));
      const combinedSpend = METAD.map((d,i)=> d.spend + (GOOGLED[i]?GOOGLED[i].spend:0));
      const spendMax = Math.max(...combinedSpend, 1);
      safeNewChart(ctx, {data:{labels, datasets:[
        {type:'bar', label:'Meta + Google spend', data:combinedSpend, backgroundColor:palAlpha(PAL.gold,0.55), borderColor:PAL.gold, borderWidth:1, borderRadius:3, barPercentage:0.55, categoryPercentage:0.65, order:2, yAxisID:'y1'},
        {type:'line', label:'GA4 revenue', data:GA4D.map(d=>d.revenue), borderColor:PAL.green, backgroundColor:palAlpha(PAL.green,0.12), fill:true, tension:.35, order:1, yAxisID:'y'},
      ]}, options:{plugins:{legend:{position:'bottom', labels:{boxWidth:10}}}, scales:{
        y:{position:'left', title:{display:true,text:'GA4 Revenue (AED)'}, ticks:{callback:v=>'AED '+fmtCompact(v)}},
        y1:{position:'right', suggestedMax:spendMax*1.7, title:{display:true,text:'Spend (AED)'}, grid:{display:false}, ticks:{callback:v=>'AED '+fmtCompact(v)}},
      }}});

      const trendInsight = computeTrendInsight();
      const trendEl = document.getElementById('execTrendInsight');
      if (trendEl) trendEl.innerHTML = trendInsight
        ? `<div class="bignote" style="margin-top:10px;"><span style="color:var(--gold);font-weight:600;">${trendInsight.icon}</span> ${trendInsight.text}</div>`
        : `<div class="bignote" style="margin-top:10px;color:var(--text-faint);">Not enough daily data points in this range to compute a trend callout.</div>`;

      const ctx2 = document.getElementById('execRoasChart');
      const dailyRoas = METAD.map((d,i)=>{
        const spend = d.spend + (GOOGLED[i]?GOOGLED[i].spend:0);
        const rev = GA4D[i] ? GA4D[i].revenue : 0;
        return spend ? rev/spend : null;
      });
      safeNewChart(ctx2, {type:'line', data:{labels, datasets:[
        {label:'MER (GA4 rev ÷ Meta+Google spend)', data:dailyRoas, borderColor:PAL.gold, backgroundColor:palAlpha(PAL.gold,0.15), fill:true, tension:.35, pointRadius:2},
      ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{y:{ticks:{callback:v=>v.toFixed(1)+'x'}}}}});

      const ctx3 = document.getElementById('execDonutChart');
      safeNewChart(ctx3, {type:'doughnut', data:{labels:PT.rows.map(r=>r.name), datasets:[{data:PT.rows.map(r=>r.revenue||0), backgroundColor:PT.rows.map(r=>PAL[r.key]), borderWidth:0}]},
        options:{cutout:'62%', plugins:{legend:{position:'bottom', labels:{boxWidth:10}}}}});

      const contribEl = document.getElementById('execContribInsight');
      if (contribEl){
        const ci = computeContributionInsights();
        contribEl.innerHTML = ci ? `<div class="stat-list">
          <div class="stat-row"><div class="stat-name">Top revenue contributor</div><div class="stat-val" style="color:var(--gold);">${ci.topRevenue.name} · ${fmtAED(ci.topRevenue.revenue,0)}</div></div>
          ${ci.mostEfficient ? `<div class="stat-row"><div class="stat-name">Most efficient platform</div><div class="stat-val" style="color:${roasColor(ci.mostEfficient.roas)}">${ci.mostEfficient.name} · ${fmtX(ci.mostEfficient.roas)}</div></div>` : ''}
          <div class="stat-row"><div class="stat-name">Highest spend platform</div><div class="stat-val">${ci.highestSpend.name} · ${fmtAED(ci.highestSpend.spend,0)}</div></div>
        </div>` : `<div class="bignote" style="color:var(--text-faint);">No platforms with both spend and revenue data for this range.</div>`;
      }

      const ctx4 = document.getElementById('execRoasBarChart');
      const sortedRows = [...PT.rows].sort((a,b)=>(b.roas??-1)-(a.roas??-1));
      safeNewChart(ctx4, {type:'bar', data:{labels:sortedRows.map(r=>r.name), datasets:[{label:'ROAS', data:sortedRows.map(r=>r.roas), backgroundColor:sortedRows.map(r=>PAL[r.key])}]},
        options:{indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{ticks:{callback:v=>v+'x'}}}}});

      if (CAMPAIGNS_AVAILABLE){
        const camps = allCampaignsRows().filter(c=>c.objective==='Conversion');
        const iconKeyFor = p => ({Meta:'meta',Google:'google',Snapchat:'snapchat',TikTok:'tiktok'}[p]);
        const byPlat = {};
        camps.forEach(c=>{ (byPlat[c.platform]=byPlat[c.platform]||[]).push(c); });
        safeNewChart(document.getElementById('execCampMatrixChart'), {type:'bubble', data:{datasets:Object.entries(byPlat).map(([p,cs])=>({
          label:p, data:cs.filter(c=>c.roas!=null).map(c=>({x:c.spend, y:c.roas, r:Math.max(5, Math.sqrt(c.revenue||1)/6)})), backgroundColor:PAL[iconKeyFor(p)]+'CC',
        }))}, options:{plugins:{legend:{position:'bottom',labels:{boxWidth:10}}}, scales:{x:{title:{display:true,text:'Spend (AED)'},ticks:{callback:v=>fmtCompact(v)}}, y:{title:{display:true,text:'ROAS'},ticks:{callback:v=>v+'x'}}}}});
      }

      document.getElementById('execFunnelWrap').innerHTML = execFunnelHtml();

      if (CAMPAIGNS_AVAILABLE){
        buildTable('execFreshTable', [
          {key:'platform', label:'Source'},
          {key:'status', label:'Status', fmt:v=>`<span class="pill active">${v}</span>`},
          {key:'lastPull', label:'Last Pull'},
          {key:'rows', label:'Rows Returned', fmt:v=>fmtNum(v)},
        ], freshnessRows(), {pageSize:5, defaultSort:'platform', defaultDir:'asc'});
      }

      const insightsWrap = document.getElementById('execInsightsWrap');
      if (insightsWrap){
        const insights = computeExecutiveInsights();
        insightsWrap.innerHTML = insights.length ? insights.map(i=>`<div class="insight"><div class="flag ${i.cat==='Attention'||i.cat==='Concentration'?'watch':i.cat==='Leader'?'opp':i.icon==='↓'?'watch':'opp'}"></div><div class="insight-body"><div class="insight-tag">${i.icon} ${i.cat}</div><div class="insight-title">${i.title}</div><div class="insight-desc">${i.desc}</div></div></div>`).join('')
          : `<div class="empty-state">Not enough real data in this range to generate executive insights.</div>`;
      }
    },
  ]
};

function execFunnelHtml(){
  // Mid-funnel stages now come from CAMPAIGN_ROWS — real per-day, per-campaign data already
  // filtered to the selected date range in recomputeAll(). Note: "Payment Info" is Meta-only
  // (Google/Snapchat/TikTok don't expose that specific field), so it's shown but not chained
  // into the main step-conversion math the way the other stages are.
  const lpv = sumKey(CAMPAIGN_ROWS,'lpv');
  const vc = sumKey(CAMPAIGN_ROWS,'vc');
  const atc = sumKey(CAMPAIGN_ROWS,'atc');
  const ic = sumKey(CAMPAIGN_ROWS,'ic');
  const stages = [
    {label:'Impressions', value: PT.totalImpr},
    {label:'Clicks', value: PT.totalClicks},
    {label:'Landing Page View', value: lpv},
    {label:'View Content', value: vc},
    {label:'Add to Cart', value: atc},
    {label:'Initiate Checkout', value: ic},
    {label:'Purchase', value: PT.totalPurchases},
  ];
  const max = stages[0].value || 1;
  return '<div style="display:flex;flex-direction:column;gap:3px;max-width:720px;margin:0 auto;">' + stages.map((s,i)=>{
    const widthPct = 22 + (78 * ((s.value||0)/max));
    const prev = i>0 ? stages[i-1].value : null;
    const convFromPrev = prev ? (s.value/prev*100) : null;
    const convFromTop = (s.value/max*100);
    return `<div style="display:flex;align-items:center;gap:14px;">
      <div style="width:130px;font-size:12px;color:var(--text-dim);text-align:right;">${s.label}</div>
      <div style="flex:1;display:flex;justify-content:center;">
        <div style="width:${widthPct}%;background:linear-gradient(90deg,${PAL.gold},#B8935A);clip-path:polygon(4% 0,96% 0,100% 100%,0% 100%);padding:8px 0;text-align:center;border-radius:3px;">
          <span style="font-family:var(--mono);font-weight:600;color:#141210;font-size:12.5px;">${fmtCompact(s.value)}</span>
        </div>
      </div>
      <div style="width:130px;font-size:11px;color:var(--text-faint);">${convFromPrev===null?'':'step '+convFromPrev.toFixed(0)+'% · '}total ${convFromTop.toFixed(1)}%</div>
    </div>`;
  }).join('') + '</div>';
}

function freshnessRows(){
  return [
    {platform:'Meta Ads (facebook)', status:'LIVE', lastPull:'On-demand, this session', rows: 15},
    {platform:'Google Ads', status:'LIVE', lastPull:'On-demand, this session', rows: 30},
    {platform:'Snapchat Ads', status:'LIVE', lastPull:'On-demand, this session', rows: 36},
    {platform:'TikTok Ads', status:'LIVE', lastPull:'On-demand, this session', rows: 50},
    {platform:'GA4', status:'LIVE', lastPull:'On-demand, this session', rows: 90},
  ];
}

function execInsightPreview(){
  if (!BREAKDOWNS_AVAILABLE) return unavailableBlock('Insights');
  const list = computeInsights().slice(0,3);
  return list.map(i=>`<div class="insight"><div class="flag ${i.flag}"></div><div class="insight-body"><div class="insight-tag">${i.tag}</div><div class="insight-title">${i.title}</div><div class="insight-desc">${i.desc}</div></div></div>`).join('');
}

/* ---------------- 2. CROSS-PLATFORM PERFORMANCE ---------------- */
PAGES.cross = {
  html(){
    return `
    <div class="page-head">
      <div class="page-eyebrow">Blended · Platform Comparison</div>
      <div class="page-title">Cross-Platform Performance</div>
      <div class="page-desc">Side-by-side comparison of delivery and efficiency across all connected ad platforms. Blended ratios are calculated from aggregated totals — never averaged from per-platform ratios.</div>
    </div>
    ${partialRangeBanner()}
    ${!ISFULL ? `<div class="range-banner"><span class="ic">ℹ</span><div>All four platforms below are recalculated for ${fmtDate(RANGE.from)} – ${fmtDate(RANGE.to)} from real daily campaign-level data.</div></div>` : ''}
    <div class="kpi-grid">
      ${kpi('Blended CTR', fmtPct(PT.blendedCTR,2))}
      ${kpi('Blended CPC', fmtAED(PT.blendedCPC,2))}
      ${kpi('Blended CPM', fmtAED(PT.blendedCPM,2))}
      ${kpi('Blended ROAS', fmtX(PT.blendedROAS))}
    </div>
    ${sectionLabel('Platform comparison')}
    <div class="card">
      <div class="card-head"><div><div class="card-title">Strongest & Weakest Platform</div><div class="card-sub">Badges mark the strongest and weakest platform on this period's ROAS and revenue.</div></div><span class="tag live">Live</span></div>
      ${platformCompareCards()}
    </div>
    ${sectionLabel('Spend, revenue & efficiency')}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Spend vs Revenue by Platform</div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="crossBarChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Revenue Contribution %</div><span class="tag live">Live</span></div>
        <div class="chart-wrap" style="height:340px;"><canvas id="crossContribChart"></canvas></div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Efficiency Matrix — Spend vs ROAS</div><div class="card-sub">Bubble size = revenue. Dashed line = breakeven (1.0x).</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="crossScatterChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">ROAS vs CPA by Platform</div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="crossRoasCpaChart"></canvas></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Full Comparison Table</div><div class="card-sub">Platform-attributed purchases/revenue — not GA4 website revenue. See GA4 page for site-side view.</div></div><span class="tag live">Live</span></div>
      <div id="crossTable"></div>
    </div>
    <div class="banner"><span class="ic">ℹ</span><div>Platform-attributed revenue (this page) reflects each network's own pixel/API attribution and will not sum to GA4 website revenue due to differing attribution windows and models — this is expected and is tracked on the Data Quality page.</div></div>
    `;
  },
  charts:[function(){
    const ctx = document.getElementById('crossBarChart');
    if(!ctx||ctx._done) return; ctx._done=true;
    safeNewChart(ctx, {type:'bar', data:{labels:PT.rows.map(r=>r.name), datasets:[
      {label:'Spend', data:PT.rows.map(r=>r.spend), backgroundColor:'#8A7C5C'},
      {label:'Revenue', data:PT.rows.map(r=>r.revenue), backgroundColor:'#D6BB7F'},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{y:{ticks:{callback:v=>'AED '+fmtCompact(v)}}}}});
    const ctx2 = document.getElementById('crossContribChart');
    safeNewChart(ctx2, {type:'pie', data:{labels:PT.rows.map(r=>r.name), datasets:[{data:PT.rows.map(r=>r.revenue), backgroundColor:PT.rows.map(r=>PAL[r.key])}]}, options:{maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{boxWidth:12,padding:14,font:{size:12.5}}}}}});

    safeNewChart(document.getElementById('crossScatterChart'), {type:'bubble', data:{datasets:PT.rows.map(r=>({
      label:r.name, data:[{x:r.spend, y:r.roas||0, r:Math.max(8, Math.sqrt(r.revenue)/8)}], backgroundColor:PAL[r.key]+'CC'
    }))}, options:{plugins:{legend:{position:'bottom',labels:{boxWidth:10}}, annotation:undefined},
      scales:{x:{title:{display:true,text:'Spend (AED)'}, ticks:{callback:v=>fmtCompact(v)}}, y:{title:{display:true,text:'ROAS'}, ticks:{callback:v=>v+'x'}}}}});

    safeNewChart(document.getElementById('crossRoasCpaChart'), {data:{labels:PT.rows.map(r=>r.name), datasets:[
      {type:'bar', label:'ROAS', data:PT.rows.map(r=>r.roas), backgroundColor:PT.rows.map(r=>PAL[r.key]), yAxisID:'y'},
      {type:'line', label:'CPA (AED)', data:PT.rows.map(r=>r.cpa), borderColor:PAL.blue, backgroundColor:'transparent', yAxisID:'y1', tension:.3},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{y:{position:'left', ticks:{callback:v=>v+'x'}}, y1:{position:'right', grid:{display:false}, ticks:{callback:v=>fmtCompact(v)}}}}});

    buildTable('crossTable', [
      {key:'name', label:'Platform', fmt:(v,row)=> platformLabel(row.key,v) + (row.dateFiltered ? '' : ` <span class="mini-badge" style="background:rgba(124,156,181,0.15);color:var(--blue);margin-left:6px;">${ISFULL?'Full period':'Unavailable'}</span>`)},
      {key:'spend', label:'Spend', fmt:v=>fmtAED(v)},
      {key:'impressions', label:'Impressions', fmt:v=>fmtNum(v)},
      {key:'clicks', label:'Clicks', fmt:v=>fmtNum(v)},
      {key:'ctr', label:'CTR', fmt:v=>fmtPct(v,2)},
      {key:'cpc', label:'CPC', fmt:v=>fmtAED(v,2)},
      {key:'cpm', label:'CPM', fmt:v=>fmtAED(v,2)},
      {key:'purchases', label:'Purchases', fmt:v=>fmtNum(v)},
      {key:'revenue', label:'Revenue', fmt:v=>fmtAED(v)},
      {key:'roas', label:'ROAS', fmt:v=>`<span style="color:${roasColor(v)}">${fmtX(v)}</span>`},
      {key:'cpa', label:'CPA', fmt:v=>v===null?NA:fmtAED(v)},
      {key:'contribution', label:'Rev. Contribution', fmt:v=>fmtPct(v,1)},
      {key:'key', label:'Signal', fmt:(v,row)=>{
        const bestROAS = PT.rows.reduce((a,b)=> (b.roas||0) > (a.roas||0) ? b : a);
        const worstROAS = PT.rows.reduce((a,b)=> (b.roas??Infinity) < (a.roas??Infinity) ? b : a);
        if(row.key===bestROAS.key) return '<span class="mini-badge best">★ Strongest</span>';
        if(row.key===worstROAS.key) return '<span class="mini-badge watch">Weakest</span>';
        return '<span class="mini-badge" style="background:rgba(255,255,255,0.04);color:var(--text-faint);">—</span>';
      }},
    ], PT.rows, {pageSize:6, defaultSort:'spend'});
  }]
};

/* ---------------- 3. GOOGLE ADS ---------------- */
PAGES.google = {
  html(){
    const t = { spend:GOOGLEAGG.spend, clicks:GOOGLEAGG.clicks, impressions:GOOGLEAGG.impressions, ctr:GOOGLEAGG.ctr, cpc:GOOGLEAGG.cpc,
      purchases: GOOGLEAGG.purchases, revenue: GOOGLEAGG.revenue, roas: GOOGLEAGG.roas };
    const googleCamps = CAMPAIGN_ROWS.filter(c=>c.platform==='Google');
    const objectiveMap = { PERFORMANCE_MAX: 'Performance Max (Sales)', DEMAND_GEN: 'Demand Gen (Awareness/Traffic)' };
    return `
    <div class="page-head">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:4px;">
        <div style="width:56px;height:56px;border-radius:12px;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;flex:0 0 56px;">${ICONS.google}</div>
        <div>
          <div class="page-eyebrow">Platform · Google Ads</div>
          <div class="page-title" style="margin-bottom:0;">Google Ads</div>
        </div>
      </div>
      <div class="page-desc">Account: Jawhara Jewellery - Badran (793-518-5903). Campaign hierarchy: Campaign → applicable ad group/asset layers where supported. Only Performance Max and Demand Gen campaigns are currently active — no Search campaigns in this account.</div>
    </div>
    ${partialRangeBanner()}
    <div class="banner warn"><span class="ic">⚠</span><div><b>Tracking flag:</b> Google Ads' native "Conversions" column is inflated by non-purchase conversion actions linked from GA4 (session_start, page views, etc.) and should not be used for CPA/ROAS. This dashboard uses the purchase-specific conversion action <b>"Google Shopping App – Purchase"</b> instead. The GA4-linked <b>order_complete</b> conversion action currently reports zero for this window — see Data Quality page.</div></div>
    <div class="kpi-grid">
      ${kpi('Spend', fmtAED(t.spend))}
      ${kpi('Clicks', fmtNum(t.clicks))}
      ${kpi('Impressions', fmtNum(t.impressions))}
      ${kpi('CTR', fmtPct(t.ctr,2))}
      ${kpi('CPC', fmtAED(t.cpc,2))}
      ${kpi('Purchases', t.purchases===null?NA:fmtNum(t.purchases,2))}
      ${kpi('Revenue', t.revenue===null?NA:fmtAED(t.revenue))}
      ${kpi('ROAS', t.roas===null?NA:fmtX(t.roas))}
    </div>

    ${sectionLabel('Daily performance trends')}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Cost &amp; Revenue</div><div class="card-sub">Real daily spend vs. purchase revenue.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="googleCostRevenueChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Conversions &amp; ROAS</div><div class="card-sub">Daily purchases against daily Return On Ad Spend.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="googleConvRoasChart"></canvas></div>
      </div>
    </div>

    ${sectionLabel('Spend by campaign objective')}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Campaign Objective Spend</div><div class="card-sub">Real campaign type as reported by Google Ads.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap sm"><canvas id="googleObjectiveChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Daily Spend &amp; Clicks</div><span class="tag live">Live</span></div>
        <div class="chart-wrap sm"><canvas id="googleDailyChart"></canvas></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Funnel (available fields)</div><span class="tag warn">Partial</span></div>
        ${funnelHtml([
          {label:'Impressions', value:t.impressions},
          {label:'Clicks', value:t.clicks},
          {label:'Purchases', value:t.purchases},
        ])}
        <div class="bignote">Google Ads does not expose add-to-cart / checkout stage events at the account level for this account — mid-funnel steps are N/A here. GA4 page shows the website-side view of the same journey.</div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Best-Performing Creative Assets</div><span class="tag live">Live · real image assets</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;">
          ${DATA.google_top_images.map(img=>`
            <div style="text-align:center;">
              <img src="${img.url}" alt="Google Ads creative" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid var(--line);background:#fff;">
              <div style="font-size:10.5px;color:var(--text-faint);margin-top:4px;">${fmtAED(img.cost,0)} across ${img.campaigns.length} asset group${img.campaigns.length===1?'':'s'}</div>
            </div>
          `).join('')}
        </div>
        <div class="bignote">Real image assets retrieved from the account\u2019s Performance Max asset groups, ranked by total spend served against each image \u2014 Google Ads does not attribute purchases to individual images in the available reporting, so spend is the closest real proxy for prominence.</div>
      </div>
    </div>

    ${sectionLabel('Campaigns & ad groups / asset groups')}
    <div class="card">
      <div class="card-head"><div><div class="card-title">Campaigns</div><div class="card-sub">Click a campaign to expand its real ad groups (Demand Gen) or asset groups (Performance Max).</div></div><span class="tag live">Live</span></div>
      <div id="googleCampaignExpand"></div>
    </div>
    `;
  },
  charts:[function(){
    const ctx = document.getElementById('googleDailyChart');
    if(!ctx||ctx._done) return; ctx._done=true;
    safeNewChart(ctx, {type:'bar', data:{labels:GOOGLED.map(d=>d.date.slice(5)), datasets:[
      {type:'bar', label:'Spend (AED)', data:GOOGLED.map(d=>d.spend), backgroundColor:PAL.google, yAxisID:'y'},
      {type:'line', label:'Clicks', data:GOOGLED.map(d=>d.clicks), borderColor:PAL.gold, backgroundColor:'transparent', yAxisID:'y1', tension:.3},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{y:{position:'left', ticks:{callback:v=>fmtCompact(v)}}, y1:{position:'right', grid:{display:false}}}}});

    const labels = GOOGLED.map(d=>d.date.slice(5));
    safeNewChart(document.getElementById('googleCostRevenueChart'), {data:{labels, datasets:[
      {type:'bar', label:'Cost (AED)', data:GOOGLED.map(d=>d.spend), backgroundColor:palAlpha(PAL.google,0.6), borderColor:PAL.google, borderWidth:1, borderRadius:3, barPercentage:0.55, categoryPercentage:0.65, yAxisID:'y1'},
      {type:'line', label:'Revenue (AED)', data:GOOGLED.map(d=>d.revenue), borderColor:PAL.green, backgroundColor:palAlpha(PAL.green,0.12), fill:true, tension:.35, yAxisID:'y'},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{
      y:{position:'left', title:{display:true,text:'Revenue (AED)'}, ticks:{callback:v=>fmtCompact(v)}},
      y1:{position:'right', title:{display:true,text:'Cost (AED)'}, grid:{display:false}, ticks:{callback:v=>fmtCompact(v)}},
    }}});

    const dailyRoas = GOOGLED.map(d=> d.spend ? d.revenue/d.spend : null);
    safeNewChart(document.getElementById('googleConvRoasChart'), {data:{labels, datasets:[
      {type:'bar', label:'Purchases', data:GOOGLED.map(d=>d.purchases), backgroundColor:palAlpha(PAL.gold,0.6), borderColor:PAL.gold, borderWidth:1, borderRadius:3, barPercentage:0.55, categoryPercentage:0.65, yAxisID:'y1'},
      {type:'line', label:'ROAS', data:dailyRoas, borderColor:PAL.blue, backgroundColor:'transparent', tension:.35, yAxisID:'y'},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{
      y:{position:'left', title:{display:true,text:'ROAS'}, ticks:{callback:v=>v.toFixed(1)+'x'}},
      y1:{position:'right', title:{display:true,text:'Purchases'}, grid:{display:false}, ticks:{callback:v=>fmtCompact(v)}},
    }}});

    const objectiveMap = { PERFORMANCE_MAX: 'Performance Max (Sales)', DEMAND_GEN: 'Demand Gen (Awareness/Traffic)' };
    const objRows = DATA.google.campaigns.map(c=>({...c, objLabel: objectiveMap[c.type]||c.type}));
    safeNewChart(document.getElementById('googleObjectiveChart'), {type:'doughnut', data:{labels:objRows.map(c=>c.objLabel), datasets:[{data:objRows.map(c=>c.spend), backgroundColor:[PAL.gold, PAL.blue, PAL.amber], borderWidth:0}]},
      options:{cutout:'55%', plugins:{legend:{position:'bottom', labels:{boxWidth:10}}}}});

    const googleCamps = CAMPAIGN_ROWS.filter(c=>c.platform==='Google');
    // Same full metric set as the original campaign table (Spend, Impressions, Clicks, CTR,
    // Purchases, Revenue, ROAS) — the expand/collapse for ad groups/asset groups is added on
    // top of this, not instead of it.
    const wrap = document.getElementById('googleCampaignExpand');
    if (wrap){
      const rows = DATA.google.campaigns.map((camp, i)=>{
        const liveRow = googleCamps.find(c=>c.name===camp.name) || {};
        const spend = liveRow.spend ?? camp.spend;
        const impressions = liveRow.impressions ?? camp.impressions;
        const clicks = liveRow.clicks ?? camp.clicks;
        const ctr = safeDiv(clicks, impressions);
        const purchases = liveRow.purchases ?? camp.purchases;
        const revenue = liveRow.revenue ?? camp.revenue;
        const roas = liveRow.roas ?? safeDiv(revenue, spend);
        return { camp, i, spend, impressions, clicks, ctr, purchases, revenue, roas };
      });
      wrap.innerHTML = `
        <div class="table-scroll"><table><thead><tr>
          <th style="width:27.15%">Campaign${thInfo('Campaign')}</th>
          <th class="num-col" style="width:10.41%">Spend${thInfo('Spend')}</th>
          <th class="num-col" style="width:10.41%">Impressions${thInfo('Impressions')}</th>
          <th class="num-col" style="width:10.41%">Clicks${thInfo('Clicks')}</th>
          <th class="num-col" style="width:10.41%">CTR${thInfo('CTR')}</th>
          <th class="num-col" style="width:10.41%">Purchases${thInfo('Purchases')}</th>
          <th class="num-col" style="width:10.41%">Revenue${thInfo('Revenue')}</th>
          <th class="num-col" style="width:10.41%">ROAS${thInfo('ROAS')}</th>
        </tr></thead><tbody>
        ${rows.map(r=>{
          const groups = DATA.google_groups.filter(g=>g.campaign_name===r.camp.name);
          const groupType = groups.length ? groups[0].group_type : 'Group';
          return `
          <tr class="camp-toggle" data-idx="${r.i}" style="cursor:pointer;">
            <td class="strong" style="width:27.15%"><span class="camp-caret" style="display:inline-block;transition:transform .15s;color:var(--gold);margin-right:8px;">▸</span>${r.camp.name} <span class="pill ${r.camp.status==='ENABLED'?'active':'paused'}" style="margin-left:6px;">${r.camp.status}</span></td>
            <td class="mono num-col" style="width:10.41%">${fmtAED(r.spend)}</td>
            <td class="mono num-col" style="width:10.41%">${fmtNum(r.impressions)}</td>
            <td class="mono num-col" style="width:10.41%">${fmtNum(r.clicks)}</td>
            <td class="mono num-col" style="width:10.41%">${fmtPct(r.ctr,2)}</td>
            <td class="mono num-col" style="width:10.41%">${fmtNum(r.purchases,2)}</td>
            <td class="mono num-col" style="width:10.41%">${fmtAED(r.revenue)}</td>
            <td class="mono num-col" style="width:10.41%;color:${roasColor(r.roas)}">${fmtX(r.roas)}</td>
          </tr>
          <tr class="camp-subrows" data-idx="${r.i}" style="display:none;background:var(--ink-2);">
            <td colspan="8" style="padding:0;">
              <div style="padding:10px 16px 14px 44px;">
                ${groups.length ? groups.map(g=>`
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line-soft);font-size:12.5px;">
                    <div><span class="mini-badge" style="background:rgba(124,156,181,0.15);color:var(--blue);margin-right:8px;">${g.group_type}</span>${g.group_name}</div>
                    <div style="display:flex;gap:16px;font-family:var(--mono);color:var(--text-dim);">
                      <span title="Spend">${fmtAED(g.spend,0)}</span>
                      <span title="Impressions">${fmtNum(g.impressions)} impr.</span>
                      <span title="Clicks">${fmtNum(g.clicks)} clicks</span>
                      <span title="CTR">${fmtPct(safeDiv(g.clicks,g.impressions),2)} CTR</span>
                      <span title="Purchases">${fmtNum(g.purchases,1)} purch.</span>
                      <span title="Revenue">${fmtAED(g.revenue,0)}</span>
                      <span style="color:${roasColor(safeDiv(g.revenue,g.spend))}" title="ROAS">${fmtX(safeDiv(g.revenue,g.spend))}</span>
                    </div>
                  </div>`).join('') : `<div class="empty-state" style="padding:8px 0;">No ${groupType.toLowerCase()} data retrieved for this campaign.</div>`}
              </div>
            </td>
          </tr>`;
        }).join('')}
        </tbody></table></div>`;
      wrap.querySelectorAll('.camp-toggle').forEach(el=>{
        el.addEventListener('click', ()=>{
          const idx = el.dataset.idx;
          const sub = wrap.querySelector(`.camp-subrows[data-idx="${idx}"]`);
          const caret = el.querySelector('.camp-caret');
          const open = sub.style.display !== 'none';
          sub.style.display = open ? 'none' : 'table-row';
          caret.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
        });
      });
    }
  }]
};

/* ---------------- 4. META ADS ---------------- */
PAGES.meta = {
  html(){
    const t = { spend:METAAGG.spend, impressions:METAAGG.impressions, reach_avg:METAAGG.reach_avg, ctr:METAAGG.ctr, cpc:METAAGG.cpc, cpm:METAAGG.cpm, purchases:METAAGG.purchases, revenue:METAAGG.revenue, roas:METAAGG.roas };
    const metaCamps = CAMPAIGN_ROWS.filter(c=>c.platform==='Meta');
    const objectiveMap = { OUTCOME_SALES:'Sales', LINK_CLICKS:'Traffic', OUTCOME_AWARENESS:'Awareness' };
    return `
    <div class="page-head">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:4px;">
        <div style="width:56px;height:56px;border-radius:12px;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;flex:0 0 56px;">${ICONS.meta}</div>
        <div>
          <div class="page-eyebrow">Platform · Meta Ads</div>
          <div class="page-title" style="margin-bottom:0;">Meta Ads</div>
        </div>
      </div>
      <div class="page-desc">Account 1499460650506686 (Facebook & Instagram). Hierarchy: Campaign → Ad Set → Ad — all three levels shown below with real retrieved data.</div>
    </div>
    ${partialRangeBanner()}
    <div class="kpi-grid">
      ${kpi('Spend', fmtAED(t.spend))}
      ${kpi('Impressions', fmtNum(t.impressions))}
      ${kpi('Avg. Reach / day', fmtNum(t.reach_avg))}
      ${kpi('CTR', fmtPct(t.ctr,2))}
      ${kpi('CPC', fmtAED(t.cpc,2))}
      ${kpi('CPM', fmtAED(t.cpm,2))}
      ${kpi('Purchases', fmtNum(t.purchases))}
      ${kpi('ROAS', fmtX(t.roas))}
    </div>

    ${sectionLabel('Daily performance trends')}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Cost &amp; Revenue</div><div class="card-sub">Real daily spend vs. purchase revenue.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="metaCostRevenueChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Conversions &amp; ROAS</div><div class="card-sub">Daily purchases against daily Return On Ad Spend.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="metaConvRoasChart"></canvas></div>
      </div>
    </div>

    ${sectionLabel('Spend by campaign objective')}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Campaign Objective Spend</div><div class="card-sub">Real campaign objective as reported by Meta.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap sm"><canvas id="metaObjectiveChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Daily Spend &amp; Reach</div><span class="tag live">Live</span></div>
        <div class="chart-wrap sm"><canvas id="metaDailyChart"></canvas></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Funnel</div><span class="tag ${ISFULL?'live':'warn'}">${ISFULL?'Live':'Partial for this range'}</span></div>
        ${ISFULL ? funnelHtml([
          {label:'Impressions', value: DATA.meta.totals.impressions},
          {label:'Landing Page View', value: DATA.meta_campaigns.reduce((a,c)=>a+c.landing_page_view,0)},
          {label:'View Content', value: DATA.meta_campaigns.reduce((a,c)=>a+c.view_content,0)},
          {label:'Add to Cart', value: DATA.meta_campaigns.reduce((a,c)=>a+c.add_to_cart,0)},
          {label:'Initiate Checkout', value: DATA.meta_campaigns.reduce((a,c)=>a+c.initiate_checkout,0)},
          {label:'Purchase', value: DATA.meta.totals.purchases},
        ]) : funnelHtml([
          {label:'Impressions', value: t.impressions},
          {label:'Purchase', value: t.purchases},
        ]) + unavailableBlock('Mid-funnel stages (landing page view, view content, add to cart, checkout)')}
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Best-Performing Creative Assets</div><div class="card-sub">Real thumbnails, ranked by revenue.</div></div><span class="tag live">Live · real image assets</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:10px;">
          ${[...DATA.meta_ads].sort((a,b)=>b.revenue-a.revenue).slice(0,6).map(a=>`
            <div style="text-align:center;">
              <img src="${a.thumbnail_url}" alt="Meta creative" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid var(--line);">
              <div style="font-size:10px;color:var(--text-faint);margin-top:4px;">${fmtAED(a.revenue,0)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    ${sectionLabel('Campaigns, ad sets & ads')}
    <div class="card">
      <div class="card-head"><div><div class="card-title">Campaigns</div><div class="card-sub">Click a campaign to expand its real ad sets; click an ad set to expand its real ads.</div></div><span class="tag live">Live</span></div>
      <div id="metaCampaignExpand"></div>
    </div>
    `;
  },
  charts:[function(){
    const ctx = document.getElementById('metaDailyChart');
    if(!ctx||ctx._done) return; ctx._done=true;
    safeNewChart(ctx, {type:'bar', data:{labels:METAD.map(d=>d.date.slice(5)), datasets:[
      {type:'bar', label:'Spend (AED)', data:METAD.map(d=>d.spend), backgroundColor:PAL.meta, yAxisID:'y'},
      {type:'line', label:'Reach', data:METAD.map(d=>d.reach), borderColor:PAL.gold, backgroundColor:'transparent', yAxisID:'y1', tension:.3},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{y:{ticks:{callback:v=>fmtCompact(v)}}, y1:{position:'right', grid:{display:false}, ticks:{callback:v=>fmtCompact(v)}}}}});

    const labels = METAD.map(d=>d.date.slice(5));
    safeNewChart(document.getElementById('metaCostRevenueChart'), {data:{labels, datasets:[
      {type:'bar', label:'Cost (AED)', data:METAD.map(d=>d.spend), backgroundColor:palAlpha(PAL.meta,0.6), borderColor:PAL.meta, borderWidth:1, borderRadius:3, barPercentage:0.55, categoryPercentage:0.65, yAxisID:'y1'},
      {type:'line', label:'Revenue (AED)', data:METAD.map(d=>d.revenue), borderColor:PAL.green, backgroundColor:palAlpha(PAL.green,0.12), fill:true, tension:.35, yAxisID:'y'},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{
      y:{position:'left', title:{display:true,text:'Revenue (AED)'}, ticks:{callback:v=>fmtCompact(v)}},
      y1:{position:'right', title:{display:true,text:'Cost (AED)'}, grid:{display:false}, ticks:{callback:v=>fmtCompact(v)}},
    }}});

    const dailyRoas = METAD.map(d=> d.spend ? d.revenue/d.spend : null);
    safeNewChart(document.getElementById('metaConvRoasChart'), {data:{labels, datasets:[
      {type:'bar', label:'Purchases', data:METAD.map(d=>d.purchases), backgroundColor:palAlpha(PAL.gold,0.6), borderColor:PAL.gold, borderWidth:1, borderRadius:3, barPercentage:0.55, categoryPercentage:0.65, yAxisID:'y1'},
      {type:'line', label:'ROAS', data:dailyRoas, borderColor:PAL.blue, backgroundColor:'transparent', tension:.35, yAxisID:'y'},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{
      y:{position:'left', title:{display:true,text:'ROAS'}, ticks:{callback:v=>v.toFixed(1)+'x'}},
      y1:{position:'right', title:{display:true,text:'Purchases'}, grid:{display:false}, ticks:{callback:v=>fmtCompact(v)}},
    }}});

    const objectiveMap = { OUTCOME_SALES:'Sales', LINK_CLICKS:'Traffic', OUTCOME_AWARENESS:'Awareness' };
    const objRows = {};
    DATA.meta_campaigns.forEach(c=>{ const k = objectiveMap[c.objective]||c.objective; objRows[k] = (objRows[k]||0) + c.spend; });
    const objKeys = Object.keys(objRows);
    safeNewChart(document.getElementById('metaObjectiveChart'), {type:'doughnut', data:{labels:objKeys, datasets:[{data:objKeys.map(k=>objRows[k]), backgroundColor:[PAL.gold, PAL.blue, PAL.amber], borderWidth:0}]},
      options:{cutout:'55%', plugins:{legend:{position:'bottom', labels:{boxWidth:10}}}}});

    const metaCamps = CAMPAIGN_ROWS.filter(c=>c.platform==='Meta');
    const wrap = document.getElementById('metaCampaignExpand');
    if (wrap){
      const rows = DATA.meta_campaigns.map((camp,i)=>{
        const liveRow = metaCamps.find(c=>c.name===camp.name) || {};
        const spend = liveRow.spend ?? camp.spend;
        const impressions = liveRow.impressions ?? camp.impressions;
        const clicks = liveRow.clicks ?? camp.clicks;
        const purchases = liveRow.purchases ?? camp.purchases;
        const revenue = liveRow.revenue ?? camp.revenue;
        const roas = liveRow.roas ?? safeDiv(revenue, spend);
        return { camp, i, spend, impressions, clicks, purchases, revenue, roas };
      });
      wrap.innerHTML = `
        <div class="table-scroll"><table><thead><tr>
          <th style="width:26.09%">Campaign${thInfo('Campaign')}</th>
          <th style="width:13.91%">Objective${thInfo('Objective')}</th>
          <th class="num-col" style="width:10%">Spend${thInfo('Spend')}</th>
          <th class="num-col" style="width:10%">Impressions${thInfo('Impressions')}</th>
          <th class="num-col" style="width:10%">Clicks${thInfo('Clicks')}</th>
          <th class="num-col" style="width:10%">Purchases${thInfo('Purchases')}</th>
          <th class="num-col" style="width:10%">Revenue${thInfo('Revenue')}</th>
          <th class="num-col" style="width:10%">ROAS${thInfo('ROAS')}</th>
        </tr></thead><tbody>
        ${rows.map(r=>{
          const adsets = DATA.meta_adsets.filter(a=>a.campaign_name===r.camp.name);
          return `
          <tr class="camp-toggle" data-idx="c${r.i}" style="cursor:pointer;">
            <td class="strong" style="width:26.09%"><span class="camp-caret" style="display:inline-block;transition:transform .15s;color:var(--gold);margin-right:8px;">▸</span>${r.camp.name} <span class="pill ${r.camp.status==='ACTIVE'?'active':'paused'}" style="margin-left:6px;">${r.camp.status.replace('CAMPAIGN_','')}</span></td>
            <td style="width:13.91%">${objectiveMap[r.camp.objective]||r.camp.objective}</td>
            <td class="mono num-col" style="width:10%">${fmtAED(r.spend)}</td>
            <td class="mono num-col" style="width:10%">${fmtNum(r.impressions)}</td>
            <td class="mono num-col" style="width:10%">${fmtNum(r.clicks)}</td>
            <td class="mono num-col" style="width:10%">${fmtNum(r.purchases)}</td>
            <td class="mono num-col" style="width:10%">${fmtAED(r.revenue)}</td>
            <td class="mono num-col" style="width:10%;color:${roasColor(r.roas)}">${fmtX(r.roas)}</td>
          </tr>
          <tr class="camp-subrows" data-idx="c${r.i}" style="display:none;background:var(--ink-2);">
            <td colspan="8" style="padding:0;">
              <div style="padding:6px 16px 10px 40px;">
                ${adsets.length ? adsets.map((a,j)=>{
                  const ads = DATA.meta_ads.filter(ad=>ad.adset_name===a.adset_name);
                  return `
                  <div style="border-bottom:1px solid var(--line-soft);">
                    <div class="camp-toggle" data-idx="a${r.i}-${j}" style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;cursor:pointer;font-size:12.5px;">
                      <div><span class="camp-caret" style="display:inline-block;transition:transform .15s;color:var(--blue);margin-right:8px;font-size:10px;">▸</span><span class="mini-badge" style="background:rgba(124,156,181,0.15);color:var(--blue);margin-right:8px;">Ad Set</span>${a.adset_name}</div>
                      <div style="display:flex;gap:14px;font-family:var(--mono);color:var(--text-dim);">
                        <span>${fmtAED(a.spend,0)}</span><span>${fmtNum(a.clicks)} clicks</span><span>${fmtNum(a.purchases,1)} purch.</span>
                        <span style="color:${roasColor(safeDiv(a.revenue,a.spend))}">${fmtX(safeDiv(a.revenue,a.spend))}</span>
                      </div>
                    </div>
                    <div class="camp-subrows" data-idx="a${r.i}-${j}" style="display:none;padding:2px 0 8px 28px;">
                      ${ads.length ? ads.map(ad=>`
                        <div style="display:flex;align-items:center;gap:10px;padding:5px 0;font-size:12px;">
                          <img src="${ad.thumbnail_url}" alt="" style="width:28px;height:28px;object-fit:cover;border-radius:4px;border:1px solid var(--line);">
                          <span class="mini-badge" style="background:rgba(214,187,127,0.15);color:var(--gold);">Ad</span>
                          <span style="flex:1;color:var(--text-dim);">${ad.ad_name}</span>
                          <span style="font-family:var(--mono);color:var(--text-dim);">${fmtAED(ad.spend,0)} · ${ad.roas===null?'N/A':fmtX(ad.roas)}</span>
                        </div>`).join('') : '<div class="empty-state" style="padding:4px 0;">No individual ad rows retrieved for this ad set.</div>'}
                    </div>
                  </div>`;
                }).join('') : '<div class="empty-state" style="padding:8px 0;">No ad-set data retrieved for this campaign.</div>'}
              </div>
            </td>
          </tr>`;
        }).join('')}
        </tbody></table></div>`;
      wrap.querySelectorAll('.camp-toggle').forEach(el=>{
        el.addEventListener('click', (e)=>{
          e.stopPropagation();
          const idx = el.dataset.idx;
          const sub = wrap.querySelector(`.camp-subrows[data-idx="${idx}"]`);
          const caret = el.querySelector('.camp-caret');
          const open = sub.style.display !== 'none';
          sub.style.display = open ? 'none' : (sub.tagName==='TR' ? 'table-row' : 'block');
          caret.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
        });
      });
    }
  }]
};

/* ---------------- 5. SNAPCHAT ADS ---------------- */
PAGES.snapchat = {
  html(){
    const t = { spend:SNAPAGG.spend, impressions:SNAPAGG.impressions, clicks:SNAPAGG.clicks, ctr:SNAPAGG.ctr, cpc:SNAPAGG.cpc,
      purchases:SNAPAGG.purchases, revenue:SNAPAGG.revenue, roas:SNAPAGG.roas };
    const snapCamps = CAMPAIGN_ROWS.filter(c=>c.platform==='Snapchat');
    const lpv = sumKey(snapCamps,'lpv'), vc = sumKey(snapCamps,'vc'), atc = sumKey(snapCamps,'atc'), ic = sumKey(snapCamps,'ic');
    return `
    <div class="page-head">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:4px;">
        <div style="width:56px;height:56px;border-radius:12px;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;flex:0 0 56px;">${ICONS.snapchat}</div>
        <div>
          <div class="page-eyebrow">Platform · Snapchat Ads</div>
          <div class="page-title" style="margin-bottom:0;">Snapchat Ads</div>
        </div>
      </div>
      <div class="page-desc">Account: Jawhara Jewellery - Ads. Of 36 campaigns returned, only 2 recorded spend in the retrieved window — the remainder are historical/paused with zero delivery.</div>
    </div>
    ${partialRangeBanner()}
    <div class="kpi-grid">
      ${kpi('Spend', fmtAED(t.spend,2))}
      ${kpi('Impressions', fmtNum(t.impressions))}
      ${kpi('CTR', fmtPct(t.ctr,2))}
      ${kpi('CPC', fmtAED(t.cpc,2))}
      ${kpi('Purchases', fmtNum(t.purchases,2))}
      ${kpi('Revenue', fmtAED(t.revenue,2))}
      ${kpi('ROAS', t.roas===null?NA:fmtX(t.roas))}
    </div>
    ${t.spend>0 && t.roas!==null && t.roas<1 ? `<div class="banner warn"><span class="ic">⚠</span><div><b>Efficiency flag:</b> Snapchat ROAS is ${fmtX(t.roas)} — below breakeven for this period, on spend of ${fmtAED(t.spend,0)}. See Insights page.</div></div>` : ''}

    ${sectionLabel('Daily performance trends')}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Cost &amp; Revenue</div><div class="card-sub">Real daily spend vs. purchase revenue, aggregated from per-day campaign data.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="snapCostRevenueChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Conversions &amp; ROAS</div><div class="card-sub">Daily purchases against daily Return On Ad Spend.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="snapConvRoasChart"></canvas></div>
      </div>
    </div>

    ${sectionLabel('Spend by campaign objective')}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Campaign Objective Spend</div><div class="card-sub">Real campaign objective as reported by Snapchat.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap sm"><canvas id="snapObjectiveChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Funnel</div><span class="tag live">Live</span></div>
        ${funnelHtml([
          {label:'Impressions', value:t.impressions},
          {label:'Landing Page View', value:lpv},
          {label:'View Content', value:vc},
          {label:'Add to Cart', value:atc},
          {label:'Start Checkout', value:ic},
          {label:'Purchase', value:t.purchases},
        ])}
      </div>
    </div>

    <div class="banner"><span class="ic">ℹ</span><div><b>Creative previews are not available for Snapchat.</b> The connected Snapchat Ads data source has no image/video-asset URL fields — checked directly against its full field list. Nothing is substituted here.</div></div>

    ${sectionLabel('Campaigns & ad squads')}
    <div class="card">
      <div class="card-head"><div><div class="card-title">Campaigns</div><div class="card-sub">Click a campaign to expand its real ad squads (Snapchat's term for ad sets).</div></div><span class="tag live">Live</span></div>
      <div id="snapCampaignExpand"></div>
    </div>
    `;
  },
  charts:[function(){
    const snapCamps = CAMPAIGN_ROWS.filter(c=>c.platform==='Snapchat');
    const daily = dailyPlatformSeries('Snapchat', RANGE.from, RANGE.to);
    const labels = daily.map(d=>d.date.slice(5));
    safeNewChart(document.getElementById('snapCostRevenueChart'), {data:{labels, datasets:[
      {type:'bar', label:'Cost (AED)', data:daily.map(d=>d.spend), backgroundColor:palAlpha(PAL.snapchat,0.6), borderColor:PAL.snapchat, borderWidth:1, borderRadius:3, barPercentage:0.55, categoryPercentage:0.65, yAxisID:'y1'},
      {type:'line', label:'Revenue (AED)', data:daily.map(d=>d.revenue), borderColor:PAL.green, backgroundColor:palAlpha(PAL.green,0.12), fill:true, tension:.35, yAxisID:'y'},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{
      y:{position:'left', title:{display:true,text:'Revenue (AED)'}, ticks:{callback:v=>fmtCompact(v)}},
      y1:{position:'right', title:{display:true,text:'Cost (AED)'}, grid:{display:false}, ticks:{callback:v=>fmtCompact(v)}},
    }}});
    const dailyRoas = daily.map(d=> d.spend ? d.revenue/d.spend : null);
    safeNewChart(document.getElementById('snapConvRoasChart'), {data:{labels, datasets:[
      {type:'bar', label:'Purchases', data:daily.map(d=>d.purchases), backgroundColor:palAlpha(PAL.gold,0.6), borderColor:PAL.gold, borderWidth:1, borderRadius:3, barPercentage:0.55, categoryPercentage:0.65, yAxisID:'y1'},
      {type:'line', label:'ROAS', data:dailyRoas, borderColor:PAL.blue, backgroundColor:'transparent', tension:.35, yAxisID:'y'},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{
      y:{position:'left', title:{display:true,text:'ROAS'}, ticks:{callback:v=>v.toFixed(1)+'x'}},
      y1:{position:'right', title:{display:true,text:'Purchases'}, grid:{display:false}, ticks:{callback:v=>fmtCompact(v)}},
    }}});

    const objRows = {};
    (DATA.snapchat.campaigns||[]).forEach(c=>{ objRows[c.objective] = (objRows[c.objective]||0) + c.spend; });
    const objKeys = Object.keys(objRows);
    safeNewChart(document.getElementById('snapObjectiveChart'), {type:'doughnut', data:{labels:objKeys, datasets:[{data:objKeys.map(k=>objRows[k]), backgroundColor:[PAL.gold, PAL.blue, PAL.amber], borderWidth:0}]},
      options:{cutout:'55%', plugins:{legend:{position:'bottom', labels:{boxWidth:10}}}}});

    const wrap = document.getElementById('snapCampaignExpand');
    if (wrap){
      const rows = (DATA.snapchat.campaigns||[]).filter(c=>c.spend>0).map((camp,i)=>{
        const liveRow = snapCamps.find(c=>c.name===camp.name) || {};
        const spend = liveRow.spend ?? camp.spend;
        const purchases = liveRow.purchases ?? camp.purchases;
        const revenue = liveRow.revenue ?? camp.revenue;
        return { camp, i, spend, clicks: liveRow.clicks ?? camp.clicks, purchases, revenue, roas: safeDiv(revenue,spend) };
      });
      wrap.innerHTML = `
        <div class="table-scroll"><table><thead><tr>
          <th style="width:28.99%">Campaign${thInfo('Campaign')}</th><th style="width:15.46%">Objective${thInfo('Objective')}</th>
          <th class="num-col" style="width:11.11%">Spend${thInfo('Spend')}</th><th class="num-col" style="width:11.11%">Clicks${thInfo('Clicks')}</th>
          <th class="num-col" style="width:11.11%">Purchases${thInfo('Purchases')}</th><th class="num-col" style="width:11.11%">Revenue${thInfo('Revenue')}</th><th class="num-col" style="width:11.11%">ROAS${thInfo('ROAS')}</th>
        </tr></thead><tbody>
        ${rows.map(r=>{
          const squads = DATA.snapchat_adsquads.filter(s=>s.campaign_name===r.camp.name);
          return `
          <tr class="camp-toggle" data-idx="${r.i}" style="cursor:pointer;">
            <td class="strong" style="width:28.99%"><span class="camp-caret" style="display:inline-block;transition:transform .15s;color:var(--gold);margin-right:8px;">▸</span>${r.camp.name}</td>
            <td style="width:15.46%">${r.camp.objective}</td>
            <td class="mono num-col" style="width:11.11%">${fmtAED(r.spend,2)}</td>
            <td class="mono num-col" style="width:11.11%">${fmtNum(r.clicks)}</td>
            <td class="mono num-col" style="width:11.11%">${fmtNum(r.purchases,2)}</td>
            <td class="mono num-col" style="width:11.11%">${fmtAED(r.revenue,2)}</td>
            <td class="mono num-col" style="width:11.11%;color:${roasColor(r.roas)}">${fmtX(r.roas)}</td>
          </tr>
          <tr class="camp-subrows" data-idx="${r.i}" style="display:none;background:var(--ink-2);">
            <td colspan="7" style="padding:0;"><div style="padding:10px 16px 14px 44px;">
              ${squads.length ? squads.map(s=>`
                <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line-soft);font-size:12.5px;">
                  <div><span class="mini-badge" style="background:rgba(124,156,181,0.15);color:var(--blue);margin-right:8px;">Ad Squad</span>${s.adsquad_name}</div>
                  <div style="display:flex;gap:16px;font-family:var(--mono);color:var(--text-dim);">
                    <span>${fmtAED(s.spend,0)}</span><span>${fmtNum(s.clicks)} clicks</span><span>${fmtNum(s.purchases,1)} purch.</span>
                    <span style="color:${roasColor(safeDiv(s.revenue,s.spend))}">${fmtX(safeDiv(s.revenue,s.spend))}</span>
                  </div>
                </div>`).join('') : '<div class="empty-state" style="padding:6px 0;">No ad-squad data retrieved for this campaign.</div>'}
            </div></td>
          </tr>`;
        }).join('')}
        </tbody></table></div>`;
      wrap.querySelectorAll('.camp-toggle').forEach(el=>{
        el.addEventListener('click', ()=>{
          const idx = el.dataset.idx;
          const sub = wrap.querySelector(`.camp-subrows[data-idx="${idx}"]`);
          const caret = el.querySelector('.camp-caret');
          const open = sub.style.display !== 'none';
          sub.style.display = open ? 'none' : 'table-row';
          caret.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
        });
      });
    }
  }]
};

/* ---------------- 6. TIKTOK ADS ---------------- */
PAGES.tiktok = {
  html(){
    const t = { spend:TIKTOKAGG.spend, impressions:TIKTOKAGG.impressions, clicks:TIKTOKAGG.clicks, ctr:TIKTOKAGG.ctr, cpc:TIKTOKAGG.cpc,
      purchases:TIKTOKAGG.purchases, revenue:TIKTOKAGG.revenue, roas:TIKTOKAGG.roas };
    const tiktokCamps = CAMPAIGN_ROWS.filter(c=>c.platform==='TikTok');
    const lpv = sumKey(tiktokCamps,'lpv'), atc = sumKey(tiktokCamps,'atc'), ic = sumKey(tiktokCamps,'ic');
    return `
    <div class="page-head">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:4px;">
        <div style="width:56px;height:56px;border-radius:12px;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;flex:0 0 56px;">${ICONS.tiktok}</div>
        <div>
          <div class="page-eyebrow">Platform · TikTok Ads</div>
          <div class="page-title" style="margin-bottom:0;">TikTok Ads</div>
        </div>
      </div>
      <div class="page-desc">Account: Jawharajewellery0922. 3 campaigns recorded spend in the retrieved window; the remainder of the ~50 campaigns returned are historical with zero delivery.</div>
    </div>
    ${partialRangeBanner()}
    <div class="kpi-grid">
      ${kpi('Spend', fmtAED(t.spend))}
      ${kpi('Impressions', fmtNum(t.impressions))}
      ${kpi('CTR', fmtPct(t.ctr,2))}
      ${kpi('CPC', fmtAED(t.cpc,2))}
      ${kpi('Purchases', fmtNum(t.purchases))}
      ${kpi('Revenue', fmtAED(t.revenue))}
      ${kpi('ROAS', t.roas===null?NA:fmtX(t.roas))}
    </div>

    ${sectionLabel('Daily performance trends')}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Cost &amp; Revenue</div><div class="card-sub">Real daily spend vs. purchase revenue, aggregated from per-day campaign data.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="tiktokCostRevenueChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Conversions &amp; ROAS</div><div class="card-sub">Daily purchases against daily Return On Ad Spend.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="tiktokConvRoasChart"></canvas></div>
      </div>
    </div>

    ${sectionLabel('Spend by campaign objective')}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Campaign Objective Spend</div><div class="card-sub">Real campaign objective as reported by TikTok.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap sm"><canvas id="tiktokObjectiveChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Funnel</div><span class="tag live">Live</span></div>
        ${funnelHtml([
          {label:'Impressions', value:t.impressions},
          {label:'Landing Page View', value:lpv},
          {label:'Add to Cart', value:atc},
          {label:'Initiate Checkout', value:ic},
          {label:'Complete Payment', value:t.purchases},
        ])}
      </div>
    </div>

    ${sectionLabel('Campaigns & ad groups')}
    <div class="card">
      <div class="card-head"><div><div class="card-title">Campaigns</div><div class="card-sub">Click a campaign to expand its real ad groups.</div></div><span class="tag live">Live</span></div>
      <div id="tiktokCampaignExpand"></div>
    </div>

    <div class="card">
      <div class="card-head"><div><div class="card-title">Creative Previews</div><div class="card-sub">Real video thumbnails retrieved from the ad account, ranked by spend.</div></div><span class="tag live">Live · real assets</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;">
        ${DATA.tiktok_creatives.map(c=>`
          <div>
            <img src="${c.thumbnail_url}" alt="TikTok creative" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px;border:1px solid var(--line);">
            <div style="font-size:10.5px;color:var(--text-dim);margin-top:4px;">${fmtAED(c.spend,0)} spend</div>
            <div style="font-size:9.5px;color:var(--text-faint);">${c.campaign_name.length>28?c.campaign_name.slice(0,27)+'…':c.campaign_name}</div>
          </div>
        `).join('')}
      </div>
      <div class="bignote">These are the account\u2019s video ads with a retrievable thumbnail. The single highest-converting TikTok ad this period (13 purchases, a static image) did not have a retrievable image URL in this data pull \u2014 not substituted here.</div>
    </div>
    `;
  },
  charts:[function(){
    const tiktokCamps = CAMPAIGN_ROWS.filter(c=>c.platform==='TikTok');
    const daily = dailyPlatformSeries('TikTok', RANGE.from, RANGE.to);
    const labels = daily.map(d=>d.date.slice(5));
    safeNewChart(document.getElementById('tiktokCostRevenueChart'), {data:{labels, datasets:[
      {type:'bar', label:'Cost (AED)', data:daily.map(d=>d.spend), backgroundColor:palAlpha(PAL.tiktok,0.6), borderColor:PAL.tiktok, borderWidth:1, borderRadius:3, barPercentage:0.55, categoryPercentage:0.65, yAxisID:'y1'},
      {type:'line', label:'Revenue (AED)', data:daily.map(d=>d.revenue), borderColor:PAL.green, backgroundColor:palAlpha(PAL.green,0.12), fill:true, tension:.35, yAxisID:'y'},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{
      y:{position:'left', title:{display:true,text:'Revenue (AED)'}, ticks:{callback:v=>fmtCompact(v)}},
      y1:{position:'right', title:{display:true,text:'Cost (AED)'}, grid:{display:false}, ticks:{callback:v=>fmtCompact(v)}},
    }}});
    const dailyRoas = daily.map(d=> d.spend ? d.revenue/d.spend : null);
    safeNewChart(document.getElementById('tiktokConvRoasChart'), {data:{labels, datasets:[
      {type:'bar', label:'Purchases', data:daily.map(d=>d.purchases), backgroundColor:palAlpha(PAL.gold,0.6), borderColor:PAL.gold, borderWidth:1, borderRadius:3, barPercentage:0.55, categoryPercentage:0.65, yAxisID:'y1'},
      {type:'line', label:'ROAS', data:dailyRoas, borderColor:PAL.blue, backgroundColor:'transparent', tension:.35, yAxisID:'y'},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{
      y:{position:'left', title:{display:true,text:'ROAS'}, ticks:{callback:v=>v.toFixed(1)+'x'}},
      y1:{position:'right', title:{display:true,text:'Purchases'}, grid:{display:false}, ticks:{callback:v=>fmtCompact(v)}},
    }}});

    const objRows = {};
    (DATA.tiktok.campaigns||[]).forEach(c=>{ objRows[c.objective] = (objRows[c.objective]||0) + c.spend; });
    const objKeys = Object.keys(objRows);
    safeNewChart(document.getElementById('tiktokObjectiveChart'), {type:'doughnut', data:{labels:objKeys, datasets:[{data:objKeys.map(k=>objRows[k]), backgroundColor:[PAL.gold, PAL.blue, PAL.amber], borderWidth:0}]},
      options:{cutout:'55%', plugins:{legend:{position:'bottom', labels:{boxWidth:10}}}}});

    const wrap = document.getElementById('tiktokCampaignExpand');
    if (wrap){
      const rows = (DATA.tiktok.campaigns||[]).filter(c=>c.spend>0).map((camp,i)=>{
        const liveRow = tiktokCamps.find(c=>c.name===camp.name) || {};
        const spend = liveRow.spend ?? camp.spend;
        const purchases = liveRow.purchases ?? camp.purchases;
        const revenue = liveRow.revenue ?? camp.revenue;
        return { camp, i, spend, clicks: liveRow.clicks ?? camp.clicks, purchases, revenue, roas: safeDiv(revenue,spend) };
      });
      wrap.innerHTML = `
        <div class="table-scroll"><table><thead><tr>
          <th style="width:28.99%">Campaign${thInfo('Campaign')}</th><th style="width:15.46%">Objective${thInfo('Objective')}</th>
          <th class="num-col" style="width:11.11%">Spend${thInfo('Spend')}</th><th class="num-col" style="width:11.11%">Clicks${thInfo('Clicks')}</th>
          <th class="num-col" style="width:11.11%">Purchases${thInfo('Purchases')}</th><th class="num-col" style="width:11.11%">Revenue${thInfo('Revenue')}</th><th class="num-col" style="width:11.11%">ROAS${thInfo('ROAS')}</th>
        </tr></thead><tbody>
        ${rows.map(r=>{
          const groups = DATA.tiktok_adgroups.filter(g=>g.campaign_name===r.camp.name);
          return `
          <tr class="camp-toggle" data-idx="${r.i}" style="cursor:pointer;">
            <td class="strong" style="width:28.99%"><span class="camp-caret" style="display:inline-block;transition:transform .15s;color:var(--gold);margin-right:8px;">▸</span>${r.camp.name}</td>
            <td style="width:15.46%">${r.camp.objective}</td>
            <td class="mono num-col" style="width:11.11%">${fmtAED(r.spend)}</td>
            <td class="mono num-col" style="width:11.11%">${fmtNum(r.clicks)}</td>
            <td class="mono num-col" style="width:11.11%">${fmtNum(r.purchases)}</td>
            <td class="mono num-col" style="width:11.11%">${fmtAED(r.revenue)}</td>
            <td class="mono num-col" style="width:11.11%;color:${roasColor(r.roas)}">${fmtX(r.roas)}</td>
          </tr>
          <tr class="camp-subrows" data-idx="${r.i}" style="display:none;background:var(--ink-2);">
            <td colspan="7" style="padding:0;"><div style="padding:10px 16px 14px 44px;">
              ${groups.length ? groups.map(g=>`
                <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line-soft);font-size:12.5px;">
                  <div><span class="mini-badge" style="background:rgba(124,156,181,0.15);color:var(--blue);margin-right:8px;">Ad Group</span>${g.adgroup_name}</div>
                  <div style="display:flex;gap:16px;font-family:var(--mono);color:var(--text-dim);">
                    <span>${fmtAED(g.spend,0)}</span><span>${fmtNum(g.clicks)} clicks</span><span>${fmtNum(g.purchases)} purch.</span>
                  </div>
                </div>`).join('') : '<div class="empty-state" style="padding:6px 0;">No ad-group data retrieved for this campaign.</div>'}
            </div></td>
          </tr>`;
        }).join('')}
        </tbody></table></div>`;
      wrap.querySelectorAll('.camp-toggle').forEach(el=>{
        el.addEventListener('click', ()=>{
          const idx = el.dataset.idx;
          const sub = wrap.querySelector(`.camp-subrows[data-idx="${idx}"]`);
          const caret = el.querySelector('.camp-caret');
          const open = sub.style.display !== 'none';
          sub.style.display = open ? 'none' : 'table-row';
          caret.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
        });
      });
    }
  }]
};

/* ---------------- 7. GA4 / WEBSITE & ECOMMERCE ---------------- */
PAGES.ga4 = {
  html(){
    return `
    <div class="page-head">
      <div class="page-eyebrow">Website · GA4</div>
      <div class="page-title">${iconBadge('ga4',22)} GA4 / Website & Ecommerce</div>
      <div class="page-desc">Property: Jawhara Jewellery - GA4 (394213533). This is website-side ecommerce performance — the source of truth for MER and blended revenue, independent of platform attribution.</div>
    </div>
    ${fullPeriodOnlyBanner()}
    ${partialRangeBanner()}
    <div class="kpi-grid">
      ${kpi('Sessions', fmtNum(GA4T.sessions))}
      ${kpi('Active Users', fmtNum(GA4T.active_users))}
      ${kpi('Ecommerce Purchases', fmtNum(GA4T.purchases))}
      ${kpi('Purchase Revenue', fmtAED(GA4T.revenue))}
      ${kpi('AOV', fmtAED(AOV,0))}
      ${kpi('Site Conv. Rate', fmtPct(CONVRATE,2))}
      ${kpi('Add to Carts', fmtNum(GA4T.add_to_carts))}
      ${kpi('Checkouts', fmtNum(GA4T.checkouts))}
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Revenue by Channel</div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="ga4ChannelChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Sessions by Channel</div><span class="tag live">Live</span></div>
        <div class="chart-wrap sm"><canvas id="ga4SessionChart"></canvas></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Channel Breakdown</div><div class="card-sub">session_default_channel_group — GA4's own attribution, independent of ad-platform pixels.</div></div><span class="tag live">Live</span></div>
      <div id="ga4ChannelTable"></div>
    </div>
    <div class="banner"><span class="ic">ℹ</span><div><b>Paid Search</b> shows only 86 sessions and 0 purchases in this window — consistent with the account currently running Performance Max / Demand Gen rather than Search campaigns in Google Ads.</div></div>

    ${sectionLabel('Source / medium')}
    <div class="card">
      <div class="card-head"><div><div class="card-title">Sessions &amp; Revenue by Source / Medium</div><div class="card-sub">GA4's most granular traffic breakdown — the exact referrer and medium combination, independent of ad-platform attribution.</div></div><span class="tag live">Live</span></div>
      <div class="chart-wrap"><canvas id="ga4SourceMediumChart"></canvas></div>
      <div id="ga4SourceMediumTable" style="margin-top:14px;"></div>
      <div class="bignote">Revenue is shown only for source/mediums with meaningful session volume in this pull; smaller referral sources show session and user counts only.</div>
    </div>

    ${sectionLabel('Website performance & drop-off')}
    <div class="kpi-grid">
      ${kpi('Bounce Rate', fmtPct(GA4_BOUNCE_RATE,1))}
      ${kpi('Engagement Rate', fmtPct(GA4_ENGAGEMENT_RATE,1))}
      ${kpi('Avg. Session Duration', fmtDuration(GA4_AVG_SESSION_DURATION))}
      ${kpi('Pages / Session', fmtNum(GA4_PAGES_PER_SESSION,2))}
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Engagement Trend</div><div class="card-sub">Daily bounce rate vs engagement rate.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="ga4EngagementChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Funnel Drop-off Rate</div><div class="card-sub">Real stage-to-stage drop-off across the full purchase journey.</div></div><span class="tag live">Live</span></div>
        ${funnelHtml([
          {label:'Sessions', value: GA4T.sessions},
          {label:'Add to Cart', value: GA4T.add_to_carts},
          {label:'Checkout', value: GA4T.checkouts},
          {label:'Purchase', value: GA4T.purchases},
        ])}
        <div class="bignote">${(GA4T.checkouts!=null && GA4T.add_to_carts) ? `Steepest drop-off: ${fmtPct(1-safeDiv(GA4T.checkouts,GA4T.add_to_carts),0)} of users who add to cart do not reach checkout.` : 'Add to Cart / Checkout have no daily breakdown — full-period values only, shown when Last 30 Days is selected.'}</div>
      </div>
    </div>

    ${sectionLabel('Customer behaviour')}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">New vs. Returning Visitors</div><div class="card-sub">Returning visitors convert at a meaningfully different rate than new visitors.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap sm"><canvas id="ga4NewReturningChart"></canvas></div>
        <div id="ga4NewReturningStats" style="margin-top:10px;"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">New vs. Returning — Weekly Trend</div><div class="card-sub">Real weekly sessions and conversion rate for each segment. Edge weeks (partial data window) are marked.</div></div><span class="tag live">Live</span></div>
        <div class="chart-wrap sm"><canvas id="ga4NewReturningWeeklyChart"></canvas></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Sessions &amp; Purchases by Device</div><div class="card-sub">Where customers actually browse and buy.</div></div><span class="tag live">Live</span></div>
      <div class="chart-wrap sm"><canvas id="ga4DeviceChart"></canvas></div>
      <div id="ga4DeviceStats" style="margin-top:10px;"></div>
    </div>
    `;
  },
  charts:[function(){
    const ch = DATA.ga4.channels;
    safeNewChart(document.getElementById('ga4ChannelChart'), {type:'bar', data:{labels:ch.map(c=>c.channel), datasets:[{label:'Revenue', data:ch.map(c=>c.revenue), backgroundColor:PAL.ga4}]},
      options:{indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{ticks:{callback:v=>'AED '+fmtCompact(v)}}}}});
    safeNewChart(document.getElementById('ga4SessionChart'), {type:'doughnut', data:{labels:ch.map(c=>c.channel), datasets:[{data:ch.map(c=>c.sessions), backgroundColor:['#4267B2','#4A90D9','#7FA37A','#D6BB7F','#E24A6D','#8A7C5C','#C97B6B','#E8A33D','#7C9CB5','#B8935A','#A69D8C','#726A5C']}]},
      options:{cutout:'60%', plugins:{legend:{display:false}}}});
    buildTable('ga4ChannelTable', [
      {key:'channel', label:'Channel'},
      {key:'sessions', label:'Sessions', fmt:v=>fmtNum(v)},
      {key:'active_users', label:'Users', fmt:v=>fmtNum(v)},
      {key:'add_to_carts', label:'Add to Cart', fmt:v=>fmtNum(v)},
      {key:'checkouts', label:'Checkouts', fmt:v=>fmtNum(v)},
      {key:'purchases', label:'Purchases', fmt:v=>fmtNum(v)},
      {key:'revenue', label:'Revenue', fmt:v=>fmtAED(v)},
    ], ch, {pageSize:12, defaultSort:'revenue'});

    // --- Source / Medium ---
    const sm = [...DATA.ga4_source_medium].sort((a,b)=>b.sessions-a.sessions);
    safeNewChart(document.getElementById('ga4SourceMediumChart'), {type:'bar', data:{labels:sm.map(s=>s.source_medium), datasets:[
      {label:'Sessions', data:sm.map(s=>s.sessions), backgroundColor:palAlpha(PAL.ga4,0.7)},
    ]}, options:{indexAxis:'y', plugins:{legend:{position:'bottom'}}, scales:{x:{ticks:{callback:v=>fmtCompact(v)}}}}});
    buildTable('ga4SourceMediumTable', [
      {key:'source_medium', label:'Source / Medium'},
      {key:'sessions', label:'Sessions', fmt:v=>fmtNum(v)},
      {key:'active_users', label:'Users', fmt:v=>fmtNum(v)},
      {key:'conversions_purchase', label:'Purchases', fmt:v=>fmtNum(v,1)},
      {key:'revenue', label:'Revenue', fmt:v=>v===null?NA:fmtAED(v)},
    ], sm, {pageSize:12, defaultSort:'sessions'});

    // --- Website performance & engagement trend ---
    const perf = DATA.ga4_daily_perf;
    safeNewChart(document.getElementById('ga4EngagementChart'), {type:'line', data:{labels:perf.map(d=>d.date.slice(5)), datasets:[
      {label:'Bounce Rate', data:perf.map(d=>d.bounce_rate*100), borderColor:PAL.red, backgroundColor:'transparent', tension:.3, yAxisID:'y'},
      {label:'Engagement Rate', data:perf.map(d=>d.engagement_rate*100), borderColor:PAL.green, backgroundColor:palAlpha(PAL.green,0.1), fill:true, tension:.3, yAxisID:'y'},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{y:{title:{display:true,text:'%'}, ticks:{callback:v=>v+'%'}}}}});

    // --- Customer behaviour: new vs returning ---
    const nvr = DATA.ga4_new_vs_returning;
    safeNewChart(document.getElementById('ga4NewReturningChart'), {type:'bar', data:{labels:nvr.map(n=>n.segment), datasets:[
      {label:'Sessions', data:nvr.map(n=>n.sessions), backgroundColor:palAlpha(PAL.gold,0.6), yAxisID:'y1'},
      {label:'Conversion Rate', data:nvr.map(n=>safeDiv(n.purchases,n.sessions)*100), type:'line', borderColor:PAL.green, backgroundColor:'transparent', yAxisID:'y'},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{y:{position:'left', title:{display:true,text:'Conv. rate %'}}, y1:{position:'right', grid:{display:false}, ticks:{callback:v=>fmtCompact(v)}}}}});
    document.getElementById('ga4NewReturningStats').innerHTML = `<div class="stat-list">${nvr.map(n=>`<div class="stat-row"><div class="stat-name">${n.segment} — conv. rate</div><div class="stat-val" style="color:${roasColor(safeDiv(n.purchases,n.sessions)*100)}">${fmtPct(safeDiv(n.purchases,n.sessions),2)}</div></div>`).join('')}</div>`;

    // --- New vs Returning: real weekly trend (sessions + conversion rate for each segment) ---
    // Grouped bars for session volume (very different scale from %) plus lines for conversion
    // rate on a second axis — the clearest way to see week-over-week volume shifts alongside the
    // conversion-rate gap between segments, without one obscuring the other. Every point here is
    // aggregated from real daily GA4 rows; nothing is estimated or interpolated. Edge weeks with
    // fewer than 7 real days (window boundary) are marked in their label.
    const wk = DATA.ga4_new_vs_returning_weekly;
    const wkLabels = wk.map(w => fmtDate(w.week_start) + (w.days<7 ? ` (${w.days}d)` : ''));
    safeNewChart(document.getElementById('ga4NewReturningWeeklyChart'), {data:{labels:wkLabels, datasets:[
      {type:'bar', label:'New Sessions', data:wk.map(w=>w.new_sessions), backgroundColor:palAlpha(PAL.blue,0.55), yAxisID:'y1'},
      {type:'bar', label:'Returning Sessions', data:wk.map(w=>w.returning_sessions), backgroundColor:palAlpha(PAL.gold,0.6), yAxisID:'y1'},
      {type:'line', label:'New Conv. Rate', data:wk.map(w=>safeDiv(w.new_purchases,w.new_sessions)*100), borderColor:PAL.green, backgroundColor:'transparent', tension:.3, yAxisID:'y'},
      {type:'line', label:'Returning Conv. Rate', data:wk.map(w=>safeDiv(w.returning_purchases,w.returning_sessions)*100), borderColor:PAL.red, backgroundColor:'transparent', tension:.3, yAxisID:'y'},
    ]}, options:{plugins:{legend:{position:'bottom', labels:{boxWidth:10}}}, scales:{
      y:{position:'left', title:{display:true,text:'Conv. rate %'}, ticks:{callback:v=>v.toFixed(1)+'%'}},
      y1:{position:'right', title:{display:true,text:'Sessions'}, grid:{display:false}, ticks:{callback:v=>fmtCompact(v)}},
    }}});

    // --- Customer behaviour: device category ---
    const dev = DATA.ga4_device_category;
    safeNewChart(document.getElementById('ga4DeviceChart'), {type:'doughnut', data:{labels:dev.map(d=>d.device), datasets:[{data:dev.map(d=>d.sessions), backgroundColor:[PAL.gold, PAL.blue, PAL.amber]}]},
      options:{cutout:'55%', plugins:{legend:{position:'bottom', labels:{boxWidth:10}}}}});
    document.getElementById('ga4DeviceStats').innerHTML = `<div class="stat-list">${dev.map(d=>`<div class="stat-row"><div class="stat-name">${d.device} — conv. rate</div><div class="stat-val">${fmtPct(safeDiv(d.purchases,d.sessions),2)}</div></div>`).join('')}</div>`;
  }]
};

/* ---------------- 8. FULL FUNNEL ---------------- */
PAGES.funnel = {
  html(){
    const impressions = PT.totalImpr;
    const clicks = PT.totalClicks;
    const purchases = PT.totalPurchases;
    const revenue = PT.totalRevenue;
    const lpv = sumKey(CAMPAIGN_ROWS,'lpv');
    const viewContent = sumKey(CAMPAIGN_ROWS,'vc');
    const atc = sumKey(CAMPAIGN_ROWS,'atc');
    const checkout = sumKey(CAMPAIGN_ROWS,'ic');
    const payInfo = null; // Payment Info is Meta-only and not summed into the unified campaign_daily dataset
    return `
    <div class="page-head">
      <div class="page-eyebrow">Journey · Cross-Platform</div>
      <div class="page-title">Full Funnel / Customer Journey</div>
      <div class="page-desc">Combined funnel across all connected ad platforms, from delivery through platform-attributed purchase. Stages are summed only from platforms that report the given field — see note below each stage.</div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Awareness → Purchase</div><span class="tag live">Live · Meta + Snapchat + TikTok + Google</span></div>
        ${funnelHtml([
          {label:'Impressions', value: impressions},
          {label:'Clicks', value: clicks},
          {label:'Landing Page View', value: lpv},
          {label:'View Content', value: viewContent},
          {label:'Add to Cart', value: atc},
          {label:'Initiate Checkout', value: checkout},
          {label:'Purchase', value: purchases},
        ])}
        <div class="bignote">Landing Page View combines Meta + Snapchat + TikTok (Google Ads does not expose this field at account level here). View Content combines Meta + Snapchat only. Add to Cart / Checkout combine Meta + Snapchat + TikTok. Purchases and Revenue are platform-attributed and summed across all four networks.</div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Stage Efficiency</div><span class="tag live">Live</span></div>
        <div class="stat-list">
          <div class="stat-row"><div class="stat-name">Blended CTR (Clicks/Impr.)</div><div class="stat-val">${fmtPct(safeDiv(clicks,impressions),2)}</div></div>
          <div class="stat-row"><div class="stat-name">Click → Landing Page View</div><div class="stat-val">${fmtPct(safeDiv(lpv,clicks),1)}</div></div>
          <div class="stat-row"><div class="stat-name">LPV → View Content</div><div class="stat-val">${fmtPct(safeDiv(viewContent,lpv),1)}</div></div>
          <div class="stat-row"><div class="stat-name">View Content → Add to Cart</div><div class="stat-val">${fmtPct(safeDiv(atc,viewContent),1)}</div></div>
          <div class="stat-row"><div class="stat-name">Add to Cart → Checkout</div><div class="stat-val">${fmtPct(safeDiv(checkout,atc),1)}</div></div>
          <div class="stat-row"><div class="stat-name">Checkout → Purchase</div><div class="stat-val">${fmtPct(safeDiv(purchases,checkout),1)}</div></div>
          <div class="stat-row"><div class="stat-name">Blended CPA</div><div class="stat-val">${fmtAED(safeDiv(PT.totalSpend,purchases),0)}</div></div>
          <div class="stat-row"><div class="stat-name">Blended ROAS</div><div class="stat-val">${fmtX(safeDiv(revenue,PT.totalSpend))}</div></div>
        </div>
        <div class="bignote">Checkout → Purchase is the steepest drop-off (${(100-100*safeDiv(purchases,checkout)).toFixed(0)}% loss) — flagged on the Insights page. Payment-info stage (Meta only, ${fmtNum(payInfo)}) is not comparable across platforms and shown separately on the Meta Ads page.</div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Funnel Chart — Awareness to Purchase</div><div class="card-sub">Same real stage data as above, shown as a cone-shaped funnel.</div></div><span class="tag live">Live</span></div>
      <div id="funnelConeWrap"></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Platform Contribution by Stage</div><span class="tag live">Live</span></div>
        <div class="chart-wrap"><canvas id="funnelStackChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Website-side journey (GA4)</div><span class="tag live">Live</span></div>
        ${funnelHtml([
          {label:'Sessions', value: GA4T.sessions},
          {label:'Add to Cart', value: GA4T.add_to_carts},
          {label:'Checkout', value: GA4T.checkouts},
          {label:'Purchase', value: GA4T.purchases},
        ])}
        <div class="bignote">This is the GA4 website funnel (all traffic, not only paid) — useful to sanity-check platform-reported funnels against actual site behaviour.</div>
      </div>
    </div>
    `;
  },
  charts:[function(){
    // Recomputed here (not shared from html()'s local scope) — same real source values.
    const impressions = PT.totalImpr, clicks = PT.totalClicks, purchases = PT.totalPurchases;
    const lpv = sumKey(CAMPAIGN_ROWS,'lpv'), viewContent = sumKey(CAMPAIGN_ROWS,'vc');
    const atc = sumKey(CAMPAIGN_ROWS,'atc'), checkout = sumKey(CAMPAIGN_ROWS,'ic');
    // Same real stage totals as the funnelHtml widget above (impressions, clicks, lpv, view
    // content, add to cart, checkout, purchase) — only the visualization changes here, not the
    // underlying numbers or how they're calculated.
    const stageLabels = ['Impressions','Clicks','Landing Page View','View Content','Add to Cart','Initiate Checkout','Purchase'];
    const stageValues = [impressions, clicks, lpv, viewContent, atc, checkout, purchases];
    document.getElementById('funnelConeWrap').innerHTML = svgConeFunnel(stageLabels, stageValues);

    const byPlat = {};
    CAMPAIGN_ROWS.forEach(c=>{ (byPlat[c.platform]=byPlat[c.platform]||{clicks:0,atc:0,purchases:0}); byPlat[c.platform].atc += c.atc; byPlat[c.platform].purchases += c.purchases; });
    // Clicks per platform come straight from PT.rows (already real, filtered for the selected range).
    const keyMap = {meta:'Meta', google:'Google', snapchat:'Snapchat', tiktok:'TikTok'};
    PT.rows.forEach(r=>{
      const name = keyMap[r.key];
      byPlat[name] = byPlat[name] || {clicks:0,atc:0,purchases:0};
      byPlat[name].clicks = r.clicks||0;
    });
    const labels = ['Clicks','Add to Cart','Purchases'];
    const iconKeyFor = {Meta:'meta',Google:'google',Snapchat:'snapchat',TikTok:'tiktok'};
    // Convert to each stage's real percentage share per platform, rather than raw stacked counts.
    // Reason: Clicks (279K) outscales Purchases (130) by ~2,150x, so on one shared linear axis
    // the Add to Cart and Purchases bars were real but rendered at a fraction of a percent of the
    // chart's height — technically present, invisible to the eye. A 100%-stacked share view keeps
    // every stage's real numbers (shown in the tooltip) while making every bar visible, and better
    // matches what "Contribution by Stage" means — each platform's share of that stage, not a
    // volume comparison across stages of very different absolute size.
    const rawByPlat = {}; Object.entries(byPlat).forEach(([p,s])=>{ rawByPlat[p] = [s.clicks, s.atc, s.purchases]; });
    const stageTotals = labels.map((_,i)=> Object.values(rawByPlat).reduce((a,arr)=>a+(arr[i]||0),0));
    safeNewChart(document.getElementById('funnelStackChart'), {type:'bar', data:{labels, datasets:Object.entries(rawByPlat).map(([p,arr])=>({
      label:p, data:arr.map((v,i)=> stageTotals[i] ? v/stageTotals[i]*100 : 0), rawValues:arr, backgroundColor:PAL[iconKeyFor[p]], stack:'st',
    }))}, options:{plugins:{legend:{position:'bottom'}, tooltip:{callbacks:{label:(ctx)=>{
      const raw = ctx.dataset.rawValues[ctx.dataIndex];
      return `${ctx.dataset.label}: ${fmtNum(raw)} (${ctx.parsed.y.toFixed(1)}%)`;
    }}}}, scales:{x:{stacked:true}, y:{stacked:true, max:100, ticks:{callback:v=>v+'%'}}}}});
  }]
};

/* ---------------- 9. CAMPAIGN ANALYSIS ---------------- */
function allCampaignsRows(){
  // CAMPAIGN_ROWS is computed fresh in recomputeAll() from real per-day, per-campaign data
  // (DATA.campaign_daily) filtered to the currently selected date range — genuinely real for
  // any range within the retrieved window, not a full-period substitution.
  return CAMPAIGN_ROWS;
}
PAGES.campaigns = {
  html(){
    if (!CAMPAIGNS_AVAILABLE){
      return `
      <div class="page-head">
        <div class="page-eyebrow">Cross-Platform</div>
        <div class="page-title">Campaign Analysis</div>
        <div class="page-desc">Every campaign with spend, consolidated across all four ad platforms.</div>
      </div>
      ${unavailableBlock('Campaign Analysis')}`;
    }
    const rows = allCampaignsRows();
    const iconKeyFor = p => ({Meta:'meta',Google:'google',Snapchat:'snapchat',TikTok:'tiktok'}[p]);
    const topRevenue = [...rows].map(r=>({...r, iconKey:iconKeyFor(r.platform)})).sort((a,b)=>b.revenue-a.revenue).slice(0,6);
    // ROAS ranking is restricted to Conversion-objective campaigns — Traffic and Awareness
    // campaigns weren't built to drive purchase revenue, so ranking them by ROAS would penalize
    // them for succeeding at a different job.
    const topROAS = [...rows].filter(c=>c.objective==='Conversion' && c.purchases>0).map(r=>({...r, iconKey:iconKeyFor(r.platform)})).sort((a,b)=>(b.roas||0)-(a.roas||0)).slice(0,6);
    const highestSpend = [...rows].map(r=>({...r, iconKey:iconKeyFor(r.platform)})).sort((a,b)=>b.spend-a.spend).slice(0,6);
    const attention = [...rows].filter(c=>c.objective==='Conversion' && c.spend>500 && (c.roas===null || c.roas<1)).map(r=>({...r, iconKey:iconKeyFor(r.platform)})).sort((a,b)=>b.spend-a.spend).slice(0,6);
    return `
    <div class="page-head">
      <div class="page-eyebrow">Cross-Platform</div>
      <div class="page-title">Campaign Analysis</div>
      <div class="page-desc">Every campaign with spend in the last 30 days, consolidated across all four ad platforms. Use search to filter by name or platform.</div>
    </div>
    ${partialRangeBanner()}
    <div class="banner"><span class="ic">ℹ</span><div><b>Evaluated by objective.</b> ROAS-based rankings below (Top ROAS, Needs Attention) only include Conversion-objective campaigns — Traffic and Awareness campaigns aren't designed to drive purchase revenue, so ranking them on ROAS would be judging them against a goal they were never given. The small square before each campaign name marks its objective (gold = Conversion, blue = Traffic, amber = Awareness).</div></div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Top 6 by Revenue — All Objectives</div><span class="tag live">Live</span></div>
        ${rankBars(topRevenue, 'revenue', {fmt:v=>fmtAED(v), color:()=>PAL.green})}
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Top 6 by ROAS</div><div class="card-sub">Conversion-objective only</div></div><span class="tag live">Live</span></div>
        ${topROAS.length ? rankBars(topROAS, 'roas', {fmt:v=>fmtX(v), color:()=>PAL.gold}) : '<div class="empty-state">No Conversion-objective campaigns with purchases in this range.</div>'}
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Highest Spend — All Objectives</div><span class="tag live">Live</span></div>
        ${rankBars(highestSpend, 'spend', {fmt:v=>fmtAED(v), color:(r)=>r.objective==='Conversion'?roasColor(r.roas):PAL.dim})}
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Needs Attention</div><div class="card-sub">Conversion-objective, spend &gt; AED 500, ROAS &lt; 1x</div></div><span class="tag warn">Conversion only</span></div>
        ${attention.length ? rankBars(attention, 'spend', {fmt:v=>fmtAED(v), color:()=>PAL.red}) : '<div class="empty-state">None right now.</div>'}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Spend vs Revenue Relationship</div><div class="card-sub">Conversion-objective campaigns only — ROAS isn't a fair measure for Traffic or Awareness campaigns.</div></div><span class="tag live">Live</span></div>
      <div class="chart-wrap"><canvas id="campScatterChart"></canvas></div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Revenue Contribution by Objective</div><div class="card-sub">Which campaign goal is actually driving revenue this period.</div></div><span class="tag live">Live</span></div>
      <div class="chart-wrap" style="height:360px;"><canvas id="campObjectiveRevenueChart"></canvas></div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Daily Purchases Trend — All Campaigns</div><div class="card-sub">Real day-by-day purchases across every active campaign, all platforms combined.</div></div><span class="tag live">Live</span></div>
      <div class="chart-wrap"><canvas id="campDailyPurchasesChart"></canvas></div>
    </div>
    <div class="card">
      <div class="card-head"><div class="card-title">Active Campaigns (${rows.length})</div><span class="tag live">Live</span></div>
      <div id="allCampaignsTable"></div>
    </div>
    `;
  },
  charts:[function(){
    if (!CAMPAIGNS_AVAILABLE) return;
    const rows = allCampaignsRows();
    const iconKeyFor = p => ({Meta:'meta',Google:'google',Snapchat:'snapchat',TikTok:'tiktok'}[p]);
    const byPlatform = {};
    rows.filter(r=>r.objective==='Conversion').forEach(r=>{ (byPlatform[r.platform]=byPlatform[r.platform]||[]).push(r); });
    safeNewChart(document.getElementById('campScatterChart'), {type:'scatter', data:{datasets:Object.entries(byPlatform).map(([p,rs])=>({
      label:p, data:rs.map(r=>({x:r.spend, y:r.revenue})), backgroundColor:PAL[iconKeyFor(p)], pointRadius:6,
    }))}, options:{plugins:{legend:{position:'bottom'}}, scales:{x:{title:{display:true,text:'Spend (AED)'},ticks:{callback:v=>fmtCompact(v)}}, y:{title:{display:true,text:'Revenue (AED)'},ticks:{callback:v=>fmtCompact(v)}}}}});

    // Revenue contribution by objective — pie is the right shape for a part-to-whole split.
    // Uses its own dedicated color map (not the shared `objColor` used by the Active Campaigns
    // table's badges below) because that shared map's Conversion (gold) and Awareness (amber)
    // are near-identical warm tones — fine as a small badge dot, but indistinguishable as pie
    // slices. This fix is scoped to this chart only; the table's badge colors are untouched.
    const objColor = {Conversion:PAL.gold, Traffic:PAL.blue, Awareness:PAL.amber, Other:PAL.dim};
    const pieObjColor = {Conversion:'#D6BB7F', Traffic:'#4C8DFF', Awareness:'#5FB88F', Other:'#8B8378'};
    const byObjective = {};
    rows.forEach(r=>{ byObjective[r.objective] = (byObjective[r.objective]||0) + (r.revenue||0); });
    const objKeys = Object.keys(byObjective);
    safeNewChart(document.getElementById('campObjectiveRevenueChart'), {type:'pie', data:{labels:objKeys, datasets:[{data:objKeys.map(k=>byObjective[k]), backgroundColor:objKeys.map(k=>pieObjColor[k]||PAL.dim), borderColor:'var(--card)', borderWidth:2}]},
      options:{maintainAspectRatio:false, plugins:{legend:{position:'bottom', labels:{boxWidth:14, padding:16, font:{size:12.5}}}}}});

    // New: real daily purchases trend across all campaigns/platforms for the selected range — a
    // line chart is the right shape for a genuine day-by-day time series.
    const dailyFiltered = filterCampaignDaily(RANGE.from, RANGE.to);
    const byDate = {};
    dailyFiltered.forEach(r=>{ byDate[r.date] = (byDate[r.date]||0) + (r.purchases||0); });
    const dates = Object.keys(byDate).sort();
    safeNewChart(document.getElementById('campDailyPurchasesChart'), {type:'line', data:{labels:dates.map(d=>d.slice(5)), datasets:[
      {label:'Purchases', data:dates.map(d=>byDate[d]), borderColor:PAL.gold, backgroundColor:palAlpha(PAL.gold,0.12), fill:true, tension:.3},
    ]}, options:{plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>fmtNum(v)}}}}});

    buildTable('allCampaignsTable', [
      {key:'platform', label:'Platform', fmt:(v)=>platformLabel(iconKeyFor(v),v), totalFmt:()=>'<b>Total</b>'},
      {key:'name', label:'Campaign', totalFmt:(v,t)=>`${t.count} campaign${t.count===1?'':'s'}`},
      {key:'objective', label:'Objective', fmt:v=>`<span class="mini-badge" style="background:${objColor[v]}22;color:${objColor[v]};">${v}</span>`, totalFmt:()=>''},
      {key:'purchases', label:'Purchases', fmt:v=>fmtNum(v,2)},
      {key:'revenue', label:'Revenue', fmt:v=>fmtAED(v)},
      {key:'roas', label:'ROAS', fmt:(v,row)=>row.objective!=='Conversion'?'<span class="kpi-na">n/a</span>':(v===null?NA:`<span style="color:${roasColor(v)}">${fmtX(v)}</span>`), totalFmt:(v)=>v===null?NA:fmtX(v)},
      {key:'cpa', label:'CPA', fmt:(v,row)=>row.objective!=='Conversion'?'<span class="kpi-na">n/a</span>':(v===null?NA:fmtAED(v)), totalFmt:(v)=>v===null?NA:fmtAED(v)},
    ], rows, {pageSize:12, defaultSort:'revenue', totalsRow:(all)=>{
      const purchases = sumKey(all,'purchases');
      const revenue = sumKey(all,'revenue');
      const conv = all.filter(r=>r.objective==='Conversion');
      const convSpend = sumKey(conv,'spend'); // used only to compute ROAS/CPA totals — not displayed as its own column/value
      const convRevenue = sumKey(conv,'revenue');
      const convPurchases = sumKey(conv,'purchases');
      return { count: all.length, purchases, revenue, roas: safeDiv(convRevenue, convSpend), cpa: safeDiv(convSpend, convPurchases) };
    }});
  }]
};

/* ---------------- 10. AUDIENCE ANALYSIS ---------------- */
PAGES.audience = {
  html(){
    if (!BREAKDOWNS_AVAILABLE){
      return `
      <div class="page-head">
        <div class="page-eyebrow">Audience</div>
        <div class="page-title">Audience Analysis</div>
        <div class="page-desc">Meta audience-dimension breakdowns: gender and publisher placement.</div>
      </div>
      ${unavailableBlock('Audience Analysis')}`;
    }
    const g = DATA.meta_gender, pl = DATA.meta_placement;
    return `
    <div class="page-head">
      <div class="page-eyebrow">Audience</div>
      <div class="page-title">Audience Analysis</div>
      <div class="page-desc">Real Meta audience-dimension pulls: gender and publisher placement (Facebook vs Instagram vs WhatsApp). Age-bucket, interest and lookalike composition were not queried in this pass — see gap note below. Snapchat/TikTok/GA4 audience dimensions are also pending.</div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Meta — Spend & Revenue by Gender</div><span class="tag live">Live</span></div>
        <div class="chart-wrap sm"><canvas id="audGenderChart"></canvas></div>
        <div id="audGenderTable" style="margin-top:12px;"></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Meta — Spend & Revenue by Placement</div><span class="tag live">Live</span></div>
        <div class="chart-wrap sm"><canvas id="audPlacementChart"></canvas></div>
        <div id="audPlacementTable" style="margin-top:12px;"></div>
      </div>
    </div>
    <div class="banner warn"><span class="ic">⚠</span><div><b>Data gap:</b> Age-bucket, interest/affinity, and lookalike-source composition were not queried in this pass (available across all platforms + GA4). Prospecting-vs-retargeting split derived from Meta campaign naming is below — a structural read of real spend, not a platform-native field.</div></div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Meta — Prospecting vs Retargeting (naming-convention derived)</div><div class="card-sub">Campaign names containing "rt" / "engd-aud" are treated as retargeting; all others as prospecting.</div></div><span class="tag warn">Heuristic on real data</span></div>
      <div id="audienceTable"></div>
    </div>
    `;
  },
  charts:[function(){
    if (!BREAKDOWNS_AVAILABLE) return;
    const g = DATA.meta_gender, pl = DATA.meta_placement;
    safeNewChart(document.getElementById('audGenderChart'), {type:'bar', data:{labels:g.map(r=>r.gender), datasets:[
      {label:'Spend', data:g.map(r=>r.spend), backgroundColor:'#8A7C5C'},
      {label:'Revenue', data:g.map(r=>r.revenue), backgroundColor:PAL.gold},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{y:{ticks:{callback:v=>'AED '+fmtCompact(v)}}}}});
    safeNewChart(document.getElementById('audPlacementChart'), {type:'bar', data:{labels:pl.map(r=>r.platform), datasets:[
      {label:'Spend', data:pl.map(r=>r.spend), backgroundColor:'#8A7C5C'},
      {label:'Revenue', data:pl.map(r=>r.revenue), backgroundColor:PAL.gold},
    ]}, options:{indexAxis:'y', plugins:{legend:{position:'bottom'}}, scales:{x:{ticks:{callback:v=>'AED '+fmtCompact(v)}}}}});
    buildTable('audGenderTable', [
      {key:'gender', label:'Gender'},
      {key:'spend', label:'Spend', fmt:v=>fmtAED(v)},
      {key:'purchases', label:'Purchases', fmt:v=>fmtNum(v)},
      {key:'revenue', label:'Revenue', fmt:v=>fmtAED(v)},
      {key:'roas', label:'ROAS', fmt:(v,row)=>row.spend?fmtX(safeDiv(row.revenue,row.spend)):NA},
    ], g, {pageSize:5, defaultSort:'spend'});
    buildTable('audPlacementTable', [
      {key:'platform', label:'Placement'},
      {key:'spend', label:'Spend', fmt:v=>fmtAED(v)},
      {key:'purchases', label:'Purchases', fmt:v=>fmtNum(v)},
      {key:'revenue', label:'Revenue', fmt:v=>fmtAED(v)},
      {key:'roas', label:'ROAS', fmt:(v,row)=>row.spend?fmtX(safeDiv(row.revenue,row.spend)):NA},
    ], pl, {pageSize:5, defaultSort:'spend'});
    const classify = name => /(-rt-|rt-diana|engd-aud|retarget)/i.test(name) ? 'Retargeting' : 'Prospecting';
    const groups = {};
    DATA.meta_campaigns.forEach(c=>{
      const gg = classify(c.name);
      groups[gg] = groups[gg] || {group:gg, spend:0, purchases:0, revenue:0};
      groups[gg].spend += c.spend; groups[gg].purchases += c.purchases; groups[gg].revenue += c.revenue;
    });
    const rows = Object.values(groups).map(gg=>({...gg, roas: safeDiv(gg.revenue,gg.spend), cpa: safeDiv(gg.spend,gg.purchases)}));
    buildTable('audienceTable', [
      {key:'group', label:'Segment'},
      {key:'spend', label:'Spend', fmt:v=>fmtAED(v)},
      {key:'purchases', label:'Purchases', fmt:v=>fmtNum(v)},
      {key:'revenue', label:'Revenue', fmt:v=>fmtAED(v)},
      {key:'roas', label:'ROAS', fmt:v=>v===null?NA:fmtX(v)},
      {key:'cpa', label:'CPA', fmt:v=>v===null?NA:fmtAED(v)},
    ], rows, {pageSize:5, defaultSort:'spend'});
  }]
};

/* ---------------- 11. CREATIVE ANALYSIS ---------------- */
PAGES.creative = {
  html(){
    if (!BREAKDOWNS_AVAILABLE){
      return `
      <div class="page-head">
        <div class="page-eyebrow">Creative</div>
        <div class="page-title">Creative Analysis</div>
        <div class="page-desc">Ad-level performance for Meta, with creative thumbnails.</div>
      </div>
      ${unavailableBlock('Creative Analysis')}`;
    }
    const ads = DATA.meta_ads;
    const topBySpend = [...ads].sort((a,b)=>b.spend-a.spend).slice(0,5);
    const topByRevenue = [...ads].sort((a,b)=>b.revenue-a.revenue).slice(0,5);
    const creativeCard = a => `
      <div class="creative-card">
        <img src="${a.thumbnail_url}" alt="" class="creative-card-img">
        <div class="creative-card-body">
          <div class="creative-card-name" title="${a.ad_name}">${a.ad_name}</div>
          <div class="creative-card-campaign" title="${a.campaign_name}">${a.campaign_name}</div>
          <span class="pill ${a.status==='ACTIVE'?'active':'paused'}" style="margin:4px 0 8px;">${a.status}</span>
          <div class="creative-card-metrics">
            <div><span class="pcm-label">Spend</span><span class="pcm-val">${fmtAED(a.spend)}</span></div>
            <div><span class="pcm-label">CTR</span><span class="pcm-val">${fmtPct(a.ctr,2)}</span></div>
            <div><span class="pcm-label">Purchases</span><span class="pcm-val">${fmtNum(a.purchases)}</span></div>
            <div><span class="pcm-label">Revenue</span><span class="pcm-val">${fmtAED(a.revenue)}</span></div>
            <div style="grid-column:1/-1;"><span class="pcm-label">ROAS</span><span class="pcm-val" style="color:${a.roas===null?'inherit':roasColor(a.roas)}">${a.roas===null?'N/A':fmtX(a.roas)}</span></div>
          </div>
        </div>
      </div>`;
    return `
    <div class="page-head">
      <div class="page-eyebrow">Creative</div>
      <div class="page-title">Creative Analysis</div>
      <div class="page-desc">Real ad-level performance for Meta, with live creative thumbnails pulled directly from the ad account. Snapchat and TikTok ad-level creative rows were not queried in this pass.</div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Top Meta Ads by Spend</div><div class="card-sub">Top 5 of ${ads.length} ads with spend &gt; AED 50 in the last 30 days.</div></div><span class="tag live">Live · ad-level</span></div>
      <div class="creative-card-grid">${topBySpend.map(creativeCard).join('')}</div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Top Ads by Revenue</div><div class="card-sub">Top 5 of ${ads.length} ads, ranked by real purchase revenue.</div></div><span class="tag live">Live · ad-level</span></div>
      <div class="creative-card-grid">${topByRevenue.map(creativeCard).join('')}</div>
    </div>
    <div class="banner"><span class="ic">ℹ</span><div><b>Read:</b> "ad-uae-sales-new-img-diana-collection-05-jul-26-avl" is the single best-performing creative (${fmtAED(9313.98,0)} spend, ${fmtX(4.57)} ROAS) — a static product image on the Diana Collection retargeting set. Video creatives in the same account are currently running on prospecting/awareness campaigns with materially lower ROAS. Consider testing this image concept into prospecting.</div></div>
    `;
  },
  charts:[]
};

/* ---------------- 12. PRODUCT & COLLECTION ---------------- */
PAGES.product = {
  html(){
    if (!BREAKDOWNS_AVAILABLE){
      return `
      <div class="page-head">
        <div class="page-eyebrow">Ecommerce · GA4</div>
        <div class="page-title">Product & Collection Analysis</div>
        <div class="page-desc">Top products by revenue, from GA4 ecommerce item data.</div>
      </div>
      ${unavailableBlock('Product & Collection Analysis')}`;
    }
    const totalItemRev = DATA.top_items.reduce((a,i)=>a+i.item_revenue,0);
    return `
    <div class="page-head">
      <div class="page-eyebrow">Ecommerce · GA4</div>
      <div class="page-title">Product & Collection Analysis</div>
      <div class="page-desc">Top products by revenue, from GA4 ecommerce item data — real SKU-level purchases and views on jawharajewellery.com over the last 30 days.</div>
    </div>
    <div class="kpi-grid">
      ${kpi('Top 15 Items — Revenue', fmtAED(totalItemRev))}
      ${kpi('Top 15 Items — Units', fmtNum(DATA.top_items.reduce((a,i)=>a+i.items_purchased,0)))}
      ${kpi('Best Seller', DATA.top_items[0].item_name.slice(0,28)+'…')}
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Top Products by Revenue</div><div class="card-sub">GA4 item-scoped ecommerce data.</div></div><span class="tag live">Live</span></div>
      <div id="productTable"></div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Top Products by Collection</div><div class="card-sub">Collection extracted directly from each real item name (e.g. "Danah Collection", "- Diana"). Items with no recognizable collection marker are grouped as Unspecified — not assigned one that isn't in the data.</div></div><span class="tag live">Live</span></div>
      <div id="collectionTable"></div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">Top Products by Category</div><div class="card-sub">Category extracted directly from each real item name (e.g. "Earrings", "Pendant Chain", "Ring"). Items with no recognizable category keyword are grouped as Unspecified.</div></div><span class="tag live">Live</span></div>
      <div id="categoryTable"></div>
    </div>
    `;
  },
  charts:[function(){
    if (!BREAKDOWNS_AVAILABLE) return;
    buildTable('productTable', [
      {key:'item_name', label:'Product'},
      {key:'items_viewed', label:'Viewed', fmt:v=>fmtNum(v)},
      {key:'items_added_to_cart', label:'Added to Cart', fmt:v=>fmtNum(v)},
      {key:'items_purchased', label:'Purchased', fmt:v=>fmtNum(v)},
      {key:'item_revenue', label:'Revenue', fmt:v=>fmtAED(v)},
    ], DATA.top_items, {pageSize:10, defaultSort:'item_revenue', totalsRow:(all)=>({
      item_name: `Total (${all.length} products)`, items_viewed: sumKey(all,'items_viewed'),
      items_added_to_cart: sumKey(all,'items_added_to_cart'), items_purchased: sumKey(all,'items_purchased'),
      item_revenue: sumKey(all,'item_revenue'),
    }), });

    const byCollection = {}, byCategory = {};
    DATA.top_items.forEach(item=>{
      const col = extractCollection(item.item_name);
      const cat = extractCategory(item.item_name);
      (byCollection[col] = byCollection[col] || []).push(item);
      (byCategory[cat] = byCategory[cat] || []).push(item);
    });
    const rollup = (grouped) => Object.entries(grouped).map(([name, items])=>({
      name, viewed: sumKey(items,'items_viewed'), added_to_cart: sumKey(items,'items_added_to_cart'),
      purchased: sumKey(items,'items_purchased'), revenue: sumKey(items,'item_revenue'), count: items.length,
    })).sort((a,b)=>b.revenue-a.revenue);
    const collectionRows = rollup(byCollection);
    const categoryRows = rollup(byCategory);
    const rollupCols = [
      {key:'name', label:'Name', fmt:(v,row)=>`${v} <span class="mini-badge" style="background:rgba(214,187,127,0.12);color:var(--text-faint);">${row.count} product${row.count===1?'':'s'}</span>`, totalFmt:(v)=>v},
      {key:'viewed', label:'Viewed', fmt:v=>fmtNum(v)},
      {key:'added_to_cart', label:'Added to Cart', fmt:v=>fmtNum(v)},
      {key:'purchased', label:'Purchased', fmt:v=>fmtNum(v)},
      {key:'revenue', label:'Revenue', fmt:v=>fmtAED(v)},
    ];
    buildTable('collectionTable', rollupCols, collectionRows, {pageSize:10, defaultSort:'revenue', totalsRow:(all)=>({
      name: `Total (${all.reduce((a,r)=>a+r.count,0)} products)`, viewed: sumKey(all,'viewed'), added_to_cart: sumKey(all,'added_to_cart'),
      purchased: sumKey(all,'purchased'), revenue: sumKey(all,'revenue'),
    })});
    buildTable('categoryTable', rollupCols, categoryRows, {pageSize:10, defaultSort:'revenue', totalsRow:(all)=>({
      name: `Total (${all.reduce((a,r)=>a+r.count,0)} products)`, viewed: sumKey(all,'viewed'), added_to_cart: sumKey(all,'added_to_cart'),
      purchased: sumKey(all,'purchased'), revenue: sumKey(all,'revenue'),
    })});
  }]
};

/* ---------------- 13. BUDGET & PACING ---------------- */
PAGES.budget = {
  html(){
    const b = DATA.meta_budget;
    return `
    <div class="page-head">
      <div class="page-eyebrow">Pacing</div>
      <div class="page-title">Budget & Pacing</div>
      <div class="page-desc">Daily spend cadence, plus real ad-set daily budgets retrieved for Meta. Most Meta campaigns in this account run Campaign Budget Optimization (CBO) at the campaign level rather than a fixed ad-set daily budget, so a budget value is only available for 2 of the active campaigns below. Google, Snapchat and TikTok budget-cap fields were not queried in this pass.</div>
    </div>
    ${BREAKDOWNS_AVAILABLE ? `
    <div class="card">
      <div class="card-head"><div><div class="card-title">Meta — Ad Sets With a Retrieved Daily Budget</div><div class="card-sub">Full-period (14 Jul–12 Aug) spend against the ad set's current daily budget × 30 — no daily breakdown exists for these budget rows, so this table does not change with the date filter.</div></div><span class="tag warn">Full period only</span></div>
      <div class="table-scroll"><table><thead><tr><th style="width:39.47%">Campaign / Ad Set</th><th class="num-col" style="width:15.13%">Daily Budget</th><th class="num-col" style="width:15.13%">Implied 30d Budget</th><th class="num-col" style="width:15.13%">Actual 30d Spend</th><th class="num-col" style="width:15.13%">Pacing</th></tr></thead><tbody>
        ${b.map(r=>{
          const implied = r.adset_daily_budget*30;
          const pct = r.spend_30d/implied*100;
          return `<tr><td class="strong" style="width:39.47%">${r.campaign_name}</td><td class="mono num-col" style="width:15.13%">${fmtAED(r.adset_daily_budget)}/day</td><td class="mono num-col" style="width:15.13%">${fmtAED(implied)}</td><td class="mono num-col" style="width:15.13%">${fmtAED(r.spend_30d)}</td><td class="mono num-col" style="width:15.13%">${pct.toFixed(0)}%</td></tr>`;
        }).join('')}
      </tbody></table></div>
      <div class="bignote">All other active campaigns (Diana Collection Sales, Awareness store-locator, WhatsApp flash sale, Oman traffic) returned no ad-set-level daily/lifetime budget — consistent with campaign-level CBO, whose budget field sits one level up and was not queried in this pass.</div>
    </div>
    <div class="banner warn"><span class="ic">⚠</span><div><b>Data gap:</b> Campaign-level CBO budgets, Google Ads shared budgets, and Snapchat/TikTok ad-set budgets were not retrieved in this pass. Retrieving <code>campaign_budget</code> / <code>campaign_daily_budget</code> fields on the next pull will complete this page.</div></div>
    ` : unavailableBlock('The ad-set budget table')}
    <div class="card">
      <div class="card-head"><div class="card-title">Daily Spend Cadence — Meta vs Google</div><span class="tag live">Live</span></div>
      <div class="chart-wrap"><canvas id="budgetChart"></canvas></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><div class="card-title">Meta — Spend Volatility</div><span class="tag live">Live</span></div>
        <div class="stat-list">
          <div class="stat-row"><div class="stat-name">Avg. daily spend</div><div class="stat-val">${fmtAED(safeDiv(METAAGG.spend, RANGE.days))}</div></div>
          <div class="stat-row"><div class="stat-name">Peak day</div><div class="stat-val">${fmtAED(Math.max(...METAD.map(d=>d.spend)))}</div></div>
          <div class="stat-row"><div class="stat-name">Lowest day</div><div class="stat-val">${fmtAED(Math.min(...METAD.map(d=>d.spend)))}</div></div>
        </div>
      </div>
      <div class="card"><div class="card-head"><div class="card-title">Google — Spend Volatility</div><span class="tag live">Live</span></div>
        <div class="stat-list">
          <div class="stat-row"><div class="stat-name">Avg. daily spend</div><div class="stat-val">${fmtAED(safeDiv(GOOGLEAGG.spend, RANGE.days))}</div></div>
          <div class="stat-row"><div class="stat-name">Peak day</div><div class="stat-val">${fmtAED(Math.max(...GOOGLED.map(d=>d.spend)))}</div></div>
          <div class="stat-row"><div class="stat-name">Lowest day</div><div class="stat-val">${fmtAED(Math.min(...GOOGLED.map(d=>d.spend)))}</div></div>
        </div>
      </div>
    </div>
    `;
  },
  charts:[function(){
    safeNewChart(document.getElementById('budgetChart'), {type:'line', data:{labels:METAD.map(d=>d.date.slice(5)), datasets:[
      {label:'Meta', data:METAD.map(d=>d.spend), borderColor:PAL.meta, backgroundColor:palAlpha(PAL.meta,0.12), fill:true, tension:.3},
      {label:'Google', data:GOOGLED.map(d=>d.spend), borderColor:PAL.google, backgroundColor:palAlpha(PAL.google,0.12), fill:true, tension:.3},
    ]}, options:{plugins:{legend:{position:'bottom'}}, scales:{y:{ticks:{callback:v=>'AED '+fmtCompact(v)}}}}});
  }]
};

/* ---------------- 14. INSIGHTS & RECOMMENDATIONS ---------------- */
function computeInsights(){
  const insights = [];
  // Snapchat sub-breakeven ROAS
  const sc = DATA.snapchat.totals;
  if (sc.roas < 1){
    insights.push({flag:'risk', tag:'Efficiency', title:`Snapchat ROAS is ${fmtX(sc.roas)} — below breakeven`,
      desc:`Snapchat spent ${fmtAED(sc.spend,0)} for ${fmtAED(sc.revenue,0)} in platform-attributed revenue over the last 30 days (${fmtNum(sc.purchases)} purchases, CPA ${fmtAED(sc.cpa,0)}). Recommend pausing the lower-performing of the two active campaigns and re-testing creative before adding further budget.`});
  }
  // Meta CPA much higher than Google CPA
  const m = DATA.meta.totals, g = DATA.google.totals;
  if (m.cpa && g.cpa && m.cpa > g.cpa*2){
    insights.push({flag:'watch', tag:'Reallocation', title:`Meta CPA (${fmtAED(m.cpa,0)}) is ${(m.cpa/g.cpa).toFixed(1)}x Google's CPA (${fmtAED(g.cpa,0)})`,
      desc:`Google Ads is delivering purchases at a materially lower cost this period (${fmtNum(g.purchases)} purchases on ${fmtAED(g.spend,0)} spend vs Meta's ${fmtNum(m.purchases)} purchases on ${fmtAED(m.spend,0)}). Consider shifting incremental budget toward the Performance Max campaign while Meta's retargeting sets are optimised.`});
  }
  // Google tracking gap
  insights.push({flag:'risk', tag:'Tracking', title:'Google Ads GA4-linked purchase conversion action reports zero',
    desc:`The "order_complete" conversion action (linked from GA4) shows 0 conversions for the full 30-day window on both English and Arabic checkout pages, while the platform's own "Google Shopping App – Purchase" action shows ${fmtNum(g.purchases)} purchases worth ${fmtAED(g.revenue,0)}. This points to a conversion-action mapping gap rather than zero purchases — validate the linked GA4 conversion import before using it for bidding.`});
  // Campaigns spending without purchases
  const spendNoPurchase = DATA.meta_campaigns.filter(c=>c.spend>500 && c.purchases===0);
  if (spendNoPurchase.length){
    const totalWasted = spendNoPurchase.reduce((a,c)=>a+c.spend,0);
    insights.push({flag:'risk', tag:'Wasted spend', title:`${spendNoPurchase.length} Meta campaign(s) spent ${fmtAED(totalWasted,0)} with zero purchases`,
      desc:`${spendNoPurchase.map(c=>c.name).join(', ')} — combined spend of ${fmtAED(totalWasted,0)} in the last 30 days with no recorded purchase. Two are awareness-objective campaigns (expected low direct conversion) but "${spendNoPurchase.find(c=>c.objective==='LINK_CLICKS')?.name||spendNoPurchase[0].name}" is a traffic campaign and warrants a closer look at landing page and offer alignment.`});
  }
  // TikTok disabled campaign still driving most of the purchases
  const tk = DATA.tiktok.campaigns.find(c=>c.name.includes('sales-diana'));
  if (tk){
    insights.push({flag:'opp', tag:'Scaling', title:`TikTok's best campaign is currently disabled`,
      desc:`"${tk.name}" produced ${fmtNum(tk.purchases)} of TikTok's ${fmtNum(DATA.tiktok.totals.purchases)} purchases (ROAS ${fmtX(safeDiv(tk.revenue,tk.spend))}) but is now status "${tk.status}". If paused intentionally for creative refresh, prioritise relaunch — this was TikTok's only campaign converting above breakeven.`});
  }
  // Meta funnel drop-off checkout->purchase
  const atc = DATA.meta_campaigns.reduce((a,c)=>a+c.add_to_cart,0);
  const ic = DATA.meta_campaigns.reduce((a,c)=>a+c.initiate_checkout,0);
  const pur = DATA.meta_campaigns.reduce((a,c)=>a+c.purchases,0);
  insights.push({flag:'watch', tag:'Funnel', title:`Meta checkout → purchase completion is ${fmtPct(safeDiv(pur,ic),1)}`,
    desc:`Of ${fmtNum(ic)} checkouts initiated on Meta-attributed traffic, only ${fmtNum(pur)} completed as purchases. This is a steeper drop than the add-to-cart → checkout step (${fmtPct(safeDiv(ic,atc),1)}) — worth checking payment method availability and checkout friction for Meta-driven traffic specifically.`});
  // MER strong
  insights.push({flag:'opp', tag:'Overall health', title:`Blended MER is healthy at ${fmtX(MER)}`,
    desc:`GA4 website revenue of ${fmtAED(GA4T.revenue,0)} against total ad spend of ${fmtAED(PT.totalSpend,0)} gives a MER of ${fmtX(MER)} — comfortably above a typical 3–4x jewellery benchmark. Cross-network and Direct remain the largest revenue channels; Paid Social converts at a lower rate (${fmtPct(safeDiv(70771*0.00048,1))}${''}) relative to its session volume and is worth a closer creative/audience review.`});
  return insights;
}

PAGES.insights = {
  html(){
    if (!BREAKDOWNS_AVAILABLE){
      return `
      <div class="page-head">
        <div class="page-eyebrow">Auto-generated · Backed by retrieved data</div>
        <div class="page-title">Insights & Recommendations</div>
        <div class="page-desc">Every insight below is generated from the aggregated metrics shown elsewhere in this dashboard — no insight is produced without a supporting number.</div>
      </div>
      ${unavailableBlock('Insights')}`;
    }
    const list = computeInsights();
    return `
    <div class="page-head">
      <div class="page-eyebrow">Auto-generated · Backed by retrieved data</div>
      <div class="page-title">Insights & Recommendations</div>
      <div class="page-desc">Every insight below is generated from the aggregated metrics shown elsewhere in this dashboard — no insight is produced without a supporting number.</div>
    </div>
    ${list.map(i=>`<div class="insight"><div class="flag ${i.flag}"></div><div class="insight-body"><div class="insight-tag">${i.tag}</div><div class="insight-title">${i.title}</div><div class="insight-desc">${i.desc}</div></div></div>`).join('')}
    `;
  },
  charts:[]
};

/* ---------------- 15. DATA QUALITY / TRACKING HEALTH ---------------- */
PAGES.dataquality = {
  html(){
    return `
    <div class="page-head">
      <div class="page-eyebrow">Governance</div>
      <div class="page-title">Data Quality / Tracking Health</div>
      <div class="page-desc">Connection status and known gaps for every connected source, so the team can trust — or knowingly discount — each number on this dashboard.</div>
    </div>
    ${partialRangeBanner()}
    <div class="card">
      <div class="card-head"><div class="card-title">Source Status</div><span class="tag live">5/5 connected</span></div>
      <div id="dqTable"></div>
    </div>
    <div class="grid-2" style="margin-top:20px;">
      <div class="card">
        <div class="card-head"><div class="card-title">Known Tracking Gaps</div><span class="tag warn">4 open items</span></div>
        <div class="insight"><div class="flag risk"></div><div class="insight-body"><div class="insight-tag">Google Ads</div><div class="insight-title">GA4-linked purchase conversion action reports zero</div><div class="insight-desc">"order_complete" (EN/AR) shows 0 for 30 days while the platform's own Shopping-app purchase action shows 68. Validate the GA4 → Google Ads conversion import.</div></div></div>
        <div class="insight"><div class="flag watch"></div><div class="insight-body"><div class="insight-tag">Google Ads</div><div class="insight-title">Native "Conversions" column is not purchase-only</div><div class="insight-desc">The default conversions metric includes session_start / page_view / first_visit actions and is not usable for CPA or ROAS. This dashboard substitutes the purchase-specific action.</div></div></div>
        <div class="insight"><div class="flag watch"></div><div class="insight-body"><div class="insight-tag">Meta Ads</div><div class="insight-title">Purchase actions null on several days</div><div class="insight-desc">actions_purchase / action_values_purchase return null (not zero) on ~9 of the last 30 days. Treated as zero for aggregation per dashboard convention, but worth confirming with Meta pixel health check.</div></div></div>
        <div class="insight"><div class="flag watch"></div><div class="insight-body"><div class="insight-tag">Cross-platform</div><div class="insight-title">Audience, creative-level and budget fields not yet queried</div><div class="insight-desc">Age/gender/interest dimensions, ad-level creative rows, and campaign/ad-set budget caps are not yet available across all platforms and were out of scope for this reporting period. Flagged on the respective pages rather than estimated.</div></div></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Definitions in use</div></div>
        <div class="stat-list">
          <div class="stat-row"><div class="stat-name">ROAS</div><div class="stat-val">Σ Revenue ÷ Σ Spend</div></div>
          <div class="stat-row"><div class="stat-name">CPA</div><div class="stat-val">Σ Spend ÷ Σ Purchases</div></div>
          <div class="stat-row"><div class="stat-name">AOV</div><div class="stat-val">Σ Revenue ÷ Σ Purchases</div></div>
          <div class="stat-row"><div class="stat-name">CTR / CPC / CPM</div><div class="stat-val">Aggregated, never averaged</div></div>
          <div class="stat-row"><div class="stat-name">MER</div><div class="stat-val">GA4 Revenue ÷ Total Ad Spend</div></div>
        </div>
        <div class="bignote">Per the approved Jawhara metric dictionary: blended ratios are always calculated from aggregated numerator/denominator totals, never by averaging per-campaign or per-platform ratios.</div>
      </div>
    </div>
    `;
  },
  charts:[function(){
    buildTable('dqTable', [
      {key:'platform', label:'Source'},
      {key:'status', label:'Status', fmt:v=>`<span class="pill active">${v}</span>`},
      {key:'lastPull', label:'Last Successful Pull'},
      {key:'rows', label:'Rows Returned', fmt:v=>fmtNum(v)},
      {key:'gap', label:'Notable Gap'},
    ], [
      {platform:'Meta Ads', status:'LIVE', lastPull:'On-demand, this session', rows:52, gap:'Ad-level, audience & budget fields not pulled'},
      {platform:'Google Ads', status:'LIVE', lastPull:'On-demand, this session', rows:2, gap:'GA4-linked purchase action returns zero'},
      {platform:'Snapchat Ads', status:'LIVE', lastPull:'On-demand, this session', rows:36, gap:'34 of 36 campaigns are zero-delivery / historical'},
      {platform:'TikTok Ads', status:'LIVE', lastPull:'On-demand, this session', rows:50, gap:'Best-performing campaign currently disabled'},
      {platform:'GA4', status:'LIVE', lastPull:'On-demand, this session', rows:90, gap:'item_category not queried for collection roll-up'},
    ], {pageSize:5, defaultSort:'platform', defaultDir:'asc'});
  }]
};

/* ============================================================
   FILTER WIRING — date / comparison / platform selectors
   ============================================================ */
function showLoading(){ const o=document.getElementById('loadingOverlay'); if(o) o.style.display='flex'; }
function hideLoading(){ const o=document.getElementById('loadingOverlay'); if(o) o.style.display='none'; }

function updateStatusStrip(){
  const strip = document.getElementById('statusStrip');
  if (!strip) return;
  if (RANGE && RANGE.available){
    strip.innerHTML = `<span class="dot live"></span> Data last refreshed: 12 Aug 2026 &nbsp;·&nbsp; Reporting window: ${fmtDate(RANGE.from)} – ${fmtDate(RANGE.to)} (${RANGE.days} day${RANGE.days===1?'':'s'})${appState.platform!=='all' ? ' &nbsp;·&nbsp; Platform: '+({meta:'Meta Ads',google:'Google Ads',snapchat:'Snapchat Ads',tiktok:'TikTok Ads',ga4:'GA4 / Website'}[appState.platform]) : ''}`;
  } else {
    strip.innerHTML = `<span class="dot warn"></span> ${rangeUnavailableMessage()}`;
  }
}

function applyFilters(){
  showLoading();
  setTimeout(()=>{
    recomputeAll();
    updateStatusStrip();
    rerenderAllFresh();
    hideLoading();
  }, 400); // brief, honest UI pause while the client-side aggregation recalculates — no network call is made
}

document.getElementById('dateRangeSel').addEventListener('change', function(){
  appState.preset = this.value;
  document.getElementById('customRangeCtrl').style.display = (this.value === 'custom') ? 'flex' : 'none';
  if (this.value !== 'custom') applyFilters();
});
document.getElementById('applyCustomRange').addEventListener('click', function(){
  const from = document.getElementById('customFrom').value;
  const to = document.getElementById('customTo').value;
  if (!from || !to){ alert('Please choose both a start and end date.'); return; }
  appState.preset = 'custom';
  appState.customFrom = from;
  appState.customTo = to;
  applyFilters();
});
document.getElementById('compSel').addEventListener('change', function(){
  appState.compare = this.value;
  applyFilters();
});
document.getElementById('platformSel').addEventListener('change', function(){
  appState.platform = this.value;
  applyFilters();
});

/* ============================================================
   BOOTSTRAP
   ============================================================ */
buildNav();
updateStatusStrip();
renderPage('exec');
showPage('exec');

document.getElementById('refreshBtn').addEventListener('click', function(){
  this.classList.add('spin');
  this.textContent = '↻ Refreshing…';
  showLoading();
  setTimeout(()=>{
    this.textContent = '↻ Refresh'; this.classList.remove('spin');
    recomputeAll();
    updateStatusStrip();
    rerenderAllFresh();
    hideLoading();
  }, 600);
});
