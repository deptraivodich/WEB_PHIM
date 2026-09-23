import { api, setCsrfToken } from './api.js';
let session = null;
function accept(data) {
  session = data.user;
  setCsrfToken(data.csrf_token);
  return session;
}
export async function restoreSession() {
  try { return accept(await api('/api/auth/me')); }
  catch (error) {
    session = null;
    setCsrfToken(null);
    if (error.status === 401) return null;
    throw error;
  }
}
export const getCurrentSession = () => session;
export async function login(username, password) {
  return accept(await api('/api/auth/login', { method: 'POST', body: { username, password } }));
}
export async function register(username, age, password) {
  return api('/api/auth/register', { method: 'POST', body: { username, age: Number(age), password } });
}
export async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); }
  catch (error) { if (error.status !== 401) throw error; }
  session = null;
  setCsrfToken(null);
}
export const getAllAccounts = () => api('/api/auth/users');
export function clearSession() { session = null; setCsrfToken(null); }
