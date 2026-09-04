import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  initAccounts,
  login as authLogin,
  register as authRegister,
  logout as authLogout,
  getCurrentSession
} from '../services/authService';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState('guest');
  const [loading, setLoading] = useState(true);

  // On mount: init accounts DB + restore session
  useEffect(() => {
    const bootstrap = async () => {
      try {
        // Seed default accounts if first run
        await initAccounts();

        // Restore persisted session
        const session = getCurrentSession();
        if (session) {
          setCurrentUser({
            username: session.username,
            displayName: session.displayName,
            age: session.age
          });
          setUserRole(session.role);
        }
      } catch (e) {
        console.warn('[AuthContext] Bootstrap error:', e);
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, []);

  // Login with username + password
  const login = async (username, password) => {
    const session = await authLogin(username, password);
    setCurrentUser({
      username: session.username,
      displayName: session.displayName,
      age: session.age
    });
    setUserRole(session.role);
    return session;
  };

  // Register new account
  const register = async (username, age, password) => {
    const account = await authRegister(username, age, password);
    return account;
  };

  // Logout
  const logout = () => {
    authLogout();
    setCurrentUser(null);
    setUserRole('guest');
  };

  const value = {
    currentUser,
    userRole,
    loading,
    isAdmin: userRole === 'admin',
    isUser: userRole === 'user' || userRole === 'admin',
    login,
    register,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
