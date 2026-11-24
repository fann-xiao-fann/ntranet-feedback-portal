import type { ReactNode } from 'react';
import { Download, ZoomIn } from 'lucide-react';
import type { AttachmentItem } from '../api/client';

const ATTACHMENT_TOKEN_REGEX = /\[\[attachment:([0-9a-f-]+)\]\]/gi;

export function getReferencedAttachmentIds(content: string): Set<string> {
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  const regex = new RegExp(ATTACHMENT_TOKEN_REGEX.source, 'gi');
  while ((match = regex.exec(content)) !== null) {
    ids.add(match[1]);
  }
  return ids;
}

function renderInlineFormatting(text: string, keyPrefix: string): ReactNode[] {
  // Parse **bold** and *italic* safely into React elements (no raw HTML)
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partIdx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${partIdx++}`} className="font-semibold text-slate-900">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={`${keyPrefix}-i-${partIdx++}`} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

interface RichContentViewerProps {
  content: string;
  attachments: AttachmentItem[];
  onPreviewPhoto: (photo: AttachmentItem) => void;
  showDownloadButton?: boolean;
}

export function RichContentViewer({
  content,
  attachments,
  onPreviewPhoto,
  showDownloadButton = false,
}: RichContentViewerProps) {
  const attMap = new Map(attachments.map((a) => [a.id, a]));
  const lines = content.replace(/\r\n/g, '\n').split('\n');

  function renderAttachmentFigure(att: AttachmentItem, key: string) {
    return (
      <figure
        key={key}
        className="group relative my-3 block w-full overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        <button
          type="button"
          onClick={() => onPreviewPhoto(att)}
          title="点击全屏查看高清原图"
          className="block w-full cursor-zoom-in bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <img src={att.url} alt="意见图片" className="block h-auto w-full" />
        </button>

        <div className="pointer-events-none absolute right-2.5 top-2.5 flex items-center gap-1.5 opacity-90 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onPreviewPhoto(att)}
            className="pointer-events-auto inline-flex items-center gap-1 rounded-lg bg-slate-900/75 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm backdrop-blur-xs hover:bg-slate-900"
          >
            <ZoomIn className="h-3.5 w-3.5" />
            原图
          </button>
          {showDownloadButton && att.downloadUrl && (
            <a
              href={att.downloadUrl}
              className="pointer-events-auto inline-flex items-center gap-1 rounded-lg bg-slate-900/75 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm backdrop-blur-xs hover:bg-slate-900"
            >
              <Download className="h-3.5 w-3.5" />
              下载
            </a>
          )}
        </div>
      </figure>
    );
  }

  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Standalone inline attachment line
    const singleToken = /^\[\[attachment:([0-9a-f-]+)\]\]$/i.exec(trimmed);
    if (singleToken) {
      const att = attMap.get(singleToken[1]);
      if (att) {
        elements.push(renderAttachmentFigure(att, `att-${i}-${att.id}`));
      }
      i++;
      continue;
    }

    // Unordered list block
    if (/^-\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^-\s+/, ''));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-2 list-disc space-y-1 pl-5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineFormatting(item, `ul-${i}-${idx}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list block
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-2 list-decimal space-y-1 pl-5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineFormatting(item, `ol-${i}-${idx}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Blank line spacer
    if (!trimmed) {
      elements.push(<div key={`sp-${i}`} className="h-2" />);
      i++;
      continue;
    }

    // Normal paragraph line (also handles inline attachment tokens mixed within text)
    const parts: ReactNode[] = [];
    let last = 0;
    const inlineRegex = new RegExp(ATTACHMENT_TOKEN_REGEX.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = inlineRegex.exec(line)) !== null) {
      if (match.index > last) {
        parts.push(...renderInlineFormatting(line.slice(last, match.index), `p-${i}-${last}`));
      }
      const att = attMap.get(match[1]);
      if (att) {
        parts.push(renderAttachmentFigure(att, `inline-att-${i}-${match.index}`));
      }
      last = match.index + match[0].length;
    }
    if (last < line.length) {
      parts.push(...renderInlineFormatting(line.slice(last), `p-${i}-${last}`));
    }

    elements.push(
      <p key={`p-${i}`} className="whitespace-pre-wrap break-words leading-relaxed">
        {parts}
      </p>
    );
    i++;
  }

  return <div className="space-y-1 text-sm text-slate-800">{elements}</div>;
}
