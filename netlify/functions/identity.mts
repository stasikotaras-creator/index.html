import type { UserValidateEvent } from '@netlify/functions';
export default {
  userValidate(event: UserValidateEvent) {
    const owner = Netlify.env.get('NOTIFICATION_OWNER_EMAIL')?.trim().toLowerCase();
    if (!owner || event.user.email?.toLowerCase() !== owner) return event.deny();
  },
};
