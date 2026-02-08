// Analytics client — sends events to /api/track
const ENDPOINT = '/api/track';

interface TrackEvent {
  game: string;
  event: 'start' | 'complete' | 'quit' | 'error';
  duration?: number;
  metadata?: Record<string, string>;
}

export async function trackEvent(data: TrackEvent): Promise<void> {
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {
    // Analytics should never break the game — silently fail
  }
}

// Helper: track game session duration
export function createSessionTracker(game: string) {
  const startTime = performance.now();
  trackEvent({ game, event: 'start' });
  
  return {
    complete() {
      const duration = Math.round((performance.now() - startTime) / 1000);
      trackEvent({ game, event: 'complete', duration });
    },
    quit() {
      const duration = Math.round((performance.now() - startTime) / 1000);
      trackEvent({ game, event: 'quit', duration });
    },
  };
}
