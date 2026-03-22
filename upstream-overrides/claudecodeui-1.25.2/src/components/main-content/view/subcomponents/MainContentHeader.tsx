import { useCallback, useEffect, useRef, useState } from 'react';
import type { MainContentHeaderProps } from '../../types/types';
import MobileMenuButton from './MobileMenuButton';
import MainContentTabSwitcher from './MainContentTabSwitcher';
import MainContentTitle from './MainContentTitle';

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  isMobile,
  onMenuClick,
}: MainContentHeaderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    setCanScrollLeft(element.scrollLeft > 2);
    setCanScrollRight(element.scrollLeft < element.scrollWidth - element.clientWidth - 2);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(element);

    return () => observer.disconnect();
  }, [updateScrollState]);

  return (
    <div className="pwa-header-safe flex-shrink-0 border-b border-border/60 bg-background/85 px-3 py-2 backdrop-blur-xl sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
          <MainContentTitle
            activeTab={activeTab}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            shouldShowTasksTab={shouldShowTasksTab}
          />
        </div>

        <div className="relative min-w-0 flex-shrink overflow-hidden rounded-xl border border-border/40 bg-card/65 px-1 py-1 shadow-sm sm:flex-shrink-0">
          {canScrollLeft && (
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-card to-transparent" />
          )}
          <div
            ref={scrollRef}
            onScroll={updateScrollState}
            className="scrollbar-hide overflow-x-auto"
          >
            <MainContentTabSwitcher
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              shouldShowTasksTab={shouldShowTasksTab}
            />
          </div>
          {canScrollRight && (
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-card to-transparent" />
          )}
        </div>
      </div>
    </div>
  );
}
