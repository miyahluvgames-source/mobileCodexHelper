import { FolderPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IS_CODEX_ONLY_HARDENED } from '../../../constants/config';
import type { WorkspaceType } from '../types';

type StepTypeSelectionProps = {
  workspaceType: WorkspaceType;
  onWorkspaceTypeChange: (workspaceType: WorkspaceType) => void;
};

export default function StepTypeSelection({
  workspaceType,
  onWorkspaceTypeChange,
}: StepTypeSelectionProps) {
  const { t } = useTranslation();

  if (IS_CODEX_ONLY_HARDENED) {
    return (
      <div className="space-y-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
          Add an existing project directory
        </h4>

        <button
          onClick={() => onWorkspaceTypeChange('existing')}
          className={`w-full rounded-lg border-2 p-4 text-left transition-all ${
            workspaceType === 'existing'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/50">
              <FolderPlus className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1">
              <h5 className="mb-1 font-semibold text-gray-900 dark:text-white">
                Existing project
              </h5>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Add a folder that already exists on this machine. Clone/new workspace flows stay disabled in Codex mode.
              </p>
            </div>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h4 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
        {t('projectWizard.step1.question')}
      </h4>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <button
          onClick={() => onWorkspaceTypeChange('existing')}
          className={`rounded-lg border-2 p-4 text-left transition-all ${
            workspaceType === 'existing'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/50">
              <FolderPlus className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1">
              <h5 className="mb-1 font-semibold text-gray-900 dark:text-white">
                {t('projectWizard.step1.existing.title')}
              </h5>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('projectWizard.step1.existing.description')}
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={() => onWorkspaceTypeChange('new')}
          className={`rounded-lg border-2 p-4 text-left transition-all ${
            workspaceType === 'new'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/50">
              <svg className="h-5 w-5 text-purple-600 dark:text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h16" />
                <path d="M8 20V4l8 4v12" />
              </svg>
            </div>
            <div className="flex-1">
              <h5 className="mb-1 font-semibold text-gray-900 dark:text-white">
                {t('projectWizard.step1.new.title')}
              </h5>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('projectWizard.step1.new.description')}
              </p>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
