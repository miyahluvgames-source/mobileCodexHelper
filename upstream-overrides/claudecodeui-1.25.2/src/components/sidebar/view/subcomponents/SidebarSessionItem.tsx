import { Check, Clock, Edit2, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Badge, Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import { IS_CODEX_ONLY_HARDENED } from '../../../../constants/config';
import { formatTimeAgo } from '../../../../utils/dateUtils';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  t: TFunction;
};

export default function SidebarSessionItem({
  project,
  session,
  selectedSession,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;

  const selectMobileSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.name);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.name, session.id, editingSessionName, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.name, session.id, sessionView.sessionName, session.__provider);
  };

  return (
    <div className="group relative">
      {sessionView.isActive && (
        <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 transform">
          <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
        </div>
      )}

      <div className="md:hidden">
        <div
          className={cn(
            'relative mx-3 my-1 rounded-xl border px-3 py-2.5 active:scale-[0.98] transition-all duration-150',
            isSelected ? 'border-primary/30 bg-primary/8 shadow-sm' : '',
            !isSelected && sessionView.isActive
              ? 'border-green-500/30 bg-green-50/5 dark:bg-green-900/5'
              : 'border-border/40 bg-card/85',
          )}
          onClick={selectMobileSession}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl',
                isSelected ? 'bg-primary/10 text-primary' : 'bg-muted/60 text-muted-foreground',
              )}
            >
              <SessionProviderLogo provider={session.__provider} className="h-3.5 w-3.5" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Session
                </span>
                {sessionView.isActive && (
                  <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-green-600 dark:text-green-400">
                    Live
                  </span>
                )}
              </div>
              <div className="truncate text-sm font-semibold text-foreground">{sessionView.sessionName}</div>
              <div className="mt-1 flex items-center gap-1.5">
                <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {formatTimeAgo(sessionView.sessionTime, currentTime, t)}
                </span>
                {sessionView.messageCount > 0 && (
                  <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[10px]">
                    {sessionView.messageCount}
                  </Badge>
                )}
              </div>
            </div>

            {!IS_CODEX_ONLY_HARDENED && !sessionView.isCursorSession && (
              <button
                className="ml-1 flex h-5 w-5 items-center justify-center rounded-md bg-red-50 opacity-70 transition-transform active:scale-95 dark:bg-red-900/20"
                onClick={(event) => {
                  event.stopPropagation();
                  requestDeleteSession();
                }}
              >
                <Trash2 className="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <Button
          variant="ghost"
          className={cn(
            'h-auto w-full justify-start rounded-xl border border-transparent p-2.5 text-left font-normal transition-colors duration-200 hover:bg-accent/50',
            isSelected && 'border-primary/15 bg-accent text-accent-foreground',
          )}
          onClick={() => onSessionSelect(session, project.name)}
        >
          <div className="flex w-full min-w-0 items-start gap-2">
            <div className={cn(
              'mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl',
              isSelected ? 'bg-primary/10 text-primary' : 'bg-muted/60 text-muted-foreground',
            )}>
              <SessionProviderLogo provider={session.__provider} className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Session
              </div>
              <div className="truncate text-sm font-semibold text-foreground">{sessionView.sessionName}</div>
              <div className="mt-1 flex items-center gap-1">
                <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {formatTimeAgo(sessionView.sessionTime, currentTime, t)}
                </span>
                {sessionView.messageCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-auto px-1.5 py-0 text-[10px] transition-opacity group-hover:opacity-0"
                  >
                    {sessionView.messageCount}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </Button>

        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 transform items-center gap-1 opacity-0 transition-all duration-200 group-hover:opacity-100">
            {!IS_CODEX_ONLY_HARDENED && editingSession === session.id ? (
              <>
                <input
                  type="text"
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveEditedSession();
                    } else if (event.key === 'Escape') {
                      onCancelEditingSession();
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="w-32 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button
                  className="flex h-6 w-6 items-center justify-center rounded bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveEditedSession();
                  }}
                  title={t('tooltips.save')}
                >
                  <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
                </button>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingSession();
                  }}
                  title={t('tooltips.cancel')}
                >
                  <X className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                </button>
              </>
            ) : !IS_CODEX_ONLY_HARDENED ? (
              <>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartEditingSession(session.id, sessionView.sessionName);
                  }}
                  title={t('tooltips.editSessionName')}
                >
                  <Edit2 className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                </button>
                {!sessionView.isCursorSession && (
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestDeleteSession();
                    }}
                    title={t('tooltips.deleteSession')}
                  >
                    <Trash2 className="h-3 w-3 text-red-600 dark:text-red-400" />
                  </button>
                )}
              </>
            ) : null}
          </div>
      </div>
    </div>
  );
}
