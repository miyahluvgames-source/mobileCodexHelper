import { Check, ChevronDown, ChevronRight, Edit3, Folder, FolderOpen, Plus, Star, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import { IS_CODEX_ONLY_HARDENED } from '../../../../constants/config';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { MCPServerStatus, SessionWithProvider } from '../../types/types';
import { getTaskIndicatorStatus } from '../../utils/utils';
import TaskIndicator from './TaskIndicator';
import SidebarProjectSessions from './SidebarProjectSessions';

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  isStarred: boolean;
  editingProject: string | null;
  editingName: string;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  onEditingNameChange: (name: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  t: TFunction;
};

const getSessionCountDisplay = (sessions: SessionWithProvider[], hasMoreSessions: boolean): string => {
  const sessionCount = sessions.length;
  if (hasMoreSessions && sessionCount >= 5) {
    return `${sessionCount}+`;
  }

  return `${sessionCount}`;
};

export default function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  isStarred,
  editingProject,
  editingName,
  sessions,
  initialSessionsLoaded,
  isLoadingSessions,
  currentTime,
  editingSession,
  editingSessionName,
  tasksEnabled,
  mcpServerStatus,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  t,
}: SidebarProjectItemProps) {
  const isSelected = selectedProject?.name === project.name;
  const isEditing = editingProject === project.name;
  const hasMoreSessions = project.sessionMeta?.hasMore === true;
  const sessionCountDisplay = getSessionCountDisplay(sessions, hasMoreSessions);
  const sessionCountLabel = `${sessionCountDisplay} session${sessions.length === 1 ? '' : 's'}`;
  const taskStatus = getTaskIndicatorStatus(project, mcpServerStatus);
  const projectPathHint =
    project.fullPath && project.fullPath.length > 42
      ? `...${project.fullPath.slice(-39)}`
      : project.fullPath;

  const toggleProject = () => onToggleProject(project.name);
  const toggleStarProject = () => onToggleStarProject(project.name);

  const saveProjectName = () => {
    onSaveProjectName(project.name);
  };

  const selectAndToggleProject = () => {
    if (selectedProject?.name !== project.name) {
      onProjectSelect(project);
    }

    toggleProject();
  };

  return (
    <div className={cn('md:space-y-1', isDeleting && 'opacity-50 pointer-events-none')}>
      <div className="md:group group">
        <div className="md:hidden">
          <div
            className={cn(
              'mx-3 my-1 rounded-2xl border px-3 py-3 active:scale-[0.98] transition-all duration-150',
              isSelected && 'border-primary/30 bg-primary/8 shadow-sm',
              !isSelected && 'border-border/50 bg-card/90',
              isStarred &&
                !isSelected &&
                'border-yellow-200/40 bg-yellow-50/50 dark:border-yellow-800/30 dark:bg-yellow-900/5',
            )}
            onClick={toggleProject}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div
                  className={cn(
                    'mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl transition-colors',
                    isExpanded ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {isExpanded ? (
                    <FolderOpen className="h-4 w-4" />
                  ) : (
                    <Folder className="h-4 w-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(event) => onEditingNameChange(event.target.value)}
                      className="w-full rounded-lg border-2 border-primary/40 bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-all duration-200 focus:border-primary focus:shadow-md focus:outline-none"
                      placeholder={t('projects.projectNamePlaceholder')}
                      autoFocus
                      autoComplete="off"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          saveProjectName();
                        }

                        if (event.key === 'Escape') {
                          onCancelEditingProject();
                        }
                      }}
                      style={{
                        fontSize: '16px',
                        WebkitAppearance: 'none',
                        borderRadius: '8px',
                      }}
                    />
                  ) : (
                    <>
                      <div className="mb-1 flex min-w-0 items-center gap-2">
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                          Project
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {sessionCountLabel}
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <h3 className="truncate text-sm font-semibold text-foreground">{project.displayName}</h3>
                        {tasksEnabled && (
                          <TaskIndicator
                            status={taskStatus}
                            size="xs"
                            className="ml-2 hidden flex-shrink-0 md:inline-flex"
                          />
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{projectPathHint}</p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {isEditing ? (
                  <>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-green-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveProjectName();
                      }}
                    >
                      <Check className="h-4 w-4 text-white" />
                    </button>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-gray-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelEditingProject();
                      }}
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 active:scale-90 dark:border-primary/30 dark:bg-primary/20"
                      onClick={(event) => {
                        event.stopPropagation();
                        onProjectSelect(project);
                        onNewSession(project);
                      }}
                      title={t('sessions.newSession')}
                    >
                      <Plus className="h-4 w-4 text-primary" />
                    </button>
                    <button
                      className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 transition-all duration-150 border',
                        isStarred
                          ? 'bg-yellow-500/10 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800'
                          : 'bg-gray-500/10 dark:bg-gray-900/30 border-gray-200 dark:border-gray-800',
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleStarProject();
                      }}
                      title={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                    >
                      <Star
                        className={cn(
                          'w-4 h-4 transition-colors',
                          isStarred
                            ? 'text-yellow-600 dark:text-yellow-400 fill-current'
                            : 'text-gray-600 dark:text-gray-400',
                        )}
                      />
                    </button>

                    {!IS_CODEX_ONLY_HARDENED && (
                      <>
                        <button
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-500/10 active:scale-90 dark:border-red-800 dark:bg-red-900/30"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteProject(project);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                        </button>

                        <button
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 active:scale-90 dark:border-primary/30 dark:bg-primary/20"
                          onClick={(event) => {
                            event.stopPropagation();
                            onStartEditingProject(project);
                          }}
                        >
                          <Edit3 className="h-4 w-4 text-primary" />
                        </button>
                      </>
                    )}

                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/30">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          className={cn(
            'hidden h-auto w-full justify-between rounded-2xl border border-transparent p-3 font-normal transition-colors hover:bg-accent/50 md:flex',
            isSelected && 'border-primary/15 bg-accent text-accent-foreground',
            isStarred &&
              !isSelected &&
              'bg-yellow-50/50 dark:bg-yellow-900/10 hover:bg-yellow-100/50 dark:hover:bg-yellow-900/20',
          )}
          onClick={selectAndToggleProject}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 flex-shrink-0 text-primary" />
            ) : (
              <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1 text-left">
              {isEditing ? (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(event) => onEditingNameChange(event.target.value)}
                    className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
                    placeholder={t('projects.projectNamePlaceholder')}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        saveProjectName();
                      }
                      if (event.key === 'Escape') {
                        onCancelEditingProject();
                      }
                    }}
                  />
                  <div className="truncate text-xs text-muted-foreground" title={project.fullPath}>
                    {project.fullPath}
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Project
                  </div>
                  <div className="truncate text-sm font-semibold text-foreground" title={project.displayName}>
                    {project.displayName}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {sessionCountLabel}
                    </span>
                    <span className="truncate opacity-70" title={project.fullPath}>
                      {projectPathHint}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            {isEditing ? (
              <>
                <div
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-green-600 transition-colors hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/20"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveProjectName();
                  }}
                >
                  <Check className="h-3 w-3" />
                </div>
                <div
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:hover:bg-gray-800"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingProject();
                  }}
                >
                  <X className="h-3 w-3" />
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="touch:opacity-100 flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-primary/10 text-primary opacity-100 transition-all duration-200 hover:bg-primary/15"
                  onClick={(event) => {
                    event.stopPropagation();
                    onNewSession(project);
                  }}
                  title={t('sessions.newSession')}
                >
                  <Plus className="h-3 w-3" />
                </button>
                <div
                  className={cn(
                    'w-6 h-6 opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center rounded cursor-pointer touch:opacity-100',
                    isStarred ? 'hover:bg-yellow-50 dark:hover:bg-yellow-900/20 opacity-100' : 'hover:bg-accent',
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleStarProject();
                  }}
                  title={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                >
                  <Star
                    className={cn(
                      'w-3 h-3 transition-colors',
                      isStarred
                        ? 'text-yellow-600 dark:text-yellow-400 fill-current'
                        : 'text-muted-foreground',
                    )}
                  />
                </div>
                {!IS_CODEX_ONLY_HARDENED && (
                  <>
                    <div
                      className="touch:opacity-100 flex h-6 w-6 cursor-pointer items-center justify-center rounded opacity-0 transition-all duration-200 hover:bg-accent group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStartEditingProject(project);
                      }}
                      title={t('tooltips.renameProject')}
                    >
                      <Edit3 className="h-3 w-3" />
                    </div>
                    <div
                      className="touch:opacity-100 flex h-6 w-6 cursor-pointer items-center justify-center rounded opacity-0 transition-all duration-200 hover:bg-red-50 group-hover:opacity-100 dark:hover:bg-red-900/20"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteProject(project);
                      }}
                      title={t('tooltips.deleteProject')}
                    >
                      <Trash2 className="h-3 w-3 text-red-600 dark:text-red-400" />
                    </div>
                  </>
                )}
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                )}
              </>
            )}
          </div>
        </Button>
      </div>

      <SidebarProjectSessions
        project={project}
        isExpanded={isExpanded}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        isLoadingSessions={isLoadingSessions}
        currentTime={currentTime}
        editingSession={editingSession}
        editingSessionName={editingSessionName}
        onEditingSessionNameChange={onEditingSessionNameChange}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onProjectSelect={onProjectSelect}
        onSessionSelect={onSessionSelect}
        onDeleteSession={onDeleteSession}
        onLoadMoreSessions={onLoadMoreSessions}
        onNewSession={onNewSession}
        t={t}
      />
    </div>
  );
}
