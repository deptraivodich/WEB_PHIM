import React, { useState, useEffect } from 'react';
import ginTokiImg from '../../assets/gin_toki.png';
import shinImg from '../../assets/shin.jpg';

/**
 * TrollLogoutModal Component
 * Fun troll modal intercepted when user attempts to log out.
 * 
 * Requirements:
 * - Backdrop: bg-black/90, z-[9999], fixed inset-0
 * - Dialog: White background, black text: "Web phim có đẳng cấp hơn web MFiml hay không và Admin có đẹp trai hay không"
 * - Buttons:
 *    + Button "CÓ" (Red)
 *    + Button "KHÔNG" (Green initially, escapes on hover up to 10 times, on 10th time turns into red "CÓ" and stops moving)
 * - On clicking "CÓ": Alert message, execute real logout, close modal.
 */
const TrollLogoutModal = ({ isOpen, onClose, onConfirmLogout }) => {
  const [hoverCount, setHoverCount] = useState(0);
  const [noBtnStyle, setNoBtnStyle] = useState({});
  const [isConfirmed, setIsConfirmed] = useState(false);

  // Reset state when modal opens or closes
  useEffect(() => {
    if (isOpen) {
      setHoverCount(0);
      setNoBtnStyle({});
      setIsConfirmed(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Handle onMouseEnter on button "KHÔNG"
  const handleNoMouseEnter = () => {
    if (hoverCount < 10) {
      const nextCount = hoverCount + 1;
      setHoverCount(nextCount);

      if (nextCount === 10) {
        // On 10th hover: transform into stationary red "CÓ" button
        setNoBtnStyle({});
        setHoverCount(11); // Lock logic
      } else {
        // Calculate random coordinates inside viewport safely
        const btnWidth = 110;
        const btnHeight = 45;
        const padding = 20;
        const maxX = Math.max(padding, window.innerWidth - btnWidth - padding);
        const maxY = Math.max(padding, window.innerHeight - btnHeight - padding);
        const randomX = Math.floor(Math.random() * (maxX - padding)) + padding;
        const randomY = Math.floor(Math.random() * (maxY - padding)) + padding;

        setNoBtnStyle({
          position: 'fixed',
          left: `${randomX}px`,
          top: `${randomY}px`,
          zIndex: 10000,
          transition: 'all 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)'
        });
      }
    }
  };

  // Handle clicking "CÓ" (or transformed button)
  const handleConfirmYes = () => {
    setIsConfirmed(true);
  };

  // Final logout execution
  const handleFinalLogout = () => {
    if (onConfirmLogout) {
      onConfirmLogout();
    }
    if (onClose) {
      onClose();
    }
  };

  const isTransformed = hoverCount >= 10;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn select-none"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="bg-white text-black max-w-md w-full p-6 sm:p-8 rounded-3xl shadow-[0_25px_70px_rgba(0,0,0,0.8)] text-center space-y-6 animate-scaleUp border border-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        {isConfirmed ? (
          /* Custom In-Modal Confirmation Screen (Replaces native browser alert) - Image 2: Shin */
          <div className="space-y-5 animate-fadeIn">
            {/* Shin Image - with thin black border */}
            <div className="w-full max-w-[260px] sm:max-w-[300px] mx-auto rounded-2xl overflow-hidden shadow-md border border-black/80">
              <img
                src={shinImg}
                alt="Shin"
                className="w-full h-auto object-cover rounded-2xl"
              />
            </div>

            <h3 className="text-lg sm:text-xl font-black text-gray-900 leading-snug">
              Cảm ơn sự trung thực của bạn :)
            </h3>

            <p className="text-xs sm:text-sm text-gray-600 font-medium">
              Đây là câu trả lời hoàn toàn tự nguyện và <strong className="text-red-600">KHÔNG</strong> có ai bắt ép cả.
            </p>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleFinalLogout}
                className="w-full py-3 px-6 rounded-xl bg-gray-900 hover:bg-black text-white font-black text-sm transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer"
              >
                OK (Đăng xuất ngay)
              </button>
            </div>
          </div>
        ) : (
          /* Normal Troll Question Screen - Image 1: Gintoki */
          <>
            {/* Gintoki Image - with thin black border */}
            <div className="w-full max-w-[280px] sm:max-w-[330px] mx-auto rounded-2xl overflow-hidden shadow-md border border-black/80">
              <img
                src={ginTokiImg}
                alt="Gintoki"
                className="w-full h-auto object-cover rounded-2xl"
              />
            </div>

            {/* Question Title */}
            <h3 className="text-lg sm:text-xl font-black text-gray-900 leading-snug">
              Web phim có đẳng cấp hơn web MFILM hay không và Admin có đẹp trai hay không
            </h3>

            <p className="text-xs text-gray-500 font-medium">
              Vui lòng xác nhận câu trả lời chân thật để tiến hành đăng xuất khỏi hệ thống:
            </p>

            {/* Buttons Row */}
            <div className="flex items-center justify-center gap-4 pt-2 relative min-h-[50px]">
              {/* Button CÓ (Original Red Button) */}
              <button
                type="button"
                onClick={handleConfirmYes}
                className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-sm transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1.5"
              >
                <span>👍 CÓ</span>
              </button>

              {/* Button KHÔNG (Escapes on hover, transforms into CÓ on 10th hover) */}
              <button
                type="button"
                style={noBtnStyle}
                onMouseEnter={handleNoMouseEnter}
                onClick={isTransformed ? handleConfirmYes : undefined}
                className={`px-6 py-2.5 rounded-xl font-black text-sm transition-colors shadow-md cursor-pointer flex items-center gap-1.5 ${isTransformed
                    ? 'bg-red-600 hover:bg-red-700 text-white hover:scale-105 active:scale-95'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
              >
                <span>{isTransformed ? '👍 CÓ' : '👎 KHÔNG'}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TrollLogoutModal;
