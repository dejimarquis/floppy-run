// Lightweight telemetry - respects privacy, no PII
// Sends to Azure Application Insights or custom endpoint

const TELEMETRY_ENDPOINT = window.PIXELDUST_TELEMETRY_ENDPOINT || null;
const SESSION_ID = crypto.randomUUID();

// Track page view
function trackPageView() {
  track('pageview', {
    path: window.location.pathname,
    referrer: document.referrer || null
  });
}

// Track game start
export function trackGameStart(gameId) {
  track('game_start', { gameId });
}

// Track game session duration
export function trackGameEnd(gameId, durationMs) {
  track('game_end', { 
    gameId, 
    durationMs,
    durationMin: Math.round(durationMs / 60000)
  });
}

// Core tracking function
function track(event, data = {}) {
  if (!TELEMETRY_ENDPOINT) {
    console.debug('[telemetry]', event, data);
    return;
  }

  const payload = {
    event,
    sessionId: SESSION_ID,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    ...data
  };

  // Use sendBeacon for reliability
  if (navigator.sendBeacon) {
    navigator.sendBeacon(TELEMETRY_ENDPOINT, JSON.stringify(payload));
  } else {
    fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {});
  }
}

// DAU/MAU: tracked server-side by sessionId per day/month

// Init
if (typeof window !== 'undefined') {
  trackPageView();
  
  // Track when user leaves
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      track('session_end');
    }
  });
}
