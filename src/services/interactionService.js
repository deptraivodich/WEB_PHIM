import { api } from './api.js';
const moviePath = id => '/api/movies/' + encodeURIComponent(id);
const notify = () => {
  window.dispatchEvent(new Event('210loliphim_interactions_updated'));
  window.dispatchEvent(new Event('210loliphim_favorites_updated'));
};
export const recordMovieView = movieId => api(moviePath(movieId) + '/view', { method: 'POST' });
export const getMovieStats = movieId => api(moviePath(movieId) + '/stats');
export const toggleMovieLike = async movieId => {
  const current = await getMovieStats(movieId);
  const result = await api(moviePath(movieId) + '/like', { method: 'POST', body: { is_liked: !current.is_liked } });
  notify();
  return result;
};
export const getUserFavorites = async () => (await api('/api/user/me/favorites')).favorites;
export const getLeaderboardTrending = async (limit = 10) => (await api('/api/leaderboard/trending?limit=' + limit)).trending;
export const getTodaySeries = async () => (await api('/api/leaderboard/today-series')).trending;
export const getLeaderboardFavorites = async (limit = 10) => (await api('/api/leaderboard/favorites?limit=' + limit)).favorites;
export const getRecentComments = async (limit = 10) => (await api('/api/comments/latest?limit=' + limit)).comments;
export const getMovieComments = async movieId => {
  const comments = [];
  let offset = 0;
  do {
    const page = await api(moviePath(movieId) + '/comments?offset=' + offset);
    comments.push(...page.comments);
    offset = page.next_offset;
  } while (offset !== null && offset !== undefined);
  return comments;
};
export const addMovieComment = async (movieId, { content }) => {
  const data = await api(moviePath(movieId) + '/comments', { method: 'POST', body: { content } });
  notify();
  return data.comment;
};
export const getAdminStats = () => api('/api/admin/stats');
