import React, { useState, useRef, useEffect } from 'react';
import { getStoredMovies } from '../../services/movieService';


/**
 * CineSmartAIBot Component
 * Chatbot Widget AI góc dưới màn hình dành cho Web Phim với giao diện Dark Mode & tông màu Vàng Cam.
 */
const CineSmartAIBot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const initialWelcomeMessage = {
    id: 'welcome_msg',
    sender: 'ai',
    text: 'Xin chào! Tôi là trợ lý AI. Tôi có thể giúp gì cho bạn?',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };

  const [messages, setMessages] = useState([initialWelcomeMessage]);
  const messagesEndRef = useRef(null);

  // Mảng 4 câu hỏi gợi ý nhanh
  const quickPrompts = [
    { id: 'prompt_1', text: 'Phim hợp gu tôi', icon: '🎬' },
    { id: 'prompt_2', text: 'Top Anime xem nhiều', icon: '🔥' },
    { id: 'prompt_3', text: 'Tâm trạng buồn xem...', icon: '🍿' },
    { id: 'prompt_4', text: 'Đố tôi 1 câu về anime', icon: '🎯' }
  ];


  // Tự động cuộn xuống tin nhắn mới nhất
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen, isTyping]);

  // Reset đoạn chat (+ Chat mới)
  const handleResetChat = () => {
    setMessages([{
      id: `msg_reset_${Date.now()}`,
      sender: 'ai',
      text: 'Xin chào! Tôi là trợ lý AI. Tôi có thể giúp gì cho bạn?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }]);
  };

  // Xử lý gửi tin nhắn - Gọi API Backend FastAPI (Gemini 1.5 Flash + ClickHouse Telemetry)
  const handleSendMessage = async (textToSend) => {
    const text = textToSend || inputText;
    if (!text.trim()) return;

    const userMsg = {
      id: `user_${Date.now()}_${Math.random()}`,
      sender: 'user',
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputText('');
    setIsTyping(true);

    try {
      // Lấy danh sách tên tất cả phim thực tế đang có trong kho dữ liệu Web
      let availableMovies = [];
      try {
        const stored = getStoredMovies();
        if (Array.isArray(stored) && stored.length > 0) {
          availableMovies = stored.map(m => m.title).filter(Boolean);
        }
      } catch (e) {
        console.warn("Could not read stored movies for AI context:", e);
      }

      const backendApiUrl = import.meta.env.VITE_CHAT_API_URL || 'http://localhost:8000/api/chat';
      const response = await fetch(backendApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          user_id: 'anonymous',
          available_movies: availableMovies
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const data = await response.json();
      const aiReplyText = data.reply || 'Xin lỗi, tôi chưa thể trả lời tin nhắn của bạn lúc này.';

      const aiMsg = {
        id: `ai_${Date.now()}_${Math.random()}`,
        sender: 'ai',
        text: aiReplyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.warn("Không thể kết nối Backend Chat AI API, thực hiện phản hồi dự phòng:", err);
      const aiMsg = {
        id: `ai_${Date.now()}_${Math.random()}`,
        sender: 'ai',
        text: `🤖 **Trợ lý CineSmart AI**: Rất tiếc không thể kết nối tới máy chủ AI (http://localhost:8000/api/chat). Bạn hãy chắc chắn dịch vụ FastAPI backend đang chạy nhé!`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, aiMsg]);
    } finally {
      setIsTyping(false);
    }
  };


  // Nhận diện giọng nói (Microphone)
  const handleToggleVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Trình duyệt của bạn chưa hỗ trợ nhận diện giọng nói (Speech Recognition API).');
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'vi-VN';
      recognition.interimResults = false;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInputText(transcript);
        setIsListening(false);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch (e) {
      console.error(e);
      setIsListening(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[9999] font-sans">
      {/* 1. TRẠNG THÁI THU GỌN (COLLAPSED BUTTON) */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="px-5 py-3 rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-white font-black text-sm flex items-center gap-2.5 shadow-[0_0_25px_rgba(245,158,11,0.5)] hover:shadow-[0_0_35px_rgba(245,158,11,0.7)] hover:-translate-y-1 active:translate-y-0 transition-all cursor-pointer border border-amber-300/40"
        >
          {/* Chat Icon */}
          <div className="w-6 h-6 rounded-full bg-black/20 flex items-center justify-center">
            <svg className="w-4 h-4 text-white fill-current" viewBox="0 0 24 24">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
            </svg>
          </div>
          <span>Chat AI</span>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-300 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400"></span>
          </span>
        </button>
      )}

      {/* 2. TRẠNG THÁI MỞ RỘNG (EXPANDED CHAT WINDOW) */}
      {isOpen && (
        <div className="w-80 sm:w-96 h-[500px] bg-gray-900 border border-amber-500/40 rounded-2xl shadow-2xl shadow-black/90 flex flex-col overflow-hidden animate-fadeIn backdrop-blur-xl">
          {/* HEADER */}
          <div className="bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 px-4 py-3 text-white flex items-center justify-between shadow-md border-b border-amber-500/30">
            <div className="flex items-center gap-2.5">
              {/* Avatar */}
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-black/40 border border-amber-200/50 flex items-center justify-center text-xs font-black text-amber-300 shadow-inner">
                  AI
                </div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 border-2 border-gray-900 rounded-full"></span>
              </div>
              <div>
                <h3 className="font-bold text-xs sm:text-sm text-white leading-tight flex items-center gap-1.5">
                  <span>Trợ lý CineSmart AI</span>
                  <span className="text-[10px] bg-black/30 px-1.5 py-0.5 rounded text-amber-200 font-normal">v2.0</span>
                </h3>
                <p className="text-[10px] text-amber-100/90 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>Trực tuyến</span>
                </p>
              </div>
            </div>

            {/* Nút thao tác trên Header */}
            <div className="flex items-center gap-1 text-xs">
              {/* Nút + Chat mới */}
              <button
                type="button"
                onClick={handleResetChat}
                title="Tạo cuộc trò chuyện mới"
                className="px-2 py-1 rounded-lg bg-black/25 hover:bg-black/40 text-amber-100 text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer border border-white/10"
              >
                <span>+ Chat mới</span>
              </button>

              {/* Nút Reload */}
              <button
                type="button"
                onClick={handleResetChat}
                title="Tải lại trò chuyện"
                className="p-1.5 rounded-lg bg-black/25 hover:bg-black/40 text-amber-100 hover:text-white transition-colors cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>

              {/* Nút X Đóng cửa sổ */}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                title="Đóng cửa sổ"
                className="p-1.5 rounded-lg bg-black/25 hover:bg-red-500/80 text-amber-100 hover:text-white transition-colors cursor-pointer ml-0.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* CHAT BODY (KHU VỰC HIỂN THỊ TIN NHẮN) */}
          <div className="flex-1 p-3.5 space-y-3.5 overflow-y-auto custom-scrollbar bg-gray-950/80">
            {/* RENDER DANH SÁCH TIN NHẮN */}
            {messages.map((msg, index) => {
              // QUY TẮC BẮT BUỘC: Biến trung gian gán key
              const messageKey = msg.id || `msg_item_${index}`;
              const isAi = msg.sender === 'ai';

              return (
                <div
                  key={messageKey}
                  className={`flex gap-2.5 ${isAi ? 'items-start' : 'items-end justify-end'}`}
                >
                  {isAi && (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-600 to-orange-500 border border-amber-400/40 flex items-center justify-center text-[10px] font-black text-white flex-shrink-0 shadow-sm">
                      AI
                    </div>
                  )}

                  <div
                    className={`max-w-[82%] p-3 rounded-2xl text-xs leading-relaxed font-sans whitespace-pre-line shadow-md ${
                      isAi
                        ? 'bg-gray-800/90 text-gray-100 border border-amber-500/20 rounded-tl-none'
                        : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-tr-none font-medium'
                    }`}
                  >
                    <p>{msg.text}</p>
                    <span
                      className={`block text-[9px] mt-1 font-mono ${
                        isAi ? 'text-gray-400 text-right' : 'text-amber-100/80 text-right'
                      }`}
                    >
                      {msg.timestamp}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* KHU VỰC GỢI Ý CÂU HỎI NHANH (QUICK SUGGESTIONS) */}
            {messages.length === 1 && (
              <div className="mt-4 pt-2 border-t border-gray-800/60 space-y-2">
                <p className="text-[11px] font-bold text-amber-400 flex items-center gap-1">
                  <span>💡 Gợi ý câu hỏi nhanh:</span>
                </p>

                <div className="grid grid-cols-2 gap-2">
                  {quickPrompts.map((prompt, promptIdx) => {
                    // QUY TẮC BẮT BUỘC: Biến trung gian gán key
                    const promptKey = prompt.id || `quick_prompt_${promptIdx}`;

                    return (
                      <button
                        key={promptKey}
                        type="button"
                        onClick={() => handleSendMessage(prompt.text)}
                        className="border border-amber-500/40 hover:border-amber-400 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 hover:text-white text-[11px] p-2 rounded-xl transition-all text-left flex items-center justify-between font-medium cursor-pointer shadow-sm group"
                      >
                        <span className="truncate">{prompt.text}</span>
                        <span className="text-xs group-hover:scale-125 transition-transform">{prompt.icon}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI TYPING ANIMATION */}
            {isTyping && (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-600 to-orange-500 border border-amber-400/40 flex items-center justify-center text-[10px] font-black text-white flex-shrink-0">
                  AI
                </div>
                <div className="bg-gray-800/90 text-gray-400 p-2.5 rounded-2xl rounded-tl-none border border-amber-500/20 text-xs flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:0.4s]"></span>
                  <span className="text-[10px] italic ml-1">Đang suy nghĩ...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* INPUT AREA (KHU VỰC NHẬP TIN NHẮN & MICRO) */}
          <div className="p-3 bg-gray-900 border-t border-gray-800/80">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              {/* Nút Micro */}
              <button
                type="button"
                onClick={handleToggleVoiceInput}
                title={isListening ? 'Đang lắng nghe... Bấm để dừng' : 'Nhập bằng giọng nói (Micro)'}
                className={`p-2.5 rounded-xl border transition-all cursor-pointer flex-shrink-0 ${
                  isListening
                    ? 'bg-red-500 text-white border-red-400 animate-pulse'
                    : 'bg-gray-800 text-gray-400 hover:text-amber-400 border-gray-700 hover:border-amber-500/50'
                }`}
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              </button>

              {/* Ô Input Text */}
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={isListening ? 'Đang nghe giọng nói của bạn...' : 'Nhập tin nhắn hoặc dùng mic...'}
                className="flex-1 bg-gray-800 text-white text-xs px-3.5 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-amber-500 placeholder-gray-500 font-sans transition-all"
              />

              {/* Nút Gửi (Send) */}
              <button
                type="submit"
                disabled={!inputText.trim()}
                title="Gửi tin nhắn"
                className="p-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex-shrink-0"
              >
                <svg className="w-4 h-4 fill-current transform rotate-90" viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CineSmartAIBot;
