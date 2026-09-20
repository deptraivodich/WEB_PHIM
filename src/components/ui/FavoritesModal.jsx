import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatVietnameseSentenceCase, generateSlug } from '../../utils/textUtils';
import { toggleMovieLike } from '../../services/interactionService';

/**
 * FavoritesModal Component
 * Shows all favorite movies for the user with search and remove capabilities.
 */
const FavoritesModal = ({ isOpen, onClose, username, movies = [], onFavoritesChange }) => {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const filteredMovies = movies.filter(movie => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (movie.title && movie.title.toLowerCase().includes(q)) ||
      (movie.originalTitle && movie.originalTitle.toLowerCase().includes(q))
    );
  });

  const handleRemoveFavorite = async (movieId, e) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await toggleMovieLike(movieId, username);
      if (onFavoritesChange) {
        onFavoritesChange();
      }
    } catch (err) {
      console.error("Error removing favorite:", err);
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
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-neon-red to-pink-600 flex items-center justify-center text-xl shadow-[0_0_15px_rgba(229,9,20,0.4)]">
              ❤️
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
                <span>Phim Yêu Thích Của Bạn</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-neon-red/20 text-neon-red border border-neon-red/30 font-bold">
                  {movies.length} phim
                </span>
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Danh sách những bộ phim bạn đã thả tim
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
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
            placeholder="Tìm kiếm phim trong danh sách yêu thích..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-white text-xs placeholder-gray-500 focus:outline-none"
          />
          {searchQuery && (
            <button 
              type="button" 
              onClick={() => setSearchQuery('')}
              className="text-xs text-gray-400 hover:text-white px-2 py-0.5"
            >
              Xóa
            </button>
          )}
        </div>

        {/* Movies Grid */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] custom-scrollbar">
          {filteredMovies.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <span className="text-4xl">❤️</span>
              <p className="text-gray-300 font-bold text-sm">
                {searchQuery ? 'Không tìm thấy phim phù hợp với từ khóa.' : 'Hiện chưa có phim nào trong danh sách yêu thích.'}
              </p>
              <p className="text-gray-500 text-xs">
                Hãy bấm vào biểu tượng trái tim ở các trang phim để lưu phim vào đây!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filteredMovies.map((movie, idx) => {
                const itemKey = movie.id || `fav-${idx}`;
                const formattedTitle = formatVietnameseSentenceCase(movie.title || 'Phim');
                const movieSlug = generateSlug(movie.title) || movie.id;

                return (
                  <div 
                    key={itemKey}
                    className="relative group rounded-2xl overflow-hidden bg-[#181d36] border border-white/10 hover:border-neon-red/50 transition-all duration-300 shadow-lg hover:shadow-2xl flex flex-col"
                  >
                    <Link to={`/movie/${movieSlug}`} className="block relative aspect-[2/3] overflow-hidden">
                      <img
                        src={movie.poster || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300'}
                        alt={formattedTitle}
                        onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300'; }}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2.5">
                        <span className="text-[11px] font-bold text-white bg-neon-red/80 px-2 py-0.5 rounded">
                          Xem chi tiết
                        </span>
                      </div>
                    </Link>

                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={(e) => handleRemoveFavorite(movie.id, e)}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 hover:bg-neon-red text-white flex items-center justify-center text-xs opacity-80 hover:opacity-100 transition-all z-10 shadow-md"
                      title="Bỏ thích"
                    >
                      ✕
                    </button>

                    <div className="p-3 flex-1 flex flex-col justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-white truncate" title={formattedTitle}>
                          {formattedTitle}
                        </h4>
                        {movie.originalTitle && (
                          <p className="text-[10px] text-amber-300 truncate mt-0.5">{movie.originalTitle}</p>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5 text-[10px] text-gray-400">
                        <span>★ {movie.imdb || '8.5'}</span>
                        <Link 
                          to={`/movie/${movieSlug}/tap-1`}
                          className="text-neon-cyan hover:underline font-bold"
                        >
                          Xem phim →
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FavoritesModal;
