import { load } from 'cheerio';

export const calendarSource = 'https://www.nyse.com/markets/hours-calendars';
const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function dateKey(month: string, day: string, year: number) {
  const m = months.indexOf(month) + 1;
  if (!m || +day < 1 || +day > 31) throw new Error('Invalid calendar date');
  return `${year}-${String(m).padStart(2,'0')}-${day.padStart(2,'0')}`;
}
export function parseCalendar(html: string) {
  const $ = load(html);
  const table = $('table').filter((_, el) => $(el).find('th').first().text().trim() === 'Holiday').first();
  const years = table.find('thead th').slice(1).map((_, el) => Number($(el).text().trim())).get();
  if (!years.length || years.some(y => y < 2020 || y > 2200)) throw new Error('Calendar format changed');
  const holidays: Record<string,string> = {};
  table.find('tbody tr').each((_, row) => {
    const name = $(row).find('th').text().trim();
    const cells = $(row).find('td');
    if (!name || cells.length !== years.length) throw new Error('Invalid holiday row');
    cells.each((i, cell) => {
      const text = $(cell).text().trim();
      const match = text.match(/([A-Z][a-z]+) (\d{1,2})/);
      if (match) holidays[dateKey(match[1],match[2],years[i])] = name;
      else if (!text.startsWith('—')) throw new Error('Unrecognized holiday');
    });
  });
  if (Object.keys(holidays).length < years.length * 8) throw new Error('Incomplete calendar');
  const earlyCloses: Record<string,number> = {};
  $('p').each((_, el) => {
    const text = $(el).text();
    if (!text.includes('Each market will close early')) return;
    const time = text.match(/close early at (\d{1,2}):(\d{2}) p\.m\./);
    const dates = [...text.split('. NYSE')[0].matchAll(/([A-Z][a-z]+) (\d{1,2}), (\d{4})/g)];
    if (!time || !dates.length) throw new Error('Unrecognized early close');
    for (const d of dates) earlyCloses[dateKey(d[1],d[2],+d[3])] = (+time[1] % 12 + 12) * 60 + +time[2];
  });
  if (!Object.keys(earlyCloses).length) throw new Error('Missing early closes');
  return { years, holidays, earlyCloses };
}
// Resolve the exchange's local wall time with IANA DST rules, never a fixed UTC offset.
export function easternInstant(date: string, minutes: number) {
  const wall = Date.parse(`${date}T${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', timeZoneName:'longOffset' }).formatToParts(wall);
  const offset = parts.find(p => p.type === 'timeZoneName')!.value.match(/GMT([+-])(\d{2}):(\d{2})/)!;
  const delta = (+offset[2]*60 + +offset[3]) * (offset[1] === '-' ? -1 : 1);
  return new Date(wall-delta*60000).toISOString();
}
export function createSchedule(calendar: ReturnType<typeof parseCalendar>, now: Date) {
  const currentDate = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const start = Date.parse(`${currentDate}T00:00:00Z`);
  const days = [];
  for (let i = 0; i < 16; i++) {
    const d = new Date(start+i*86400000), date = d.toISOString().slice(0,10);
    if (!calendar.years.includes(d.getUTCFullYear())) throw new Error('Calendar coverage expired');
    const holiday = calendar.holidays[date] || null;
    const closed = !!holiday || [0,6].includes(d.getUTCDay());
    days.push({ date, holiday, open: closed ? null : easternInstant(date,570), close: closed ? null : easternInstant(date,calendar.earlyCloses[date] ?? 960), early: !closed && !!calendar.earlyCloses[date] });
  }
  return days;
}
