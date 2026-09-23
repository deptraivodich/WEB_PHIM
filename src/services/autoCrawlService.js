import { api } from './api';
export const isEligibleForAutoUpdate = movie => {
  if (!movie?.id) return false;
  const status = String(movie.status || '').toLowerCase();
  const category = String(movie.category || '').toLowerCase();
  return !['completed', 'hoàn tất', 'hoan tat'].includes(status)
    && movie.type !== 'single' && !movie.chieurap && !category.includes('phim lẻ') && !category.includes('chiếu rạp');
};
export const getAutoUpdateState = () => api('/api/admin/auto-update');
export const configureAutoUpdate = milliseconds => api('/api/admin/auto-update', {
  method: 'PUT', body: { interval_seconds: Math.floor(Number(milliseconds) / 1000) }
});
export const stopAutoUpdate = () => api('/api/admin/auto-update/stop', { method: 'POST' });
export const runAutoUpdateBatch = async batch => {
  const data = await api('/api/movies/auto-update', {
    method: 'POST', body: { movie_ids: batch ? batch.map(movie => movie.id) : null }
  });
  window.dispatchEvent(new Event('210loliphim_movies_updated'));
  return { status: data.status, checkedCount: data.checked_count, updatedCount: data.updated_count,
    updatedMovies: data.updated_movies, checkedDetails: data.checked_details };
};
export const runAutoUpdate = () => runAutoUpdateBatch();
