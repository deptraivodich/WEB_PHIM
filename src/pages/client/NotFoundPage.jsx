import React from 'react';
import { Link } from 'react-router-dom';

const NotFoundPage = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-6 space-y-6">
      <h1 className="text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-red to-orange-500 shadow-neon-red">
        404
      </h1>
      <h2 className="text-2xl font-bold text-gray-200">Trang Phim Không Tồn Tại HOẶC Đã Bị Cổ Bể!</h2>
      <p className="text-gray-400 max-w-md text-sm">
        Đường dẫn bạn truy cập có thể đã thay đổi hoặc không có trong hệ thống dữ liệu phim.
      </p>
      <Link 
        to="/"
        className="px-8 py-3 rounded-xl bg-neon-red hover:bg-red-600 text-white font-bold transition-all shadow-neon-red"
      >
        Trở Về Trang Chủ
      </Link>
    </div>
  );
};

export default NotFoundPage;
