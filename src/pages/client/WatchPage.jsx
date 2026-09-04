import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import VideoPlayer from '../../components/player/VideoPlayer';
import Navbar from '../../components/common/Navbar';
import { getMovies } from '../../services/movieService';
import { useAuth } from '../../contexts/AuthContext';
import { 
  recordWatchHistory, 
  updateWatchPlaybackPosition, 
  getMovieHistory,
  formatDurationToMinutesSeconds 
} from '../../services/historyService';
import { formatVietnameseSentenceCase } from '../../utils/textUtils';

const WatchPage = () => {
  const { id } = useParams();
  const { currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const episodeParam = searchParams.get('ep') || '1';
  
  const playerRef = useRef(null);
  const lastSavedTimeRef = useRef(0);
  const [currentMovie, setCurrentMovie] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeEpisodeState, setActiveEpisodeState] = useState(episodeParam);
  const [resumePrompt, setResumePrompt] = useState(null); // { savedTime: number, formattedTime: string }

  useEffect(() => {
    setActiveEpisodeState(episodeParam);
  }, [episodeParam]);

  useEffect(() => {
    const fetchWatchMovie = async () => {
      setIsLoading(true);
      setCurrentMovie(null);

      try {
        const moviesList = await getMovies();
        const found = (moviesList || []).find(m => String(m.id) === String(id) || String(m.id) === String(id?.trim()));

        if (found) {
          setCurrentMovie(found);
        } else if (moviesList && moviesList.length > 0) {
          setCurrentMovie(moviesList[0]);
        }
      } catch (err) {
        console.error("Error loading watch movie for ID:", id, err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchWatchMovie();
    window.scrollTo(0, 0);
  }, [id]);

  // Resolve episodes list safely
  const movieEpisodesList = currentMovie?.episodes || [];
  const episodes = Array.isArray(movieEpisodesList) && movieEpisodesList.length > 0
    ? movieEpisodesList
    : [{ name: '1', url: currentMovie?.m3u8Url || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' }];

  const activeEpisodeObj = episodes.find(ep => String(ep.name || ep.number) === String(activeEpisodeState)) || episodes[0];
  const activeStreamUrl = activeEpisodeObj?.url || activeEpisodeObj?.m3u8Url || currentMovie?.m3u8Url || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
  const currentEpName = activeEpisodeObj?.name || activeEpisodeObj?.number || activeEpisodeState;
  const formattedTitle = formatVietnameseSentenceCase(currentMovie?.title || 'Phim mới');

  // Check saved progress and show resume dialog if user previously stopped mid-video
  useEffect(() => {
    if (currentUser?.username && id) {
      const historyItem = getMovieHistory(currentUser.username, id);
      if (
        historyItem && 
        historyItem.currentTime && 
        historyItem.currentTime > 5 && 
        String(historyItem.episode) === String(currentEpName)
      ) {
        setResumePrompt({
          savedTime: historyItem.currentTime,
          formattedTime: formatDurationToMinutesSeconds(historyItem.currentTime)
        });
      } else {
        setResumePrompt(null);
      }
    }
  }, [currentUser?.username, id, currentEpName]);

  // Initial history recording when entering watch page
  useEffect(() => {
    if (currentUser?.username && currentMovie && currentMovie.id) {
      recordWatchHistory(currentUser.username, currentMovie, currentEpName);
    }
  }, [currentUser?.username, currentMovie, currentEpName]);

  // Throttled playback position tracking
  const handleTimeUpdate = useCallback((currentTime, duration) => {
    if (!currentUser?.username || !id) return;
    
    // Save to DB every 2.5 seconds or when currentTime progresses noticeably
    if (Math.abs(currentTime - lastSavedTimeRef.current) >= 2.5) {
      lastSavedTimeRef.current = currentTime;
      updateWatchPlaybackPosition(currentUser.username, id, currentEpName, currentTime, duration);
    }
  }, [currentUser?.username, id, currentEpName]);

  // Action: Resume from saved position
  const handleResumeWatching = () => {
    if (!resumePrompt) return;
    const targetTime = resumePrompt.savedTime;
    setResumePrompt(null);
    if (playerRef.current) {
      playerRef.current.seekTo(targetTime);
      playerRef.current.play();
    }
  };

  // Action: Restart from beginning (0s)
  const handleRestartFromBeginning = () => {
    setResumePrompt(null);
    if (currentUser?.username && id) {
      updateWatchPlaybackPosition(currentUser.username, id, currentEpName, 0);
    }
    if (playerRef.current) {
      playerRef.current.seekTo(0);
      playerRef.current.play();
    }
  };

  const handlePlayExternal = () => {
    if (playerRef.current) {
      playerRef.current.play();
    }
  };

  const handleSeekForward = () => {
    if (playerRef.current) {
      playerRef.current.seek(15);
    }
  };

  const handleSelectEpisode = (epNum) => {
    setActiveEpisodeState(String(epNum));
    setSearchParams({ ep: String(epNum) });
  };

  if (isLoading || !currentMovie) {
    return (
      <div className="min-h-screen bg-background text-white flex flex-col justify-center items-center space-y-4">
        <div className="w-12 h-12 rounded-full border-4 border-neon-red border-t-transparent animate-spin"></div>
        <p className="text-xs text-gray-400 font-bold">Đang nạp luồng phát video...</p>
      </div>
    );
  }

  const {
    id: activeId,
    originalTitle,
    poster,
    banner,
    quality = '4K UltraHD',
    year = '2024'
  } = currentMovie;

  return (
    <div className="min-h-screen bg-background text-white pb-20">
      <main className="pt-24 px-4 md:px-12 max-w-7xl mx-auto space-y-6">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center space-x-2 text-sm text-gray-400">
          <Link to="/" className="hover:text-neon-red transition-colors">Trang chủ</Link>
          <span>/</span>
          <Link to={`/movie/${activeId}`} className="hover:text-neon-cyan transition-colors">{formattedTitle}</Link>
          <span>/</span>
          <span className="text-amber-400 font-bold">Tập {currentEpName}</span>
        </div>

        {/* Resume Watching Prompt Dialog Overlay */}
        {resumePrompt && (
          <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-[#1b223d] to-[#161c36] border border-amber-400/40 shadow-[0_0_30px_rgba(245,158,11,0.25)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-scaleUp">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-xl flex-shrink-0">
                ⏱️
              </div>
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Tiếp tục xem phim?</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-amber-400 text-black font-black">
                    {resumePrompt.formattedTime}
                  </span>
                </h4>
                <p className="text-xs text-gray-300 mt-0.5">
                  Bạn đã xem đến <strong className="text-amber-300">{resumePrompt.formattedTime}</strong> ở Tập {currentEpName}. Bạn có muốn tiếp tục xem không?
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleResumeWatching}
                className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-black font-black text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-1.5 hover:scale-105"
              >
                <span>▶ Tiếp tục</span>
              </button>
              <button
                type="button"
                onClick={handleRestartFromBeginning}
                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-200 hover:text-white border border-white/15 font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <span>🔄 Từ đầu</span>
              </button>
              <button
                type="button"
                onClick={() => setResumePrompt(null)}
                className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 text-xs transition-all cursor-pointer"
                title="Đóng thông báo"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Video Player Container */}
        <div className="w-full bg-surface-card rounded-2xl overflow-hidden border border-glass-border shadow-2xl">
          <VideoPlayer 
            key={`${activeId}-${currentEpName}-${activeStreamUrl}`}
            ref={playerRef}
            url={activeStreamUrl}
            title={`${formattedTitle} - Tập ${currentEpName} (${quality})`}
            poster={banner || poster}
            onTimeUpdate={handleTimeUpdate}
          />
        </div>

        {/* Player External Controls Test & Movie Information */}
        <div className="p-6 rounded-2xl glass-panel flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <span>{formattedTitle} ({year})</span>
              <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-neon-red text-white shadow-[0_0_10px_rgba(229,9,20,0.5)]">
                Tập {currentEpName}
              </span>
            </h1>
            <p className="text-gray-400 text-xs sm:text-sm mt-1 font-mono">
              {originalTitle ? `${originalTitle} • ` : ''}Nguồn: KKPhim Luồng M3U8 Trực Tiếp • {quality}
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button 
              type="button"
              onClick={handlePlayExternal}
              className="px-4 py-2 rounded-xl bg-neon-red/20 hover:bg-neon-red/30 border border-neon-red/40 text-neon-red text-sm font-semibold transition-all cursor-pointer"
            >
              ▶ Play()
            </button>
            <button 
              type="button"
              onClick={handleSeekForward}
              className="px-4 py-2 rounded-xl bg-neon-cyan/20 hover:bg-neon-cyan/30 border border-neon-cyan/40 text-neon-cyan text-sm font-semibold transition-all cursor-pointer"
            >
              ⏩ Seek +15s
            </button>
          </div>
        </div>

        {/* Episodes Selection Grid Component in Watch Page */}
        <div className="p-6 rounded-2xl glass-panel space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-4 bg-amber-400 rounded-full"></span>
              <span>Danh Sách Chọn Tập Phim</span>
              <span className="text-xs text-amber-400 font-extrabold px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/30">
                {episodes.length} Tập
              </span>
            </h3>
            <span className="text-xs text-neon-cyan font-semibold">Click tập bất kỳ để chuyển luồng phát ngay lập tức</span>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2.5">
            {episodes.map((ep, idx) => {
              const epNum = ep.name || ep.number || (idx + 1);
              const isActive = String(epNum) === String(currentEpName);
              const formattedEpNumber = String(epNum).padStart(2, '0');

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectEpisode(epNum)}
                  className={`py-3 px-2 rounded-xl text-center text-xs font-bold transition-all border cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                    isActive
                      ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-black border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.6)] scale-105 font-black'
                      : 'bg-surface/80 text-gray-300 hover:text-white border-white/10 hover:border-amber-400/50 hover:bg-white/10'
                  }`}
                >
                  <span className="text-[10px] opacity-75 font-normal">Tập</span>
                  <span className="text-sm font-black">{formattedEpNumber}</span>
                </button>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
};

export default WatchPage;
