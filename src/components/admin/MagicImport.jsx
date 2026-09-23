import React, { useState, useEffect } from 'react';
import { parseTSV, getTSVTemplateExample } from '../../utils/MagicParser';
import { getMovies, addMovie, updateMovie } from '../../services/movieService';
import { api } from '../../services/api';
import { formatVietnameseSentenceCase } from '../../utils/textUtils';

/**
 * Timeout helper to prevent Promise hanging indefinitely when Firestore is slow/offline
 */
const normalizeTitle = (str) => {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[\s:()_\-–.]+/g, '');
};

/**
 * Normalizes episode identifier string (e.g. "Tập 1", "01", "1" -> "1")
 */
const normalizeEpisodeKey = (nameOrNum) => {
  const str = String(nameOrNum || '').trim();
  const match = str.match(/\d+/);
  return match ? String(parseInt(match[0], 10)) : str.toLowerCase();
};

/**
 * Helper to find episodes in incomingList that do NOT exist in existingList
 */
const findNewEpisodesOnly = (existingList = [], incomingList = []) => {
  const existingSet = new Set();
  if (Array.isArray(existingList)) {
    for (const ep of existingList) {
      if (!ep) continue;
      const key = normalizeEpisodeKey(ep.name || ep.number);
      if (key) existingSet.add(key);
    }
  }

  const newEps = [];
  if (Array.isArray(incomingList)) {
    for (const ep of incomingList) {
      if (!ep) continue;
      const key = normalizeEpisodeKey(ep.name || ep.number);
      if (key && !existingSet.has(key)) {
        newEps.push(ep);
      }
    }
  }

  return newEps;
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
      const key = normalizeEpisodeKey(ep.name || ep.number || (i + 1));
      const displayKey = String(ep.name || ep.number || (i + 1)).trim();
      const url = String(ep.url || ep.m3u8Url || '').trim();
      if (key && url) {
        map.set(key, { name: displayKey, url });
      }
    }
  }

  // 2. Insert or overwrite with incoming episodes
  if (Array.isArray(incomingList)) {
    for (let i = 0; i < incomingList.length; i++) {
      const ep = incomingList[i];
      if (!ep) continue;
      const key = normalizeEpisodeKey(ep.name || ep.number || (i + 1));
      const displayKey = String(ep.name || ep.number || (i + 1)).trim();
      const url = String(ep.url || ep.m3u8Url || '').trim();
      if (key && url) {
        map.set(key, { name: displayKey, url });
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
 * Component MagicImport Upgrade:
 * 1. Hỗ trợ bỏ link CẢ MỘT TRANG danh sách hoặc 1 phim lẻ vào ô Input URL.
 * 2. Phân tích 3 Kịch bản đối chiếu với DB:
 *    - Status 'new': Phim chưa có trong DB (+1 Tạo mới).
 *    - Status 'update': Phim có trong DB + Có tập mới (+1 Tự động gộp).
 *    - Status 'duplicate': Phim có trong DB + Không có tập mới (+1 Đã trùng - Bỏ qua).
 * 3. Hiển thị 3 bộ đếm (Tạo mới, Tự động gộp, Đã trùng) & Bảng Preview thông minh.
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

  // States for Automated PhimAPI Crawler (Support List & Single URLs)
  const [targetUrl, setTargetUrl] = useState('');
  const [isFetchingApi, setIsFetchingApi] = useState(false);
  const [crawlStatus, setCrawlStatus] = useState(null);

  // Fetch API crawler logic (Runs Backend FastAPI Multi-threaded Crawl with Client Fallback)
  const handleFetchApi = async () => {
    if (!targetUrl.trim()) {
      setCrawlStatus({ type: 'error', text: 'Vui lòng nhập URL phim hoặc link trang danh sách phim!' });
      return;
    }

    setIsFetchingApi(true);
    setCrawlStatus({ type: 'info', text: '🌐 Đang gọi API bóc tách dữ liệu phim (Đa luồng)...' });
    setErrorMessage('');

    try {
      const data = await api('/api/crawl', { method: 'POST', body: { url: targetUrl.trim() } });
      const tsvResult = data.tsv;
      const crawledCount = data.crawled_count;
      if (data.failed_count) setErrorMessage('Có ' + data.failed_count + ' phim không tải được; preview chỉ có phần thành công.');
      setRawText(tsvResult);
      setCrawlStatus({ 
        type: 'success', 
        text: `🎉 Fetch thành công! Đã tự động cào và điền dữ liệu TSV của ${crawledCount} phim vào ô bên dưới.` 
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
      throw e;
    }
  };

  useEffect(() => {
    loadExistingMovies().catch(error => setErrorMessage(error.message));
  }, []);

  /**
   * Logic Phân Tích & Kiểm Tra Trùng Khớp 3 Kịch Bản:
   * 1. Kịch bản 1 ('new'): Phim chưa có trong DB -> [+ Tạo mới (X tập)]
   * 2. Kịch bản 2 ('update'): Phim đã có trong DB + CÓ TẬP MỚI -> [🔄 Tự Động Gộp (+X Tập Mới)]
   * 3. Kịch bản 3 ('duplicate'): Phim đã có trong DB + KHÔNG CÓ TẬP MỚI -> [✅ Đã Trùng - Bỏ qua]
   */
  const handleParse = async () => {
    setErrorMessage('');
    setUploadStatus(null);
    if (!rawText.trim()) {
      setErrorMessage('Vui lòng dán dữ liệu TSV từ Excel vào ô văn bản bên dưới.');
      return;
    }

    setIsParsing(true);
    try {
      const currentDbMovies = await loadExistingMovies();
      const results = parseTSV(rawText);

      const annotatedResults = results.map(movie => {
        const formattedTitle = formatVietnameseSentenceCase(movie.title);
        const normTitle = normalizeTitle(formattedTitle);
        const normOrig = normalizeTitle(movie.originalTitle);
        const normSlug = normalizeTitle(movie.slug);

        // Tim kiem phim trong DB theo Title hoặc Original Title hoặc Slug (Bỏ qua so sánh Ảnh Bìa)
        const match = (currentDbMovies || []).find(m => {
          const mTitle = normalizeTitle(m.title);
          const mOrig = normalizeTitle(m.originalTitle);
          const mSlug = normalizeTitle(m.slug || m.id);
          return (
            (normSlug && mSlug && normSlug === mSlug) ||
            (normTitle && mTitle === normTitle) ||
            (normOrig && mOrig && normOrig === mOrig)
          );
        });

        // -------------------------------------------------------------------
        // KỊCH BẢN 1: PHIM CHƯA CÓ TRONG DB -> status = 'new'
        // -------------------------------------------------------------------
        if (!match) {
          return {
            ...movie,
            title: formattedTitle,
            importAction: 'new',
            isExistingMatch: false,
            newEpisodes: movie.episodes || [],
            newEpisodesCount: movie.episodes?.length || 1,
            existingEpisodesCount: 0,
            totalAfterMergeCount: movie.episodes?.length || 1,
            mergedEpisodes: movie.episodes || []
          };
        }

        // Phim đã có trong DB -> Trích xuất mảng tập đang có
        const existingEps = Array.isArray(match.episodes) && match.episodes.length > 0 
          ? match.episodes 
          : [{ name: '1', url: match.m3u8Url || '' }];

        const incomingCountry = String(movie.country || '').trim();
        const existingCountry = String(match.country || '').trim();
        const hasCountryUpdate = Boolean(incomingCountry && incomingCountry !== existingCountry);

        const incomingDirector = String(movie.director || '').trim();
        const existingDirector = String(match.director || '').trim();
        const hasDirectorUpdate = Boolean(incomingDirector && incomingDirector !== existingDirector && incomingDirector !== 'Đang cập nhật');

        const incomingStatus = String(movie.status || '').trim();
        const existingStatus = String(match.status || '').trim();
        const hasStatusUpdate = Boolean(incomingStatus && incomingStatus !== existingStatus);

        const incomingEpCurrent = String(movie.episodeCurrent || movie.episodesStatus || '').trim();
        const existingEpCurrent = String(match.episodeCurrent || match.episodesStatus || '').trim();
        const hasEpisodeCurrentUpdate = Boolean(incomingEpCurrent && incomingEpCurrent !== existingEpCurrent);

        // Trích xuất CHỈ NHỮNG TẬP MỚI
        const newEpsOnly = findNewEpisodesOnly(existingEps, movie.episodes || []);
        const hasNewEpisodes = newEpsOnly.length > 0;
        const merged = mergeEpisodesList(existingEps, movie.episodes || []);

        const hasEpisodeUrlUpdate = JSON.stringify(merged) !== JSON.stringify(existingEps);
        const hasAnyUpdate = hasEpisodeUrlUpdate || hasNewEpisodes || hasCountryUpdate || hasDirectorUpdate || hasStatusUpdate || hasEpisodeCurrentUpdate;

        if (hasAnyUpdate) {
          // -------------------------------------------------------------------
          // KỊCH BẢN 2: PHIM ĐÃ CÓ TRONG DB, CÓ THAY ĐỔI 1 TRONG 5 TRƯỜNG -> status = 'update'
          // -------------------------------------------------------------------
          const updateReasons = [];
          if (hasNewEpisodes) updateReasons.push(`+${newEpsOnly.length} Tập Mới`);
          if (hasCountryUpdate) updateReasons.push(`Quốc gia (${incomingCountry})`);
          if (hasDirectorUpdate) updateReasons.push(`Đạo diễn (${incomingDirector})`);
          if (hasStatusUpdate) updateReasons.push(`Trạng thái (${incomingStatus})`);
          if (hasEpisodeCurrentUpdate) updateReasons.push(`Tập hiện tại (${incomingEpCurrent})`);

          const updateReasonText = `🔄 Gộp (${updateReasons.join(', ')})`;

          return {
            ...movie,
            title: formattedTitle,
            importAction: 'update',
            isExistingMatch: true,
            matchedMovieId: match.id,
            matchedRevision: match._revision || 0,
            matchedMovieTitle: match.title,
            hasNewEpisodes,
            hasCountryUpdate,
            hasDirectorUpdate,
            hasStatusUpdate,
            hasEpisodeCurrentUpdate,
            updateReasonText,
            country: incomingCountry || existingCountry,
            director: incomingDirector || existingDirector,
            movieStatus: incomingStatus || existingStatus,
            episodeCurrent: incomingEpCurrent || existingEpCurrent,
            episodesStatus: incomingEpCurrent || movie.episodesStatus || match.episodesStatus,
            newEpisodes: newEpsOnly,
            newEpisodesCount: newEpsOnly.length,
            existingEpisodesCount: existingEps.length,
            totalAfterMergeCount: merged.length,
            mergedEpisodes: merged
          };
        } else {
          // -------------------------------------------------------------------
          // KỊCH BẢN 3: PHIM ĐÃ CÓ TRONG DB, KHÔNG CÓ BẤT KỲ THAY ĐỔI NÀO -> status = 'duplicate'
          // -------------------------------------------------------------------
          return {
            ...movie,
            title: formattedTitle,
            importAction: 'duplicate',
            isExistingMatch: true,
            matchedMovieId: match.id,
            matchedRevision: match._revision || 0,
            matchedMovieTitle: match.title,
            hasNewEpisodes: false,
            hasCountryUpdate: false,
            hasDirectorUpdate: false,
            hasStatusUpdate: false,
            hasEpisodeCurrentUpdate: false,
            country: existingCountry || incomingCountry,
            director: existingDirector || incomingDirector,
            episodeCurrent: existingEpCurrent || incomingEpCurrent,
            newEpisodes: [],
            newEpisodesCount: 0,
            existingEpisodesCount: existingEps.length,
            totalAfterMergeCount: existingEps.length,
            mergedEpisodes: existingEps
          };
        }
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

  // Nạp dữ liệu lên Database (Bỏ qua các phim có status === 'duplicate')
  const handleUploadToFirebase = async () => {
    if (parsedData.length === 0) {
      setErrorMessage('Không có dữ liệu phim nào để nạp.');
      return;
    }

    // CHỈ NẠP CÁC PHIM TẠO MỚI ('new') HOẶC CÓ TẬP MỚI ('update') - BỎ QUA 'duplicate'
    const validMovies = parsedData.filter(m => m.isValid && m.importAction !== 'duplicate');
    if (validMovies.length === 0) {
      setErrorMessage('Tất cả các phim trong danh sách phân tích đều ĐÃ TRÙNG HOÀN TOÀN với Database (Đã bỏ qua). Không có tập mới nào để nạp!');
      return;
    }

    setIsUploading(true);
    setErrorMessage('');
    setUploadStatus({ 
      type: 'info', 
      text: `Đang khởi tạo Batch Write cho ${validMovies.length} bộ phim (Đã bỏ qua các phim trùng)...` 
    });

    let savedCount = 0;
    try {
      for (const movie of validMovies) {
        const { importAction, matchedMovieId, matchedRevision, mergedEpisodes, isValid, missingFields,
          isExistingMatch, matchedMovieTitle, existingEpisodesCount, totalAfterMergeCount,
          newEpisodes, newEpisodesCount, hasNewEpisodes, hasCountryUpdate, hasDirectorUpdate,
          hasStatusUpdate, hasEpisodeCurrentUpdate, updateReasonText, movieStatus, ...data } = movie;
        const episodes = mergedEpisodes || data.episodes || [];
        const payload = {
          ...data, episodes, episodesCount: episodes.length + ' Tập',
          status: movieStatus || data.status || 'ongoing',
          episodesStatus: data.episodeCurrent || data.episodesStatus || '',
          m3u8Url: episodes[0]?.url || data.m3u8Url || ''
        };
        if (importAction === 'update') {
          await updateMovie(matchedMovieId, { ...payload, _revision: matchedRevision });
        } else {
          await addMovie(payload);
        }
        savedCount++;
      }
      setUploadStatus({ type: 'success', text: 'Đã lưu ' + savedCount + ' phim lên kho dữ liệu.' });
      await loadExistingMovies();
      setParsedData([]);
    } catch (err) {
      setUploadStatus({ type: 'error', text: 'Đã xác nhận lưu ' + savedCount + '/' + validMovies.length + ' phim. Phần còn lại chưa được xác nhận. Hãy phân tích lại trước khi thử lại. ' + err.message });
      setErrorMessage(err.message);
      setParsedData([]);
    } finally {
      setIsUploading(false);
    }
  };

  const countNew = parsedData.filter(m => m.importAction === 'new').length;
  const countUpdate = parsedData.filter(m => m.importAction === 'update').length;
  const countDuplicate = parsedData.filter(m => m.importAction === 'duplicate').length;

  return (
    <div className="w-full space-y-6">
      {/* Component Header & Actions */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>✨ Magic Import & Crawl Phim Đa Luồng</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
                Multi-Thread Enabled
              </span>
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              Hỗ trợ nhập link <strong>CẢ TRANG DANH SÁCH</strong> hoặc <strong>1 Phim lẻ</strong>. Tự động phân loại 3 kịch bản: <strong>Tạo mới</strong>, <strong>Gộp tập mới</strong>, và <strong>Bỏ qua trùng hoàn toàn</strong>.
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
              <span>🚀 Tự Động Cào Phim Qua URL (Hỗ trợ Trang Danh Sách / Phim Lẻ):</span>
            </label>
            <span className="text-[11px] text-gray-400">
              Ví dụ: <code className="text-neon-cyan font-mono bg-black/40 px-1.5 py-0.5 rounded">https://www.kkphim1.com/danh-sach/hoat-hinh?country=nhat-ban&page=2</code>
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2">
            <input 
              id="target_url"
              name="target_url"
              type="text"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="Dán link cả trang danh sách hoặc link 1 phim lẻ vào đây..."
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
                  <span>Đang Cào Đa Luồng...</span>
                </>
              ) : (
                <>
                  <span>⚡ Fetch & Cào API</span>
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
          <label className="text-xs font-semibold text-gray-300">Dữ liệu Raw TSV từ Excel / Cào tự động:</label>
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
              disabled={isUploading || isParsing || (countNew === 0 && countUpdate === 0)}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white text-xs font-black transition-all shadow-[0_0_20px_rgba(245,158,11,0.5)] disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {isUploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Đang nạp lên Database...</span>
                </>
              ) : (
                <>
                  <span>🔥 Nạp {countNew + countUpdate} Bộ Phim Lên DB ({countDuplicate} Trùng - Bỏ Qua)</span>
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

      {/* PREVIEW PANEL & 3 SCENARIOS COUNTERS */}
      {parsedData.length > 0 && (
        <div className="glass-panel p-6 rounded-2xl space-y-5">
          {/* Header Title */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-glass-border pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>Bảng Xem Trước (Preview):</span>
              <span className="text-neon-cyan">({parsedData.length} Bộ Phim)</span>
            </h3>
          </div>

          {/* 3 COUNTERS SUMMARY CARDS UI */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* 1. Tạo Mới */}
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">➕</span>
                <div>
                  <div className="text-xs text-amber-300 font-bold">Tạo Mới</div>
                  <div className="text-[10px] text-amber-400/70">Phim chưa có trong DB</div>
                </div>
              </div>
              <span className="text-xl font-black text-amber-400 font-mono">
                {countNew}
              </span>
            </div>

            {/* 2. Tự Động Gộp */}
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">🔄</span>
                <div>
                  <div className="text-xs text-emerald-300 font-bold">Tự Động Gộp Tập</div>
                  <div className="text-[10px] text-emerald-400/70">Phim cũ + Có tập mới</div>
                </div>
              </div>
              <span className="text-xl font-black text-emerald-400 font-mono">
                {countUpdate}
              </span>
            </div>

            {/* 3. Đã Trùng */}
            <div className="p-3.5 rounded-xl bg-slate-500/10 border border-slate-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">✅</span>
                <div>
                  <div className="text-xs text-slate-300 font-bold">Đã Trùng (Bỏ Qua)</div>
                  <div className="text-[10px] text-slate-400/70">Không có tập mới nào</div>
                </div>
              </div>
              <span className="text-xl font-black text-slate-300 font-mono">
                {countDuplicate}
              </span>
            </div>
          </div>

          {/* TABLE PREVIEW */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-card border-b border-glass-border text-gray-300 font-semibold">
                  <th className="p-3">#</th>
                  <th className="p-3">Ảnh Bìa / Poster</th>
                  <th className="p-3">Trạng Thái Hệ Thống</th>
                  <th className="p-3">Tên Phim (Tiếng Việt)</th>
                  <th className="p-3">Chi Tiết Tập Phim</th>
                  <th className="p-3">Tổng Tập Sau Gộp</th>
                  <th className="p-3">Link Video Tập Đầu</th>
                  <th className="p-3">Năm</th>
                  <th className="p-3">Quốc Gia</th>
                  <th className="p-3">IMDb</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border text-gray-300">
                {parsedData.map((movie, idx) => (
                  <tr key={idx} className={`transition-colors ${
                    movie.importAction === 'duplicate' ? 'opacity-60 bg-white/[0.01]' : 'hover:bg-white/5'
                  }`}>
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

                    {/* Action badge for 3 Scenarios */}
                    <td className="p-3">
                      {movie.importAction === 'new' && (
                        <span className="px-2.5 py-1 rounded-lg text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold inline-flex items-center gap-1">
                          ➕ Tạo Mới ({movie.episodes?.length || 1} Tập)
                        </span>
                      )}

                      {movie.importAction === 'update' && (
                        <div className="space-y-0.5">
                          <span className="px-2.5 py-1 rounded-lg text-[11px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold inline-flex items-center gap-1">
                            {movie.updateReasonText || `🔄 Tự Động Gộp (+${movie.newEpisodesCount} Tập Mới)`}
                          </span>
                          <p className="text-[10px] text-gray-400 truncate max-w-[170px]">
                            {movie.hasNewEpisodes ? `Đã có sẵn ${movie.existingEpisodesCount} tập` : `Cập nhật Quốc gia: ${movie.country}`}
                          </p>
                        </div>
                      )}

                      {movie.importAction === 'duplicate' && (
                        <span className="px-2.5 py-1 rounded-lg text-[11px] bg-slate-700/50 text-slate-400 border border-slate-600/50 font-semibold inline-flex items-center gap-1">
                          ✅ Đã Trùng - Bỏ Qua
                        </span>
                      )}
                    </td>

                    <td className="p-3 font-bold text-white max-w-[180px] truncate">
                      {movie.title}
                      {movie.originalTitle && <span className="block text-[10px] text-gray-400 font-normal truncate">{movie.originalTitle}</span>}
                    </td>
                    
                    {/* Episodes Count & Details */}
                    <td className="p-3">
                      {movie.importAction === 'duplicate' ? (
                        <span className="text-[11px] text-slate-400 italic">Đã trùng - Bỏ qua</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded-full bg-neon-cyan/20 text-neon-cyan font-black text-[11px] border border-neon-cyan/30">
                            +{movie.newEpisodesCount || movie.episodes?.length || 1} Tập mới
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
                      )}

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
                    <td className="p-3">{movie.year}</td>
                    <td className="p-3 font-semibold text-emerald-300">{movie.country || 'N/A'}</td>
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
