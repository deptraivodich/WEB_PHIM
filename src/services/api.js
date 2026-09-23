export const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
let csrfToken = null;
export const setCsrfToken = token => { csrfToken = token; };
export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export async function api(path, { method = 'GET', body, signal, keepalive = false } = {}) {
  const headers = { 'X-Requested-With': 'WEB_PHIM' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const timeout = AbortSignal.timeout(path.includes('auto-update') ? 510000 : path.includes('crawl') ? 115000 : 35000);
  try {
    const response = await fetch(API_BASE + path, {
      method, credentials: 'include', headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal || timeout, keepalive
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        csrfToken = null;
        window.dispatchEvent(new Event('webphim-session-expired'));
      }
      throw new ApiError(typeof data.detail === 'string' ? data.detail : 'Yêu cầu không hợp lệ.', response.status);
    }
    return data;
  } catch (error) {
    if (error.status !== 401 && !path.includes('/track') && !path.includes('/auth/login')) {
      window.dispatchEvent(new CustomEvent('webphim-api-error', {
        detail: error.status ? error.message : 'Không tải được dữ liệu mới. Dữ liệu đang hiển thị có thể đã cũ.'
      }));
    }
    throw error;
  }
}
