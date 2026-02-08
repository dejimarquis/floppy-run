// Azure SWA Function: POST /api/track
// Receives game telemetry events and forwards to Application Insights
const appInsights = require('applicationinsights');

let client = null;

function getClient() {
  if (!client) {
    const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    if (!connectionString) {
      console.warn('APPLICATIONINSIGHTS_CONNECTION_STRING not set');
      return null;
    }
    appInsights.setup(connectionString).setAutoCollectRequests(false).setAutoCollectPerformance(false).setAutoCollectExceptions(false).setAutoCollectDependencies(false).setAutoCollectConsole(false).start();
    client = appInsights.defaultClient;
  }
  return client;
}

module.exports = async function (context, req) {
  // Only accept POST
  if (req.method !== 'POST') {
    context.res = { status: 405, body: 'Method not allowed' };
    return;
  }

  const { game, event, duration, metadata } = req.body || {};
  
  if (!game || !event) {
    context.res = { status: 400, body: 'Missing required fields: game, event' };
    return;
  }

  const aiClient = getClient();
  if (aiClient) {
    aiClient.trackEvent({
      name: `game_${event}`,
      properties: {
        game,
        event,
        duration: duration?.toString(),
        ...metadata
      }
    });
  }

  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: { ok: true }
  };
};
