import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import Navbar from '../../components/common/Navbar';
import { getMovies } from '../../services/movieService';
import { formatVietnameseSentenceCase } from '../../utils/textUtils';

// Fallback template when fetching detail
const DEFAULT_FALLBACK_MOVIE = {
  id: '1',
  title: 'Phim Đang Tải...',
  originalTitle: 'Loading...',
  banner: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1600&auto=format&fit=crop&q=80',
  poster: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
  imdb: '8.0',
  year: '2024',
  ageRating: '16+',
  quality: '4K UltraHD',
  duration: '120 phút',
  episodesCount: 'Full Tập',
  audio: 'Vietsub + Thuyết Minh',
  director: 'Đang cập nhật',
  actors: 'Đang cập nhật',
  genres: ['Hành động', 'Viễn tưởng'],
  description: 'Mô tả chi tiết nội dung phim đang được cập nhật từ hệ thống.',
  episodes: Array.from({ length: 12 }, (_, i) => ({
    number: i + 1,
    title: `Tập ${i + 1}`,
    m3u8Url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
  }))
};

// Sidebar Top Movies Weekly mock
const TOP_WEEKLY = [
  { rank: 1, title: 'Deadpool & Wolverine', views: '1.2M', imdb: '8.1', poster: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=300&auto=format&fit=crop&q=80' },
  { rank: 2, title: 'Godzilla x Kong', views: '980K', imdb: '7.4', poster: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=300&auto=format&fit=crop&q=80' },
  { rank: 3, title: 'Oppenheimer', views: '850K', imdb: '8.9', poster: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=300&auto=format&fit=crop&q=80' },
  { rank: 4, title: 'Avatar: Dòng Nước', views: '720K', imdb: '7.8', poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&auto=format&fit=crop&q=80' }
];

const DetailFilm = () => {
  const { id } = useParams(); // LỖI 3 FIX: Dynamic URL Param ID extraction
  const [movieDetail, setMovieDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEpisode, setSelectedEpisode] = useState(1);
  const [isFavorite, setIsFavorite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [comments, setComments] = useState([
    { id: 1, user: 'MinhPhim99', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100', text: 'Phim đỉnh thực sự! Trải nghiệm 4K âm thanh cực kỳ sống động.', time: '2 giờ trước' },
    { id: 2, user: 'CinemaFanatic', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100', text: 'Bản thuyết minh rất mượt.', time: '5 giờ trước' }
  ]);
  const [newComment, setNewComment] = useState('');

  // LỖI 3 FIX: Fetch & re-bind movie data whenever ID in URL changes
  useEffect(() => {
    const fetchMovieData = async () => {
      setIsLoading(true);
      setMovieDetail(null); // Clear previous state immediately!

      try {
        const moviesList = await getMovies();
        const found = (moviesList || []).find(m => String(m.id) === String(id) || String(m.id) === String(id?.trim()));

        const formatEpisodes = (rawEps, defaultM3u8) => {
          if (Array.isArray(rawEps) && rawEps.length > 0) {
            return rawEps.map((ep, i) => {
              const epNum = ep.name || ep.number || (i + 1);
              return {
                number: epNum,
                title: ep.title || `Tập ${epNum}`,
                m3u8Url: ep.url || ep.m3u8Url || defaultM3u8 || ''
              };
            });
          }
          return [
            {
              number: 1,
              title: 'Tập 1',
              m3u8Url: defaultM3u8 || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
            }
          ];
        };

        if (found) {
          const parsedEps = formatEpisodes(found.episodes, found.m3u8Url);
          setMovieDetail({
            ...found,
            episodes: parsedEps,
            episodesCount: `${parsedEps.length} Tập`
          });
        } else if (moviesList && moviesList.length > 0) {
          // If requested ID not found, use first available movie or default template
          const fallback = moviesList[0];
          const parsedEps = formatEpisodes(fallback.episodes, fallback.m3u8Url);
          setMovieDetail({
            ...fallback,
            episodes: parsedEps,
            episodesCount: `${parsedEps.length} Tập`
          });
        } else {
          setMovieDetail(DEFAULT_FALLBACK_MOVIE);
        }
      } catch (err) {
        console.error("Error fetching detail for ID:", id, err);
        setMovieDetail(DEFAULT_FALLBACK_MOVIE);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMovieData();
    window.scrollTo(0, 0); // Scroll to top when changing movie
  }, [id]);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleAddComment = (e) => {
    e.preventDefault();
    if (newComment.trim()) {
      setComments([
        {
          id: Date.now(),
          user: 'Bạn (VIP Member)',
          avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100',
          text: newComment.trim(),
          time: 'Vừa xong'
        },
        ...comments
      ]);
      setNewComment('');
    }
  };

  if (isLoading || !movieDetail) {
    return (
      <div className="min-h-screen bg-background text-white flex flex-col justify-center items-center space-y-4">
        <div className="w-12 h-12 rounded-full border-4 border-neon-red border-t-transparent animate-spin"></div>
        <p className="text-xs text-gray-400 font-bold">Đang tải thông tin phim...</p>
      </div>
    );
  }

  const {
    id: activeId,
    title,
    originalTitle,
    banner,
    poster,
    imdb = '8.5',
    year = '2024',
    ageRating = '16+',
    quality = '4K UltraHD',
    duration = '120 phút',
    episodesCount = 'Full Tập',
    badge = 'Vietsub + Thuyết Minh',
    director = 'Đang cập nhật',
    actors = 'Đang cập nhật',
    genres = ['Hành động', 'Viễn tưởng'],
    description = 'Tóm tắt nội dung phim đang được cập nhật.',
    episodes = []
  } = movieDetail;

  return (
    <div className="min-h-screen bg-background text-white pb-24">
      {/* Hero Section - Full Width Backdrop Banner */}
      <section className="relative w-full h-[55vh] md:h-[70vh] flex items-end overflow-hidden">
        {/* Backdrop Image */}
        <div className="absolute inset-0 z-0">
          <img 
            src={banner || poster} 
            alt={title} 
            className="w-full h-full object-cover object-center scale-105 filter brightness-90 opacity-80"
          />
          {/* Gradient Overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent"></div>
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/40 to-transparent"></div>
        </div>

        {/* Ambient Top Shadow */}
        <div className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-background to-transparent z-1"></div>
      </section>

      {/* Main Content Layout Container */}
      <main className="relative z-10 -mt-36 md:-mt-48 max-w-7xl mx-auto px-4 md:px-12">
        <div className="flex flex-col xl:flex-row gap-8 items-start">

          {/* Left & Center Main Content Area */}
          <div className="flex-1 space-y-8 w-full">

            {/* 2-Column Movie Info Header */}
            <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start">
              
              {/* Left Column: Poster Image */}
              <div className="w-44 sm:w-56 md:w-64 flex-shrink-0 mx-auto md:mx-0">
                <div className="relative aspect-[2/3] w-full rounded-2xl overflow-hidden shadow-[0_0_35px_rgba(229,9,20,0.5)] border border-glass-border group">
                  <img 
                    src={poster} 
                    alt={title} 
                    className="w-full h-full object-cover rounded-2xl transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute top-3 left-3 bg-neon-red text-white text-[10px] font-extrabold px-2.5 py-1 rounded shadow-neon-red uppercase">
                    {quality}
                  </div>
                </div>

                {/* Sub-info Badges under Poster */}
                <div className="mt-3 flex items-center justify-center gap-2 text-xs text-gray-400">
                  <span className="px-2 py-1 rounded bg-white/5 border border-white/10">{badge}</span>
                </div>
              </div>

              {/* Right Column: Title, Metadata, Action Buttons & Storyline */}
              <div className="flex-1 space-y-4 text-center md:text-left">
                
                {/* Title & Original Title */}
                <div>
                  <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight">
                    {formatVietnameseSentenceCase(title)}
                  </h1>
                  <h2 className="text-base md:text-lg text-gray-400 font-medium mt-1">
                    {originalTitle} ({year})
                  </h2>
                </div>

                {/* Metadata Badges Row */}
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5 text-xs sm:text-sm font-semibold">
                  <span className="px-2.5 py-1 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 flex items-center gap-1 font-bold">
                    ★ {imdb} IMDb
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-neon-red/20 text-neon-red border border-neon-red/30">
                    {ageRating}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-white/10 text-gray-200 border border-white/10">
                    {year}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30">
                    {duration}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {episodesCount}
                  </span>
                </div>

                {/* Genres Tags */}
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-1">
                  {Array.isArray(genres) ? genres.map((g, idx) => (
                    <span key={idx} className="px-3 py-1 rounded-full bg-surface-card text-xs text-gray-300 border border-glass-border">
                      {g}
                    </span>
                  )) : (
                    <span className="px-3 py-1 rounded-full bg-surface-card text-xs text-gray-300 border border-glass-border">
                      {genres}
                    </span>
                  )}
                </div>

                {/* Storyline Description */}
                <p className="text-gray-300 text-xs sm:text-sm leading-relaxed max-w-3xl line-clamp-4">
                  {description}
                </p>

                {/* Director & Cast */}
                <div className="text-xs text-gray-400 space-y-1 pt-1">
                  <p><strong className="text-gray-200">Đạo diễn:</strong> {director}</p>
                  <p><strong className="text-gray-200">Diễn viên:</strong> {actors}</p>
                </div>

                {/* Action Buttons Section */}
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 pt-4">
                  {/* Big Prominent Highlighted 'Xem Ngay' Button with Dynamic Movie ID */}
                  <Link 
                    to={`/watch/${activeId}?ep=${selectedEpisode}`}
                    className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-yellow-400 via-amber-500 to-amber-600 hover:from-yellow-300 hover:to-amber-500 text-black font-extrabold text-sm sm:text-base flex items-center gap-2 shadow-[0_0_30px_rgba(251,191,36,0.6)] hover:scale-105 transition-all duration-300 cursor-pointer"
                  >
                    <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    <span>XEM NGAY (TẬP {selectedEpisode})</span>
                  </Link>

                  {/* Circular Icon Buttons: Yêu thích, Bình luận, Chia sẻ */}
                  <div className="flex items-center space-x-3">
                    <button 
                      onClick={() => setIsFavorite(!isFavorite)}
                      title={isFavorite ? 'Đã yêu thích' : 'Thêm vào yêu thích'}
                      className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all duration-300 ${
                        isFavorite 
                          ? 'bg-neon-red text-white border-neon-red shadow-[0_0_20px_#e50914] scale-110' 
                          : 'bg-surface-card text-gray-300 hover:text-white border-glass-border hover:border-neon-red/50 hover:bg-neon-red/20'
                      }`}
                    >
                      <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                      </svg>
                    </button>

                    <a 
                      href="#comments-section"
                      title="Bình luận"
                      className="w-11 h-11 rounded-full bg-surface-card text-gray-300 hover:text-white border border-glass-border hover:border-neon-cyan/50 hover:bg-neon-cyan/20 flex items-center justify-center transition-all duration-300"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/>
                      </svg>
                    </a>

                    <button 
                      onClick={handleShare}
                      title="Chia sẻ phim"
                      className="relative w-11 h-11 rounded-full bg-surface-card text-gray-300 hover:text-white border border-glass-border hover:border-amber-500/50 hover:bg-amber-500/20 flex items-center justify-center transition-all duration-300"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
                      </svg>
                      {copied && (
                        <span className="absolute -top-10 left-1/2 transform -translate-x-1/2 px-2.5 py-1 bg-neon-cyan text-black font-extrabold text-[10px] rounded whitespace-nowrap shadow-lg animate-bounce">
                          Đã copy link!
                        </span>
                      )}
                    </button>
                  </div>
                </div>

              </div>
            </div>

            {/* Episodes Selection Container (Khung chọn Tập phim Grid) */}
            <div className="p-6 rounded-2xl bg-surface-card/90 border border-glass-border backdrop-blur-md space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span className="w-1.5 h-4 bg-neon-red rounded-full"></span>
                  <span>Danh Sách Tập Phim</span>
                  <span className="text-xs text-gray-400 font-normal">({episodesCount})</span>
                </h3>
                <span className="text-xs text-neon-cyan font-semibold">Nguồn m3u8 Vietsub • KKPhim</span>
              </div>

              {/* Episode Rectangular Grid Buttons */}
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2.5">
                {episodes.map((ep) => (
                  <Link
                    key={ep.number}
                    to={`/watch/${activeId}?ep=${ep.number}`}
                    onClick={() => setSelectedEpisode(ep.number)}
                    className={`py-2.5 px-3 rounded-xl text-center text-xs font-bold transition-all duration-200 border ${
                      selectedEpisode === ep.number
                        ? 'bg-neon-red text-white border-neon-red shadow-[0_0_15px_#e50914] scale-105'
                        : 'bg-background/80 text-gray-300 hover:text-white border-glass-border hover:border-neon-red/50 hover:bg-neon-red/20'
                    }`}
                  >
                    Tập {ep.number}
                  </Link>
                ))}
              </div>
            </div>

            {/* Comments Section */}
            <div id="comments-section" className="p-6 rounded-2xl bg-surface-card/90 border border-glass-border backdrop-blur-md space-y-6">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-4 bg-neon-cyan rounded-full"></span>
                <span>Bình Luận & Đánh Giá ({comments.length})</span>
              </h3>

              {/* Comment Input Form */}
              <form onSubmit={handleAddComment} className="flex gap-3">
                <input 
                  type="text" 
                  placeholder="Viết nhận xét của bạn về phim..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="flex-1 py-3 px-4 rounded-xl bg-background/80 border border-glass-border text-xs text-gray-200 focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan transition-all"
                />
                <button 
                  type="submit"
                  className="px-6 py-3 rounded-xl bg-neon-cyan/20 hover:bg-neon-cyan/30 text-neon-cyan border border-neon-cyan/40 text-xs font-bold transition-all"
                >
                  Gửi
                </button>
              </form>

              {/* Comment List */}
              <div className="space-y-4">
                {comments.map((c) => (
                  <div key={c.id} className="flex items-start space-x-3 p-3.5 rounded-xl bg-background/40 border border-white/5">
                    <img src={c.avatar} alt="Avatar" className="w-9 h-9 rounded-full object-cover border border-white/10" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-gray-200">{c.user}</span>
                        <span className="text-gray-500 text-[10px]">{c.time}</span>
                      </div>
                      <p className="text-xs text-gray-300 mt-1">{c.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Right Sidebar: Top Phim Tuần Này */}
          <aside className="hidden xl:block w-80 flex-shrink-0 space-y-4">
            <div className="p-5 rounded-2xl bg-surface-card/90 border border-glass-border backdrop-blur-md space-y-4">
              <h3 className="text-base font-extrabold text-white flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="text-neon-red">🔥</span> Top Phim Tuần Này
                </span>
                <span className="text-[10px] text-gray-400">BXH Cổ Bể</span>
              </h3>

              <div className="space-y-3">
                {TOP_WEEKLY.map((item) => (
                  <Link 
                    key={item.rank} 
                    to={`/movie/${activeId}`}
                    className="flex items-center space-x-3 p-2 rounded-xl hover:bg-white/5 transition-all group"
                  >
                    <span className={`text-2xl font-black italic w-6 text-center ${
                      item.rank === 1 ? 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]' :
                      item.rank === 2 ? 'text-gray-300' :
                      item.rank === 3 ? 'text-amber-600' : 'text-gray-600'
                    }`}>
                      {item.rank}
                    </span>

                    <div className="w-12 h-16 rounded-lg overflow-hidden flex-shrink-0 border border-glass-border group-hover:scale-105 transition-transform">
                      <img src={item.poster} alt={item.title} className="w-full h-full object-cover" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-gray-200 truncate group-hover:text-neon-red transition-colors">
                        {item.title}
                      </h4>
                      <div className="flex items-center space-x-2 text-[10px] text-gray-400 mt-0.5">
                        <span className="text-yellow-400 font-semibold">★ {item.imdb}</span>
                        <span>•</span>
                        <span>{item.views} lượt xem</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </aside>

        </div>
      </main>
    </div>
  );
};

export default DetailFilm;
