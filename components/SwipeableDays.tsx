import React, { useState, useEffect, useRef, useMemo } from 'react';
import { DaySchedule, Lesson } from '../types';
import DayColumn from './DayColumn';
import ScheduleState from './ScheduleState';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { getDayCalendarDate, getSemesterWeek, getDayName, getDayISODate, samaraISO, getSamaraDate } from '../utils/samaraDate';
import { useNow } from '../utils/useNow';
import { TeacherAssignmentScope } from './EditLessonModal';

interface SwipeableDaysProps {
  days: DaySchedule[];
  weekNumber?: number;
  userRole?: string;
  onUpdateLesson?: (lessonId: string, updated: Partial<Lesson>, applyScope?: TeacherAssignmentScope, lessonDayName?: string) => void;
  onResetLesson?: (lessonId: string) => void;
}

const SwipeableDays: React.FC<SwipeableDaysProps> = ({ 
  days,
  weekNumber = 1,
  userRole,
  onUpdateLesson,
  onResetLesson,
}) => {
  const liveNow = useNow(60000);
  const samaraToday = useMemo(() => getSamaraDate(liveNow), [liveNow]);
  const currentSemesterWeek = useMemo(() => getSemesterWeek(samaraToday), [samaraToday]);
  const todayDayName = useMemo(() => getDayName(samaraToday), [samaraToday]);

  // Determine initial day: if viewing current semester week, select today's day; otherwise first day with lessons!
  const initialIndex = useMemo(() => {
    if (weekNumber === currentSemesterWeek && days.length > 0) {
      const idx = days.findIndex(d => d.dayName === todayDayName);
      if (idx >= 0) return idx;
    }
    if (days.length > 0) {
      const firstWithLessons = days.findIndex(d => d.lessons.length > 0);
      if (firstWithLessons >= 0) return firstWithLessons;
    }
    return 0;
  }, [weekNumber, currentSemesterWeek, todayDayName, days]);

  const [activeDayIndex, setActiveDayIndex] = useState<number>(initialIndex);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);

  // Track previous week to detect REAL week changes vs background data re-renders
  const prevWeekRef = useRef<number>(weekNumber);
  const currentDayNameRef = useRef<string>(days[initialIndex]?.dayName || '');

  // Keep currentDayNameRef updated with the active day
  useEffect(() => {
    if (days[activeDayIndex]?.dayName) {
      currentDayNameRef.current = days[activeDayIndex].dayName;
    }
  }, [activeDayIndex, days]);
  
  // Swipe tracking
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const startTime = useRef<number>(0);
  const lastWheelTime = useRef<number>(0);

  // Day chips scroll container
  const chipsContainerRef = useRef<HTMLDivElement>(null);
  const dayChipRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const goToNextDay = () => {
    setActiveDayIndex(prev => {
      if (prev < days.length - 1) {
        setSlideDirection('left');
        return prev + 1;
      }
      return prev;
    });
  };

  const goToPrevDay = () => {
    setActiveDayIndex(prev => {
      if (prev > 0) {
        setSlideDirection('right');
        return prev - 1;
      }
      return prev;
    });
  };

  // Keyboard navigation for Desktop / Telegram Desktop users (Left/Right arrows)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'ArrowLeft') {
        goToPrevDay();
      } else if (e.key === 'ArrowRight') {
        goToNextDay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [days.length]);

  // Handle weekNumber change: preserve the selected day of the week (e.g. Friday remains Friday)!
  // Background data updates (cloud sync, attendance, notes) will NEVER reset the user's active day!
  useEffect(() => {
    if (prevWeekRef.current !== weekNumber) {
      prevWeekRef.current = weekNumber;

      const preferredDayName = currentDayNameRef.current;
      if (preferredDayName && days.length > 0) {
        const matchingIdx = days.findIndex(d => d.dayName === preferredDayName);
        if (matchingIdx >= 0) {
          setActiveDayIndex(matchingIdx);
          return;
        }
      }

      if (weekNumber === currentSemesterWeek && days.length > 0) {
        const idx = days.findIndex(d => d.dayName === todayDayName);
        setActiveDayIndex(idx >= 0 ? idx : 0);
      } else {
        const firstWithLessons = days.findIndex(d => d.lessons.length > 0);
        setActiveDayIndex(firstWithLessons >= 0 ? firstWithLessons : 0);
      }
    } else {
      // If weekNumber didn't change, just clamp if days array changed length
      setActiveDayIndex(prev => {
        if (days.length === 0) return 0;
        return Math.min(prev, days.length - 1);
      });
    }
  }, [weekNumber, days, currentSemesterWeek, todayDayName]);

  // Scroll active day chip horizontally WITHOUT jerking the main page!
  useEffect(() => {
    const container = chipsContainerRef.current;
    const chip = dayChipRefs.current[activeDayIndex];
    if (container && chip) {
      const targetLeft = chip.offsetLeft - (container.clientWidth / 2) + (chip.clientWidth / 2);
      container.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: 'smooth'
      });
    }
  }, [activeDayIndex]);

  if (!days || days.length === 0) {
    return (
      <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-sm w-full">
        <p className="text-slate-400">Расписание для этой группы не найдено.</p>
      </div>
    );
  }

  // Pointer & Touch gesture handlers
  // Evaluates complete gesture at release: ensures fluid vertical scroll and reliable horizontal swipes
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Don't intercept clicks on buttons or links
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return;

    startX.current = e.clientX;
    startY.current = e.clientY;
    startTime.current = Date.now();
    if (e.pointerType === 'mouse') {
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch (err) {}
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {}
    }

    if (startX.current === null || startY.current === null) return;
    const diffX = startX.current - e.clientX;
    const diffY = Math.abs(startY.current - e.clientY);
    const elapsed = Date.now() - startTime.current;

    startX.current = null;
    startY.current = null;

    const isDominantHorizontal = Math.abs(diffX) > diffY * 1.35;
    const isDistance = Math.abs(diffX) >= 28;
    const isFlick = Math.abs(diffX) >= 18 && elapsed < 350;

    if (isDominantHorizontal && (isDistance || isFlick)) {
      if (diffX > 0) {
        goToNextDay();
      } else {
        goToPrevDay();
      }
    }
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
    startX.current = null;
    startY.current = null;
  };

  // Horizontal mouse wheel or trackpad swipe with 400ms cooldown (prevents wheel thrashing)
  const handleWheel = (e: React.WheelEvent) => {
    const now = Date.now();
    if (now - lastWheelTime.current < 400) return;

    if (Math.abs(e.deltaX) > 35 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      lastWheelTime.current = now;
      if (e.deltaX > 0) {
        goToNextDay();
      } else {
        goToPrevDay();
      }
    }
  };

  // Direct Touch Fallback for mobile devices
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    startTime.current = Date.now();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (startX.current === null || startY.current === null) return;
    const diffX = startX.current - e.changedTouches[0].clientX;
    const diffY = Math.abs(startY.current - e.changedTouches[0].clientY);
    const elapsed = Date.now() - startTime.current;

    startX.current = null;
    startY.current = null;

    const isDominantHorizontal = Math.abs(diffX) > diffY * 1.35;
    const isDistance = Math.abs(diffX) >= 28;
    const isFlick = Math.abs(diffX) >= 18 && elapsed < 350;

    if (isDominantHorizontal && (isDistance || isFlick)) {
      if (diffX > 0) {
        goToNextDay();
      } else {
        goToPrevDay();
      }
    }
  };

  const handleTouchCancel = () => {
    startX.current = null;
    startY.current = null;
  };

  const getShortDayName = (dayName: string) => {
    switch (dayName) {
      case 'Понедельник': return 'Пн';
      case 'Вторник': return 'Вт';
      case 'Среда': return 'Ср';
      case 'Четверг': return 'Чт';
      case 'Пятница': return 'Пт';
      case 'Суббота': return 'Сб';
      case 'Воскресенье': return 'Вс';
      default: return dayName.slice(0, 2);
    }
  };

  if (!days || days.length === 0) {
    return <ScheduleState status="empty" groupName="" />;
  }

  return (
    <div className="space-y-4 w-full max-w-full overflow-x-clip">
      {/* Day Selector Chips (Horizontal Row with Calendar Dates & Today Badge) */}
      <div 
        ref={chipsContainerRef}
        className="flex gap-2 overflow-x-auto pb-2 scrollbar-none lg:hidden w-full max-w-full"
      >
        {days.map((day, idx) => {
          const shortName = getShortDayName(day.dayName);
          const calDate = getDayCalendarDate(day.dayName, weekNumber, samaraToday);
          const dayIso = getDayISODate(day.dayName, weekNumber, samaraToday);
          const isToday = dayIso === samaraISO(samaraToday);

          return (
            <button
              key={day.dayName}
              ref={el => { dayChipRefs.current[idx] = el; }}
              onClick={() => {
                setSlideDirection(idx > activeDayIndex ? 'left' : 'right');
                setActiveDayIndex(idx);
              }}
              className={`px-3 py-2 text-xs font-bold rounded-2xl whitespace-nowrap transition-all flex flex-col items-center gap-0.5 shrink-0 relative ${
                activeDayIndex === idx
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-none scale-[1.02]'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
              } ${isToday && activeDayIndex !== idx ? 'border-indigo-400 dark:border-indigo-500 ring-1 ring-indigo-400' : ''}`}
            >
              <div className="flex items-center gap-1">
                <span>{shortName}</span>
                {isToday && (
                  <span className={`text-[8px] font-extrabold px-1 rounded ${
                    activeDayIndex === idx ? 'bg-indigo-800 text-indigo-100' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300'
                  }`}>
                    Сегодня
                  </span>
                )}
              </div>
              <span className={`text-[10px] ${activeDayIndex === idx ? 'text-indigo-200' : 'text-slate-400'}`}>
                {calDate}
              </span>
            </button>
          );
        })}
      </div>

      {/* Swipe Container - Supports Touch (phones) and Pointer Drag (PC / Telegram Desktop) */}
      <div
        className="lg:hidden relative w-full max-w-full touch-pan-y cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={handleWheel}
      >
        <div 
          key={`${weekNumber}_${activeDayIndex}`} 
          className={
            slideDirection === 'left' 
              ? 'animate-in fade-in slide-in-from-right-4 duration-150' 
              : slideDirection === 'right' 
              ? 'animate-in fade-in slide-in-from-left-4 duration-150' 
              : 'animate-in fade-in duration-150'
          }
        >
          <DayColumn 
            daySchedule={days[activeDayIndex] || days[0]} 
            weekNumber={weekNumber}
            userRole={userRole}
            onUpdateLesson={onUpdateLesson}
            onResetLesson={onResetLesson}
          />
        </div>

        {/* Navigation Arrows */}
        <div className="flex justify-between items-center mt-4 w-full">
          <button
            onClick={goToPrevDay}
            disabled={activeDayIndex === 0}
            className="flex items-center gap-1 px-3.5 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-30 border border-slate-200 dark:border-slate-700 min-h-[44px] transition-transform active:scale-95"
          >
            <ChevronLeft className="w-4 h-4" /> Назад
          </button>
          <span className="text-xs text-slate-400 font-medium">
            {activeDayIndex + 1} из {days.length} (Свайп или стрелки)
          </span>
          <button
            onClick={goToNextDay}
            disabled={activeDayIndex === days.length - 1}
            className="flex items-center gap-1 px-3.5 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-30 border border-slate-200 dark:border-slate-700 min-h-[44px] transition-transform active:scale-95"
          >
            Вперед <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Grid Layout for Wide Screens (Desktop monitors >= 1024px) */}
      <div className="hidden lg:grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 items-start w-full">
        {days.map(day => (
          <DayColumn 
            key={day.dayName} 
            daySchedule={day} 
            weekNumber={weekNumber}
            userRole={userRole}
            onUpdateLesson={onUpdateLesson}
            onResetLesson={onResetLesson}
          />
        ))}
      </div>
    </div>
  );
};

export default SwipeableDays;
