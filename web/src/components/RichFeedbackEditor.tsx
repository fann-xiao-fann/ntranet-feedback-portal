import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import {
  AlertCircle,
  Bold,
  Camera,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  RemoveFormatting,
} from 'lucide-react';
import { ImageAnnotatorModal } from './ImageAnnotatorModal';

export const MAX_EDITOR_PHOTOS = 5;
export const MAX_EDITOR_PHOTO_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface StoredInlinePhoto {
  file: File;
  previewUrl: string;
}

export interface RichEditorValue {
  content: string;
  plainTextLength: number;
  files: File[];
}

interface RichFeedbackEditorProps {
  resetKey: number;
  onChange: (value: RichEditorValue) => void;
}

function serializeInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\u200B/g, '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();

  if (tag === 'BR') {
    return '\n';
  }
  const inner = Array.from(el.childNodes).map(serializeInline).join('');
  if (!inner) return '';

  if (tag === 'STRONG' || tag === 'B') {
    return `**${inner}**`;
  }
  if (tag === 'EM' || tag === 'I') {
    return `*${inner}*`;
  }
  return inner;
}

function serializeEditor(
  root: HTMLElement,
  photoMap: Map<string, StoredInlinePhoto>
): RichEditorValue {
  const orderedFiles: File[] = [];
  const keyToIndex = new Map<string, number>();

  function walkBlock(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? '').replace(/\u200B/g, '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }
    const el = node as HTMLElement;
    const photoKey = el.dataset.photoKey;
    if (photoKey) {
      const entry = photoMap.get(photoKey);
      if (!entry) return '';
      let idx = keyToIndex.get(photoKey);
      if (idx === undefined) {
        idx = orderedFiles.length;
        keyToIndex.set(photoKey, idx);
        orderedFiles.push(entry.file);
      }
      return `\n[[photo:${idx}]]\n`;
    }

    const tag = el.tagName.toUpperCase();
    if (tag === 'BR') {
      return '\n';
    }
    if (tag === 'UL') {
      const items = Array.from(el.children)
        .filter((c) => c.tagName.toUpperCase() === 'LI')
        .map((li) => `- ${Array.from(li.childNodes).map(serializeInline).join('').trim()}`)
        .filter((line) => line !== '-');
      return items.length > 0 ? `\n${items.join('\n')}\n` : '';
    }
    if (tag === 'OL') {
      const items = Array.from(el.children)
        .filter((c) => c.tagName.toUpperCase() === 'LI')
        .map(
          (li, i) =>
            `${i + 1}. ${Array.from(li.childNodes).map(serializeInline).join('').trim()}`
        )
        .filter((line) => !/^\d+\.$/.test(line));
      return items.length > 0 ? `\n${items.join('\n')}\n` : '';
    }
    if (tag === 'DIV' || tag === 'P') {
      const inner = Array.from(el.childNodes).map(walkBlock).join('');
      return `${inner}\n`;
    }
    return serializeInline(el);
  }

  const raw = Array.from(root.childNodes)
    .map(walkBlock)
    .join('')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const plainText = raw.replace(/\[\[photo:\d+\]\]/g, '').trim();

  return {
    content: raw,
    plainTextLength: plainText.length,
    files: orderedFiles,
  };
}

export function RichFeedbackEditor({ resetKey, onChange }: RichFeedbackEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photoMapRef = useRef<Map<string, StoredInlinePhoto>>(new Map());
  const savedRangeRef = useRef<Range | null>(null);

  const [photoCount, setPhotoCount] = useState(0);
  const [textLength, setTextLength] = useState(0);
  const [isEmpty, setIsEmpty] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [annotatingKey, setAnnotatingKey] = useState<string | null>(null);

  const emitChange = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;

    // Clean up URLs for any image nodes deleted via Backspace/Delete
    const presentKeys = new Set<string>();
    root.querySelectorAll<HTMLElement>('[data-photo-key]').forEach((el) => {
      if (el.dataset.photoKey) presentKeys.add(el.dataset.photoKey);
    });
    for (const [key, entry] of photoMapRef.current.entries()) {
      if (!presentKeys.has(key)) {
        URL.revokeObjectURL(entry.previewUrl);
        photoMapRef.current.delete(key);
      }
    }

    const serialized = serializeEditor(root, photoMapRef.current);
    setPhotoCount(serialized.files.length);
    setTextLength(serialized.plainTextLength);
    setIsEmpty(serialized.content.length === 0);
    onChange(serialized);
  }, [onChange]);

  // Reset editor when parent requests reset
  useEffect(() => {
    const root = editorRef.current;
    if (root) {
      root.innerHTML = '';
    }
    for (const entry of photoMapRef.current.values()) {
      URL.revokeObjectURL(entry.previewUrl);
    }
    photoMapRef.current.clear();
    savedRangeRef.current = null;
    setPhotoCount(0);
    setTextLength(0);
    setIsEmpty(true);
    setPhotoError(null);
  }, [resetKey]);

  // Revoke object URLs on unmount
  useEffect(() => {
    const map = photoMapRef.current;
    return () => {
      for (const entry of map.values()) {
        URL.revokeObjectURL(entry.previewUrl);
      }
      map.clear();
    };
  }, []);

  function saveSelection() {
    const root = editorRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (root.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  }

  function restoreSelection() {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    if (!sel) return;
    if (savedRangeRef.current && root.contains(savedRangeRef.current.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    } else {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function createInlineImageNode(key: string, entry: StoredInlinePhoto): HTMLElement {
    const figure = document.createElement('div');
    figure.setAttribute('contenteditable', 'false');
    figure.dataset.photoKey = key;
    figure.className =
      'group my-3 block w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-2xs select-none';

    const imgWrap = document.createElement('div');
    imgWrap.className = 'relative bg-white';

    const img = document.createElement('img');
    img.src = entry.previewUrl;
    img.alt = '点击放大或标注图片';
    img.title = '点击打开高清缩放与标注（画框、画线、打字）';
    img.className = 'block h-auto w-full cursor-zoom-in object-contain';
    img.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setAnnotatingKey(key);
    };
    imgWrap.appendChild(img);

    const actions = document.createElement('div');
    actions.className = 'absolute right-2.5 top-2.5 flex items-center gap-1.5';

    const annotateBtn = document.createElement('button');
    annotateBtn.type = 'button';
    annotateBtn.textContent = '缩放 / 标注';
    annotateBtn.title = '放大查看并在图上画框、线条、打字';
    annotateBtn.className =
      'cursor-pointer rounded-lg bg-slate-900/75 px-2.5 py-1 text-xs font-medium text-white shadow-sm backdrop-blur-xs hover:bg-blue-600';
    annotateBtn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setAnnotatingKey(key);
    };
    actions.appendChild(annotateBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.title = '移除图片';
    removeBtn.className =
      'flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg bg-slate-900/75 text-base font-bold leading-none text-white shadow-sm hover:bg-red-600';
    removeBtn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      figure.remove();
      emitChange();
    };
    actions.appendChild(removeBtn);

    imgWrap.appendChild(actions);

    figure.appendChild(imgWrap);
    return figure;
  }

  function handleSaveAnnotation(annotatedFile: File) {
    if (!annotatingKey || !editorRef.current) {
      setAnnotatingKey(null);
      return;
    }
    const existing = photoMapRef.current.get(annotatingKey);
    const nextUrl = URL.createObjectURL(annotatedFile);
    photoMapRef.current.set(annotatingKey, {
      file: annotatedFile,
      previewUrl: nextUrl,
    });
    if (existing) {
      URL.revokeObjectURL(existing.previewUrl);
    }

    const figure = editorRef.current.querySelector<HTMLElement>(
      `[data-photo-key="${annotatingKey}"]`
    );
    const imgEl = figure?.querySelector('img');
    if (imgEl) {
      imgEl.src = nextUrl;
    }

    setAnnotatingKey(null);
    emitChange();
  }

  function insertImages(incoming: FileList | File[]) {
    const root = editorRef.current;
    if (!root) return;
    setPhotoError(null);

    const files = Array.from(incoming);
    if (files.length === 0) return;

    const currentCount = root.querySelectorAll('[data-photo-key]').length;
    const remaining = MAX_EDITOR_PHOTOS - currentCount;
    if (remaining <= 0) {
      setPhotoError(`最多插入 ${MAX_EDITOR_PHOTOS} 张图片`);
      return;
    }

    const accepted: File[] = [];
    const errors: string[] = [];

    for (const file of files) {
      if (accepted.length >= remaining) {
        errors.push(`单次最多插入 ${MAX_EDITOR_PHOTOS} 张图片，超出部分未添加`);
        break;
      }
      if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
        errors.push(`「${file.name || '图片'}」格式不受支持，仅支持 JPG / PNG / WebP`);
        continue;
      }
      if (file.size > MAX_EDITOR_PHOTO_BYTES) {
        errors.push(`「${file.name || '图片'}」超过 10 MB 大小限制`);
        continue;
      }
      if (file.size === 0) {
        errors.push(`「${file.name || '图片'}」文件为空`);
        continue;
      }
      accepted.push(file);
    }

    if (errors.length > 0) {
      setPhotoError(errors[0]);
    }
    if (accepted.length === 0) return;

    restoreSelection();
    const sel = window.getSelection();
    let range: Range;
    if (sel && sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      range = sel.getRangeAt(0);
      range.deleteContents();
    } else {
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
    }

    let lastInserted: Node | null = null;
    for (const file of accepted) {
      const key = `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const entry: StoredInlinePhoto = {
        file,
        previewUrl: URL.createObjectURL(file),
      };
      photoMapRef.current.set(key, entry);

      const block = createInlineImageNode(key, entry);
      const afterPara = document.createElement('div');
      afterPara.appendChild(document.createElement('br'));

      range.insertNode(afterPara);
      range.insertNode(block);

      range = document.createRange();
      range.setStart(afterPara, 0);
      range.collapse(true);
      lastInserted = afterPara;
    }

    if (sel && lastInserted) {
      const caretRange = document.createRange();
      caretRange.setStart(lastInserted, 0);
      caretRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caretRange);
      savedRangeRef.current = caretRange.cloneRange();
    }

    emitChange();
  }

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) {
          const ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
          const namedFile =
            f.name && f.name !== 'image.png'
              ? f
              : new File([f], `screenshot-${Date.now()}.${ext}`, { type: f.type });
          imageFiles.push(namedFile);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      saveSelection();
      insertImages(imageFiles);
      return;
    }

    // Paste plain text cleanly to avoid messy external HTML/styles
    const text = e.clipboardData?.getData('text/plain');
    if (text !== undefined) {
      e.preventDefault();
      document.execCommand('insertText', false, text);
      emitChange();
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) =>
      f.type ? f.type.startsWith('image/') : true
    );
    if (files.length > 0) {
      insertImages(files);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      insertImages(e.target.files);
      e.target.value = '';
    }
  }

  function execFormat(command: string) {
    restoreSelection();
    document.execCommand(command, false);
    saveSelection();
    emitChange();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="block text-sm font-medium text-slate-800">
          详细说明（支持图文混排） <span className="text-red-500">*</span>
        </span>
        <span className="text-xs text-slate-400">
          文字{' '}
          <span className={textLength > 5000 ? 'font-medium text-red-600' : ''}>
            {textLength} / 5000
          </span>{' '}
          · 图片 {photoCount} / {MAX_EDITOR_PHOTOS}（JPG/PNG/WebP，单张 ≤ 10MB）
        </span>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`mt-1.5 overflow-hidden rounded-xl border transition-colors ${
          dragActive
            ? 'border-blue-500 ring-2 ring-blue-500/20'
            : 'border-slate-300 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20'
        }`}
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2.5 py-2">
          <button
            type="button"
            title="加粗"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execFormat('bold')}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="斜体"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execFormat('italic')}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="无序列表"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execFormat('insertUnorderedList')}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="有序列表"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execFormat('insertOrderedList')}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
          >
            <ListOrdered className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="清除文字格式"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execFormat('removeFormat')}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
          >
            <RemoveFormatting className="h-4 w-4" />
          </button>

          <div className="mx-1 h-4 w-px bg-slate-300" />

          <button
            type="button"
            disabled={photoCount >= MAX_EDITOR_PHOTOS}
            onMouseDown={(e) => {
              e.preventDefault();
              saveSelection();
            }}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            <span>插入图片</span>
            <Camera className="h-3.5 w-3.5 sm:hidden" />
          </button>

          <span className="ml-auto hidden text-[11px] text-slate-400 sm:inline">
            支持 Ctrl+V / ⌘+V 粘贴截图，点击图片可缩放及画框/画线/打字标注
          </span>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Editable Area */}
        <div className="relative bg-white">
          {isEmpty && (
            <div className="pointer-events-none absolute left-3.5 top-3 text-sm text-slate-400">
              请输入详细问题描述或改进建议；可直接按 Ctrl+V / ⌘+V 粘贴截图，或点击上方「插入图片」图文混排...
            </div>
          )}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="详细说明"
            onInput={() => {
              saveSelection();
              emitChange();
            }}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onPaste={handlePaste}
            className="min-h-[210px] max-h-[520px] overflow-y-auto px-3.5 py-3 text-sm leading-relaxed text-slate-900 focus:outline-none [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
          />
        </div>
      </div>

      {photoError && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {photoError}
        </p>
      )}

      <ImageAnnotatorModal
        imageUrl={annotatingKey ? (photoMapRef.current.get(annotatingKey)?.previewUrl ?? null) : null}
        originalFileName={
          annotatingKey ? (photoMapRef.current.get(annotatingKey)?.file.name ?? 'screenshot.png') : ''
        }
        onClose={() => setAnnotatingKey(null)}
        onSave={handleSaveAnnotation}
      />
    </div>
  );
}
