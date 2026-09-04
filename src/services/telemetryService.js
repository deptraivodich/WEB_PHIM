const TELEMETRY_API_URL = import.meta.env.VITE_TELEMETRY_API_URL || 'http://localhost:8000/api/track';

/**
 * Retrieve or generate a unique Session ID for the user's browser session.
 */
const getSessionId = () => {
  try {
    let sessionId = sessionStorage.getItem('webphim_telemetry_session');
    if (!sessionId) {
      sessionId = 'sess_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
      sessionStorage.setItem('webphim_telemetry_session', sessionId);
    }
    return sessionId;
  } catch (e) {
    return 'sess_fallback_' + Date.now();
  }
};

/**
 * Send Big Data Telemetry Event to FastAPI + ClickHouse Ingestion Service.
 * Uses navigator.sendBeacon for zero-latency, non-blocking delivery.
 * 
 * @param {Object} params
 * @param {string} [params.userId='anonymous'] - ID or email of current user
 * @param {string} params.movieId - ID of the movie being interacted with
 * @param {string} params.actionType - Action: 'click_poster' | 'view_detail' | 'play' | 'pause' | 'seek' | 'heartbeat' | 'search' | 'complete'
 * @param {number} [params.watchTime=0] - Cumulative watch time in seconds
 * @param {string} [params.videoQuality=''] - Video resolution e.g. '1080p', '4K'
 * @param {string} [params.deviceType='web'] - Client device
 */
export const trackEvent = async ({
  userId = 'anonymous',
  movieId,
  actionType,
  watchTime = 0,
  videoQuality = '',
  deviceType = 'web'
}) => {
  if (!movieId || !actionType) return;

  const payload = {
    user_id: String(userId),
    session_id: getSessionId(),
    movie_id: String(movieId),
    action_type: actionType,
    watch_time: Math.max(0, Math.round(Number(watchTime) || 0)),
    video_quality: String(videoQuality || ''),
    device_type: String(deviceType || 'web')
  };

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(TELEMETRY_API_URL, blob);
    } else {
      fetch(TELEMETRY_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(err => console.warn('[Telemetry] Send failed:', err.message));
    }
  } catch (e) {
    // Non-blocking catch to ensure telemetry never impacts UI execution
  }
};
