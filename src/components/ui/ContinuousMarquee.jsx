import React, { useRef, useState, useEffect, useId, useCallback } from 'react';

/**
 * ContinuousMarquee Component
 * 
 * Continuous auto-scroll / marquee for movie card rows.
 * Features:
 * 1. Direction: 'right' (Left-to-Right ->, translateX: -D to 0) or 'left' (Right-to-Left <-, translateX: -D to -2D).
 * 2. Speed: Configurable in px/second (default 30 px/s). Duration = D / speed.
 * 3. Seamless infinite loop: D is the exact distance between two identical sets, including the junction gap.
 * 4. Responsive & Clones: Generates enough clones so the viewport is 100% filled in all phases of the cycle.
 * 5. Pause on hover & focus-within: Freezes on hover/focus and resumes without restart.
 * 6. Accessibility: Clones have aria-hidden="true" and tabIndex={-1} for screen readers.
 * 7. Prefers-reduced-motion: Auto-scroll is disabled, manual scrolling is enabled.
 */
const ContinuousMarquee = ({
  items = [],
  direction = 'right',
  speed = 30, // px per second
  renderItem,
  gapClass = 'gap-3 sm:gap-4',
  className = ''
}) => {
  const rawId = useId();
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const animName = `marquee_${direction}_${safeId}`;

  const containerRef = useRef(null);
  const trackRef = useRef(null);
  const set0Ref = useRef(null);
  const set1Ref = useRef(null);

  const [cycleWidth, setCycleWidth] = useState(0);
  const [numSets, setNumSets] = useState(4);
  const [isMeasured, setIsMeasured] = useState(false);

  // Exact measurement of 1 full cycle (D), including the junction gap
  const measureCycle = useCallback(() => {
    if (!set0Ref.current || !set1Ref.current || !containerRef.current) return;

    const set0Left = set0Ref.current.offsetLeft;
    const set1Left = set1Ref.current.offsetLeft;
    const d = set1Left - set0Left;

    if (d > 0) {
      setCycleWidth(d);
      setIsMeasured(true);

      const viewportWidth = containerRef.current.clientWidth || window.innerWidth;
      // Ensure enough duplicate sets to cover at least 2*D + viewport width
      const neededSets = Math.max(4, Math.ceil((2 * d + viewportWidth) / d) + 1);
      setNumSets((prev) => Math.max(prev, neededSets));
    }
  }, []);

  useEffect(() => {
    // Initial measure
    measureCycle();

    // Re-measure on window resize
    const handleResize = () => {
      measureCycle();
    };
    window.addEventListener('resize', handleResize);

    // ResizeObserver on the first set and container to adapt to responsive changes
    let observer = null;
    if (typeof ResizeObserver !== 'undefined' && set0Ref.current && containerRef.current) {
      observer = new ResizeObserver(() => {
        measureCycle();
      });
      observer.observe(set0Ref.current);
      observer.observe(containerRef.current);
    }

    // Secondary measurement after short delay to ensure any deferred layout/fonts are settled
    const timer = setTimeout(measureCycle, 150);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (observer) observer.disconnect();
      clearTimeout(timer);
    };
  }, [items, measureCycle]);

  if (!items || items.length === 0) return null;

  // Calculate dynamic duration in seconds: D / speed
  const safeSpeed = speed > 0 ? speed : 30;
  const duration = cycleWidth > 0 ? (cycleWidth / safeSpeed).toFixed(4) : 0;

  // Animation endpoints according to exact specification:
  // Hàng chạy sang phải (left-to-right): translateX(-D) đến translateX(0)
  // Hàng chạy sang trái (right-to-left): translateX(-D) đến translateX(-2D)
  const startX = -cycleWidth;
  const endX = direction === 'right' ? 0 : -2 * cycleWidth;

  const setsArray = Array.from({ length: numSets });

  return (
    <div
      ref={containerRef}
      className={`continuous-marquee-container-${safeId} relative w-full overflow-x-hidden overflow-y-visible py-8 -my-4 select-none ${className}`}
    >
      {/* Scoped CSS animation styles */}
      {isMeasured && cycleWidth > 0 && (
        <style>{`
          @keyframes ${animName} {
            0% {
              transform: translate3d(${startX}px, 0, 0);
            }
            100% {
              transform: translate3d(${endX}px, 0, 0);
            }
          }

          .continuous-marquee-track-${safeId} {
            animation: ${animName} ${duration}s linear infinite;
            will-change: transform;
          }

          .continuous-marquee-container-${safeId}:hover .continuous-marquee-track-${safeId},
          .continuous-marquee-container-${safeId}:focus-within .continuous-marquee-track-${safeId} {
            animation-play-state: paused;
          }

          @media (prefers-reduced-motion: reduce) {
            .continuous-marquee-track-${safeId} {
              animation: none !important;
              transform: none !important;
            }
            .continuous-marquee-container-${safeId} {
              overflow-x: auto !important;
            }
          }
        `}</style>
      )}

      {/* Marquee Track */}
      <div
        ref={trackRef}
        className={`continuous-marquee-track-${safeId} flex flex-nowrap items-center ${gapClass} w-max`}
      >
        {setsArray.map((_, setIdx) => {
          const isClone = setIdx > 0;
          const setKey = `marquee-set-${safeId}-${setIdx}`;

          // Attach refs to set 0 and set 1 to accurately measure D (including junction gap)
          let setRefProp = null;
          if (setIdx === 0) setRefProp = set0Ref;
          else if (setIdx === 1) setRefProp = set1Ref;

          return (
            <div
              key={setKey}
              ref={setRefProp}
              aria-hidden={isClone ? 'true' : undefined}
              className={`flex flex-nowrap items-center ${gapClass} flex-shrink-0`}
            >
              {items.map((item, itemIdx) => {
                const itemKey = `set-${setIdx}-item-${item.id || itemIdx}`;
                return (
                  <div key={itemKey} className="flex-shrink-0">
                    {renderItem(item, itemIdx, isClone)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ContinuousMarquee;
