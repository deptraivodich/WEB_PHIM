import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import MovieCard from '../../components/ui/MovieCard';
import { getMovies } from '../../services/movieService';
import { ANIME_GENRES } from '../../components/common/Navbar';
import { formatVietnameseSentenceCase } from '../../utils/textUtils';

/**
 * Phase 4 & Multi-Select Upgrade: CategoryPage
 * Features:
 * - Multi-select genre tags connected via URL query params (?genres=Action,Comedy)
 * - Match mode toggling: AND (All tags must match) vs OR (At least 1 tag matches)
 * - Search query filtering via ?q= or ?search=
 * - Quick Search inside modal & live badges
 * - Click outside to close modal & red X close button
 */
const CategoryPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [allMovies, setAllMovies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  
  // Match Mode: 'AND' (Must match all selected tags) | 'OR' (Must match at least one tag)
  const [matchMode, setMatchMode] = useState('AND');
  
  // Sort Mode: 'imdb' | 'year' | 'title'
  const [sortBy, setSortBy] = useState('imdb');

  // Extract active genres from URL search params (?genres=Action,Comedy or ?genre=Action)
  const activeGenres = useMemo(() => {
    const raw = searchParams.get('genres') || searchParams.get('genre') || '';
    if (!raw.trim()) return [];
    return raw.split(',').map(g => g.trim()).filter(Boolean);
  }, [searchParams]);

  // Extract search query from URL search params (?q=... or ?search=...)
  const searchQueryParam = useMemo(() => {
    return searchParams.get('q') || searchParams.get('search') || '';
  }, [searchParams]);

  // Fetch all movies from DB
  useEffect(() => {
    const fetchAll = async () => {
      setIsLoading(true);
      try {
        const data = await getMovies();
        setAllMovies(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Error loading category movies:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchAll();
  }, []);

  // Update URL search parameters when genres change
  const updateGenreParams = (newGenres) => {
    const currentParams = Object.fromEntries(searchParams.entries());
    if (newGenres.length === 0) {
      delete currentParams.genres;
      delete currentParams.genre;
    } else {
      currentParams.genres = newGenres.join(',');
      delete currentParams.genre;
    }
    setSearchParams(currentParams);
  };

  // Toggle single genre tag in multi-select
  const toggleGenreParam = (genre) => {
    const exists = activeGenres.some(g => g.toLowerCase() === genre.toLowerCase());
    if (exists) {
      updateGenreParams(activeGenres.filter(g => g.toLowerCase() !== genre.toLowerCase()));
    } else {
      updateGenreParams([...activeGenres, genre]);
    }
  };

  // Clear all selected genres
  const clearAllGenres = () => {
    updateGenreParams([]);
  };

  // Select all anime genres
  const selectAllGenres = () => {
    updateGenreParams([...ANIME_GENRES]);
  };

  // Helper to extract genres array from movie
  const getMovieGenres = (movie) => {
    if (Array.isArray(movie?.genres)) return movie.genres.filter(Boolean);
    if (typeof movie?.category === 'string' && movie.category.trim()) {
      return movie.category.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (Array.isArray(movie?.category)) return movie.category.filter(Boolean);
    return [];
  };

  // Filter & Sort movies based on active genres, search query, and sort criteria
  const filteredMovies = useMemo(() => {
    if (!Array.isArray(allMovies)) return [];

    let result = allMovies.filter(movie => {
      if (!movie) return false;

      // 1. Search Query Filter
      if (searchQueryParam.trim()) {
        const q = searchQueryParam.trim().toLowerCase();
        const titleMatch = String(movie.title || '').toLowerCase().includes(q);
        const originalMatch = String(movie.originalTitle || '').toLowerCase().includes(q);
        if (!titleMatch && !originalMatch) {
          return false;
        }
      }

      // 2. Multi-Genre Filter
      if (activeGenres.length > 0) {
        const movieGenres = getMovieGenres(movie).map(g => g.toLowerCase());

        if (matchMode === 'AND') {
          // AND Mode: Movie must contain ALL active genres
          const matchesAll = activeGenres.every(ag => 
            movieGenres.some(mg => mg === ag.toLowerCase() || mg.includes(ag.toLowerCase()))
          );
          if (!matchesAll) return false;
        } else {
          // OR Mode: Movie must contain AT LEAST ONE of active genres
          const matchesAny = activeGenres.some(ag => 
            movieGenres.some(mg => mg === ag.toLowerCase() || mg.includes(ag.toLowerCase()))
          );
          if (!matchesAny) return false;
        }
      }

      return true;
    });

    // 3. Sort Results
    result.sort((a, b) => {
      if (sortBy === 'imdb') {
        return (parseFloat(b.imdb) || 0) - (parseFloat(a.imdb) || 0);
      }
      if (sortBy === 'year') {
        return (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
      }
      if (sortBy === 'title') {
        return String(a.title || '').localeCompare(String(b.title || ''));
      }
      return 0;
    });

    return result;
  }, [allMovies, activeGenres, searchQueryParam, matchMode, sortBy]);

  return (
    <div className="min-h-screen bg-background text-gray-100 flex flex-col pt-24 pb-20">
      
      {/* Header Banner */}
      <div className="relative py-10 px-4 md:px-12 bg-gradient-to-b from-[#14172b] to-background border-b border-glass-border">
        <div className="max-w-7xl mx-auto space-y-4">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 text-xs text-amber-400 font-bold mb-1">
                <Link to="/" className="hover:underline">Trang chủ</Link>
                <span>/</span>
                <span>Phân loại đa thể loại</span>
                {searchQueryParam && (
                  <>
                    <span>/</span>
                    <span className="text-neon-cyan font-normal">Từ khóa: "{searchQueryParam}"</span>
                  </>
                )}
              </div>

              <h1 className="text-2xl sm:text-4xl font-black text-white font-display flex flex-wrap items-center gap-3">
                <span>Kho Phim & Thể Loại Anime</span>
                <span className="text-xs px-3 py-1 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 font-bold">
                  {filteredMovies.length} Bộ Phim
                </span>
              </h1>
            </div>

            {/* Quick Actions: Open Modal & Mode Switch */}
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => setIsFilterModalOpen(true)}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-black font-black text-xs transition-all shadow-[0_0_15px_rgba(245,158,11,0.4)] flex items-center gap-2 cursor-pointer"
              >
                <span>🎭 Chọn Thể Loại ({activeGenres.length})</span>
                <span className="w-5 h-5 rounded-full bg-black/20 text-black flex items-center justify-center text-[10px] font-extrabold">
                  +
                </span>
              </button>

              {/* Sort Selector */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="py-2.5 px-3 rounded-xl bg-surface border border-glass-border text-xs text-gray-200 focus:outline-none focus:border-amber-400 cursor-pointer"
              >
                <option value="imdb">★ Điểm IMDb cao nhất</option>
                <option value="year">📅 Năm phát hành mới nhất</option>
                <option value="title">🔤 Tên A - Z</option>
              </select>
            </div>
          </div>

          {/* Active Filter Tags Bar */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span className="text-xs text-gray-400 font-semibold flex items-center gap-1 mr-1">
              <span>Đang lọc theo:</span>
            </span>

            {activeGenres.length === 0 ? (
              <span className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-gray-400 text-xs italic">
                Tất cả thể loại (Chưa chọn lọc)
              </span>
            ) : (
              activeGenres.map((genre) => (
                <span
                  key={genre}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-400/20 text-amber-300 border border-amber-400/40 text-xs font-bold shadow-sm animate-fadeIn"
                >
                  <span>{genre}</span>
                  <button
                    type="button"
                    onClick={() => toggleGenreParam(genre)}
                    className="hover:text-white bg-amber-400/30 rounded-full w-4 h-4 inline-flex items-center justify-center text-[10px] cursor-pointer"
                    title={`Xóa ${genre}`}
                  >
                    ✕
                  </button>
                </span>
              ))
            )}

            {activeGenres.length > 0 && (
              <button
                type="button"
                onClick={clearAllGenres}
                className="text-xs text-red-400 hover:underline font-bold ml-2 cursor-pointer"
              >
                ✕ Xóa hết lọc
              </button>
            )}
          </div>

          {/* AND / OR Filter Strategy Switch */}
          {activeGenres.length > 1 && (
            <div className="flex items-center space-x-3 pt-2 text-xs">
              <span className="text-gray-400">Quy tắc lọc:</span>
              <button
                type="button"
                onClick={() => setMatchMode('AND')}
                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer border ${
                  matchMode === 'AND'
                    ? 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/50 shadow-[0_0_10px_rgba(0,240,255,0.3)]'
                    : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                }`}
              >
                Khớp TẤT CẢ (AND) - Phải chứa đủ {activeGenres.length} tags
              </button>
              <button
                type="button"
                onClick={() => setMatchMode('OR')}
                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer border ${
                  matchMode === 'OR'
                    ? 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/50 shadow-[0_0_10px_rgba(0,240,255,0.3)]'
                    : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                }`}
              >
                Khớp MỘT PHẦN (OR) - Chứa 1 trong các tags
              </button>
            </div>
          )}

        </div>
      </div>

      {/* Main Results Grid Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-12 py-8 space-y-8">
        
        {/* Genre Tags Horizontal Quick-Pills */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
              Chọn nhanh thể loại phổ biến:
            </h2>
            <button
              type="button"
              onClick={() => setIsFilterModalOpen(true)}
              className="text-xs text-amber-400 hover:underline font-bold"
            >
              Xem tất cả ({ANIME_GENRES.length}) →
            </button>
          </div>

          <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar py-2">
            {ANIME_GENRES.slice(0, 18).map((genre) => {
              const isSelected = activeGenres.some(g => g.toLowerCase() === genre.toLowerCase());
              return (
                <button
                  key={genre}
                  type="button"
                  onClick={() => toggleGenreParam(genre)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border cursor-pointer ${
                    isSelected
                      ? 'bg-amber-400 text-black border-amber-400 font-black shadow-[0_0_12px_rgba(245,158,11,0.5)] scale-105'
                      : 'bg-surface-card text-gray-300 border-glass-border hover:border-white/30 hover:text-white'
                  }`}
                >
                  {isSelected ? `✓ ${genre}` : genre}
                </button>
              );
            })}
          </div>
        </div>

        {/* MOVIE RESULTS GRID */}
        {isLoading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 sm:gap-4">
            {Array.from({ length: 12 }).map((_, idx) => (
              <MovieCard key={idx} isLoading={true} layoutMode="grid" />
            ))}
          </div>
        ) : filteredMovies.length === 0 ? (
          <div className="glass-panel p-12 rounded-3xl border border-glass-border text-center space-y-4 max-w-xl mx-auto shadow-2xl">
            <div className="text-5xl">🎬</div>
            <h3 className="text-xl font-extrabold text-white">Chưa Tìm Thấy Phim Phù Hợp</h3>
            <p className="text-xs sm:text-sm text-gray-400 leading-relaxed">
              Hiện tại không có bộ phim nào chứa đồng thời các thể loại: <strong className="text-amber-400">{activeGenres.join(', ')}</strong>.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              {matchMode === 'AND' && activeGenres.length > 1 && (
                <button
                  type="button"
                  onClick={() => setMatchMode('OR')}
                  className="px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-black text-xs font-black transition-all shadow-md cursor-pointer"
                >
                  🔄 Đổi sang chế độ "Khớp một phần (OR)"
                </button>
              )}
              <button
                type="button"
                onClick={clearAllGenres}
                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/20 transition-all cursor-pointer"
              >
                Xem tất cả phim ({allMovies.length})
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 sm:gap-4">
            {filteredMovies.map((movie, idx) => (
              <MovieCard 
                key={movie.id} 
                movie={movie} 
                layoutMode="grid" 
                isFirst={idx % 6 === 0} 
                isLast={(idx + 1) % 6 === 0 || idx === filteredMovies.length - 1} 
              />
            ))}
          </div>
        )}

      </main>

      {/* MULTI-SELECT CATEGORY MODAL DIALOG (WITH CLICK OUTSIDE & RED CLOSE X BUTTON) */}
      {isFilterModalOpen && (
        <div 
          onClick={() => setIsFilterModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn cursor-pointer"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-[#202744] border border-white/20 p-6 rounded-3xl max-w-2xl w-full space-y-5 shadow-2xl max-h-[85vh] overflow-y-auto custom-scrollbar cursor-default animate-scaleUp"
          >
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2">
                <span className="text-xl">🎭</span>
                <div>
                  <h3 className="text-base font-extrabold text-white">Chọn Bộ Lọc Đa Thể Loại</h3>
                  <p className="text-[11px] text-gray-400">Click chọn nhiều thể loại để tìm phim theo sở thích</p>
                </div>
              </div>
              
              {/* Red X Close Button */}
              <button
                type="button"
                onClick={() => setIsFilterModalOpen(false)}
                className="w-8 h-8 rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/40 flex items-center justify-center text-sm font-black transition-all cursor-pointer shadow-[0_0_10px_rgba(239,68,68,0.3)] hover:scale-110"
                title="Đóng modal"
              >
                ✕
              </button>
            </div>

            {/* Quick Search inside Modal */}
            <div className="relative">
              <input
                type="text"
                placeholder="🔍 Tìm nhanh thể loại..."
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                className="w-full py-2.5 px-4 rounded-xl bg-[#171b30] border border-white/10 text-xs text-white placeholder-gray-400 focus:outline-none focus:border-amber-400"
              />
              {filterSearch && (
                <button
                  type="button"
                  onClick={() => setFilterSearch('')}
                  className="absolute right-3 top-2.5 text-xs text-gray-400 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>

            {/* 46 Genre Badges Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
              {ANIME_GENRES.filter(g => !filterSearch || g.toLowerCase().includes(filterSearch.toLowerCase())).map((genre) => {
                const isSelected = activeGenres.some(g => g.toLowerCase() === genre.toLowerCase());
                return (
                  <button
                    type="button"
                    key={genre}
                    onClick={() => toggleGenreParam(genre)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold text-center truncate transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-amber-400 text-black border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.5)] scale-[1.02]'
                        : 'bg-[#2a3359] text-gray-200 border-white/10 hover:border-white/30 hover:text-white'
                    }`}
                  >
                    {isSelected ? `✓ ${genre}` : genre}
                  </button>
                );
              })}
            </div>

            {/* Modal Footer Controls */}
            <div className="flex items-center justify-between pt-3 border-t border-white/10">
              <span className="text-xs text-gray-300">
                Đã chọn: <strong className="text-amber-400">{activeGenres.length}</strong> thể loại
              </span>
              <div className="flex items-center space-x-2">
                {activeGenres.length > 0 && (
                  <button
                    type="button"
                    onClick={clearAllGenres}
                    className="px-4 py-2 rounded-xl bg-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/30 cursor-pointer"
                  >
                    Bỏ chọn hết
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsFilterModalOpen(false)}
                  className="px-6 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black text-xs font-black transition-all shadow-md cursor-pointer"
                >
                  Áp Dụng ({filteredMovies.length} Phim)
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default CategoryPage;
