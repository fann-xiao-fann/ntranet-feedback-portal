import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  Download,
  Maximize2,
  Minimize2,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { AttachmentItem } from '../api/client';

interface PhotoLightboxProps {
  photo: AttachmentItem | null;
  onClose: () => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100));
}

export function PhotoLightbox({ photo, onClose }: PhotoLightboxProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const dragStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);

  const computeFitScale = useCallback(
    (natW: number, natH: number, rot: number): number => {
      const vp = viewportRef.current;
      if (!vp || natW <= 0 || natH <= 0) return 1;
      const pad = 32;
      const availW = Math.max(100, vp.clientWidth - pad * 2);
      const availH = Math.max(100, vp.clientHeight - pad * 2);
      const isSwapped = rot % 180 !== 0;
      const effW = isSwapped ? natH : natW;
      const effH = isSwapped ? natW : natH;
      return clampScale(Math.min(1, availW / effW, availH / effH));
    },
    []
  );

  const resetToFit = useCallback(() => {
    setOffset({ x: 0, y: 0 });
    if (naturalSize) {
      setScale(computeFitScale(naturalSize.w, naturalSize.h, rotation));
    } else {
      setScale(1);
    }
  }, [computeFitScale, naturalSize, rotation]);

  const setActualPixelSize = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomByFactor = useCallback((factor: number) => {
    setScale((prev) => clampScale(prev * factor));
  }, []);

  const rotate90 = useCallback(() => {
    setRotation((prev) => {
      const next = (prev + 90) % 360;
      if (naturalSize) {
        setScale(computeFitScale(naturalSize.w, naturalSize.h, next));
      }
      setOffset({ x: 0, y: 0 });
      return next;
    });
  }, [computeFitScale, naturalSize]);

  // Reset state whenever photo changes
  useEffect(() => {
    setNaturalSize(null);
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    dragStartRef.current = null;
  }, [photo]);

  // Keyboard shortcuts: Esc, +/-, 0
  useEffect(() => {
    if (!photo) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomByFactor(1.25);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomByFactor(0.8);
      } else if (e.key === '0') {
        e.preventDefault();
        resetToFit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [photo, onClose, zoomByFactor, resetToFit]);

  // Prevent background page scroll while lightbox is open
  useEffect(() => {
    if (!photo) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [photo]);

  if (!photo) return null;

  function handleImageLoad() {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setNaturalSize({ w, h });
    setScale(computeFitScale(w, h, 0));
    setOffset({ x: 0, y: 0 });
  }

  function handleWheel(e: ReactWheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setScale((prev) => clampScale(prev * factor));
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    suppressNextClickRef.current = false;
    dragStartRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
      moved: false,
    };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      drag.moved = true;
    }
    setOffset({
      x: drag.originX + dx,
      y: drag.originY + dy,
    });
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    suppressNextClickRef.current = drag.moved;
    dragStartRef.current = null;
    setDragging(false);
  }

  function handleDoubleClick() {
    if (!naturalSize) return;
    const fit = computeFitScale(naturalSize.w, naturalSize.h, rotation);
    if (Math.abs(scale - fit) < 0.05) {
      setScale(clampScale(Math.max(1, fit * 2)));
    } else {
      resetToFit();
    }
  }

  const percent = Math.round(scale * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/92 backdrop-blur-xs select-none"
      role="dialog"
      aria-modal="true"
      aria-label="高清原图预览"
    >
      {/* Top Floating Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/90 px-4 py-2.5 text-xs text-slate-200">
        <span className="hidden text-slate-400 md:inline">
          滚轮缩放 · 按住左键拖拽 · 双击切换放大 · Esc 关闭
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => zoomByFactor(0.8)}
            disabled={scale <= MIN_SCALE}
            title="缩小 (-)"
            className="inline-flex items-center justify-center rounded-lg bg-slate-800 p-1.5 text-white hover:bg-slate-700 disabled:opacity-40"
          >
            <ZoomOut className="h-4 w-4" />
          </button>

          <span className="min-w-[52px] text-center font-mono text-xs font-semibold text-white">
            {percent}%
          </span>

          <button
            type="button"
            onClick={() => zoomByFactor(1.25)}
            disabled={scale >= MAX_SCALE}
            title="放大 (+)"
            className="inline-flex items-center justify-center rounded-lg bg-slate-800 p-1.5 text-white hover:bg-slate-700 disabled:opacity-40"
          >
            <ZoomIn className="h-4 w-4" />
          </button>

          <div className="mx-1 h-4 w-px bg-slate-700" />

          <button
            type="button"
            onClick={setActualPixelSize}
            title="1:1 原始像素尺寸"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 font-medium text-white hover:bg-slate-700"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            1:1 原图
          </button>

          <button
            type="button"
            onClick={resetToFit}
            title="适应窗口 (0)"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 font-medium text-white hover:bg-slate-700"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            适应窗口
          </button>

          <button
            type="button"
            onClick={rotate90}
            title="顺时针旋转 90°"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 font-medium text-white hover:bg-slate-700"
          >
            <RotateCw className="h-3.5 w-3.5" />
            旋转
          </button>

          {photo.downloadUrl && (
            <a
              href={photo.downloadUrl}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
            >
              <Download className="h-3.5 w-3.5" />
              下载原图
            </a>
          )}

          <button
            type="button"
            onClick={onClose}
            title="关闭 (Esc)"
            className="ml-1 rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:bg-red-600 hover:text-white"
            aria-label="关闭预览"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Interactive Pan & Zoom Canvas */}
      <div
        ref={viewportRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onClick={(e) => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
        className={`relative flex flex-1 items-center justify-center overflow-hidden ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <img
          ref={imgRef}
          src={photo.url}
          alt="高清原图"
          draggable={false}
          onLoad={handleImageLoad}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
            transition: dragging ? 'none' : 'transform 120ms ease-out',
          }}
          className="max-w-none select-none shadow-2xl"
        />
      </div>
    </div>
  );
}
