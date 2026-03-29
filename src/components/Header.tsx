import React from 'react';
import { AIProviderConfig } from '../types';

interface HeaderProps {
  onOpenSettings: () => void;
  onSignOut?: () => void;
  sunoCredits: number | null;
  providerConfig?: AIProviderConfig;
  authBypassEnabled?: boolean;
  sunoConnectionState?: 'missing' | 'checking' | 'connected' | 'lost';
}

export const Header: React.FC<HeaderProps> = ({ 
  onOpenSettings,
  onSignOut,
  sunoCredits,
  providerConfig,
  authBypassEnabled = false,
  sunoConnectionState = 'missing',
}) => {
  const buildLabel = `v${import.meta.env.VITE_APP_VERSION || 'dev'} (${import.meta.env.VITE_APP_COMMIT || 'local'})`;
  const providerLabel =
    providerConfig?.type === 'gemini'
      ? 'Powered by Gemini'
      : providerConfig?.type === 'openrouter'
        ? 'Powered by OpenRouter'
        : providerConfig?.type === 'openapi'
          ? 'Powered by Custom API'
          : 'No provider selected';

  const sunoBadge = (() => {
    if (sunoConnectionState === 'connected') {
      return {
        cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
        dot: 'bg-emerald-300',
        text: 'Suno Connected',
        title: 'Suno API connection is healthy',
      };
    }
    if (sunoConnectionState === 'checking') {
      return {
        cls: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
        dot: 'bg-amber-300',
        text: 'Suno Checking',
        title: 'Verifying Suno API connection',
      };
    }
    if (sunoConnectionState === 'lost') {
      return {
        cls: 'border-red-500/40 bg-red-500/10 text-red-200',
        dot: 'bg-red-300',
        text: 'Suno Lost',
        title: 'Suno API connection lost. Update token/cookie in Settings.',
      };
    }
    return {
      cls: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
      dot: 'bg-slate-300',
      text: 'Suno Missing',
      title: 'No Suno token/cookie configured',
    };
  })();

  return (
    <header className="w-full py-4 px-4 md:px-8 flex items-center justify-between border-b border-[var(--app-panel-border)] bg-[var(--app-panel)] backdrop-blur-md sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-2 rounded-lg shadow-lg shadow-purple-500/20">
          {/* Music Icon */}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-white">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Suno <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">Architect</span>
          </h1>
          <p className="text-xs text-slate-400 font-medium" title={`Build ${buildLabel}`}>
            {providerLabel}
            {providerConfig?.model && ` • ${providerConfig.model}`}
            {` • ${buildLabel}`}
          </p>
        </div>
      </div>
      
      <div className="flex items-center gap-2 sm:gap-3 relative">
        <div
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold uppercase tracking-wide ${sunoBadge.cls}`}
          title={sunoBadge.title}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${sunoBadge.dot}`} />
          {sunoBadge.text}
        </div>

        {authBypassEnabled && (
          <div
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-[11px] font-bold uppercase tracking-wide"
            title="Authentication is disabled for this deployment"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-300" />
            Auth Disabled
          </div>
        )}

        {/* Credits Display - Visible when logged in (credits not null) */}
        {sunoCredits !== null && (
            <div className="hidden sm:flex items-center gap-2 bg-[var(--app-panel)] border border-[var(--app-panel-border)]/50 px-3 py-1 rounded-lg mr-1 backdrop-blur-sm">
                <div className="flex flex-col items-end leading-none">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-0.5">Credits</span>
                    <span className="text-sm font-bold text-[var(--app-accent)] font-mono">{sunoCredits}</span>
                </div>
            </div>
        )}

        {onSignOut && (
          <button
            onClick={onSignOut}
            className="flex items-center gap-2 bg-[var(--app-panel)] text-slate-400 hover:text-white hover:bg-[var(--app-tab-hover)] border border-[var(--app-panel-border)] rounded-lg px-3 py-2 transition-all text-xs font-bold shadow-sm"
            title="Sign Out"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        )}

        {/* Unified Settings Button */}
        <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 bg-[var(--app-panel)] text-slate-400 hover:text-white hover:bg-[var(--app-tab-hover)] border border-[var(--app-panel-border)] rounded-lg px-3 py-2 transition-all text-xs font-bold shadow-sm"
            title="Open Settings"
        >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <span>Settings</span>
        </button>
      </div>
    </header>
  );
};
