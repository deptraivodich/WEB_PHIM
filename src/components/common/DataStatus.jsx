import React, { useEffect, useState } from 'react';
export default function DataStatus() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    const failed = event => setMessage(event.detail);
    window.addEventListener('webphim-api-error', failed);
    return () => window.removeEventListener('webphim-api-error', failed);
  }, []);
  return message ? <div role="alert" className="fixed bottom-4 left-4 right-4 z-[100] bg-amber-950 text-amber-100 border border-amber-500 rounded-xl p-3 text-sm">
    {message} <button type="button" className="ml-3 underline" onClick={() => setMessage('')}>Đóng</button>
  </div> : null;
}
