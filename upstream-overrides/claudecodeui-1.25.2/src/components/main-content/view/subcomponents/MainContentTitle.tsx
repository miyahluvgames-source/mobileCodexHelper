import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { AppTab, Project, ProjectSession } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
};

function getTabTitle(
  activeTab: AppTab,
  shouldShowTasksTab: boolean,
  t: (key: string) => string,
  pluginDisplayName?: string,
) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  return 'Project';
}

function getSessionTitle(session: ProjectSession): string {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.name as string) || (session.summary as string) || 'New Session';
}

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((plugin) => plugin.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;

  const title =
    activeTab === 'chat' && selectedSession
      ? getSessionTitle(selectedSession)
      : activeTab === 'chat'
        ? t('mainContent.newSession')
        : getTabTitle(activeTab, shouldShowTasksTab, t, pluginDisplayName);

  return (
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-3 overflow-x-auto">
      {selectedSession && activeTab === 'chat' && (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <SessionProviderLogo provider={selectedSession.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {selectedProject.displayName}
        </div>
        <h2 className="truncate text-sm font-semibold leading-tight text-foreground sm:text-base">
          {title}
        </h2>
      </div>
    </div>
  );
}
