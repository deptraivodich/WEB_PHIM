import { api } from './api.js';
export const ALLOWED_ACTIONS = new Set(['click_poster', 'view_detail', 'play', 'pause', 'seek', 'heartbeat', 'search', 'complete']);
export function telemetryPayload({ movieId, actionType, watchTime = 0, videoQuality = '' }, eventId = crypto.randomUUID()) {
  const action = actionType === 'click' ? 'click_poster' : actionType;
  if (!movieId || !ALLOWED_ACTIONS.has(action)) return null;
  return { event_id: eventId, movie_id: String(movieId), action_type: action,
    watch_time: Math.max(0, Math.min(3600, Math.floor(watchTime))), video_quality: videoQuality };
}
export async function trackEvent(event) {
  const payload = telemetryPayload(event);
  if (!payload) return false;
  try {
    await api('/api/track', { method: 'POST', body: payload, keepalive: true });
    return true;
  } catch {
    // No unbounded browser queue. The caller may inspect false; no fake success.
    window.dispatchEvent(new Event('webphim-telemetry-failed'));
    return false;
  }
}
