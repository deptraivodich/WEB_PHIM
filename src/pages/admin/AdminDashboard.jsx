import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import MagicImport from '../../components/admin/MagicImport';
import TrollLogoutModal from '../../components/ui/TrollLogoutModal';
import { Link, useNavigate } from 'react-router-dom';
import dragonLogo from '../../assets/dragon-logo.png';

const AdminDashboard = () => {
  const { currentUser, logout } = useAuth();
  const [isTrollModalOpen, setIsTrollModalOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-gray-100 flex flex-col">
      {/* Admin Header */}
      <header className="h-16 border-b border-glass-border glass-panel px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center space-x-3">
          <Link to="/" className="flex items-center space-x-2.5">
            <img 
              src={dragonLogo} 
              alt="Dragon Logo" 
              className="w-9 h-9 object-contain drop-shadow-[0_0_12px_rgba(255,255,255,0.9)]"
            />
            <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-red to-orange-500">
              210LOLIPHIM
            </span>
          </Link>
          <span className="text-xs text-neon-cyan px-2 py-0.5 rounded bg-neon-cyan/10 border border-neon-cyan/20 font-bold">
            ADMIN PANEL
          </span>
        </div>

        <div className="flex items-center space-x-4">
          <span className="text-xs text-gray-400">Xin chào, <strong className="text-neon-red">{currentUser?.displayName || 'Admin'}</strong></span>
          <button 
            onClick={() => setIsTrollModalOpen(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/40 transition-all cursor-pointer"
          >
            Đăng xuất
          </button>
        </div>
      </header>

      {/* Troll Logout Modal */}
      <TrollLogoutModal
        isOpen={isTrollModalOpen}
        onClose={() => setIsTrollModalOpen(false)}
        onConfirmLogout={() => {
          logout();
          navigate('/login');
        }}
      />

      {/* Main Admin Content */}
      <div className="flex-1 p-6 md:p-10 max-w-7xl w-full mx-auto space-y-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-white">Quản Trị Hệ Thống & Kho Phim</h1>
            <p className="text-gray-400 text-sm mt-1">Nạp phim hàng loạt từ TSV/Excel, quản lý luồng phát m3u8 & kho phim Firebase Firestore.</p>
          </div>

          <div className="flex items-center space-x-3">
            <Link 
              to="/admin/movies" 
              className="px-5 py-2.5 rounded-xl bg-neon-red hover:bg-red-600 text-white font-extrabold text-xs shadow-neon-red transition-all flex items-center gap-2"
            >
              <span>🎬 Quản Lý Danh Sách Phim (Full-CRUD)</span>
            </Link>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-5 glass-panel rounded-xl border-l-4 border-neon-red space-y-1">
            <p className="text-xs text-gray-400 font-semibold uppercase">Tổng Phim Quản Lý</p>
            <p className="text-2xl font-black text-white">1,248</p>
            <Link to="/admin/movies" className="text-[11px] text-neon-red hover:underline block pt-1">Quản lý ngay →</Link>
          </div>
          <div className="p-5 glass-panel rounded-xl border-l-4 border-neon-cyan space-y-1">
            <p className="text-xs text-gray-400 font-semibold uppercase">Luồng KKPhim Active</p>
            <p className="text-2xl font-black text-white">98.5%</p>
            <span className="text-[11px] text-emerald-400 block pt-1">Hoạt động bình thường</span>
          </div>
          <div className="p-5 glass-panel rounded-xl border-l-4 border-amber-500 space-y-1">
            <p className="text-xs text-gray-400 font-semibold uppercase">Lượt Xem Hôm Nay</p>
            <p className="text-2xl font-black text-white">45,210</p>
            <span className="text-[11px] text-amber-400 block pt-1">↑ +14.2% so với hôm qua</span>
          </div>
          <div className="p-5 glass-panel rounded-xl border-l-4 border-emerald-500 space-y-1">
            <p className="text-xs text-gray-400 font-semibold uppercase">Trạng Thái Firestore</p>
            <p className="text-2xl font-black text-emerald-400">Connected</p>
            <span className="text-[11px] text-gray-400 block pt-1">Batch write sẵn sàng</span>
          </div>
        </div>

        {/* Phase 4 Magic Import Tool */}
        <div className="pt-4">
          <MagicImport />
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
