const elements = Object.fromEntries(['marketState','marketCountdown','marketEvent','marketOpen','marketClose','marketDetail'].map(id => [id,document.getElementById(id)]));
let schedule, lastSync = 0, fetching = false;
const brisbane = new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true});
const newYorkDate = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
function unavailable() {
  elements.marketState.textContent = 'UNAVAILABLE';
  elements.marketState.dataset.state = '';
  elements.marketCountdown.textContent = '—';
  elements.marketEvent.textContent = 'Calendar unavailable';
  elements.marketOpen.textContent = '—';
  elements.marketClose.textContent = '—';
  elements.marketDetail.textContent = 'Cannot verify exchange hours. Retrying automatically.';
}
function tick() {
  const now = Date.now();
  if (!schedule || now-lastSync > 15*60000) { unavailable(); return; }
  const today = schedule.find(d => d.date === newYorkDate.format(now));
  const active = schedule.find(d => d.open && Date.parse(d.open) <= now && now < Date.parse(d.close));
  const next = schedule.find(d => d.open && Date.parse(d.open) > now);
  const session = active || next;
  if (!today || !session) { unavailable(); return; }
  const state = active ? 'OPEN' : today.holiday ? 'HOLIDAY' : 'CLOSED';
  elements.marketState.textContent = state;
  elements.marketState.dataset.state = state;
  elements.marketEvent.textContent = active ? 'Market closes in' : 'Market opens in';
  const remaining = Math.max(0,Math.ceil((Date.parse(active ? session.close : session.open)-now)/1000));
  const hours = Math.floor(remaining/3600);
  elements.marketCountdown.textContent = `${String(hours).padStart(2,'0')}:${String(Math.floor(remaining%3600/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
  elements.marketOpen.textContent = brisbane.format(new Date(session.open));
  elements.marketClose.textContent = brisbane.format(new Date(session.close));
  elements.marketDetail.textContent = [today.holiday ? `${today.holiday} · New York date` : active ? 'Current regular session' : 'Next regular session', session.early ? 'Early close' : '', 'Brisbane · AEST (UTC+10)'].filter(Boolean).join(' · ');
}
async function sync() {
  if (fetching) return;
  fetching = true;
  try {
    const response = await fetch('/.netlify/functions/market-calendar');
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!Array.isArray(data.days) || !data.days.length || Date.now()-Date.parse(data.generatedAt) > 15*60000) throw new Error();
    schedule = data.days;
    lastSync = Date.now();
  } catch { if (!lastSync || Date.now()-lastSync > 15*60000) unavailable(); }
  finally { fetching = false; tick(); }
}
sync();
setInterval(tick,1000);
setInterval(sync,60000);
document.addEventListener('visibilitychange',() => { if (!document.hidden) { tick(); sync(); } });
