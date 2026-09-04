import React, { useState, useEffect } from 'react';
import theRockImg from '../../assets/the_rock.png';
import tunaImg from '../../assets/tuna.jpg';

/**
 * Secret210Modal Component
 * 3-Step Troll Modal for the secret "210" button.
 * 
 * Steps:
 * - Step 1: 18+ Confirmation with The Rock image
 * - Step 2: Double check truthfulness
 * - Step 3: Troll escaping "SURE" button (runs away on hover up to 10 times, then turns into "Umk...not sure")
 * - Step 'rejected': Tuna image with rejection message
 */
const Secret210Modal = ({ isOpen, onClose, onSuccess }) => {
  const [step, setStep] = useState(1);
  const [hoverCount, setHoverCount] = useState(0);
  const [sureBtnStyle, setSureBtnStyle] = useState({});

  // Reset state when modal opens or closes
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setHoverCount(0);
      setSureBtnStyle({});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Handle onMouseEnter on button "SURE" in Step 3
  const handleSureMouseEnter = () => {
    if (hoverCount < 10) {
      const nextCount = hoverCount + 1;
      setHoverCount(nextCount);

      if (nextCount === 10) {
        // On 10th hover: transform into stationary "Umk...not sure" button
        setSureBtnStyle({});
        setHoverCount(11); // Lock logic
      } else {
        // Calculate random coordinates inside viewport safely
        const btnWidth = 120;
        const btnHeight = 45;
        const padding = 20;
        const maxX = Math.max(padding, window.innerWidth - btnWidth - padding);
        const maxY = Math.max(padding, window.innerHeight - btnHeight - padding);
        const randomX = Math.floor(Math.random() * (maxX - padding)) + padding;
        const randomY = Math.floor(Math.random() * (maxY - padding)) + padding;

        setSureBtnStyle({
          position: 'fixed',
          left: `${randomX}px`,
          top: `${randomY}px`,
          zIndex: 10000,
          transition: 'all 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)'
        });
      }
    }
  };

  const isSureTransformed = hoverCount >= 10;

  return (
    <div 
      className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 select-none animate-fadeIn"
      onClick={(e) => e.stopPropagation()}
    >
      <div 
        className="bg-white text-black max-w-md w-full p-6 sm:p-8 rounded-3xl shadow-[0_25px_70px_rgba(0,0,0,0.9)] text-center space-y-5 animate-scaleUp border border-gray-100 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ================= STEP 1 ================= */}
        {step === 1 && (
          <div className="space-y-5 animate-fadeIn">
            {/* The Rock Image */}
            <div className="relative w-36 h-36 sm:w-44 sm:h-44 mx-auto rounded-2xl overflow-hidden shadow-lg border-2 border-amber-400 bg-gray-900">
              <img 
                src={theRockImg} 
                alt="The Rock Suspicious" 
                className="w-full h-full object-cover"
              />
            </div>

            {/* Question Text */}
            <h3 className="text-base sm:text-lg font-black text-gray-900 leading-snug">
              Vì để đảm bảo tiêu chuẩn cộng đồng và không muốn làm hư giới trẻ! BẠN ĐÃ ĐỦ 18 TUỔI CHƯA
            </h3>

            {/* 2 Buttons */}
            <div className="flex items-center justify-center gap-4 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer"
              >
                ĐỦ
              </button>
              <button
                type="button"
                onClick={() => setStep('rejected')}
                className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-sm transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer"
              >
                KHÔNG:(
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 2 ================= */}
        {step === 2 && (
          <div className="space-y-5 animate-fadeIn">
            {/* The Rock Image */}
            <div className="relative w-36 h-36 sm:w-44 sm:h-44 mx-auto rounded-2xl overflow-hidden shadow-lg border-2 border-amber-400 bg-gray-900">
              <img 
                src={theRockImg} 
                alt="The Rock Suspicious" 
                className="w-full h-full object-cover scale-105"
              />
            </div>

            {/* Question Text */}
            <h3 className="text-lg sm:text-xl font-black text-gray-900 leading-snug">
              Bạn nói thật chứ! Hãy thú thật đi nào!
            </h3>

            {/* 2 Buttons */}
            <div className="flex items-center justify-center gap-4 pt-2">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer"
              >
                THẬT
              </button>
              <button
                type="button"
                onClick={() => setStep('rejected')}
                className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-sm transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer"
              >
                KHÔNG TÔI LỪA BẠN ĐẤY!
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 3 (TROLL RUNAWAY BUTTON) ================= */}
        {step === 3 && (
          <div className="space-y-5 animate-fadeIn">
            {/* The Rock Image */}
            <div className="relative w-36 h-36 sm:w-44 sm:h-44 mx-auto rounded-2xl overflow-hidden shadow-lg border-2 border-amber-400 bg-gray-900">
              <img 
                src={theRockImg} 
                alt="The Rock Suspicious" 
                className="w-full h-full object-cover scale-105"
              />
            </div>

            {/* Question Text */}
            <h3 className="text-base sm:text-lg font-black text-gray-900 leading-snug">
              Điều gì quan trọng thì nên nhắc lại 3 lần! Bạn đã chắc về tuổi của mình chưa!
            </h3>

            <p className="text-xs text-gray-500 font-medium">
              Hãy chọn câu trả lời cuối cùng để bước vào kho tàng bí mật:
            </p>

            {/* 2 Buttons: Umk...not sure (Opens rejected) & SURE (Escaping button) */}
            <div className="flex items-center justify-center gap-4 pt-2 relative min-h-[50px]">
              {/* Button Umk...not sure */}
              <button
                type="button"
                onClick={() => setStep('rejected')}
                className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-sm transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer"
              >
                Umk...not sure
              </button>

              {/* Button SURE (Runs away on hover, turns into Umk...not sure on 10th hover) */}
              <button
                type="button"
                style={sureBtnStyle}
                onMouseEnter={handleSureMouseEnter}
                onClick={isSureTransformed ? () => setStep('rejected') : undefined}
                className={`px-5 py-2.5 rounded-xl font-black text-sm transition-colors shadow-md cursor-pointer ${
                  isSureTransformed
                    ? 'bg-red-600 hover:bg-red-700 text-white hover:scale-105 active:scale-95'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                {isSureTransformed ? 'Umk...not sure' : 'SURE'}
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP REJECTED ================= */}
        {step === 'rejected' && (
          <div className="space-y-5 animate-fadeIn">
            {/* Tuna Image */}
            <div className="relative w-36 h-36 sm:w-44 sm:h-44 mx-auto rounded-2xl overflow-hidden shadow-lg bg-gray-900 border-2 border-amber-400 flex items-center justify-center">
              <img 
                src={tunaImg} 
                alt="Tuna" 
                className="w-full h-full object-cover"
              />
            </div>

            {/* Rejection Text */}
            <h3 className="text-base sm:text-lg font-black text-gray-900 leading-snug">
              Tiếc thật nhỉ! Hãy cố gắng đợi đến khi đủ tuổi đi nhóc à:)
            </h3>

            {/* Close Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-8 py-2.5 rounded-xl bg-gray-900 hover:bg-black text-white font-black text-sm transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Secret210Modal;
