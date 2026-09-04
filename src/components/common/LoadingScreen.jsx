import React from 'react';

/**
 * High-end neon loading screen with spinning rings, pulsing core, and glassmorphism.
 * Used as fallback for React Suspense during Code Splitting page transitions.
 */
const LoadingScreen = ({ message = "Đang tải 210LoliPhim..." }) => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#09090b] bg-opacity-95 backdrop-blur-md transition-opacity duration-300">
      <div className="relative flex items-center justify-center">
        {/* Outer Neon Glow Pulsing Circle */}
        <div className="w-32 h-32 rounded-full border-4 border-neon-red/20 animate-pulse shadow-[0_0_50px_rgba(229,9,20,0.3)]"></div>
        
        {/* Middle Fast Rotating Neon Ring */}
        <div className="absolute w-28 h-28 rounded-full border-t-4 border-r-4 border-neon-red animate-spin shadow-[0_0_20px_#e50914]"></div>
        
        {/* Inner Counter-Rotating Cyan Ring */}
        <div className="absolute w-20 h-20 rounded-full border-b-4 border-l-4 border-neon-cyan animate-[spin_1.5s_linear_infinite_reverse] shadow-[0_0_20px_#00f0ff]"></div>
        
        {/* Center Glowing Logo / Film Icon */}
        <div className="absolute flex flex-col items-center justify-center">
          <div className="w-10 h-10 bg-gradient-to-tr from-neon-red to-orange-500 rounded-full flex items-center justify-center shadow-[0_0_25px_#e50914] animate-bounce">
            <svg 
              className="w-5 h-5 text-white" 
              fill="currentColor" 
              viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
      </div>

      {/* Brand Text & Dynamic Message */}
      <div className="mt-8 flex flex-col items-center space-y-2">
        <h2 className="text-2xl font-extrabold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-neon-red via-red-500 to-amber-500 glow-red-text">
          210LOLIPHIM
        </h2>
        <div className="flex items-center space-x-2 text-sm text-gray-400 font-medium tracking-wide">
          <span className="inline-block w-2 h-2 rounded-full bg-neon-red animate-ping"></span>
          <span>{message}</span>
        </div>
      </div>

      {/* Subtle Bottom Ambient Glow */}
      <div className="absolute bottom-10 w-48 h-1 bg-gradient-to-r from-transparent via-neon-red to-transparent opacity-60 blur-sm"></div>
    </div>
  );
};

export default LoadingScreen;
