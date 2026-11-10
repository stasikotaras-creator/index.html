import { calendarSource, parseCalendar, createSchedule } from '../../lib/market-calendar.js';

export default async (request: Request) => {
  if (request.method !== 'GET') return new Response(null, { status:405, headers:{Allow:'GET'} });
  try {
    const upstream = await fetch(calendarSource, { signal: AbortSignal.timeout(12000) });
    if (!upstream.ok) throw new Error('Calendar unavailable');
    const calendar = parseCalendar(await upstream.text());
    const now = new Date();
    return Response.json({ source:calendarSource, generatedAt:now.toISOString(), days:createSchedule(calendar,now) }, {
      headers:{'Cache-Control':'public, max-age=60, s-maxage=300'}
    });
  } catch {
    return Response.json({ error:'Official exchange calendar is temporarily unavailable.' }, {status:503, headers:{'Cache-Control':'no-store'}});
  }
};
