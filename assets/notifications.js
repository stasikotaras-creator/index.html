import { login, signup, logout, getUser, getSettings, handleAuthCallback, acceptInvite, updateUser, requestPasswordRecovery } from '@netlify/identity';
const el = id => document.getElementById(id);
let subscriptionId = null, inviteToken = null, recovery = false;
const status = text => { el('push-status').textContent = text; };
async function api(body) {
  const res = await fetch('/api/notifications', { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Notifications unavailable.');
  return data;
}
async function refresh() {
  const user = await getUser();
  el('push-login').hidden = !!user && !recovery;
  el('push-controls').hidden = !user;
  if (!user) { status('Sign in with your owner email to manage notifications.'); return; }
  const data = await api();
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.register('/sw.js') : null;
  const local = await registration?.pushManager.getSubscription();
  // Server assigns IDs. Match via a device-local ID, never store subscription secrets separately.
  subscriptionId = localStorage.getItem('revel-push-id');
  if (!local || !data.subscriptions.some(s => s.id === subscriptionId)) subscriptionId = null;
  el('push-test').disabled = !subscriptionId;
  el('push-history').replaceChildren();
  for (const entry of data.history) {
    const li = document.createElement('li');
    li.textContent = `${new Date(entry.createdAt).toLocaleString()} · ${entry.payload.title} · ${entry.status || 'No enrolled device at event time'}${entry.attempts ? ` (${entry.attempts} attempt${entry.attempts === 1 ? '' : 's'})` : ''}`;
    const detail = document.createElement('p'); detail.className = 'note'; detail.textContent = entry.payload.body; li.append(detail);
    el('push-history').append(li);
  }
  if (!data.history.length) el('push-history').textContent = 'No notification events yet.';
  status(subscriptionId ? 'Notifications enabled on this device. “Sent” means accepted by the push service, not confirmed on screen.' : 'Signed in. Enable notifications on this device.');
  el('push-enable').dataset.key = data.publicKey;
}
function action(id, fn) { el(id).addEventListener('click', async () => { el(id).disabled = true; try { await fn(); } catch (err) { status(err.message); } finally { el(id).disabled = false; } }); }
action('push-signin', async () => {
  const email = el('push-email').value, password = el('push-password').value;
  if (inviteToken) { await acceptInvite(inviteToken, password); inviteToken = null; }
  else if (recovery) { await updateUser({ password }); recovery = false; }
  else await login(email, password);
  el('push-password').value = ''; await refresh();
});
action('push-signup', async () => { await signup(el('push-email').value, el('push-password').value); el('push-password').value = ''; status('Check your email to confirm your owner account, then sign in.'); });
action('push-recover', async () => { await requestPasswordRecovery(el('push-email').value); status('Check your email for a password reset link.'); });
action('push-logout', async () => { await logout(); el('push-history').replaceChildren(); await refresh(); });
action('push-enable', async () => {
  if (!('Notification' in window) || !('PushManager' in window)) throw new Error('On iPhone, use iOS 16.4 or later: Safari → Share → Add to Home Screen, then open the installed app.');
  // Permission request starts directly from this button's user gesture, as required by iOS.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted. Check this app’s notification settings.');
  const registration = await navigator.serviceWorker.ready;
  const key = el('push-enable').dataset.key;
  const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4)), c => c.charCodeAt(0));
  const sub = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  const saved = await api({ action: 'subscribe', subscription: sub.toJSON() });
  localStorage.setItem('revel-push-id', saved.id); await refresh();
});
action('push-disable', async () => {
  await api({ action: 'disable' });
  const registration = await navigator.serviceWorker.getRegistration();
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
  localStorage.removeItem('revel-push-id'); subscriptionId = null;
  await refresh(); status('Notifications revoked for all devices. Other devices must explicitly enable again.');
});
action('push-test', async () => { await api({ action: 'test', subscriptionId }); await refresh(); status('Isolated test queued. Check your notification centre; the portfolio ledger is unchanged.'); });
action('push-refresh', refresh);
(async () => {
  try {
    const callback = await handleAuthCallback();
    if (callback?.type === 'invite') { inviteToken = callback.token; el('push-signin').textContent = 'Accept invite & set password'; }
    if (callback?.type === 'recovery') { recovery = true; el('push-signin').textContent = 'Set new password'; }
    const settings = await getSettings(); el('push-signup').hidden = settings.disableSignup;
    await refresh();
    if (inviteToken) status('Choose a password to accept your owner invitation.');
  } catch (err) { status(err.message + ' Identity login requires a deployed preview.'); }
})();
