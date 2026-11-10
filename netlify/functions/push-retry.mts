import { drain } from '../../lib/notifications.js';
export default async () => { await drain(); };
export const config = { schedule: '* * * * *' };
