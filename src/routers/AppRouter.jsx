import React from 'react';
import { Routes, Route } from 'react-router-dom';
import ClientRouters from './ClientRouters';
import AdminRouters from './AdminRouters';

/**
 * Root Application Router routing between Client and Admin zones
 */
const AppRouter = () => {
  return (
    <Routes>
      {/* Admin Route Scope */}
      <Route path="/admin/*" element={<AdminRouters />} />

      {/* Client Route Scope */}
      <Route path="/*" element={<ClientRouters />} />
    </Routes>
  );
};

export default AppRouter;
