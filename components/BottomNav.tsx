import React from 'react';
import { Calendar, BookOpen, ClipboardCheck, Users, Shield, User } from 'lucide-react';
import { UserRole } from '../types';

interface BottomNavProps {
  currentTab: 'schedule' | 'homework' | 'attendance' | 'group' | 'admin' | 'profile';
  onTabChange: (tab: 'schedule' | 'homework' | 'attendance' | 'group' | 'admin' | 'profile') => void;
  userRole: UserRole;
  isLoggedIn: boolean;
}

const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onTabChange,
  userRole,
  isLoggedIn
}) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-300/80 dark:border-slate-800 px-1 pt-1.5 pb-safe shadow-lg sm:hidden">
      <div className="flex justify-around items-center max-w-md mx-auto">
        <button
          onClick={() => onTabChange('schedule')}
          className={`flex flex-col items-center justify-center min-h-[48px] py-1 px-2 rounded-xl transition-all ${
            currentTab === 'schedule'
              ? 'text-indigo-600 dark:text-indigo-400 font-bold scale-105'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
          }`}
        >
          <Calendar className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] leading-none">Пары</span>
        </button>

        <button
          onClick={() => onTabChange('homework')}
          className={`flex flex-col items-center justify-center min-h-[48px] py-1 px-2 rounded-xl transition-all ${
            currentTab === 'homework'
              ? 'text-indigo-600 dark:text-indigo-400 font-bold scale-105'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
          }`}
        >
          <BookOpen className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] leading-none">ДЗ</span>
        </button>

        {(userRole === 'admin' || userRole === 'starosta') && (
          <button
            onClick={() => onTabChange('attendance')}
            className={`flex flex-col items-center justify-center min-h-[48px] py-1 px-2 rounded-xl transition-all ${
              currentTab === 'attendance'
                ? 'text-indigo-600 dark:text-indigo-400 font-bold scale-105'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
            }`}
          >
            <ClipboardCheck className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] leading-none">Посещение</span>
          </button>
        )}

        {(userRole === 'admin' || userRole === 'starosta') && (
          <button
            onClick={() => onTabChange('group')}
            className={`flex flex-col items-center justify-center min-h-[48px] py-1 px-2 rounded-xl transition-all ${
              currentTab === 'group'
                ? 'text-indigo-600 dark:text-indigo-400 font-bold scale-105'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
            }`}
          >
            <Users className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] leading-none">Группа</span>
          </button>
        )}

        {userRole === 'admin' && (
          <button
            onClick={() => onTabChange('admin')}
            className={`flex flex-col items-center justify-center min-h-[48px] py-1 px-2 rounded-xl transition-all ${
              currentTab === 'admin'
                ? 'text-amber-600 dark:text-amber-400 font-bold scale-105'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
            }`}
          >
            <Shield className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] leading-none">Админ</span>
          </button>
        )}

        <button
          onClick={() => onTabChange('profile')}
          className={`flex flex-col items-center justify-center min-h-[48px] py-1 px-2 rounded-xl transition-all ${
            currentTab === 'profile'
              ? 'text-indigo-600 dark:text-indigo-400 font-bold scale-105'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
          }`}
        >
          <User className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] leading-none">{isLoggedIn ? 'Профиль' : 'Вход'}</span>
        </button>
      </div>
    </nav>
  );
};

export default BottomNav;
