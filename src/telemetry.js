// Azure Application Insights telemetry
// Docs: https://learn.microsoft.com/en-us/azure/azure-monitor/app/javascript-sdk

let appInsights = null;

// Initialize App Insights (call once on page load)
export function initTelemetry() {
  const connectionString = window.FLOPPY_APPINSIGHTS_CONNECTION_STRING;
  
  if (!connectionString) {
    console.debug('[telemetry] No connection string configured, running in debug mode');
    return;
  }

  // Load the App Insights SDK dynamically
  const script = document.createElement('script');
  script.src = 'https://js.monitor.azure.com/scripts/b/ai.3.gbl.min.js';
  script.crossOrigin = 'anonymous';
  script.onload = () => {
    const cfg = {
      connectionString,
      enableAutoRouteTracking: true,
      enableCorsCorrelation: true,
      enableRequestHeaderTracking: true,
      enableResponseHeaderTracking: true,
      disableFetchTracking: false,
      disableAjaxTracking: false
    };

    // @ts-ignore
    appInsights = new window.Microsoft.ApplicationInsights.ApplicationInsights({ config: cfg });
    appInsights.loadAppInsights();
    appInsights.trackPageView();
    
    console.debug('[telemetry] App Insights initialized');
  };
  
  document.head.appendChild(script);
}

// Track custom events
export function trackEvent(name, properties = {}) {
  if (appInsights) {
    appInsights.trackEvent({ name }, properties);
  } else {
    console.debug('[telemetry]', name, properties);
  }
}

// Track game start
export function trackGameStart(gameId, gameTitle) {
  trackEvent('game_start', { gameId, gameTitle });
}

// Track game end with duration
export function trackGameEnd(gameId, gameTitle, durationMs) {
  trackEvent('game_end', { 
    gameId, 
    gameTitle,
    durationMs,
    durationMinutes: Math.round(durationMs / 60000)
  });
}

// Track metrics (e.g., game session length)
export function trackMetric(name, value, properties = {}) {
  if (appInsights) {
    appInsights.trackMetric({ name, average: value }, properties);
  } else {
    console.debug('[telemetry] metric:', name, value, properties);
  }
}

// Initialize on module load
if (typeof window !== 'undefined') {
  initTelemetry();
}
