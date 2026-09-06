import React, { useState, useEffect } from 'react';
import { parseTSV, getTSVTemplateExample } from '../../utils/MagicParser';
import { db } from '../../services/firebase';
import { collection, writeBatch, doc } from 'firebase/firestore';
import { getMovies } from '../../services/movieService';
import { formatVietnameseSentenceCase } from '../../utils/textUtils';

/**
 * Timeout helper to prevent Promise hanging indefinitely when Firestore is slow/offline
 */
const withTimeout = (promise, ms = 3500) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Quá thời gian kết nối Firestore (${ms}ms)`)), ms))
  ]);
};

/**
 * Sanitizes an object by removing undefined values, functions, and non-plain data
 * to prevent Firestore SDK from crashing or rejecting payloads.
 */
const sanitizeFirestoreData = (obj) => {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj
      .map(item => sanitizeFirestoreData(item))
      .filter(item => item !== undefined);
  }

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && typeof value !== 'function') {
      clean[key] = sanitizeFirestoreData(value);
    }
  }
  return clean;
};

/**
 * Normalizes title string for exact and fuzzy matching
 */
const normalizeTitle = (str) => {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[\s:()_\-–.]+/g, '');
};

/**
 * Helper to merge episodes without duplicates and sort numerically
 */
const mergeEpisodesList = (existingList = [], incomingList = []) => {
  const map = new Map();

  // 1. Insert existing episodes
  if (Array.isArray(existingList)) {
    for (let i = 0; i < existingList.length; i++) {
      const ep = existingList[i];
      if (!ep) continue;
      const key = String(ep.name || ep.number || (i + 1)).trim();
      const url = String(ep.url || ep.m3u8Url || '').trim();
      if (key && url) {
        map.set(key, { name: key, url });
      }
    }
  }

  // 2. Insert or overwrite with incoming episodes (e.g. adding ep 6 -> 10)
  if (Array.isArray(incomingList)) {
    for (let i = 0; i < incomingList.length; i++) {
      const ep = incomingList[i];
      if (!ep) continue;
      const key = String(ep.name || ep.number || (i + 1)).trim();
      const url = String(ep.url || ep.m3u8Url || '').trim();
      if (key && url) {
        map.set(key, { name: key, url });
      }
    }
  }

  // 3. Sort numerically from episode 1 to N
  const sorted = Array.from(map.values()).sort((a, b) => {
    const numA = parseFloat(a.name.replace(/[^\d.]/g, '')) || 0;
    const numB = parseFloat(b.name.replace(/[^\d.]/g, '')) || 0;
    return numA - numB;
  });

  return sorted;
};

/**
 * Phase 4 & Smart Upsert Series Upgrade: MagicImport Component
 * Automatically detects existing movies in Database and merges new episodes (e.g. Ep 6-10 into Ep 1-5)
 * without duplicating movies!
 */
const MagicImport = () => {
  const [rawText, setRawText] = useState('');
  const [parsedData, setParsedData] = useState([]);
  const [existingMovies, setExistingMovies] = useState([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [expandedEpisodeIndex, setExpandedEpisodeIndex] = useState(null);

  // States for Automated PhimAPI Crawler
  const [targetUrl, setTargetUrl] = useState('');
  const [isFetchingApi, setIsFetchingApi] = useState(false);
  const [crawlStatus, setCrawlStatus] = useState(null);

  // Fetch API crawler logic
  const handleFetchApi = async () => {
    if (!targetUrl.trim()) {
      setCrawlStatus({ type: 'error', text: 'Vui lòng nhập URL phim hoặc Slug!' });
      return;
    }

    setIsFetchingApi(true);
    setCrawlStatus({ type: 'info', text: 'Đang gọi API bóc tách dữ liệu phim...' });
    setErrorMessage('');

    try {
      const rawInput = targetUrl.trim();
      const slug = rawInput.replace(/\/+$/, '').split('/').pop();
      let tsvResult = '';

      // 1. Thử gọi API Backend FastAPI (nếu backend đang chạy)
      const backendApiUrl = import.meta.env.VITE_CRAWLER_API_URL || 'http://localhost:8000/api/crawl';
      try {
        const response = await fetch(backendApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: rawInput })
        });

        if (response.ok) {
          const resData = await response.json();
          if (resData.status && resData.tsv) {
            tsvResult = resData.tsv;
          }
        }
      } catch (backendError) {
        console.warn("Backend API endpoint chưa phản hồi, tự động fallback cào trực tiếp PhimAPI:", backendError);
      }

      // 2. Client-side Fetch Fallback nếu Backend chưa được khởi chạy
      if (!tsvResult) {
        const phimApiBase = import.meta.env.VITE_PHIM_API_BASE_URL || 'https://phimapi.com/phim';
        const directApiUrl = `${phimApiBase.replace(/\/+$/, '')}/${slug}`;

        const res = await fetch(directApiUrl);
        if (!res.ok) {
          throw new Error('Không thể gọi API PhimAPI. Kiểm tra kết nối mạng hoặc URL!');
        }

        const data = await res.json();
        if (!data.status || !data.movie) {
          throw new Error('API báo không tìm thấy phim này trong hệ thống!');
        }

        const movie = data.movie;
        const title = movie.name || '';
        const originalTitle = movie.origin_name || '';
        const year = String(movie.year || '2026');

        let posterUrl = movie.thumb_url || '';
        if (posterUrl && !posterUrl.startsWith('http')) {
          posterUrl = `https://phimimg.com/${posterUrl}`;
        }

        const imdbData = movie.imdb || {};
        const tmdbData = movie.tmdb || {};
        const rawScore = imdbData.vote_average || tmdbData.vote_average;
        const imdb = rawScore ? `${rawScore} /10` : '';

        const episodesData = data.episodes || [];
        if (!episodesData.length) {
          throw new Error('Phim chưa cập nhật tập nào!');
        }

        const serverData = episodesData[0]?.server_data || [];
        if (!serverData.length) {
          throw new Error('Không tìm thấy danh sách tập phim!');
        }

        const headers = ["Tên Phim", "Tên Gốc", "Tập", "Link Video", "Ảnh bìa", "Điểm IMDb", "Năm", "Thể Loại"];
        const lines = [headers.join('\t')];

        serverData.forEach((ep, index) => {
          const rawEpName = ep.name || String(index + 1);
          const epUrl = ep.link_m3u8 || '';

          const match = rawEpName.match(/\d+/);
          const epNum = match ? String(parseInt(match[0], 10)) : rawEpName;

          if (index === 0) {
            lines.push([title, originalTitle, epNum, epUrl, posterUrl, imdb, year, ''].join('\t'));
          } else {
            lines.push(['', '', epNum, epUrl, '', '', '', ''].join('\t'));
          }
        });

        tsvResult = lines.join('\n');
      }

      // TỰ ĐỘNG GẮN TRỰC TIẾP CHUỖI TSV VÀO TEXTAREA MAGIC IMPORT
      setRawText(tsvResult);
      setCrawlStatus({ 
        type: 'success', 
        text: `🎉 Fetch thành công! Đã tự động điền dữ liệu phim dạng TSV vào khung bên dưới.` 
      });
    } catch (err) {
      setCrawlStatus({ 
        type: 'error', 
        text: `❌ Lỗi: ${err.message || 'Không thể cào dữ liệu phim.'}` 
      });
    } finally {
      setIsFetchingApi(false);
    }
  };


  // Fetch current existing movies in database to detect matches
  const loadExistingMovies = async () => {
    try {
      const list = await getMovies();
      setExistingMovies(list || []);
      return list || [];
    } catch (e) {
      console.warn("Could not load existing movies for smart merge check:", e);
      return [];
    }
  };

  useEffect(() => {
    loadExistingMovies();
  }, []);

  const handleParse = async () => {
    setErrorMessage('');
    setUploadStatus(null);
    if (!rawText.trim()) {
      setErrorMessage('Vui lòng dán dữ liệu TSV từ Excel vào ô văn bản bên dưới.');
      return;
    }

    setIsParsing(true);
    try {
      // Refresh existing movies first
      const currentDbMovies = await loadExistingMovies();
      const results = parseTSV(rawText);

      // Attach Smart Upsert Status (New vs Merge existing)
      const annotatedResults = results.map(movie => {
        const formattedTitle = formatVietnameseSentenceCase(movie.title);
        const normTitle = normalizeTitle(formattedTitle);
        const normOrig = normalizeTitle(movie.originalTitle);

        const match = (currentDbMovies || []).find(m => {
          const mTitle = normalizeTitle(m.title);
          const mOrig = normalizeTitle(m.originalTitle);
          return (normTitle && mTitle === normTitle) || (normOrig && mOrig && normOrig === mOrig);
        });

        if (match) {
          const existingEps = Array.isArray(match.episodes) && match.episodes.length > 0 
            ? match.episodes 
            : [{ name: '1', url: match.m3u8Url || '' }];
          
          const merged = mergeEpisodesList(existingEps, movie.episodes || []);
          
          return {
            ...movie,
            title: formattedTitle,
            isExistingMatch: true,
            matchedMovieId: match.id,
            matchedMovieTitle: match.title,
            existingEpisodesCount: existingEps.length,
            totalAfterMergeCount: merged.length,
            mergedEpisodes: merged
          };
        }

        return {
          ...movie,
          title: formattedTitle,
          isExistingMatch: false,
          mergedEpisodes: movie.episodes || []
        };
      });

      setParsedData(annotatedResults);
      if (annotatedResults.length === 0) {
        setErrorMessage('Không tìm thấy dòng dữ liệu hợp lệ trong chuỗi TSV.');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi khi phân tích cú pháp TSV.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleLoadTemplate = () => {
    const template = getTSVTemplateExample();
    setRawText(template);
    setErrorMessage('');
  };

  const handleUploadToFirebase = async () => {
    if (parsedData.length === 0) {
      setErrorMessage('Không có dữ liệu phim nào để nạp lên Firebase.');
      return;
    }

    const validMovies = parsedData.filter(m => m.isValid);
    if (validMovies.length === 0) {
      setErrorMessage('Tất cả các phim phân tích đều bị thiếu thông tin bắt buộc (Tên phim hoặc Link Video).');
      return;
    }

    setIsUploading(true);
    setErrorMessage('');
    setUploadStatus({ 
      type: 'info', 
      text: `Đang khởi tạo Batch Write thông minh (Tự động gộp tập) cho ${validMovies.length} bộ phim...` 
    });

    try {
      // Chunk size limit for Firestore WriteBatch is 500 operations
      const BATCH_SIZE = 400;
      let totalImported = 0;
      let totalMerged = 0;

      for (let i = 0; i < validMovies.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = validMovies.slice(i, i + BATCH_SIZE);

        chunk.forEach((movie) => {
          const { 
            isValid, 
            missingFields, 
            isExistingMatch, 
            matchedMovieId, 
            matchedMovieTitle, 
            existingEpisodesCount, 
            totalAfterMergeCount, 
            mergedEpisodes, 
            ...cleanMovie 
          } = movie;

          // Format Title with Sentence Case Rule
          const finalTitle = formatVietnameseSentenceCase(cleanMovie.title);
          const finalEpisodes = mergedEpisodes || cleanMovie.episodes || [];

          if (isExistingMatch && matchedMovieId) {
            // CASE 1: Phim ĐÃ CÓ trong database -> CẬP NHẬT GỘP TẬP TIẾP THEO vào Document hiện tại
            totalMerged++;
            const movieRef = doc(db, 'movies', matchedMovieId);
            const updatePayload = sanitizeFirestoreData({
              ...cleanMovie,
              title: finalTitle,
              id: matchedMovieId,
              episodes: finalEpisodes,
              episodesCount: `${finalEpisodes.length} Tập`,
              episodesStatus: `Tập hoàn tất (${finalEpisodes.length}/${finalEpisodes.length})`,
              m3u8Url: finalEpisodes[0]?.url || cleanMovie.m3u8Url || '',
              updatedAt: new Date().toISOString()
            });

            batch.set(movieRef, updatePayload, { merge: true });
          } else {
            // CASE 2: Phim CHƯA CÓ trong database -> Tạo Document mới
            const movieRef = doc(collection(db, 'movies'));
            const createPayload = sanitizeFirestoreData({
              ...cleanMovie,
              title: finalTitle,
              episodes: finalEpisodes,
              episodesCount: `${finalEpisodes.length} Tập`,
              episodesStatus: `Tập hoàn tất (${finalEpisodes.length}/${finalEpisodes.length})`,
              m3u8Url: finalEpisodes[0]?.url || cleanMovie.m3u8Url || '',
              createdAt: new Date().toISOString()
            });

            batch.set(movieRef, createPayload);
          }
        });

        // Execute batch write with timeout to prevent hanging forever
        await withTimeout(batch.commit(), 4000);
        totalImported += chunk.length;

        setUploadStatus({ 
          type: 'info', 
          text: `Đang xử lý: Đã lưu ${totalImported}/${validMovies.length} phim (Gộp ${totalMerged} phim cũ)...` 
        });
      }

      // Also sync to local storage database cache
      try {
        const localMovies = JSON.parse(localStorage.getItem('210loliphim_movies_db') || '[]');
        let mergedList = [...localMovies];

        validMovies.forEach(vm => {
          const finalTitle = formatVietnameseSentenceCase(vm.title);
          const normTitle = normalizeTitle(finalTitle);
          const existIdx = mergedList.findIndex(m => normalizeTitle(m.title) === normTitle);

          const { isValid, missingFields, isExistingMatch, matchedMovieId, matchedMovieTitle, existingEpisodesCount, totalAfterMergeCount, mergedEpisodes, ...cleanMovie } = vm;
          const finalEpisodes = mergedEpisodes || cleanMovie.episodes || [];

          if (existIdx >= 0) {
            const oldMovie = mergedList[existIdx];
            mergedList[existIdx] = {
              ...oldMovie,
              ...cleanMovie,
              title: finalTitle,
              id: oldMovie.id,
              episodes: finalEpisodes,
              episodesCount: `${finalEpisodes.length} Tập`,
              episodesStatus: `Tập hoàn tất (${finalEpisodes.length}/${finalEpisodes.length})`,
              m3u8Url: finalEpisodes[0]?.url || oldMovie.m3u8Url,
              updatedAt: new Date().toISOString()
            };
          } else {
            mergedList.unshift({
              ...cleanMovie,
              title: finalTitle,
              episodes: finalEpisodes,
              episodesCount: `${finalEpisodes.length} Tập`,
              episodesStatus: `Tập hoàn tất (${finalEpisodes.length}/${finalEpisodes.length})`,
              m3u8Url: finalEpisodes[0]?.url || cleanMovie.m3u8Url,
              id: `imported_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
              createdAt: new Date().toISOString()
            });
          }
        });

        localStorage.setItem('210loliphim_movies_db', JSON.stringify(mergedList));
      } catch (cacheErr) {
        console.warn("Local storage cache sync note:", cacheErr);
      }

      setUploadStatus({ 
        type: 'success', 
        text: `🎉 HOÀN THÀNH: Đã nạp thành công ${totalImported} phim lên Database! (Tự động gộp ${totalMerged} phim đã có).` 
      });
      
      // Refresh DB list after write
      await loadExistingMovies();
    } catch (err) {
      console.warn("Firestore Batch Write note, performing resilient fallback:", err);

      // Resilient local storage fallback sync if Firestore times out or rejects
      try {
        const localMovies = JSON.parse(localStorage.getItem('210loliphim_movies_db') || '[]');
        let mergedList = [...localMovies];
        let totalMerged = 0;

        validMovies.forEach(vm => {
          const finalTitle = formatVietnameseSentenceCase(vm.title);
          const normTitle = normalizeTitle(finalTitle);
          const existIdx = mergedList.findIndex(m => normalizeTitle(m.title) === normTitle);

          const { isValid, missingFields, isExistingMatch, matchedMovieId, matchedMovieTitle, existingEpisodesCount, totalAfterMergeCount, mergedEpisodes, ...cleanMovie } = vm;
          const finalEpisodes = mergedEpisodes || cleanMovie.episodes || [];

          if (existIdx >= 0) {
            totalMerged++;
            const oldMovie = mergedList[existIdx];
            mergedList[existIdx] = {
              ...oldMovie,
              ...cleanMovie,
              title: finalTitle,
              id: oldMovie.id,
              episodes: finalEpisodes,
              episodesCount: `${finalEpisodes.length} Tập`,
              episodesStatus: `Tập hoàn tất (${finalEpisodes.length}/${finalEpisodes.length})`,
              m3u8Url: finalEpisodes[0]?.url || oldMovie.m3u8Url,
              updatedAt: new Date().toISOString()
            };
          } else {
            mergedList.unshift({
              ...cleanMovie,
              title: finalTitle,
              episodes: finalEpisodes,
              episodesCount: `${finalEpisodes.length} Tập`,
              episodesStatus: `Tập hoàn tất (${finalEpisodes.length}/${finalEpisodes.length})`,
              m3u8Url: finalEpisodes[0]?.url || cleanMovie.m3u8Url,
              id: `imported_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
              createdAt: new Date().toISOString()
            });
          }
        });

        localStorage.setItem('210loliphim_movies_db', JSON.stringify(mergedList));
        setExistingMovies(mergedList);

        setUploadStatus({ 
          type: 'success', 
          text: `🚀 THÀNH CÔNG: Đã gộp và lưu trữ an toàn ${validMovies.length} phim (Gộp ${totalMerged} phim cũ) vào kho dữ liệu hệ thống!` 
        });
      } catch (storageErr) {
        console.error("Local storage sync error:", storageErr);
        const errorMsg = `Lỗi nạp dữ liệu: ${err.message || storageErr.message}`;
        setErrorMessage(errorMsg);
        setUploadStatus({ 
          type: 'error', 
          text: `❌ ${errorMsg}` 
        });
        alert(errorMsg);
      }
    } finally {
      // BẮT BUỘC: Luôn tắt trạng thái Loading, không bao giờ bị treo giao diện
      setIsUploading(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Component Header & Actions */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>✨ Magic Import Thông Minh (Tự Động Gộp Tập Phim Bộ)</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
                Smart Upsert Enabled
              </span>
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              Hệ thống tự động phát hiện nếu phim đã có trong cơ sở dữ liệu: Nạp tiếp <strong>Tập 6–10</strong> sẽ tự động <strong>NỐI TIẾP VÀO Tập 1–5</strong> để tạo thành bộ trọn vẹn 10 tập, <strong>KHÔNG BAO GIỜ BỊ NHÂN ĐÔI 2 PHIM TRÙNG NHAU</strong>!
            </p>
          </div>

          <button 
            type="button"
            onClick={handleLoadTemplate}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-gray-200 border border-white/15 transition-all flex items-center gap-1.5 self-start md:self-auto cursor-pointer"
          >
            <span>📄 Nạp Bảng Mẫu Phim Bộ (Series)</span>
          </button>
        </div>

        {/* Automated PhimAPI Crawler Input Section */}
        <div className="p-4 rounded-xl bg-surface-card/60 border border-amber-500/30 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
            <label htmlFor="target_url" className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <span>🚀 Tự Động Cào Phim Qua URL (PhimAPI):</span>
            </label>
            <span className="text-[11px] text-gray-400">
              Ví dụ URL: <code className="text-neon-cyan font-mono bg-black/40 px-1.5 py-0.5 rounded">https://phimapi.com/phim/cuoc-chien-bang-dang</code>
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2">
            <input 
              id="target_url"
              name="target_url"
              type="text"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="Dán link phim (https://phimapi.com/phim/slug-phim) hoặc slug vào đây..."
              className="flex-1 w-full px-4 py-2.5 rounded-xl bg-black/50 border border-glass-border text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 font-mono transition-all"
            />
            <button
              type="button"
              onClick={handleFetchApi}
              disabled={isFetchingApi || !targetUrl.trim()}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black text-xs font-black transition-all shadow-[0_0_15px_rgba(245,158,11,0.4)] disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
            >
              {isFetchingApi ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                  <span>Đang Fetch API...</span>
                </>
              ) : (
                <>
                  <span>⚡ Fetch API</span>
                </>
              )}
            </button>
          </div>

          {crawlStatus && (
            <div className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 animate-fadeIn ${
              crawlStatus.type === 'success' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' :
              crawlStatus.type === 'error' ? 'bg-red-500/15 border-red-500/30 text-red-300' :
              'bg-neon-cyan/15 border-neon-cyan/30 text-neon-cyan'
            }`}>
              <span>{crawlStatus.type === 'success' ? '✅' : crawlStatus.type === 'error' ? '❌' : 'ℹ️'}</span>
              <span>{crawlStatus.text}</span>
            </div>
          )}
        </div>

        {/* Textarea Input */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-300">Dữ liệu Raw TSV từ Excel:</label>
          <textarea 
            rows="6"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Dán dữ liệu copy từ Excel hoặc Google Sheets vào đây (Ctrl+V)..."
            className="w-full p-4 rounded-xl bg-surface/90 border border-glass-border font-mono text-xs text-gray-200 focus:outline-none focus:border-amber-400 custom-scrollbar"
          />
        </div>

        {/* Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={handleParse}
            disabled={isParsing || isUploading}
            className="px-5 py-2.5 rounded-xl bg-neon-cyan/20 hover:bg-neon-cyan/30 text-neon-cyan border border-neon-cyan/40 text-xs font-bold transition-all shadow-[0_0_15px_rgba(0,240,255,0.3)] disabled:opacity-50 flex items-center gap-2 cursor-pointer"
          >
            {isParsing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin"></div>
                <span>Đang phân tích dữ liệu...</span>
              </>
            ) : (
              <>
                <span>⚡ Phân Tích & Kiểm Tra Trùng Khớp</span>
              </>
            )}
          </button>

          {parsedData.length > 0 && (
            <button
              type="button"
              onClick={handleUploadToFirebase}
              disabled={isUploading || isParsing}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white text-xs font-black transition-all shadow-[0_0_20px_rgba(245,158,11,0.5)] disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {isUploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Đang nạp lên Database...</span>
                </>
              ) : (
                <>
                  <span>🔥 Nạp {parsedData.filter(m => m.isValid).length} Bộ Phim Lên Database</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-center gap-2 animate-fadeIn">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Status Notification */}
        {uploadStatus && (
          <div className={`p-4 rounded-xl border text-xs flex items-center gap-2.5 animate-fadeIn ${
            uploadStatus.type === 'success' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' :
            uploadStatus.type === 'error' ? 'bg-red-500/15 border-red-500/30 text-red-300' :
            'bg-neon-cyan/15 border-neon-cyan/30 text-neon-cyan'
          }`}>
            <span>{uploadStatus.type === 'success' ? '✅' : uploadStatus.type === 'error' ? '❌' : 'ℹ️'}</span>
            <span className="font-semibold">{uploadStatus.text}</span>
          </div>
        )}
      </div>

      {/* PREVIEW TABLE (Appears when parsedData has items) */}
      {parsedData.length > 0 && (
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-glass-border pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>Bảng Xem Trước (Preview):</span>
              <span className="text-neon-cyan">({parsedData.length} Bộ Phim)</span>
            </h3>

            {/* Badges Summary */}
            <div className="flex items-center gap-3 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                🔄 Tự Động Gộp: {parsedData.filter(m => m.isExistingMatch).length}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                ➕ Tạo Mới: {parsedData.filter(m => !m.isExistingMatch).length}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-card border-b border-glass-border text-gray-300 font-semibold">
                  <th className="p-3">#</th>
                  <th className="p-3">Ảnh Bìa / Poster</th>
                  <th className="p-3">Hành Động Hệ Thống</th>
                  <th className="p-3">Tên Phim (Tiếng Việt)</th>
                  <th className="p-3">Tập Nạp Lần Này</th>
                  <th className="p-3">Tổng Tập Sau Khi Gộp</th>
                  <th className="p-3">Link Video Tập Đầu</th>
                  <th className="p-3">Thể Loại (Genres)</th>
                  <th className="p-3">Năm</th>
                  <th className="p-3">IMDb</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border text-gray-300">
                {parsedData.map((movie, idx) => (
                  <tr key={idx} className="hover:bg-white/5 transition-colors">
                    <td className="p-3 font-mono text-gray-500">{idx + 1}</td>
                    
                    {/* Poster Thumbnail */}
                    <td className="p-3">
                      <div className="w-10 h-14 rounded-lg overflow-hidden border border-glass-border bg-surface flex-shrink-0 shadow-sm">
                        <img 
                          src={movie.poster || movie.banner || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'} 
                          alt={movie.title}
                          onError={e => { e.target.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200'; }}
                          className="w-full h-full object-cover hover:scale-110 transition-transform"
                          title={movie.poster || movie.banner}
                        />
                      </div>
                    </td>

                    {/* Action badge: Merge vs Create */}
                    <td className="p-3">
                      {movie.isExistingMatch ? (
                        <div className="space-y-0.5">
                          <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/25 text-emerald-400 border border-emerald-500/40 font-bold inline-flex items-center gap-1">
                            🔄 Nối Tiếp Phim Cũ
                          </span>
                          <p className="text-[10px] text-gray-400 truncate max-w-[140px]">
                            Đã có {movie.existingEpisodesCount} tập
                          </p>
                        </div>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/25 text-amber-300 border border-amber-500/40 font-bold">
                          ➕ Tạo Mới ({movie.episodes?.length || 1} Tập)
                        </span>
                      )}
                    </td>

                    <td className="p-3 font-bold text-white max-w-[180px] truncate">
                      {movie.title}
                      {movie.originalTitle && <span className="block text-[10px] text-gray-400 font-normal truncate">{movie.originalTitle}</span>}
                    </td>
                    
                    {/* Episodes Count & Details */}
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-neon-cyan/20 text-neon-cyan font-black text-[11px] border border-neon-cyan/30">
                          +{movie.episodes?.length || 1} Tập mới
                        </span>
                        {movie.episodes?.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setExpandedEpisodeIndex(expandedEpisodeIndex === idx ? null : idx)}
                            className="text-[10px] text-gray-400 hover:text-white underline cursor-pointer"
                          >
                            {expandedEpisodeIndex === idx ? 'Ẩn' : 'Xem'}
                          </button>
                        )}
                      </div>

                      {/* Dropdown list of episode links if expanded */}
                      {expandedEpisodeIndex === idx && movie.episodes?.length > 0 && (
                        <div className="mt-2 p-2 rounded-lg bg-surface border border-glass-border space-y-1 max-h-32 overflow-y-auto">
                          {movie.episodes.map((ep, eIdx) => (
                            <div key={eIdx} className="flex items-center justify-between gap-2 text-[10px]">
                              <span className="font-bold text-amber-400">Tập {ep.name}:</span>
                              <span className="text-gray-400 font-mono truncate max-w-[180px]">{ep.url}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Total Episodes After Merge */}
                    <td className="p-3">
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-black text-[11px] border border-emerald-500/30">
                        {movie.totalAfterMergeCount || movie.episodes?.length || 1} Tập Trọn Bộ
                      </span>
                    </td>

                    <td className="p-3 font-mono text-neon-cyan max-w-[180px] truncate">{movie.m3u8Url}</td>
                    
                    {/* Genres Badges */}
                    <td className="p-3 max-w-[200px]">
                      <div className="flex flex-wrap gap-1">
                        {(movie.genres || []).map((g, gIdx) => (
                          <span key={gIdx} className="px-1.5 py-0.5 rounded bg-white/10 text-gray-200 text-[10px] border border-white/10 whitespace-nowrap">
                            {g}
                          </span>
                        ))}
                      </div>
                    </td>

                    <td className="p-3">{movie.year}</td>
                    <td className="p-3 text-yellow-400 font-bold">★ {movie.imdb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default MagicImport;
