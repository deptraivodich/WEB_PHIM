import React from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AppRouter from './routers/AppRouter';
import CineSmartAIBot from './components/ui/CineSmartAIBot';
import DataStatus from './components/common/DataStatus';
function AppContent() {
  const location = useLocation();
  const { currentUser } = useAuth();
  const isAdmin = location.pathname.startsWith('/admin');
  return <><AppRouter /><DataStatus />{!isAdmin && currentUser && <CineSmartAIBot key={currentUser.id} />}</>;
}
export default function App() {
  return <BrowserRouter><AuthProvider><AppContent /></AuthProvider></BrowserRouter>;
}
