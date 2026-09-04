/**
 * 210LoliPhim Watch History Service
 * Stores and manages user watch history in localStorage DB
 * Format: { username, movieId, movieTitle, originalTitle, poster, banner, imdb, year, quality, ageRating, season, episodesStatus, genres, episode, currentTime, duration, progressText, timestamp, watchedAt }
 */

const HISTORY_STORAGE_KEY = '210loliphim_watch_history_db';

// Helper: Format current time as "giờ:phút - ngày/tháng/năm" (e.g. 16:05 - 15/08/2026)
export function formatWatchTime(date = new Date()) {
  const d = new Date(date);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${hours}:${minutes} - ${day}/${month}/${year}`;
}

// Helper: Format seconds to "X phút Y giây" (e.g. 310s -> "5 phút 10 giây")
export function formatDurationToMinutesSeconds(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0 giây';
  const totalSecs = Math.floor(seconds);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs} giây`;
  if (secs === 0) return `${mins} phút`;
  return `${mins} phút ${secs} giây`;
}

// Helper: Read all history from localStorage
function getAllHistoryFromStorage() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('[HistoryService] Failed to read history DB:', e);
  }
  return [];
}

// Helper: Save all history to localStorage
function saveAllHistoryToStorage(historyList) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(historyList));
    // Trigger custom event so other components can react immediately
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('210loliphim_history_updated'));
    }
  } catch (e) {
    console.error('[HistoryService] Failed to save history DB:', e);
  }
}

/**
 * Record or update watch history for a user
 * @param {string} username - User identifier
 * @param {object} movie - Movie object
 * @param {string|number} episode - Current episode watched
 * @param {number} currentTime - Playback position in seconds
 * @param {number} duration - Total video duration in seconds
 */
export function recordWatchHistory(username, movie, episode = '1', currentTime = 0, duration = 0) {
  if (!username || !movie || !movie.id) return;

  const historyList = getAllHistoryFromStorage();
  const movieIdStr = String(movie.id);
  const now = new Date();
  const timestamp = formatWatchTime(now);
  const watchedAt = now.getTime();

  // Find existing record for this user and movie
  const existingIndex = historyList.findIndex(
    item => item.username === username && String(item.movieId) === movieIdStr
  );

  const existing = existingIndex >= 0 ? historyList[existingIndex] : null;

  // Preserve previously recorded currentTime if newly supplied currentTime is 0 and episode matches
  let finalCurrentTime = currentTime;
  let finalDuration = duration;
  if (finalCurrentTime <= 0 && existing && String(existing.episode) === String(episode)) {
    finalCurrentTime = existing.currentTime || 0;
    finalDuration = existing.duration || duration || 0;
  }

  const progressText = finalCurrentTime > 0 ? formatDurationToMinutesSeconds(finalCurrentTime) : '0 giây';

  const historyEntry = {
    id: `${username}_${movieIdStr}`,
    username: username,
    movieId: movieIdStr,
    title: movie.title || 'Phim mới',
    originalTitle: movie.originalTitle || '',
    poster: movie.poster || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600',
    banner: movie.banner || movie.poster || '',
    imdb: movie.imdb || '8.0',
    year: movie.year || '2024',
    quality: movie.quality || '4K UltraHD',
    ageRating: movie.ageRating || 'T16',
    season: movie.season || 'Phần 1',
    episodesStatus: movie.episodesStatus || 'Tập hoàn tất',
    genres: Array.isArray(movie.genres) ? movie.genres : (movie.genres ? [movie.genres] : ['Phim bộ']),
    episode: String(episode),
    currentTime: Math.floor(finalCurrentTime),
    duration: Math.floor(finalDuration),
    progressText: progressText,
    timestamp: timestamp,
    watchedAt: watchedAt
  };

  if (existingIndex >= 0) {
    historyList[existingIndex] = historyEntry;
  } else {
    historyList.push(historyEntry);
  }

  saveAllHistoryToStorage(historyList);
}

/**
 * Update playback position in history for current movie & episode
 */
export function updateWatchPlaybackPosition(username, movieId, episode, currentTime, duration = 0) {
  if (!username || !movieId) return;
  const historyList = getAllHistoryFromStorage();
  const movieIdStr = String(movieId);
  const existingIndex = historyList.findIndex(
    item => item.username === username && String(item.movieId) === movieIdStr
  );

  if (existingIndex >= 0) {
    const item = historyList[existingIndex];
    const now = new Date();
    item.episode = String(episode);
    item.currentTime = Math.floor(currentTime);
    item.duration = Math.floor(duration);
    item.progressText = formatDurationToMinutesSeconds(currentTime);
    item.timestamp = formatWatchTime(now);
    item.watchedAt = now.getTime();
    saveAllHistoryToStorage(historyList);
  }
}

/**
 * Get history record for a specific user, movie and episode
 */
export function getMovieHistory(username, movieId) {
  if (!username || !movieId) return null;
  const historyList = getAllHistoryFromStorage();
  return historyList.find(
    item => item.username === username && String(item.movieId) === String(movieId)
  ) || null;
}

/**
 * Get watch history for a specific user, sorted from newest to oldest
 * @param {string} username 
 * @returns {Array} List of watch history items
 */
export function getUserWatchHistory(username) {
  if (!username) return [];
  const historyList = getAllHistoryFromStorage();
  return historyList
    .filter(item => item.username === username)
    .sort((a, b) => (b.watchedAt || 0) - (a.watchedAt || 0));
}

/**
 * Delete a single history item for a user
 * @param {string} username 
 * @param {string} movieId 
 */
export function deleteHistoryItem(username, movieId) {
  if (!username || !movieId) return;
  const historyList = getAllHistoryFromStorage();
  const updated = historyList.filter(
    item => !(item.username === username && String(item.movieId) === String(movieId))
  );
  saveAllHistoryToStorage(updated);
}

/**
 * Clear entire watch history for a user
 * @param {string} username 
 */
export function clearUserWatchHistory(username) {
  if (!username) return;
  const historyList = getAllHistoryFromStorage();
  const updated = historyList.filter(item => item.username !== username);
  saveAllHistoryToStorage(updated);
}
