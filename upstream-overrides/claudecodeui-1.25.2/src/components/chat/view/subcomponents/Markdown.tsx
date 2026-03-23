import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTranslation } from 'react-i18next';
import { normalizeInlineCodeFences } from '../../utils/chatFormatting';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { authenticatedFetch } from '../../../../utils/api';

type MarkdownProps = {
  children: React.ReactNode;
  className?: string;
  projectName?: string;
  projectRoot?: string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
};

type CodeBlockProps = {
  node?: any;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
};

const CodeBlock = ({ node, inline, className, children, ...props }: CodeBlockProps) => {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
  const looksMultiline = /[\r\n]/.test(raw);
  const inlineDetected = inline || (node && node.type === 'inlineCode');
  const shouldInline = inlineDetected || !looksMultiline;

  if (shouldInline) {
    return (
      <code
        className={`whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-[0.9em] text-gray-900 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-100 ${className || ''
          }`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';

  return (
    <div className="group relative my-2">
      {language && language !== 'text' && (
        <div className="absolute left-3 top-2 z-10 text-xs font-medium uppercase text-gray-400">{language}</div>
      )}

      <button
        type="button"
        onClick={() =>
          copyTextToClipboard(raw).then((success) => {
            if (success) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          })
        }
        className="absolute right-2 top-2 z-10 rounded-md border border-gray-600 bg-gray-700/80 px-2 py-1 text-xs text-white opacity-0 transition-opacity hover:bg-gray-700 focus:opacity-100 active:opacity-100 group-hover:opacity-100"
        title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
        aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
      >
        {copied ? (
          <span className="flex items-center gap-1">
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {t('codeBlock.copied')}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
            </svg>
            {t('codeBlock.copy')}
          </span>
        )}
      </button>

      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          padding: language && language !== 'text' ? '2rem 1rem 1rem 1rem' : '1rem',
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          },
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
};

const WINDOWS_PATH_LINK_PATTERN = /^\/?[a-zA-Z]:[\\/]/;

function normalizeComparablePath(value?: string | null) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function parseLocalFilePath(href?: string) {
  if (!href || typeof href !== 'string') {
    return null;
  }

  const decodedHref = decodeURIComponent(href).trim();
  if (!WINDOWS_PATH_LINK_PATTERN.test(decodedHref)) {
    return null;
  }

  const withoutLeadingSlash = decodedHref.startsWith('/') ? decodedHref.slice(1) : decodedHref;
  return withoutLeadingSlash.replace(/\//g, '\\');
}

function isWithinProject(filePath: string, projectRoot?: string) {
  const normalizedFile = normalizeComparablePath(filePath);
  const normalizedRoot = normalizeComparablePath(projectRoot);
  if (!normalizedFile || !normalizedRoot) {
    return false;
  }

  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

function buildLocalFileHref(filePath: string, projectName?: string, projectRoot?: string) {
  if (projectName && isWithinProject(filePath, projectRoot)) {
    return `/api/projects/${encodeURIComponent(projectName)}/files/content?path=${encodeURIComponent(filePath)}`;
  }

  return `/api/local-file/content?path=${encodeURIComponent(filePath)}`;
}

function isProbablyTextFile(filePath: string) {
  return /\.(txt|md|markdown|json|jsonl|js|jsx|ts|tsx|css|scss|html|xml|yaml|yml|py|ps1|bat|cmd|cs|go|rs|java|kt|swift|sql|toml|ini|log)$/i.test(filePath);
}

function getFileName(filePath: string) {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || 'download';
}

async function fetchLocalFileBlob(url: string, signal?: AbortSignal) {
  const response = await authenticatedFetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.blob();
}

function openBlobUrl(blob: Blob, fileName: string, previewWindow?: Window | null) {
  const objectUrl = URL.createObjectURL(blob);
  const cleanup = () => URL.revokeObjectURL(objectUrl);

  if (previewWindow && !previewWindow.closed) {
    previewWindow.location.href = objectUrl;
  } else {
    const openedWindow = window.open(objectUrl, '_blank', 'noopener,noreferrer');
    if (openedWindow) {
      window.setTimeout(cleanup, 60_000);
      return;
    }

    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  window.setTimeout(cleanup, 60_000);
}

type AuthenticatedLocalFileLinkProps = {
  children?: React.ReactNode;
  filePath: string;
  href: string;
  openInEditor: boolean;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
};

function AuthenticatedLocalFileLink({
  children,
  filePath,
  href,
  openInEditor,
  onFileOpen,
}: AuthenticatedLocalFileLinkProps) {
  const [isOpening, setIsOpening] = useState(false);

  return (
    <a
      href={href}
      className="text-blue-600 hover:underline dark:text-blue-400"
      target="_blank"
      rel="noopener noreferrer"
      onClick={async (event) => {
        event.preventDefault();

        if (openInEditor) {
          onFileOpen?.(filePath);
          return;
        }

        if (isOpening) {
          return;
        }

        const previewWindow = window.open('about:blank', '_blank');

        try {
          setIsOpening(true);
          const blob = await fetchLocalFileBlob(href);
          openBlobUrl(blob, getFileName(filePath), previewWindow);
        } catch (error) {
          console.error('Unable to open local file link:', error);
          if (previewWindow && !previewWindow.closed) {
            previewWindow.close();
          }
        } finally {
          setIsOpening(false);
        }
      }}
      title={filePath}
    >
      {children}
      {isOpening ? ' (opening...)' : null}
    </a>
  );
}

type AuthenticatedLocalImageProps = {
  src: string;
  alt?: string;
};

function AuthenticatedLocalImage({ src, alt }: AuthenticatedLocalImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    const controller = new AbortController();

    const loadImage = async () => {
      try {
        setImageUrl(null);
        setLoadFailed(false);
        const blob = await fetchLocalFileBlob(src, controller.signal);
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        console.error('Unable to load local image:', error);
        setLoadFailed(true);
      }
    };

    loadImage();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  if (loadFailed) {
    return (
      <div className="my-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400">
        {alt || 'Unable to load image'}
      </div>
    );
  }

  if (!imageUrl) {
    return (
      <div className="my-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400">
        Loading image...
      </div>
    );
  }

  return <img src={imageUrl} alt={alt || ''} className="my-2 h-auto max-w-full rounded-lg" />;
}

function createMarkdownComponents(projectName?: string, projectRoot?: string, onFileOpen?: (filePath: string, diffInfo?: unknown) => void) {
  return {
  code: CodeBlock,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2 border-l-4 border-gray-300 pl-4 italic text-gray-600 dark:border-gray-600 dark:text-gray-400">
      {children}
    </blockquote>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    const localFilePath = parseLocalFilePath(href);
    if (!localFilePath) {
      return (
        <a href={href} className="text-blue-600 hover:underline dark:text-blue-400" target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    }

    const resolvedHref = buildLocalFileHref(localFilePath, projectName, projectRoot);
    const openInEditor = Boolean(onFileOpen && projectName && isWithinProject(localFilePath, projectRoot) && isProbablyTextFile(localFilePath));

    return (
      <AuthenticatedLocalFileLink
        filePath={localFilePath}
        href={resolvedHref}
        openInEditor={openInEditor}
        onFileOpen={onFileOpen}
      >
        {children}
      </AuthenticatedLocalFileLink>
    );
  },
  img: ({ src, alt }: { src?: string; alt?: string }) => {
    const localFilePath = parseLocalFilePath(src);
    const resolvedSrc = localFilePath
      ? buildLocalFileHref(localFilePath, projectName, projectRoot)
      : src;

    if (localFilePath && resolvedSrc) {
      return <AuthenticatedLocalImage src={resolvedSrc} alt={alt} />;
    }

    return <img src={resolvedSrc} alt={alt || ''} className="my-2 h-auto max-w-full rounded-lg" />;
  },
  p: ({ children }: { children?: React.ReactNode }) => <div className="mb-2 last:mb-0">{children}</div>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-gray-200 px-3 py-2 text-left text-sm font-semibold dark:border-gray-700">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-gray-200 px-3 py-2 align-top text-sm dark:border-gray-700">{children}</td>
  ),
  };
}

export function Markdown({ children, className, projectName, projectRoot, onFileOpen }: MarkdownProps) {
  const content = normalizeInlineCodeFences(String(children ?? ''));
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);
  const markdownComponents = useMemo(
    () => createMarkdownComponents(projectName, projectRoot, onFileOpen),
    [onFileOpen, projectName, projectRoot],
  );

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={markdownComponents as any}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
