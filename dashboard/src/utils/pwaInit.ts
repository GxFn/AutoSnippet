/**
 * PWA 初始化和 Service Worker 注册
 */

export async function initPWA(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] Service Workers not supported');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
    });

    console.log('[PWA] Service Worker registered successfully:', registration);

    // 监听更新
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // 有新版本可用
          console.log('[PWA] New version available');
          // 可以显示更新提示
          notifyUserOfUpdate();
        }
      });
    });

    // 检查更新
    setInterval(() => {
      registration.update();
    }, 60000); // 每 60 秒检查一次

    // 设置离线检测
    window.addEventListener('online', () => {
      console.log('[PWA] Online - resuming sync');
      showOnlineNotification();
    });

    window.addEventListener('offline', () => {
      console.log('[PWA] Offline - data will be synced when online');
      showOfflineNotification();
    });

    // 获取离线页面消息
    navigator.serviceWorker.addEventListener('message', (event) => {
      console.log('[PWA] Message from Service Worker:', event.data);
    });
  } catch (error) {
    console.error('[PWA] Service Worker registration failed:', error);
  }
}

/**
 * 显示更新通知
 */
function notifyUserOfUpdate(): void {
  const message = '应用已更新，刷新页面以获取最新版本？';
  if (confirm(message)) {
    window.location.reload();
  }
}

/**
 * 显示在线通知
 */
function showOnlineNotification(): void {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('AutoSnippet', {
      body: '已重新连接，正在同步数据...',
      icon: '/favicon.ico',
      tag: 'online-notification',
    });
  }
}

/**
 * 显示离线通知
 */
function showOfflineNotification(): void {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('AutoSnippet', {
      body: '当前离线，数据将在重新连接时同步',
      icon: '/favicon.ico',
      tag: 'offline-notification',
    });
  }
}

/**
 * 请求通知权限
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.log('[PWA] Notifications not supported');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission !== 'denied') {
    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (error) {
      console.error('[PWA] Failed to request notification permission:', error);
      return false;
    }
  }

  return false;
}

/**
 * 添加到主屏幕提示
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
  // 显示安装提示
  showInstallPrompt();
});

function showInstallPrompt(): void {
  if (!deferredPrompt) return;

  const message = '将 AutoSnippet 添加到你的主屏幕？';
  if (confirm(message)) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('[PWA] User accepted the install prompt');
      }
      deferredPrompt = null;
    });
  }
}

/**
 * 共享目标 API
 */
export async function handleSharedData(): Promise<void> {
  if (!('launchQueue' in window)) {
    console.log('[PWA] Share Target API not supported');
    return;
  }

  const launchQueue = (window as any).launchQueue;
  if (launchQueue) {
    launchQueue.setConsumer((launchParams: any) => {
      for (const file of launchParams.files || []) {
        console.log('[PWA] Shared file received:', file.name);
      }
    });
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// 自动初始化
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    initPWA();
    handleSharedData();
  });
}
