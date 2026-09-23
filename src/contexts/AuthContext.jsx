import React, { createContext, useContext, useState, useEffect } from 'react';
import { login as authLogin, register as authRegister, logout as authLogout, restoreSession, clearSession } from '../services/authService';
const AuthContext = createContext();
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth requires AuthProvider');
  return context;
};
export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const expire = () => { clearSession(); setCurrentUser(null); };
    window.addEventListener('webphim-session-expired', expire);
    restoreSession().then(user => { if (active) setCurrentUser(user); })
      .catch(() => { if (active) setCurrentUser(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.removeEventListener('webphim-session-expired', expire); };
  }, []);
  const login = async (username, password) => {
    const user = await authLogin(username, password);
    setCurrentUser(user);
    return user;
  };
  const logout = async () => {
    await authLogout();
    setCurrentUser(null);
  };
  const userRole = currentUser?.role || 'guest';
  return <AuthContext.Provider value={{
    currentUser, loading, userRole, isAdmin: userRole === 'admin',
    isUser: Boolean(currentUser), login, logout, register: authRegister
  }}>{children}</AuthContext.Provider>;
};
