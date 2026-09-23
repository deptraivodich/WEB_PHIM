import { generateSlug } from './slugUtils.js';
export function resolveMovie(movies, target) {
  if (!target) return null;
  const byId = movies.find(m => String(m.id) === String(target));
  if (byId) return byId;
  const matches = movies.filter(m => m.slug === target || generateSlug(m.title) === target || generateSlug(m.originalTitle) === target);
  return matches.length === 1 ? matches[0] : null;
}
export const episodeKey = value => String(value ?? '').replace(/^tap-?/i, '').trim();
export function resolveEpisode(episodes, requested, explicit = true) {
  if (!explicit) return episodes[0] || null;
  return episodes.find(ep => episodeKey(ep.name || ep.number) === episodeKey(requested)) || null;
}
