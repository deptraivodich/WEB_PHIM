import React, { useState, useEffect, useRef } from 'react';
import { getMovies } from '../../services/movieService';
import { isEligibleForAutoUpdate, runAutoUpdateBatch } from '../../services/autoCrawlService';

const STORAGE_INTERVAL_KEY = '210loliphim_auto_sync_interval';
const STORAGE_LAST_TIME_KEY = '210loliphim_last_auto_sync_time';

export default function AutoSyncModal({ isOpen, onClose, onFinished }) {
  // Stats
  const [scannedCount, setScannedCount] = useState(0);
  const [updatedCount, setUpdatedCount] = useState(0);
  const [addedEpisodesCount, setAddedEpisodesCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [totalEligible, setTotalEligible] = useState(0);

  // Status & Progress
  const [isRunning, setIsRunning] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [statusText, setStatusText] = useState('Sẵn sàng đồng bộ');

  // Interval Setting
  const [intervalSetting, setIntervalSetting] = useState(() => {
    return localStorage.getItem(STORAGE_INTERVAL_KEY) || '0';
  });

  // Last Updated Time
  const [lastUpdatedTime, setLastUpdatedTime] = useState(() => {
    return localStorage.getItem(STORAGE_LAST_TIME_KEY) || '';
  });

  // Logs List
  const [logs, setLogs] = useState([]);
  const logEndRef = useRef(null);
  const isRunningRef = useRef(false);

  // Helper format time
  const getFormattedTime = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const getFormattedDateTime = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  };

  const appendLog = (type, message) => {
    const newEntry = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      time: getFormattedTime(),
      type,
      message
    };
    setLogs((prev) => [...prev, newEntry]);
  };

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Load initial eligible count when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const initEligible = async () => {
      try {
        const all = await getMovies();
        const eligible = (Array.isArray(all) ? all : []).filter(isEligibleForAutoUpdate);
        setTotalEligible(eligible.length);
        if (logs.length === 0) {
          appendLog('info', `Hệ thống tìm thấy ${eligible.length} bộ phim đang phát sóng (chưa Hoàn Tất) đủ điều kiện kiểm tra.`);
        }
      } catch (err) {
        console.warn('Lỗi đọc danh sách phim ban đầu:', err);
      }
    };

    initEligible();
  }, [isOpen]);

  // Handle interval setting change
  const handleIntervalChange = (val) => {
    setIntervalSetting(val);
    localStorage.setItem(STORAGE_INTERVAL_KEY, val);
    appendLog('info', `Đã đổi cấu hình quét ngầm định kỳ: ${val === '0' ? 'Tắt' : `${parseInt(val, 10) / 60000} phút`}.`);
  };

  // Clear Logs
  const handleClearLogs = () => {
    setLogs([]);
  };

  // Stop Syncing
  const handleStopSync = () => {
    if (isRunningRef.current) {
      isRunningRef.current = false;
      setIsRunning(false);
      setStatusText('Đã dừng đồng bộ');
      appendLog('info', 'Quá trình đồng bộ đã được tạm dừng bởi người dùng.');
    }
  };

  // Start Sync Loop
  const handleStartSync = async () => {
    if (isRunningRef.current) return;

    try {
      const all = await getMovies();
      const eligible = (Array.isArray(all) ? all : []).filter(isEligibleForAutoUpdate);

      if (eligible.length === 0) {
        appendLog('info', 'Tất cả các phim trong cơ sở dữ liệu đều đã Hoàn Tất hoặc là phim lẻ chiếu rạp.');
        return;
      }

      // Sort by oldest updated time first (round-robin)
      eligible.sort((a, b) => {
        const timeA = new Date(a.lastAutoCrawledAt || a.updatedAt || a.updated_at || 0).getTime();
        const timeB = new Date(b.lastAutoCrawledAt || b.updatedAt || b.updated_at || 0).getTime();
        return timeA - timeB;
      });

      setTotalEligible(eligible.length);
      setScannedCount(0);
      setUpdatedCount(0);
      setAddedEpisodesCount(0);
      setErrorCount(0);
      setProgressPercent(0);

      isRunningRef.current = true;
      setIsRunning(true);
      setStatusText('Đang đồng bộ tập mới...');
      appendLog('info', `Bắt đầu tiến trình đồng bộ ${eligible.length} phim từ PhimAPI...`);

      // Process in batches of 5 movies for snappy live updates
      const BATCH_SIZE = 5;
      let currentScanned = 0;
      let currentUpdated = 0;
      let currentAddedEps = 0;
      let currentErrors = 0;

      for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
        if (!isRunningRef.current) {
          break;
        }

        const batch = eligible.slice(i, i + BATCH_SIZE);
        const res = await runAutoUpdateBatch(batch);

        if (!isRunningRef.current) {
          break;
        }

        if (res.status === 'success') {
          const details = res.checkedDetails || [];
          for (const d of details) {
            currentScanned += 1;
            if (d.status === 'updated') {
              currentUpdated += 1;
              currentAddedEps += d.added_episodes_count || 0;
              appendLog('updated', d.message || `Cập nhật "${d.title}" thành công.`);
            } else if (d.status === 'error') {
              currentErrors += 1;
              appendLog('error', d.message || `Lỗi khi kiểm tra "${d.title}".`);
            } else {
              appendLog('unchanged', d.message || `"${d.title}" đã chuẩn xác đủ ${d.episodes_count || 0} tập, không cần sửa.`);
            }
          }
        } else {
          currentErrors += batch.length;
          currentScanned += batch.length;
          appendLog('error', `Lỗi kết nối khi cào lô phim: ${res.error || 'API không phản hồi'}`);
        }

        // Update stats
        setScannedCount(currentScanned);
        setUpdatedCount(currentUpdated);
        setAddedEpisodesCount(currentAddedEps);
        setErrorCount(currentErrors);

        const pct = Math.min(100, Math.round((currentScanned / eligible.length) * 100));
        setProgressPercent(pct);
      }

      if (isRunningRef.current) {
        const finishedDateTime = getFormattedDateTime();
        setLastUpdatedTime(finishedDateTime);
        localStorage.setItem(STORAGE_LAST_TIME_KEY, finishedDateTime);
        setStatusText('Đã hoàn thành đồng bộ');
        setProgressPercent(100);
        appendLog('info', `🎉 Hoàn tất chu kỳ quét! Đã kiểm tra ${currentScanned} phim, phát hiện ${currentUpdated} phim có tập mới (+${currentAddedEps} tập).`);
        if (typeof onFinished === 'function') {
          onFinished();
        }
      }
    } catch (err) {
      console.error('Lỗi quy trình Auto-Sync:', err);
      appendLog('error', `Lỗi ngoại lệ: ${err.message}`);
      setStatusText('Gặp sự cố khi đồng bộ');
    } finally {
      isRunningRef.current = false;
      setIsRunning(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 md:p-6 animate-fade-in">
      <div className="bg-[#0b101b] border border-cyan-500/20 rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl shadow-cyan-950/40 overflow-hidden">
        
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#080d16]">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 ${isRunning ? 'animate-spin' : ''}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-black text-white tracking-wide flex items-center gap-2">
                HỆ THỐNG CÀO PHIM TỰ ĐỘNG & AUTO-SYNC
              </h3>
              <p className="text-[11px] text-gray-400">
                Tự động kiểm tra PhimAPI và cập nhật tập mới, thông tin, đạo diễn theo thời gian thực
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-surface/60 hover:bg-surface border border-slate-800 text-gray-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
            title="Đóng cửa sổ"
          >
            ✕
          </button>
        </div>

        {/* Modal Body - 2 Columns */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          
          {/* LEFT COLUMN: Controls & Settings */}
          <div className="w-full md:w-80 flex-shrink-0 p-5 bg-[#080c14] border-b md:border-b-0 md:border-r border-slate-800/80 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              
              {/* Box Title */}
              <div className="flex items-center gap-2 text-emerald-400 font-black text-xs tracking-wider">
                <span className="text-base">🔄</span>
                <span>AUTO-SYNC TẬP MỚI</span>
              </div>

              {/* Box: Tự động quét ngầm định kỳ */}
              <div className="bg-[#0f1726] border border-emerald-500/25 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Tự động quét ngầm định kỳ</span>
                </div>

                <select
                  value={intervalSetting}
                  onChange={(e) => handleIntervalChange(e.target.value)}
                  className="w-full py-2.5 px-3 bg-[#090d16] border border-slate-700/80 rounded-lg text-xs text-gray-200 font-medium focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="0">Tắt (Chỉ quét khi bấm nút)</option>
                  <option value="120000">2 Phút (~120 giây)</option>
                  <option value="300000">5 Phút</option>
                  <option value="900000">15 Phút</option>
                  <option value="1800000">30 Phút</option>
                </select>

                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Khi bật, hệ thống sẽ tự động định kỳ quét KKPhim/PhimAPI và chèn các tập mới nhất vào phim mà không cần thao tác tay.
                </p>
              </div>

              {/* Action Button: Start / Stop */}
              {isRunning ? (
                <button
                  type="button"
                  onClick={handleStopSync}
                  className="w-full py-3 px-4 rounded-xl font-black text-xs bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer animate-pulse"
                >
                  <span className="w-2.5 h-2.5 bg-white rounded-sm"></span>
                  <span>DỪNG ĐỒNG BỘ</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartSync}
                  className="w-full py-3 px-4 rounded-xl font-black text-xs bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <span className="text-sm">▶</span>
                  <span>BẮT ĐẦU ĐỒNG BỘ</span>
                </button>
              )}

            </div>

            {/* Bottom timestamp */}
            <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-gray-400">
              <span>Lần cập nhật gần nhất:</span>
              <span className="font-mono text-emerald-400 font-bold">
                {lastUpdatedTime || 'Chưa thực hiện'}
              </span>
            </div>
          </div>

          {/* RIGHT COLUMN: Realtime Stats, Progress Bar & Live Log Console */}
          <div className="flex-1 p-5 space-y-4 flex flex-col overflow-hidden bg-[#0a0e17]">
            
            {/* 4 Counter Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              
              {/* Card 1: Phim đã quét */}
              <div className="bg-[#0f1726] border border-slate-800/80 rounded-xl p-3 text-center flex flex-col justify-center items-center">
                <span className="text-xl sm:text-2xl font-black text-white font-mono leading-none mb-1">
                  {scannedCount}
                  <span className="text-xs text-gray-500 font-normal ml-1">/ {totalEligible}</span>
                </span>
                <span className="text-[10px] sm:text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  PHIM ĐÃ QUÉT
                </span>
              </div>

              {/* Card 2: Phim có tập mới */}
              <div className="bg-[#0f1726] border border-emerald-500/30 rounded-xl p-3 text-center flex flex-col justify-center items-center">
                <span className="text-xl sm:text-2xl font-black text-emerald-400 font-mono leading-none mb-1">
                  {updatedCount}
                </span>
                <span className="text-[10px] sm:text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
                  PHIM CÓ TẬP MỚI
                </span>
              </div>

              {/* Card 3: Tập mới đã thêm */}
              <div className="bg-[#0f1726] border border-cyan-500/30 rounded-xl p-3 text-center flex flex-col justify-center items-center">
                <span className="text-xl sm:text-2xl font-black text-cyan-400 font-mono leading-none mb-1">
                  {addedEpisodesCount}
                </span>
                <span className="text-[10px] sm:text-[11px] font-bold text-cyan-300 uppercase tracking-wider">
                  TẬP MỚI ĐÃ THÊM
                </span>
              </div>

              {/* Card 4: Lỗi */}
              <div className="bg-[#0f1726] border border-rose-500/30 rounded-xl p-3 text-center flex flex-col justify-center items-center">
                <span className="text-xl sm:text-2xl font-black text-rose-400 font-mono leading-none mb-1">
                  {errorCount}
                </span>
                <span className="text-[10px] sm:text-[11px] font-bold text-rose-300 uppercase tracking-wider">
                  LỖI
                </span>
              </div>

            </div>

            {/* Progress Bar & Status Text */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <span>{isRunning ? '⏳' : progressPercent === 100 ? '✅' : '💤'}</span>
                  <span>{statusText}</span>
                </span>
                <span className="font-mono font-bold text-emerald-400">
                  {progressPercent}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-800/80 rounded-full overflow-hidden p-0.5">
                <div 
                  className="h-full bg-gradient-to-r from-teal-400 to-emerald-400 rounded-full transition-all duration-300 shadow-sm shadow-emerald-500/50"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Live Sync Log Container */}
            <div className="flex-1 flex flex-col min-h-0 bg-[#06090f] border border-slate-800 rounded-xl overflow-hidden">
              
              {/* Log Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/80 bg-[#080d16]">
                <div className="flex items-center gap-2 text-xs font-bold text-gray-300">
                  <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                  <span>Nhật ký Đồng bộ (Live Sync Log)</span>
                </div>
                <button
                  type="button"
                  onClick={handleClearLogs}
                  className="text-[11px] text-gray-400 hover:text-white px-2.5 py-1 rounded bg-slate-800/70 hover:bg-slate-700 border border-slate-700 transition-all cursor-pointer"
                >
                  Xóa log
                </button>
              </div>

              {/* Log Stream Box */}
              <div className="flex-1 p-3.5 overflow-y-auto font-mono text-[12px] space-y-2 select-text scrollbar-thin">
                {logs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-500 text-xs italic">
                    Chưa có nhật ký đồng bộ. Bấm &quot;BẮT ĐẦU ĐỒNG BỘ&quot; để tiến hành quét.
                  </div>
                ) : (
                  logs.map((item) => {
                    const logKey = `log_${item.id}`;
                    let iconColor = 'text-indigo-400';
                    let iconChar = '✔';
                    let textColor = 'text-gray-300';

                    if (item.type === 'updated') {
                      iconColor = 'text-emerald-400';
                      iconChar = '🚀';
                      textColor = 'text-emerald-200 font-bold';
                    } else if (item.type === 'error') {
                      iconColor = 'text-rose-400';
                      iconChar = '❌';
                      textColor = 'text-rose-300';
                    } else if (item.type === 'info') {
                      iconColor = 'text-cyan-400';
                      iconChar = 'ℹ';
                      textColor = 'text-cyan-200';
                    }

                    return (
                      <div key={logKey} className="flex items-start gap-2.5 leading-relaxed break-words hover:bg-slate-800/30 px-1 py-0.5 rounded transition-colors">
                        <span className="text-slate-500 select-none flex-shrink-0">
                          [{item.time}]
                        </span>
                        <span className={`${iconColor} select-none flex-shrink-0 font-bold`}>
                          {iconChar}
                        </span>
                        <span className={textColor}>
                          {item.message}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={logEndRef} />
              </div>

            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
