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
 * Normalizes title string for exact and fuzzy matching (ignoring symbols & spaces)
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
      const rawInput = targetUrl.trim();
      let tsvResult = '';
      let crawledCount = 0;

      // 1. Gọi API Backend FastAPI (Chạy cào ĐA LUỒNG Asyncio + Httpx)
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
            crawledCount = resData.crawled_count || 1;
          }
        }
      } catch (backendError) {
        console.warn("Backend API chưa chạy hoặc offline, chuyển sang Client Fallback:", backendError);
      }

      // 2. Client-side Fetch Fallback nếu Backend chưa được khởi chạy
      if (!tsvResult) {
        const lowerUrl = rawInput.toLowerCase();
        const isList = lowerUrl.includes('/danh-sach/') || lowerUrl.includes('/quoc-gia/') || lowerUrl.includes('/the-loai/') || lowerUrl.includes('phimapi.com/v1/api/') || lowerUrl.includes('page=');

        if (isList) {
          // Client Fallback: Trang Danh Sách
          let listApiUrl = rawInput;
          if (!rawInput.includes('phimapi.com/v1/api/')) {
            const path = rawInput.replace(/^https?:\/\/[^\/]+/, '').split('?')[0].replace(/\/+$/, '');
            const query = rawInput.includes('?') ? rawInput.split('?')[1] : '';
            if (path.includes('/danh-sach/')) {
              const cat = path.split('/danh-sach/')[1];
              listApiUrl = `https://phimapi.com/v1/api/danh-sach/${cat}${query ? '?' + query : ''}`;
            } else if (path.includes('/quoc-gia/')) {
              const cat = path.split('/quoc-gia/')[1];
              listApiUrl = `https://phimapi.com/v1/api/quoc-gia/${cat}${query ? '?' + query : ''}`;
            } else if (path.includes('/the-loai/')) {
              const cat = path.split('/the-loai/')[1];
              listApiUrl = `https://phimapi.com/v1/api/the-loai/${cat}${query ? '?' + query : ''}`;
            }
          }

          const res = await fetch(listApiUrl);
          if (!res.ok) throw new Error('Không thể truy cập API danh sách phim!');
          const listJson = await res.json();
          const items = listJson.data?.items || listJson.items || [];
          if (!items.length) throw new Error('Không tìm thấy phim nào trong trang danh sách này!');

          // Promise.all cào đồng thời chi tiết các phim
          const moviePromises = items.map(async (item) => {
            try {
              const mRes = await fetch(`https://phimapi.com/phim/${item.slug}`);
              if (!mRes.ok) return null;
              const mData = await mRes.json();
              return mData.status ? mData : null;
            } catch (e) {
              return null;
            }
          });

          const movieResults = (await Promise.all(moviePromises)).filter(Boolean);
          if (!movieResults.length) throw new Error('Tất cả các phim trong danh sách đều không cào được!');

          crawledCount = movieResults.length;
          const headers = ["Tên Phim", "Tên Gốc", "Tập", "Link Video", "Ảnh bìa", "Điểm IMDb", "Năm", "Quốc Gia", "Thể Loại"];
          const lines = [headers.join('\t')];

          movieResults.forEach(data => {
            const movie = data.movie || {};
            const title = movie.name || '';
            const originalTitle = movie.origin_name || '';
            const year = String(movie.year || '2026');
            let posterUrl = movie.poster_url || movie.thumb_url || '';
            if (posterUrl && !posterUrl.startsWith('http')) posterUrl = `https://phimimg.com/${posterUrl}`;
            const rawScore = movie.imdb?.vote_average || movie.tmdb?.vote_average;
            const imdb = rawScore ? `${rawScore} /10` : '';

            const countryData = movie.country;
            let countryStr = '';
            if (Array.isArray(countryData)) {
              countryStr = countryData.map(c => c?.name || c).filter(Boolean).join(', ');
            } else if (countryData && typeof countryData === 'object') {
              countryStr = countryData.name || '';
            } else {
              countryStr = String(countryData || '');
            }

            const serverData = data.episodes?.[0]?.server_data || [];
            serverData.forEach((ep, index) => {
              const rawEpName = ep.name || String(index + 1);
              const epUrl = ep.link_m3u8 || ep.link_embed || '';
              const match = String(rawEpName).match(/\d+/);
              const epNum = match ? String(parseInt(match[0], 10)) : String(rawEpName);

              if (index === 0) {
                lines.push([title, originalTitle, epNum, epUrl, posterUrl, imdb, year, countryStr, ''].join('\t'));
              } else {
                lines.push(['', '', epNum, epUrl, '', '', '', '', ''].join('\t'));
              }
            });
          });

          tsvResult = lines.join('\n');
        } else {
          // Client Fallback: Phim lẻ
          const slug = rawInput.replace(/\/+$/, '').split('/').pop();
          const directApiUrl = `https://phimapi.com/phim/${slug}`;
          const res = await fetch(directApiUrl);
          if (!res.ok) throw new Error('Không thể kết nối API PhimAPI!');
          const data = await res.json();
          if (!data.status || !data.movie) throw new Error('API báo không tìm thấy phim này!');

          crawledCount = 1;
          const movie = data.movie;
          const title = movie.name || '';
          const originalTitle = movie.origin_name || '';
          const year = String(movie.year || '2026');
          let posterUrl = movie.poster_url || movie.thumb_url || '';
          if (posterUrl && !posterUrl.startsWith('http')) posterUrl = `https://phimimg.com/${posterUrl}`;
          const rawScore = movie.imdb?.vote_average || movie.tmdb?.vote_average;
          const imdb = rawScore ? `${rawScore} /10` : '';

          const countryData = movie.country;
          let countryStr = '';
          if (Array.isArray(countryData)) {
            countryStr = countryData.map(c => c?.name || c).filter(Boolean).join(', ');
          } else if (countryData && typeof countryData === 'object') {
            countryStr = countryData.name || '';
          } else {
            countryStr = String(countryData || '');
          }

          const serverData = data.episodes?.[0]?.server_data || [];
          if (!serverData.length) throw new Error('Không tìm thấy danh sách tập phim!');

          const headers = ["Tên Phim", "Tên Gốc", "Tập", "Link Video", "Ảnh bìa", "Điểm IMDb", "Năm", "Quốc Gia", "Thể Loại"];
          const lines = [headers.join('\t')];

          serverData.forEach((ep, index) => {
            const rawEpName = ep.name || String(index + 1);
            const epUrl = ep.link_m3u8 || ep.link_embed || '';
            const match = String(rawEpName).match(/\d+/);
            const epNum = match ? String(parseInt(match[0], 10)) : String(rawEpName);

            if (index === 0) {
              lines.push([title, originalTitle, epNum, epUrl, posterUrl, imdb, year, countryStr, ''].join('\t'));
            } else {
              lines.push(['', '', epNum, epUrl, '', '', '', '', ''].join('\t'));
            }
          });

          tsvResult = lines.join('\n');
        }
      }

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
      return [];
    }
  };

  useEffect(() => {
    loadExistingMovies();
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
            status: 'new',
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

        // Trích xuất CHỈ NHỮNG TẬP MỚI
        const newEpsOnly = findNewEpisodesOnly(existingEps, movie.episodes || []);
        const hasNewEpisodes = newEpsOnly.length > 0;
        const merged = mergeEpisodesList(existingEps, movie.episodes || []);

        if (hasNewEpisodes || hasCountryUpdate) {
          // -------------------------------------------------------------------
          // KỊCH BẢN 2: PHIM ĐÃ CÓ TRONG DB, CÓ TẬP MỚI HOẶC CÓ QUỐC GIA MỚI -> status = 'update'
          // -------------------------------------------------------------------
          let updateReasonText = '🔄 Tự Động Gộp Phim';
          if (hasNewEpisodes && hasCountryUpdate) {
            updateReasonText = `🔄 Gộp +${newEpsOnly.length} Tập & Quốc gia (${incomingCountry})`;
          } else if (hasNewEpisodes) {
            updateReasonText = `🔄 Tự Động Gộp (+${newEpsOnly.length} Tập Mới)`;
          } else if (hasCountryUpdate) {
            updateReasonText = `🌐 Bổ sung Quốc gia (${incomingCountry})`;
          }

          return {
            ...movie,
            title: formattedTitle,
            status: 'update',
            isExistingMatch: true,
            matchedMovieId: match.id,
            matchedMovieTitle: match.title,
            hasNewEpisodes,
            hasCountryUpdate,
            updateReasonText,
            country: incomingCountry || existingCountry,
            newEpisodes: newEpsOnly,
            newEpisodesCount: newEpsOnly.length,
            existingEpisodesCount: existingEps.length,
            totalAfterMergeCount: merged.length,
            mergedEpisodes: merged
          };
        } else {
          // -------------------------------------------------------------------
          // KỊCH BẢN 3: PHIM ĐÃ CÓ TRONG DB, KHÔNG CÓ TẬP MỚI & KHÔNG ĐỔI QUỐC GIA -> status = 'duplicate'
          // -------------------------------------------------------------------
          return {
            ...movie,
            title: formattedTitle,
            status: 'duplicate',
            isExistingMatch: true,
            matchedMovieId: match.id,
            matchedMovieTitle: match.title,
            hasNewEpisodes: false,
            hasCountryUpdate: false,
            country: existingCountry || incomingCountry,
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
    const validMovies = parsedData.filter(m => m.isValid && m.status !== 'duplicate');
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

    try {
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
            status,
            isExistingMatch, 
            matchedMovieId, 
            matchedMovieTitle, 
            existingEpisodesCount, 
            totalAfterMergeCount, 
            newEpisodes,
            newEpisodesCount,
            mergedEpisodes, 
            ...cleanMovie 
          } = movie;

          const finalTitle = formatVietnameseSentenceCase(cleanMovie.title);
          const finalEpisodes = mergedEpisodes || cleanMovie.episodes || [];

          if (status === 'update' && matchedMovieId) {
            // KỊCH BẢN 2: CẬP NHẬT GỘP TẬP MỚI HOẶC QUỐC GIA VÀO PHIM CŨ
            totalMerged++;
            const movieRef = doc(db, 'movies', matchedMovieId);
            const updatePayload = sanitizeFirestoreData({
              ...cleanMovie,
              title: finalTitle,
              id: matchedMovieId,
              episodes: finalEpisodes,
              episodesCount: `${finalEpisodes.length} Tập`,
              episodesStatus: `Tập hoàn tất (${finalEpisodes.length}/${finalEpisodes.length})`,
              country: movie.country || cleanMovie.country || '',
              m3u8Url: finalEpisodes[0]?.url || cleanMovie.m3u8Url || '',
              updatedAt: new Date().toISOString()
            });

            batch.set(movieRef, updatePayload, { merge: true });
          } else if (status === 'new') {
            // KỊCH BẢN 1: TẠO PHIM MỚI
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

        await withTimeout(batch.commit(), 4000);
        totalImported += chunk.length;

        setUploadStatus({ 
          type: 'info', 
          text: `Đang xử lý: Đã nạp ${totalImported}/${validMovies.length} phim (Gộp ${totalMerged} phim cũ)...` 
        });
      }

      // Sync to local storage database cache
      try {
        const localMovies = JSON.parse(localStorage.getItem('210loliphim_movies_db') || '[]');
        let mergedList = [...localMovies];

        validMovies.forEach(vm => {
          const finalTitle = formatVietnameseSentenceCase(vm.title);
          const normTitle = normalizeTitle(finalTitle);
          const existIdx = mergedList.findIndex(m => normalizeTitle(m.title) === normTitle);

          const { isValid, missingFields, status, isExistingMatch, matchedMovieId, matchedMovieTitle, existingEpisodesCount, totalAfterMergeCount, newEpisodes, newEpisodesCount, mergedEpisodes, ...cleanMovie } = vm;
          const finalEpisodes = mergedEpisodes || cleanMovie.episodes || [];

          if (existIdx >= 0 && status === 'update') {
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
          } else if (status === 'new') {
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
        text: `🎉 HOÀN THÀNH: Đã nạp thành công ${totalImported} phim! (Tự động gộp ${totalMerged} phim có tập mới).` 
      });
      
      await loadExistingMovies();
    } catch (err) {
      console.warn("Firestore Batch Write note, performing resilient fallback:", err);

      try {
        const localMovies = JSON.parse(localStorage.getItem('210loliphim_movies_db') || '[]');
        let mergedList = [...localMovies];
        let totalMerged = 0;

        validMovies.forEach(vm => {
          const finalTitle = formatVietnameseSentenceCase(vm.title);
          const normTitle = normalizeTitle(finalTitle);
          const existIdx = mergedList.findIndex(m => normalizeTitle(m.title) === normTitle);

          const { isValid, missingFields, status, isExistingMatch, matchedMovieId, matchedMovieTitle, existingEpisodesCount, totalAfterMergeCount, newEpisodes, newEpisodesCount, mergedEpisodes, ...cleanMovie } = vm;
          const finalEpisodes = mergedEpisodes || cleanMovie.episodes || [];

          if (existIdx >= 0 && status === 'update') {
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
          } else if (status === 'new') {
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
          text: `🚀 THÀNH CÔNG: Đã lưu trữ an toàn ${validMovies.length} phim (Gộp ${totalMerged} phim cũ) vào kho dữ liệu!` 
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
      setIsUploading(false);
    }
  };

  // Tính toán 3 bộ đếm cho UI
  const countNew = parsedData.filter(m => m.status === 'new').length;
  const countUpdate = parsedData.filter(m => m.status === 'update').length;
  const countDuplicate = parsedData.filter(m => m.status === 'duplicate').length;

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
                    movie.status === 'duplicate' ? 'opacity-60 bg-white/[0.01]' : 'hover:bg-white/5'
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
                      {movie.status === 'new' && (
                        <span className="px-2.5 py-1 rounded-lg text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold inline-flex items-center gap-1">
                          ➕ Tạo Mới ({movie.episodes?.length || 1} Tập)
                        </span>
                      )}

                      {movie.status === 'update' && (
                        <div className="space-y-0.5">
                          <span className="px-2.5 py-1 rounded-lg text-[11px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold inline-flex items-center gap-1">
                            {movie.updateReasonText || `🔄 Tự Động Gộp (+${movie.newEpisodesCount} Tập Mới)`}
                          </span>
                          <p className="text-[10px] text-gray-400 truncate max-w-[170px]">
                            {movie.hasNewEpisodes ? `Đã có sẵn ${movie.existingEpisodesCount} tập` : `Cập nhật Quốc gia: ${movie.country}`}
                          </p>
                        </div>
                      )}

                      {movie.status === 'duplicate' && (
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
                      {movie.status === 'duplicate' ? (
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
