import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatVietnameseSentenceCase } from '../../utils/textUtils';
import { deleteHistoryItem, clearUserWatchHistory } from '../../services/historyService';

/**
 * WatchHistoryModal Component
 * Shows all watched movies stored in DB for the user, with search, delete, clear all, and continue watching.
 */
const WatchHistoryModal = ({ isOpen, onClose, username, history = [], onHistoryChange }) => {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const filteredHistory = history.filter(item => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (item.title && item.title.toLowerCase().includes(q)) ||
      (item.originalTitle && item.originalTitle.toLowerCase().includes(q)) ||
      (item.timestamp && item.timestamp.includes(q))
    );
  });

  const handleDeleteItem = (movieId, e) => {
    e.stopPropagation();
    e.preventDefault();
    deleteHistoryItem(username, movieId);
    if (onHistoryChange) onHistoryChange();
  };

  const handleClearAll = () => {
    if (window.confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử xem phim không?')) {
      clearUserWatchHistory(username);
      if (onHistoryChange) onHistoryChange();
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-fadeIn"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-5xl bg-[#14182b] border border-white/15 rounded-3xl shadow-[0_25px_80px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-white/10 flex flex-wrap items-center justify-between gap-4 bg-[#181d36]/80">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-neon-cyan to-blue-600 flex items-center justify-center text-xl shadow-[0_0_15px_rgba(0,240,255,0.4)]">
              🕒
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
                <span>Lịch Sử Xem Phim</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 font-bold">
                  {history.length} phim đã lưu
                </span>
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Tài khoản: <strong className="text-amber-400">@{username}</strong> • Lưu trữ trong Database
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            {history.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="px-3.5 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/30 text-red-400 border border-red-500/30 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                title="Xóa tất cả lịch sử xem"
              >
                <span>🗑️</span>
                <span className="hidden sm:inline">Xóa tất cả</span>
              </button>
            )}

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm font-black transition-all cursor-pointer border border-white/10 hover:scale-105"
              title="Đóng"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Search Bar Filter */}
        <div className="px-6 py-3 border-b border-white/5 bg-[#101324]/60 flex items-center gap-3">
          <span className="text-gray-400 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Tìm kiếm trong lịch sử xem..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-white text-xs placeholder-gray-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-xs text-gray-400 hover:text-white cursor-pointer"
            >
              Xóa tìm
            </button>
          )}
        </div>

        {/* Modal Body: Grid of Watched Movies */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-4">
          {filteredHistory.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <span className="text-5xl block">🍿</span>
              <h3 className="text-base font-bold text-gray-300">
                {searchQuery ? 'Không tìm thấy phim phù hợp trong lịch sử' : 'Chưa có lịch sử xem phim nào'}
              </h3>
              <p className="text-xs text-gray-500 max-w-sm mx-auto">
                Khi bạn xem bất kỳ bộ phim nào trên 210LoliPhim, tập phim và thời gian xem sẽ tự động được ghi nhớ tại đây.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filteredHistory.map((item) => {
                const formattedTitle = formatVietnameseSentenceCase(item.title || 'Phim');
                return (
                  <div
                    key={item.id || item.movieId}
                    className="relative group bg-[#1c223d] border border-white/10 rounded-2xl overflow-hidden shadow-lg hover:border-neon-cyan/50 transition-all flex flex-col justify-between"
                  >
                    {/* Poster with overlays */}
                    <div className="relative aspect-[2/3] w-full overflow-hidden bg-black/40">
                      <img
                        src={item.poster || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300'}
                        alt={formattedTitle}
                        onError={(e) => {
                          e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300';
                        }}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#14182b] via-transparent to-transparent opacity-90"></div>

                      {/* Episode Badge */}
                      <div className="absolute top-2 left-2 z-10">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-neon-cyan text-black shadow-md">
                          Đang xem: Tập {item.episode || '1'}
                        </span>
                      </div>

                      {/* Delete item button */}
                      <button
                        type="button"
                        onClick={(e) => handleDeleteItem(item.movieId, e)}
                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 hover:bg-red-600 text-white flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-all cursor-pointer shadow-md"
                        title="Xóa khỏi lịch sử"
                      >
                        ✕
                      </button>

                      {/* Time and Progress on bottom of image */}
                      <div className="absolute bottom-2 left-2 right-2 z-10 space-y-0.5">
                        {item.currentTime > 0 && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-neon-cyan font-bold bg-black/60 px-1.5 py-0.2 rounded">
                              ⏱️ {item.progressText || `${Math.floor(item.currentTime / 60)}p`}
                            </span>
                          </div>
                        )}
                        <p className="text-[10px] text-amber-300 font-mono font-semibold truncate flex items-center gap-1 drop-shadow-md">
                          <span>🕒</span>
                          <span>{item.timestamp}</span>
                        </p>
                      </div>
                    </div>

                    {/* Movie Info & Actions */}
                    <div className="p-3 space-y-2 flex-1 flex flex-col justify-between">
                      <div>
                        <h4 className="text-xs font-extrabold text-white truncate group-hover:text-neon-cyan transition-colors" title={formattedTitle}>
                          {formattedTitle}
                        </h4>
                        {item.originalTitle && (
                          <p className="text-[10px] text-gray-400 truncate mt-0.5">
                            {item.originalTitle}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 pt-1">
                        <Link
                          to={`/watch/${item.movieId}?ep=${item.episode || '1'}`}
                          onClick={onClose}
                          className="flex-1 py-1.5 px-2 rounded-lg bg-gradient-to-r from-neon-cyan to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-black font-black text-[11px] text-center shadow-md transition-all flex items-center justify-center gap-1"
                        >
                          <span>▶ Xem tiếp</span>
                        </Link>

                        <Link
                          to={`/movie/${item.movieId}`}
                          onClick={onClose}
                          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs text-center border border-white/15 transition-all"
                          title="Chi tiết phim"
                        >
                          ℹ
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-white/10 bg-[#181d36]/80 flex items-center justify-between text-[11px] text-gray-400">
          <span>Tự động đồng bộ lịch sử khi xem phim</span>
          <button
            type="button"
            onClick={onClose}
            className="text-amber-400 hover:underline font-bold cursor-pointer"
          >
            Đóng bảng
          </button>
        </div>
      </div>
    </div>
  );
};

export default WatchHistoryModal;
