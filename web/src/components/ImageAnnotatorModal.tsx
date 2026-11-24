import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  Check,
  Edit3,
  Hand,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  RotateCcw,
  Square,
  Trash2,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

type AnnotatorTool = 'select' | 'pan' | 'rect' | 'arrow' | 'line' | 'pen' | 'text';

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Annotation =
  | {
      id: string;
      type: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      strokeWidth: number;
    }
  | {
      id: string;
      type: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      strokeWidth: number;
    }
  | {
      id: string;
      type: 'arrow';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      strokeWidth: number;
    }
  | {
      id: string;
      type: 'pen';
      points: Point[];
      color: string;
      strokeWidth: number;
    }
  | {
      id: string;
      type: 'text';
      x: number;
      y: number;
      text: string;
      color: string;
      fontSize: number;
    };

interface PendingTextInput {
  editingId: string | null;
  imgX: number;
  imgY: number;
  value: string;
  color: string;
  fontSize: number;
}

interface ImageAnnotatorModalProps {
  imageUrl: string | null;
  originalFileName: string;
  onClose: () => void;
  onSave: (annotatedFile: File) => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';

const COLORS = [
  { hex: '#ef4444', name: '红色' },
  { hex: '#f59e0b', name: '橙黄' },
  { hex: '#2563eb', name: '蓝色' },
  { hex: '#16a34a', name: '绿色' },
  { hex: '#0f172a', name: '黑色' },
  { hex: '#ffffff', name: '白色' },
] as const;

const SIZE_PRESETS = [
  { key: 'sm', label: '细', multiplier: 0.7 },
  { key: 'md', label: '中', multiplier: 1.0 },
  { key: 'lg', label: '粗', multiplier: 1.5 },
] as const;

function nextId(): string {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100));
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function getAnnotationBounds(ann: Annotation, ctx: CanvasRenderingContext2D | null): Bounds {
  if (ann.type === 'rect') {
    const pad = ann.strokeWidth / 2;
    return { x: ann.x - pad, y: ann.y - pad, w: ann.w + pad * 2, h: ann.h + pad * 2 };
  }
  if (ann.type === 'line' || ann.type === 'arrow') {
    const pad = Math.max(10, ann.strokeWidth * 2);
    const minX = Math.min(ann.x1, ann.x2) - pad;
    const minY = Math.min(ann.y1, ann.y2) - pad;
    const maxX = Math.max(ann.x1, ann.x2) + pad;
    const maxY = Math.max(ann.y1, ann.y2) + pad;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (ann.type === 'pen') {
    const pad = Math.max(8, ann.strokeWidth);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of ann.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return {
      x: minX - pad,
      y: minY - pad,
      w: Math.max(16, maxX - minX + pad * 2),
      h: Math.max(16, maxY - minY + pad * 2),
    };
  }
  // text
  const lines = ann.text.split('\n');
  const lineHeight = ann.fontSize * 1.28;
  let maxW = ann.fontSize * 2;
  if (ctx) {
    ctx.save();
    ctx.font = `600 ${ann.fontSize}px ${FONT_STACK}`;
    for (const line of lines) {
      const m = ctx.measureText(line);
      if (m.width > maxW) maxW = m.width;
    }
    ctx.restore();
  } else {
    for (const line of lines) {
      maxW = Math.max(maxW, line.length * ann.fontSize * 0.9);
    }
  }
  const pad = Math.max(8, ann.fontSize * 0.25);
  return {
    x: ann.x - pad,
    y: ann.y - pad,
    w: maxW + pad * 2,
    h: lines.length * lineHeight + pad * 2,
  };
}

function hitTestAnnotation(
  ann: Annotation,
  pt: Point,
  ctx: CanvasRenderingContext2D | null,
  tolerance: number
): boolean {
  if (ann.type === 'text') {
    const b = getAnnotationBounds(ann, ctx);
    return (
      pt.x >= b.x - tolerance &&
      pt.x <= b.x + b.w + tolerance &&
      pt.y >= b.y - tolerance &&
      pt.y <= b.y + b.h + tolerance
    );
  }
  if (ann.type === 'rect') {
    const edgeTol = Math.max(tolerance, ann.strokeWidth * 2);
    const inOuter =
      pt.x >= ann.x - edgeTol &&
      pt.x <= ann.x + ann.w + edgeTol &&
      pt.y >= ann.y - edgeTol &&
      pt.y <= ann.y + ann.h + edgeTol;
    if (!inOuter) return false;
    const inInner =
      pt.x >= ann.x + edgeTol &&
      pt.x <= ann.x + ann.w - edgeTol &&
      pt.y >= ann.y + edgeTol &&
      pt.y <= ann.y + ann.h - edgeTol;
    return !inInner;
  }
  if (ann.type === 'line' || ann.type === 'arrow') {
    const segTol = Math.max(tolerance, ann.strokeWidth * 2.5);
    return distToSegment(pt, { x: ann.x1, y: ann.y1 }, { x: ann.x2, y: ann.y2 }) <= segTol;
  }
  if (ann.type === 'pen') {
    const segTol = Math.max(tolerance, ann.strokeWidth * 2.5);
    if (ann.points.length === 1) {
      return Math.hypot(pt.x - ann.points[0].x, pt.y - ann.points[0].y) <= segTol;
    }
    for (let i = 1; i < ann.points.length; i++) {
      if (distToSegment(pt, ann.points[i - 1], ann.points[i]) <= segTol) {
        return true;
      }
    }
    return false;
  }
  return false;
}

function translateAnnotation(ann: Annotation, dx: number, dy: number): Annotation {
  if (ann.type === 'rect') {
    return { ...ann, x: ann.x + dx, y: ann.y + dy };
  }
  if (ann.type === 'line' || ann.type === 'arrow') {
    return { ...ann, x1: ann.x1 + dx, y1: ann.y1 + dy, x2: ann.x2 + dx, y2: ann.y2 + dy };
  }
  if (ann.type === 'pen') {
    return { ...ann, points: ann.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
  return { ...ann, x: ann.x + dx, y: ann.y + dy };
}

function drawAnnotation(ctx: CanvasRenderingContext2D, ann: Annotation) {
  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.fillStyle = ann.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (ann.type === 'rect') {
    ctx.lineWidth = ann.strokeWidth;
    ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);
  } else if (ann.type === 'line') {
    ctx.lineWidth = ann.strokeWidth;
    ctx.beginPath();
    ctx.moveTo(ann.x1, ann.y1);
    ctx.lineTo(ann.x2, ann.y2);
    ctx.stroke();
  } else if (ann.type === 'arrow') {
    ctx.lineWidth = ann.strokeWidth;
    ctx.beginPath();
    ctx.moveTo(ann.x1, ann.y1);
    ctx.lineTo(ann.x2, ann.y2);
    ctx.stroke();

    const angle = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1);
    const headLen = Math.max(14, ann.strokeWidth * 4.2);
    ctx.beginPath();
    ctx.moveTo(ann.x2, ann.y2);
    ctx.lineTo(
      ann.x2 - headLen * Math.cos(angle - Math.PI / 6),
      ann.y2 - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      ann.x2 - headLen * Math.cos(angle + Math.PI / 6),
      ann.y2 - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  } else if (ann.type === 'pen') {
    if (ann.points.length === 1) {
      ctx.beginPath();
      ctx.arc(ann.points[0].x, ann.points[0].y, ann.strokeWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (ann.points.length > 1) {
      ctx.lineWidth = ann.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(ann.points[0].x, ann.points[0].y);
      for (let i = 1; i < ann.points.length; i++) {
        ctx.lineTo(ann.points[i].x, ann.points[i].y);
      }
      ctx.stroke();
    }
  } else if (ann.type === 'text') {
    ctx.font = `600 ${ann.fontSize}px ${FONT_STACK}`;
    ctx.textBaseline = 'top';
    const lines = ann.text.split('\n');
    const lineHeight = ann.fontSize * 1.28;
    ctx.lineWidth = Math.max(3, ann.fontSize * 0.14);
    ctx.strokeStyle =
      ann.color === '#ffffff' ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.92)';
    lines.forEach((line, idx) => {
      const y = ann.y + idx * lineHeight;
      ctx.strokeText(line, ann.x, y);
      ctx.fillText(line, ann.x, y);
    });
  }

  ctx.restore();
}

export function ImageAnnotatorModal({
  imageUrl,
  originalFileName,
  onClose,
  onSave,
}: ImageAnnotatorModalProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgElementRef = useRef<HTMLImageElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);

  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<AnnotatorTool>('rect');
  const [color, setColor] = useState<string>(COLORS[0].hex);
  const [sizePreset, setSizePreset] = useState<'sm' | 'md' | 'lg'>('md');

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [pendingText, setPendingText] = useState<PendingTextInput | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [saving, setSaving] = useState(false);

  const annotationsRef = useRef<Annotation[]>(annotations);
  annotationsRef.current = annotations;

  const interactionRef = useRef<
    | {
        mode: 'pan';
        pointerId: number;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
      }
    | {
        mode: 'draw';
        pointerId: number;
        tool: Exclude<AnnotatorTool, 'select' | 'pan' | 'text'>;
        startImg: Point;
      }
    | {
        mode: 'move';
        pointerId: number;
        targetId: string;
        startImg: Point;
        originalAnn: Annotation;
        beforeList: Annotation[];
        moved: boolean;
      }
    | null
  >(null);

  const isPanMode = tool === 'pan' || spacePressed;

  const pushHistory = useCallback((snapshot: Annotation[]) => {
    setHistory((prev) => [...prev.slice(-49), snapshot]);
  }, []);

  const computeFitScale = useCallback((natW: number, natH: number): number => {
    const vp = viewportRef.current;
    if (!vp || natW <= 0 || natH <= 0) return 1;
    const pad = 28;
    const availW = Math.max(120, vp.clientWidth - pad * 2);
    const availH = Math.max(120, vp.clientHeight - pad * 2);
    return clampScale(Math.min(1, availW / natW, availH / natH));
  }, []);

  const getStrokeWidth = useCallback(
    (preset: 'sm' | 'md' | 'lg' = sizePreset): number => {
      const base = naturalSize
        ? Math.max(3, Math.round(Math.max(naturalSize.w, naturalSize.h) / 360))
        : 4;
      const mult = SIZE_PRESETS.find((s) => s.key === preset)?.multiplier ?? 1;
      return Math.max(2, Math.round(base * mult));
    },
    [naturalSize, sizePreset]
  );

  const getFontSize = useCallback(
    (preset: 'sm' | 'md' | 'lg' = sizePreset): number => {
      const base = naturalSize
        ? Math.max(20, Math.round(Math.max(naturalSize.w, naturalSize.h) / 48))
        : 24;
      const mult = SIZE_PRESETS.find((s) => s.key === preset)?.multiplier ?? 1;
      return Math.max(16, Math.round(base * mult));
    },
    [naturalSize, sizePreset]
  );

  const resetToFit = useCallback(() => {
    setOffset({ x: 0, y: 0 });
    if (naturalSize) {
      setScale(computeFitScale(naturalSize.w, naturalSize.h));
    } else {
      setScale(1);
    }
  }, [computeFitScale, naturalSize]);

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const previous = prev[prev.length - 1];
      setAnnotations(previous);
      setSelectedId(null);
      return prev.slice(0, -1);
    });
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    const current = annotationsRef.current;
    if (!current.some((a) => a.id === selectedId)) return;
    pushHistory(current);
    setAnnotations(current.filter((a) => a.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, pushHistory]);

  const commitPendingText = useCallback(() => {
    if (!pendingText) return;
    const text = pendingText.value.trim();
    const current = annotationsRef.current;

    if (pendingText.editingId) {
      pushHistory(current);
      if (!text) {
        // Clearing text deletes that annotation
        setAnnotations(current.filter((a) => a.id !== pendingText.editingId));
        setSelectedId(null);
      } else {
        setAnnotations(
          current.map((a) =>
            a.id === pendingText.editingId && a.type === 'text'
              ? { ...a, text, color: pendingText.color, fontSize: pendingText.fontSize }
              : a
          )
        );
        setSelectedId(pendingText.editingId);
      }
    } else if (text) {
      const createdId = nextId();
      pushHistory(current);
      setAnnotations([
        ...current,
        {
          id: createdId,
          type: 'text',
          x: pendingText.imgX,
          y: pendingText.imgY,
          text,
          color: pendingText.color,
          fontSize: pendingText.fontSize,
        },
      ]);
      // Auto-select newly created text so user can drag or delete it immediately!
      setSelectedId(createdId);
    }

    setPendingText(null);
  }, [pendingText, pushHistory]);

  const openEditForText = useCallback((ann: Extract<Annotation, { type: 'text' }>) => {
    setSelectedId(ann.id);
    setPendingText({
      editingId: ann.id,
      imgX: ann.x,
      imgY: ann.y,
      value: ann.text,
      color: ann.color,
      fontSize: ann.fontSize,
    });
  }, []);

  // Load image when modal opens
  useEffect(() => {
    if (!imageUrl) {
      imgElementRef.current = null;
      setNaturalSize(null);
      setAnnotations([]);
      setHistory([]);
      setSelectedId(null);
      setDraft(null);
      setPendingText(null);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imgElementRef.current = img;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setNaturalSize({ w, h });
      setAnnotations([]);
      setHistory([]);
      setSelectedId(null);
      setDraft(null);
      setPendingText(null);
      setTool('rect');
      setOffset({ x: 0, y: 0 });
      setScale(computeFitScale(w, h));
    };
    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl, computeFitScale]);

  // Redraw canvas whenever image, annotations, draft, or selection changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgElementRef.current;
    if (!canvas || !img || !naturalSize) return;

    if (canvas.width !== naturalSize.w || canvas.height !== naturalSize.h) {
      canvas.width = naturalSize.w;
      canvas.height = naturalSize.h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, naturalSize.w, naturalSize.h);

    for (const ann of annotations) {
      // Hide the text currently being edited inline to avoid double rendering
      if (pendingText?.editingId && ann.id === pendingText.editingId) {
        continue;
      }
      drawAnnotation(ctx, ann);
    }

    if (draft) {
      drawAnnotation(ctx, draft);
    }

    // Draw crisp selection dashed box around selected annotation
    if (selectedId && !pendingText?.editingId) {
      const selected = annotations.find((a) => a.id === selectedId);
      if (selected) {
        const b = getAnnotationBounds(selected, ctx);
        ctx.save();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = Math.max(2, 2 / scale);
        ctx.setLineDash([Math.max(6, 6 / scale), Math.max(4, 4 / scale)]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.restore();
      }
    }
  }, [naturalSize, annotations, draft, selectedId, pendingText, scale]);

  // Focus text input when opened
  useEffect(() => {
    if (pendingText && textInputRef.current) {
      textInputRef.current.focus();
      const len = textInputRef.current.value.length;
      textInputRef.current.setSelectionRange(len, len);
    }
  }, [pendingText]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!imageUrl) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement | null)?.tagName?.toUpperCase();
      const typing = targetTag === 'TEXTAREA' || targetTag === 'INPUT';

      if (e.key === 'Escape') {
        if (pendingText) {
          setPendingText(null);
        } else if (selectedId) {
          setSelectedId(null);
        } else {
          onClose();
        }
        return;
      }

      if (typing) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        handleDeleteSelected();
      } else if (e.code === 'Space') {
        e.preventDefault();
        setSpacePressed(true);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setScale((prev) => clampScale(prev * 1.25));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setScale((prev) => clampScale(prev * 0.8));
      } else if (e.key === '0') {
        e.preventDefault();
        resetToFit();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [imageUrl, onClose, handleUndo, handleDeleteSelected, resetToFit, pendingText, selectedId]);

  if (!imageUrl) return null;

  function clientToImageCoords(clientX: number, clientY: number): Point | null {
    const canvas = canvasRef.current;
    if (!canvas || !naturalSize) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * naturalSize.w,
      y: ((clientY - rect.top) / rect.height) * naturalSize.h,
    };
  }

  function findHitAnnotation(pt: Point, onlyText = false): Annotation | null {
    const ctx = canvasRef.current?.getContext('2d') ?? null;
    const tolerance = Math.max(10, 12 / scale);
    // Search top-most first
    for (let i = annotations.length - 1; i >= 0; i--) {
      const ann = annotations[i];
      if (onlyText && ann.type !== 'text') continue;
      if (hitTestAnnotation(ann, pt, ctx, tolerance)) {
        return ann;
      }
    }
    return null;
  }

  function handleColorSelect(nextColor: string) {
    setColor(nextColor);
    if (pendingText) {
      setPendingText({ ...pendingText, color: nextColor });
      return;
    }
    if (selectedId) {
      const current = annotationsRef.current;
      pushHistory(current);
      setAnnotations(current.map((a) => (a.id === selectedId ? { ...a, color: nextColor } : a)));
    }
  }

  function handleSizeSelect(nextPreset: 'sm' | 'md' | 'lg') {
    setSizePreset(nextPreset);
    if (pendingText) {
      setPendingText({ ...pendingText, fontSize: getFontSize(nextPreset) });
      return;
    }
    if (selectedId) {
      const current = annotationsRef.current;
      const sw = getStrokeWidth(nextPreset);
      const fs = getFontSize(nextPreset);
      pushHistory(current);
      setAnnotations(
        current.map((a) => {
          if (a.id !== selectedId) return a;
          return a.type === 'text' ? { ...a, fontSize: fs } : { ...a, strokeWidth: sw };
        })
      );
    }
  }

  function handleWheel(e: ReactWheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setScale((prev) => clampScale(prev * factor));
  }

  function handleViewportPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button === 1 || (e.button === 0 && isPanMode)) {
      if (pendingText) commitPendingText();
      e.currentTarget.setPointerCapture(e.pointerId);
      interactionRef.current = {
        mode: 'pan',
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: offset.x,
        originY: offset.y,
      };
    } else if (e.target === e.currentTarget && e.button === 0) {
      if (pendingText) commitPendingText();
      setSelectedId(null);
    }
  }

  function handleCanvasPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 || isPanMode) return;
    e.stopPropagation();

    const pt = clientToImageCoords(e.clientX, e.clientY);
    if (!pt || !naturalSize) return;

    if (pendingText) {
      commitPendingText();
    }

    // In SELECT mode: hit-test ANY annotation to select & drag-move
    if (tool === 'select') {
      const hit = findHitAnnotation(pt, false);
      if (hit) {
        setSelectedId(hit.id);
        e.currentTarget.setPointerCapture(e.pointerId);
        interactionRef.current = {
          mode: 'move',
          pointerId: e.pointerId,
          targetId: hit.id,
          startImg: pt,
          originalAnn: hit,
          beforeList: annotationsRef.current,
          moved: false,
        };
      } else {
        setSelectedId(null);
      }
      return;
    }

    // In TEXT mode: clicking an existing text selects & drags it; clicking empty area creates new text
    if (tool === 'text') {
      const hitText = findHitAnnotation(pt, true);
      if (hitText) {
        setSelectedId(hitText.id);
        e.currentTarget.setPointerCapture(e.pointerId);
        interactionRef.current = {
          mode: 'move',
          pointerId: e.pointerId,
          targetId: hitText.id,
          startImg: pt,
          originalAnn: hitText,
          beforeList: annotationsRef.current,
          moved: false,
        };
        return;
      }

      setSelectedId(null);
      setPendingText({
        editingId: null,
        imgX: Math.max(0, Math.min(naturalSize.w - 20, pt.x)),
        imgY: Math.max(0, Math.min(naturalSize.h - 20, pt.y)),
        value: '',
        color,
        fontSize: getFontSize(),
      });
      return;
    }

    // Drawing modes (rect / line / arrow / pen)
    setSelectedId(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    const sw = getStrokeWidth();
    const id = nextId();
    interactionRef.current = {
      mode: 'draw',
      pointerId: e.pointerId,
      tool,
      startImg: pt,
    };

    if (tool === 'rect') {
      setDraft({ id, type: 'rect', x: pt.x, y: pt.y, w: 0, h: 0, color, strokeWidth: sw });
    } else if (tool === 'line') {
      setDraft({ id, type: 'line', x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, color, strokeWidth: sw });
    } else if (tool === 'arrow') {
      setDraft({
        id,
        type: 'arrow',
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y,
        color,
        strokeWidth: sw,
      });
    } else if (tool === 'pen') {
      setDraft({ id, type: 'pen', points: [pt], color, strokeWidth: sw });
    }
  }

  function handleCanvasDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (isPanMode) return;
    const pt = clientToImageCoords(e.clientX, e.clientY);
    if (!pt) return;
    const hitText = findHitAnnotation(pt, true);
    if (hitText && hitText.type === 'text') {
      openEditForText(hitText);
    }
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLElement>) {
    const inter = interactionRef.current;
    if (!inter || inter.pointerId !== e.pointerId) return;

    if (inter.mode === 'pan') {
      setOffset({
        x: inter.originX + (e.clientX - inter.startX),
        y: inter.originY + (e.clientY - inter.startY),
      });
      return;
    }

    const pt = clientToImageCoords(e.clientX, e.clientY);
    if (!pt) return;

    if (inter.mode === 'move') {
      const dx = pt.x - inter.startImg.x;
      const dy = pt.y - inter.startImg.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        inter.moved = true;
      }
      const movedAnn = translateAnnotation(inter.originalAnn, dx, dy);
      setAnnotations((prev) => prev.map((a) => (a.id === inter.targetId ? movedAnn : a)));
      return;
    }

    const sw = getStrokeWidth();
    if (inter.tool === 'rect') {
      const x = Math.min(inter.startImg.x, pt.x);
      const y = Math.min(inter.startImg.y, pt.y);
      const w = Math.abs(pt.x - inter.startImg.x);
      const h = Math.abs(pt.y - inter.startImg.y);
      setDraft((prev) =>
        prev && prev.type === 'rect' ? { ...prev, x, y, w, h, color, strokeWidth: sw } : prev
      );
    } else if (inter.tool === 'line') {
      setDraft((prev) =>
        prev && prev.type === 'line'
          ? { ...prev, x1: inter.startImg.x, y1: inter.startImg.y, x2: pt.x, y2: pt.y, color, strokeWidth: sw }
          : prev
      );
    } else if (inter.tool === 'arrow') {
      setDraft((prev) =>
        prev && prev.type === 'arrow'
          ? { ...prev, x1: inter.startImg.x, y1: inter.startImg.y, x2: pt.x, y2: pt.y, color, strokeWidth: sw }
          : prev
      );
    } else if (inter.tool === 'pen') {
      setDraft((prev) =>
        prev && prev.type === 'pen' ? { ...prev, points: [...prev.points, pt] } : prev
      );
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLElement>) {
    const inter = interactionRef.current;
    if (!inter || inter.pointerId !== e.pointerId) return;
    interactionRef.current = null;

    if (inter.mode === 'move') {
      if (inter.moved) {
        pushHistory(inter.beforeList);
      }
      return;
    }

    if (inter.mode === 'draw' && draft) {
      const isMeaningful =
        draft.type === 'pen'
          ? draft.points.length > 0
          : draft.type === 'rect'
            ? draft.w > 3 || draft.h > 3
            : draft.type === 'line' || draft.type === 'arrow'
              ? Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 3
              : true;
      if (isMeaningful) {
        pushHistory(annotationsRef.current);
        setAnnotations((prev) => [...prev, draft]);
      }
      setDraft(null);
    }
  }

  function handleTextKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitPendingText();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setPendingText(null);
    }
  }

  async function handleSave() {
    const img = imgElementRef.current;
    if (!img || !naturalSize) {
      onClose();
      return;
    }

    const finalAnnotations = [...annotations];
    if (pendingText) {
      const trimmed = pendingText.value.trim();
      if (pendingText.editingId) {
        const idx = finalAnnotations.findIndex((a) => a.id === pendingText.editingId);
        if (idx >= 0) {
          if (!trimmed) {
            finalAnnotations.splice(idx, 1);
          } else {
            finalAnnotations[idx] = {
              id: pendingText.editingId,
              type: 'text',
              x: pendingText.imgX,
              y: pendingText.imgY,
              text: trimmed,
              color: pendingText.color,
              fontSize: pendingText.fontSize,
            };
          }
        }
      } else if (trimmed) {
        finalAnnotations.push({
          id: nextId(),
          type: 'text',
          x: pendingText.imgX,
          y: pendingText.imgY,
          text: trimmed,
          color: pendingText.color,
          fontSize: pendingText.fontSize,
        });
      }
    }

    if (finalAnnotations.length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const outCanvas = document.createElement('canvas');
      outCanvas.width = naturalSize.w;
      outCanvas.height = naturalSize.h;
      const ctx = outCanvas.getContext('2d');
      if (!ctx) {
        onClose();
        return;
      }

      ctx.drawImage(img, 0, 0, naturalSize.w, naturalSize.h);
      for (const ann of finalAnnotations) {
        drawAnnotation(ctx, ann);
      }

      const toBlob = (mime: string, quality?: number) =>
        new Promise<Blob | null>((resolve) => outCanvas.toBlob(resolve, mime, quality));

      let mime = 'image/png';
      let ext = '.png';
      let blob = await toBlob('image/png');
      if (!blob || blob.size > MAX_UPLOAD_BYTES) {
        mime = 'image/jpeg';
        ext = '.jpg';
        blob = await toBlob('image/jpeg', 0.92);
      }
      if (!blob) {
        onClose();
        return;
      }

      const base = (originalFileName || 'screenshot').replace(/\.[^.]+$/, '');
      const annotatedFile = new File([blob], `${base}${ext}`, { type: mime });
      onSave(annotatedFile);
    } finally {
      setSaving(false);
    }
  }

  const percent = Math.round(scale * 100);
  const selectedAnn =
    selectedId && !pendingText?.editingId
      ? annotations.find((a) => a.id === selectedId) ?? null
      : null;

  // Floating action bar position for selected annotation
  const selectedOverlayPos = (() => {
    if (!selectedAnn || !naturalSize || !canvasRef.current || !viewportRef.current) return null;
    const ctx = canvasRef.current.getContext('2d');
    const b = getAnnotationBounds(selectedAnn, ctx);
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const vpRect = viewportRef.current.getBoundingClientRect();
    const rightX = canvasRect.left - vpRect.left + ((b.x + b.w) / naturalSize.w) * canvasRect.width;
    const topY = canvasRect.top - vpRect.top + (b.y / naturalSize.h) * canvasRect.height;
    return {
      left: Math.max(8, Math.min(vpRect.width - 140, rightX - 4)),
      top: Math.max(8, topY - 34),
    };
  })();

  // Inline text input overlay position
  const textBoxStyle = (() => {
    if (!pendingText || !naturalSize || !canvasRef.current || !viewportRef.current) return null;
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const vpRect = viewportRef.current.getBoundingClientRect();
    return {
      left: canvasRect.left - vpRect.left + (pendingText.imgX / naturalSize.w) * canvasRect.width,
      top: canvasRect.top - vpRect.top + (pendingText.imgY / naturalSize.h) * canvasRect.height,
      fontSize: Math.max(14, Math.round(pendingText.fontSize * scale)),
    };
  })();

  const toolButtons: Array<{ id: AnnotatorTool; label: string; icon: typeof Square }> = [
    { id: 'select', label: '选择', icon: MousePointer2 },
    { id: 'pan', label: '拖拽', icon: Hand },
    { id: 'rect', label: '画框', icon: Square },
    { id: 'arrow', label: '箭头', icon: MoveUpRight },
    { id: 'line', label: '直线', icon: Minus },
    { id: 'pen', label: '画笔', icon: Pencil },
    { id: 'text', label: '打字', icon: Type },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/94 backdrop-blur-xs select-none"
      role="dialog"
      aria-modal="true"
      aria-label="图片缩放与标注"
    >
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-slate-200 sm:px-4">
        {/* Tools */}
        <div className="flex flex-wrap items-center gap-1">
          {toolButtons.map(({ id, label, icon: Icon }) => {
            const active = tool === id && !spacePressed;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  if (pendingText) commitPendingText();
                  setTool(id);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
                  active
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            );
          })}

          <div className="mx-1 h-4 w-px bg-slate-700" />

          {/* Color Swatches */}
          <div className="flex items-center gap-1.5 px-1">
            {COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                title={c.name}
                onClick={() => handleColorSelect(c.hex)}
                style={{ backgroundColor: c.hex }}
                className={`h-5 w-5 rounded-full border-2 transition-transform ${
                  color === c.hex
                    ? 'scale-115 border-blue-400 ring-2 ring-blue-400/50'
                    : 'border-slate-600 hover:scale-105'
                }`}
              />
            ))}
          </div>

          <div className="mx-1 h-4 w-px bg-slate-700" />

          {/* Stroke / Font Size */}
          <div className="flex items-center gap-1">
            {SIZE_PRESETS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => handleSizeSelect(s.key)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                  sizePreset === s.key
                    ? 'bg-slate-200 text-slate-900'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Zoom + Undo + Save */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setScale((s) => clampScale(s * 0.8))}
            disabled={scale <= MIN_SCALE}
            title="缩小 (-)"
            className="rounded-lg bg-slate-800 p-1.5 text-white hover:bg-slate-700 disabled:opacity-40"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-[46px] text-center font-mono text-xs font-semibold text-white">
            {percent}%
          </span>
          <button
            type="button"
            onClick={() => setScale((s) => clampScale(s * 1.25))}
            disabled={scale >= MAX_SCALE}
            title="放大 (+)"
            className="rounded-lg bg-slate-800 p-1.5 text-white hover:bg-slate-700 disabled:opacity-40"
          >
            <ZoomIn className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            }}
            title="1:1 原图"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1.5 text-white hover:bg-slate-700"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">1:1</span>
          </button>

          <button
            type="button"
            onClick={resetToFit}
            title="适应窗口 (0)"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1.5 text-white hover:bg-slate-700"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">适应</span>
          </button>

          <div className="mx-1 h-4 w-px bg-slate-700" />

          <button
            type="button"
            onClick={handleUndo}
            disabled={history.length === 0}
            title="撤销 (⌘+Z / Ctrl+Z)"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-white hover:bg-slate-700 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>撤销</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (annotations.length > 0) pushHistory(annotations);
              setAnnotations([]);
              setSelectedId(null);
              setPendingText(null);
            }}
            disabled={annotations.length === 0 && !pendingText}
            title="清空全部标注"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-white hover:bg-slate-700 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>清空</span>
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            <span>{saving ? '保存中...' : '完成并保存'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            title="取消关闭 (Esc)"
            className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:bg-red-600 hover:text-white"
            aria-label="关闭标注"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div
        ref={viewportRef}
        onWheel={handleWheel}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative flex flex-1 items-center justify-center overflow-hidden ${
          isPanMode
            ? 'cursor-grab active:cursor-grabbing'
            : tool === 'select'
              ? 'cursor-default'
              : tool === 'text'
                ? 'cursor-text'
                : 'cursor-crosshair'
        }`}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handleCanvasPointerDown}
          onDoubleClick={handleCanvasDoubleClick}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transformOrigin: 'center center',
          }}
          className="max-w-none shadow-2xl"
        />

        {/* Floating Edit / Delete Bar for Selected Annotation */}
        {selectedAnn && selectedOverlayPos && (
          <div
            style={{ left: selectedOverlayPos.left, top: selectedOverlayPos.top }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-20 flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/95 p-1 text-[11px] text-white shadow-lg"
          >
            {selectedAnn.type === 'text' && (
              <button
                type="button"
                onClick={() => openEditForText(selectedAnn)}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium text-blue-300 hover:bg-slate-800"
              >
                <Edit3 className="h-3 w-3" />
                编辑
              </button>
            )}
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium text-red-300 hover:bg-red-600 hover:text-white"
            >
              <Trash2 className="h-3 w-3" />
              删除
            </button>
          </div>
        )}

        {/* Inline Text Input Box on Canvas */}
        {pendingText && textBoxStyle && (
          <div
            style={{ left: textBoxStyle.left, top: textBoxStyle.top }}
            className="absolute z-20 flex flex-col gap-1"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <textarea
              ref={textInputRef}
              rows={1}
              value={pendingText.value}
              onChange={(e) => setPendingText({ ...pendingText, value: e.target.value })}
              onKeyDown={handleTextKeyDown}
              placeholder="输入标注文字，Enter 确认..."
              style={{ color: pendingText.color, fontSize: `${textBoxStyle.fontSize}px` }}
              className="min-w-[180px] resize rounded-lg border-2 border-blue-500 bg-white/95 px-2 py-1 font-semibold leading-snug shadow-lg focus:outline-none"
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={commitPendingText}
                className="rounded bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-blue-700"
              >
                确认 (Enter)
              </button>
              <button
                type="button"
                onClick={() => setPendingText(null)}
                className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
              >
                取消 (Esc)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Tip Bar */}
      <div className="border-t border-slate-800/80 bg-slate-950/90 px-4 py-1.5 text-center text-[11px] text-slate-400">
        点击已有文字可直接拖动改位置、双击重新编辑、按 Delete 或点「删除」移除 · 切到「选择」可移动或删除任意框/线 · 滚轮缩放 · 空格拖拽画布 · ⌘+Z 撤销
      </div>
    </div>
  );
}
