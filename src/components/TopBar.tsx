import { RotateCcw } from 'lucide-react';
import type { UserRole } from '../shared/types.js';

interface TopBarProps {
  role: UserRole;
  onRoleChange: (role: UserRole) => void;
  onResetDemo: () => void;
  isResetting: boolean;
  pendingFacultyCount: number;
}

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'student', label: 'Student' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'admin', label: 'Lab Admin' },
];

export function TopBar({
  role,
  onRoleChange,
  onResetDemo,
  isResetting,
  pendingFacultyCount,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-slate-900 focus:text-white focus:text-sm focus:font-semibold focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
      >
        Skip to main content
      </a>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-2 flex flex-wrap items-center justify-between gap-3 sm:gap-6">
        <a
          href="#main-content"
          aria-label="LabLink home — jump to main content"
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
        >
          LabLink
        </a>

        <nav
          aria-label="Demo user role switcher"
          className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200"
        >
          <span className="sr-only">Select active demo role:</span>
          {ROLE_OPTIONS.map((option) => {
            const isActive = role === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onRoleChange(option.value)}
                aria-pressed={isActive}
                className={`px-3 py-1.5 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  isActive
                    ? 'bg-white text-slate-900 font-semibold shadow-xs border border-slate-300'
                    : 'text-slate-700 font-medium hover:text-slate-900'
                }`}
              >
                <span>{option.label}</span>
                {isActive && <span className="sr-only"> (current role)</span>}
                {option.value === 'faculty' && pendingFacultyCount > 0 && (
                  <span className="ml-1.5 font-mono tabular-nums text-xs text-amber-800 font-semibold">
                    ({pendingFacultyCount}
                    <span className="sr-only"> pending approvals</span>)
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={onResetDemo}
          disabled={isResetting}
          aria-label="Reset demo dataset to initial campus state"
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>{isResetting ? 'Resetting...' : 'Reset Demo'}</span>
        </button>
      </div>
    </header>
  );
}
