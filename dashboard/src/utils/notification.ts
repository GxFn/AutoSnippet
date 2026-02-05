/**
 * 混合通知：页面可见用 toast，不可见用 macOS 右上角系统通知
 */
import { toast } from 'react-hot-toast';

const TITLE = 'AutoSnippet';

function showSystemNotification(body: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;

  const send = () => {
  try {
    new Notification(TITLE, { body, tag: 'autosnippet' });
  } catch (_) {}
  };

  if (Notification.permission === 'granted') {
  send();
  return;
  }
  if (Notification.permission !== 'denied') {
  Notification.requestPermission().then((p) => {
    if (p === 'granted') send();
  });
  }
}

export function notify(body: string, options?: { type?: 'success' | 'error' }) {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
  if (options?.type === 'error') toast.error(body);
  else toast.success(body);
  } else {
  showSystemNotification(body);
  }
}
