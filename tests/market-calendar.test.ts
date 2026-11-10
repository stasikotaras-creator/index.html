import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendar, createSchedule, easternInstant } from '../lib/market-calendar.js';

test('New York daylight saving converts sessions correctly for Brisbane', () => {
  assert.equal(easternInstant('2026-03-06',570),'2026-03-06T14:30:00.000Z');
  assert.equal(easternInstant('2026-03-09',570),'2026-03-09T13:30:00.000Z');
  assert.equal(easternInstant('2026-11-02',960),'2026-11-02T21:00:00.000Z');
  assert.equal(easternInstant('2026-11-27',780),'2026-11-27T18:00:00.000Z');
});
test('schedule preserves holidays, weekends and early closes across New York date boundary', () => {
  const days = createSchedule({years:[2026], holidays:{'2026-11-26':'Thanksgiving Day'},earlyCloses:{'2026-11-27':780}},new Date('2026-11-26T02:00:00Z'));
  assert.equal(days[0].date,'2026-11-25');
  assert.equal(days[1].holiday,'Thanksgiving Day');
  assert.equal(days[1].open,null);
  assert.equal(days[2].close,'2026-11-27T18:00:00.000Z');
  assert.equal(days[2].early,true);
  assert.equal(days[3].open,null);
  assert.equal(days[4].open,null);
});
test('unsupported years and malformed official responses fail closed', () => {
  assert.throws(() => parseCalendar('<html>Unavailable</html>'));
  assert.throws(() => createSchedule({years:[2026],holidays:{},earlyCloses:{}},new Date('2027-01-01T12:00:00Z')));
});
