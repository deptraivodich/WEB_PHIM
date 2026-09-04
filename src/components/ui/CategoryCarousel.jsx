import React, { useRef } from 'react';
import MovieCard from './MovieCard';

/**
 * CategoryCarousel Component
 * Smooth horizontal carousel with CSS Scroll Snapping, hidden scrollbars, and navigation arrows.
 * Prevents card stretch/overflow using tight flex-shrink-0 card limits.
 */
const CategoryCarousel = ({ 
  title = "Danh Mục Phim Hot", 
  movies = [], 
  isLoading = false 
}) => {
  const scrollRef = useRef(null);

  const scroll = (direction) => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current;
      const scrollAmount = clientWidth * 0.75;
      scrollRef.current.scrollTo({
        left: direction === 'left' ? scrollLeft - scrollAmount : scrollLeft + scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const displayMovies = movies.length > 0 ? movies : Array(8).fill({});

  return (
    <div className="space-y-3 my-6">
      {/* Category Section Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center space-x-2.5">
          <div className="w-1.5 h-5 rounded-full bg-neon-red shadow-[0_0_12px_#e50914]"></div>
          <h2 className="text-lg md:text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
            <span>{title}</span>
            {title.includes('Top IMDb') && <span className="text-[10px] px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">★ Rated</span>}
            {title.includes('4K') && <span className="text-[10px] px-2 py-0.5 rounded bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30">4K Ultra</span>}
          </h2>
        </div>

        {/* Scroll Control Arrows */}
        <div className="flex items-center space-x-1.5">
          <button 
            onClick={() => scroll('left')}
            className="p-1.5 rounded-lg bg-surface-card hover:bg-neon-red/20 text-gray-300 hover:text-neon-red border border-glass-border transition-all"
            aria-label="Cuộn sang trái"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <button 
            onClick={() => scroll('right')}
            className="p-1.5 rounded-lg bg-surface-card hover:bg-neon-red/20 text-gray-300 hover:text-neon-red border border-glass-border transition-all"
            aria-label="Cuộn sang phải"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>
      </div>

      {/* Scrollable Container with Snapping and generous vertical padding to prevent hover popup clipping */}
      <div 
        ref={scrollRef}
        className="flex items-center space-x-3 sm:space-x-4 overflow-x-auto no-scrollbar snap-x snap-mandatory py-16 -my-12 px-2 scroll-smooth"
      >
        {displayMovies.map((movie, index) => (
          <div key={movie.id || index} className="snap-start flex-none flex-shrink-0">
            <MovieCard 
              movie={movie} 
              isLoading={isLoading} 
              layoutMode="carousel" 
              isFirst={index === 0}
              isLast={index === displayMovies.length - 1}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default CategoryCarousel;
