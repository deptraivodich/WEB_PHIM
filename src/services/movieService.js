import { api } from './api.js';
const STORAGE_KEY = '210loliphim_movies_db';
const LEGACY_KEY = '210loliphim_legacy_movies_backup';
export const sanitizeFirestoreData = data => JSON.parse(JSON.stringify(data));
export const getStoredMovies = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem('cobephim_movies_db') || '[]'); }
  catch { return []; }
};
export const saveStoredMovies = movies => {
  try {
    if (!localStorage.getItem(LEGACY_KEY)) localStorage.setItem(LEGACY_KEY, JSON.stringify(getStoredMovies()));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(movies));
  } catch { /* Cache is optional. Server result is authoritative. */ }
};
export const getMovies = async () => {
  const movies = [];
  let cursor = '';
  do {
    const page = await api('/api/movies?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    movies.push(...page.movies);
    cursor = page.next_cursor;
  } while (cursor);
  const unique = [...new Map(movies.map(m => [m.id, m])).values()];
  unique.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  saveStoredMovies(unique);
  return unique;
};
export async function getMovieById(id) {
  if (!id) return null;
  try { return await api('/api/catalog/' + encodeURIComponent(id)); }
  catch (error) { if (error.status === 404) return null; throw error; }
}
export async function stableMovieId(movie) {
  const identity = [movie.title, movie.originalTitle, movie.year].map(v => String(v || '').trim().toLowerCase()).join('|');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return 'm_' + [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function notify() { window.dispatchEvent(new Event('210loliphim_movies_updated')); }
export const addMovie = async data => {
  const id = data.id || await stableMovieId(data);
  const result = await api('/api/catalog/' + encodeURIComponent(id), {
    method: 'POST', body: sanitizeFirestoreData({ ...data, status: data.status || 'ongoing' })
  });
  notify();
  return result;
};
export const updateMovie = async (id, data) => {
  // Callers pass the revision they reviewed. Never silently overwrite a newer revision.
  const result = await api('/api/catalog/' + encodeURIComponent(id), { method: 'PUT', body: sanitizeFirestoreData(data) });
  notify();
  return result;
};
export const deleteMovie = async id => {
  await api('/api/catalog/' + encodeURIComponent(id), { method: 'DELETE' });
  notify();
  return true;
};
export const getHomepageLayout = () => api('/api/settings/homepage');
export const saveHomepageLayout = data => api('/api/settings/homepage', { method: 'PUT', body: data });
export const syncAllLocalMoviesToCloud = async () => {
  const movies = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null') || getStoredMovies();
  let count = 0;
  for (let i = 0; i < movies.length; i += 25) {
    const result = await api('/api/movies/sync', { method: 'POST', body: { movies: movies.slice(i, i + 25) } });
    count += result.synced_count;
  }
  notify();
  return { success: true, count };
};
