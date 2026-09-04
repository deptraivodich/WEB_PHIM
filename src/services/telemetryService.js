export const trackEvent = ({ userId, movieId, actionType, watchTime = 0, videoQuality = '1080p' }) => {
  const url = 'http://localhost:8000/api/track';
  const payload = {
    user_id: userId || 'anonymous',
    movie_id: movieId,
    action_type: actionType,
    watch_time: watchTime,
    video_quality: videoQuality,
    timestamp: new Date().toISOString()
  };

  const data = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    // navigator.sendBeacon requires Blob for application/json
    const blob = new Blob([data], { type: 'application/json' });
    const success = navigator.sendBeacon(url, blob);
    if (success) return;
  }

  // Fallback to fetch with keepalive if sendBeacon fails or is unsupported
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: data,
    keepalive: true
  }).catch(error => {
    console.error('Telemetry track failed:', error);
  });
};
