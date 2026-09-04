/**
 * 210LoliPhim Auth Service
 * Manages user accounts in localStorage (same pattern as movieService.js)
 * Passwords are hashed with SHA-256 via Web Crypto API before storage.
 */

const STORAGE_KEY = '210loliphim_accounts_db';
const SESSION_KEY = '210loliphim_current_session';

// --- SHA-256 Hashing via Web Crypto API ---
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Default Seeded Accounts (created on first run) ---
const SEED_ACCOUNTS = [
  {
    username: 'admin',
    password: 'admin123',
    role: 'admin',
    age: 25,
    displayName: '210LoliPhim Admin',
    createdAt: '2025-01-01T00:00:00.000Z'
  },
  {
    username: 'khale',
    password: 'khale2k5kk',
    role: 'user',
    age: 18,
    displayName: 'Khale',
    createdAt: '2025-06-15T00:00:00.000Z'
  }
];

// --- Internal Helpers ---
function getAccountsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('[AuthService] Failed to parse accounts DB:', e);
  }
  return null;
}

function saveAccountsToStorage(accounts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}

// --- Initialize: Seed default accounts if DB is empty ---
export async function initAccounts() {
  const existing = getAccountsFromStorage();
  if (existing && existing.length > 0) return existing;

  // First run: hash passwords and seed
  const seeded = [];
  for (const account of SEED_ACCOUNTS) {
    const hashedPw = await hashPassword(account.password);
    seeded.push({
      username: account.username,
      passwordHash: hashedPw,
      role: account.role,
      age: account.age,
      displayName: account.displayName,
      createdAt: account.createdAt
    });
  }
  saveAccountsToStorage(seeded);
  console.log('[AuthService] Seeded default accounts: admin, khale');
  return seeded;
}

// --- Login ---
export async function login(username, password) {
  const accounts = getAccountsFromStorage();
  if (!accounts || accounts.length === 0) {
    throw new Error('Hệ thống chưa có tài khoản nào. Vui lòng thử lại.');
  }

  const trimmedUsername = username.trim().toLowerCase();
  const account = accounts.find(
    a => a.username.toLowerCase() === trimmedUsername
  );

  if (!account) {
    throw new Error('Tên đăng nhập không tồn tại.');
  }

  const hashedInput = await hashPassword(password);
  if (hashedInput !== account.passwordHash) {
    throw new Error('Mật khẩu không chính xác.');
  }

  // Save session
  const session = {
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    age: account.age
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));

  return session;
}

// --- Register ---
export async function register(username, age, password) {
  const accounts = getAccountsFromStorage() || [];

  const trimmedUsername = username.trim();
  if (!trimmedUsername || trimmedUsername.length < 3) {
    throw new Error('Tên đăng nhập phải có ít nhất 3 ký tự.');
  }

  // Check for invalid characters
  if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
    throw new Error('Tên đăng nhập chỉ được chứa chữ cái, số và dấu gạch dưới.');
  }

  // Check duplicate
  const exists = accounts.find(
    a => a.username.toLowerCase() === trimmedUsername.toLowerCase()
  );
  if (exists) {
    throw new Error('Tên đăng nhập này đã được sử dụng.');
  }

  // Validate age
  const parsedAge = parseInt(age, 10);
  if (isNaN(parsedAge) || parsedAge < 1 || parsedAge > 120) {
    throw new Error('Tuổi phải là số từ 1 đến 120.');
  }

  // Validate password
  if (!password || password.length < 6) {
    throw new Error('Mật khẩu phải có ít nhất 6 ký tự.');
  }

  const hashedPw = await hashPassword(password);

  const newAccount = {
    username: trimmedUsername,
    passwordHash: hashedPw,
    role: 'user', // New accounts always start as 'user'
    age: parsedAge,
    displayName: trimmedUsername,
    createdAt: new Date().toISOString()
  };

  accounts.push(newAccount);
  saveAccountsToStorage(accounts);
  console.log(`[AuthService] New account registered: ${trimmedUsername}`);

  return newAccount;
}

// --- Logout ---
export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

// --- Get Current Session (for persistent login) ---
export function getCurrentSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const session = JSON.parse(raw);
      if (session && session.username) return session;
    }
  } catch (e) {
    console.warn('[AuthService] Failed to parse session:', e);
  }
  return null;
}

// --- Get all accounts (admin use) ---
export function getAllAccounts() {
  return getAccountsFromStorage() || [];
}
