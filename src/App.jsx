import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import AppRouter from './routers/AppRouter';
import CineSmartAIBot from './components/ui/CineSmartAIBot';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRouter />
        <CineSmartAIBot />
      </AuthProvider>
    </BrowserRouter>
  );
}


export default App;
