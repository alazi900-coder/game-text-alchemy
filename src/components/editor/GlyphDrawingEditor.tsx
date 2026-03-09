import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Pencil, Eraser, Undo2, Redo2, Check, X, Pipette, Square } from "lucide-react";

interface GlyphDrawingEditorProps {
  /** Source atlas canvas */
  atlasCanvas: HTMLCanvasElement;
  /** Glyph index in the atlas */
  glyphIndex: number;
  /** Cell dimensions */
  cellWidth: number;
  cellHeight: number;
  /** Grid layout */
  gridCols: number;
  /** Called with the edited glyph as ImageData when user confirms */
  onApply: (glyphImageData: ImageData) => void;
  /** Called when user cancels */
  onCancel: () => void;
}

type Tool = "pen" | "eraser" | "picker" | "fill";

export default function GlyphDrawingEditor({
  atlasCanvas,
  glyphIndex,
  cellWidth,
  cellHeight,
  gridCols,
  onApply,
  onCancel,
}: GlyphDrawingEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#ffffff");
  const [brushSize, setBrushSize] = useState(1);
  const [drawing, setDrawing] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const SCALE = 8; // Each pixel = 8 screen pixels
  const canvasW = cellWidth * SCALE;
  const canvasH = cellHeight * SCALE;

  // Initialize canvas with the glyph from atlas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = cellWidth;
    canvas.height = cellHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const col = glyphIndex % gridCols;
    const row = Math.floor(glyphIndex / gridCols);
    ctx.clearRect(0, 0, cellWidth, cellHeight);
    ctx.drawImage(
      atlasCanvas,
      col * cellWidth,
      row * cellHeight,
      cellWidth,
      cellHeight,
      0, 0, cellWidth, cellHeight
    );

    const initial = ctx.getImageData(0, 0, cellWidth, cellHeight);
    setHistory([initial]);
    setHistoryIndex(0);
  }, [atlasCanvas, glyphIndex, cellWidth, cellHeight, gridCols]);

  const pushHistory = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, cellWidth, cellHeight);
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      const next = [...trimmed, snap];
      if (next.length > 50) next.shift();
      return next;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [cellWidth, cellHeight, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIdx = historyIndex - 1;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(history[newIdx], 0, 0);
    setHistoryIndex(newIdx);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIdx = historyIndex + 1;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(history[newIdx], 0, 0);
    setHistoryIndex(newIdx);
  }, [history, historyIndex]);

  const hexToRGBA = (hex: string): [number, number, number, number] => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b, 255];
  };

  const getPixelCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * cellWidth);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * cellHeight);
    return { x: Math.max(0, Math.min(x, cellWidth - 1)), y: Math.max(0, Math.min(y, cellHeight - 1)) };
  };

  const drawPixel = (x: number, y: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    if (tool === "picker") {
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      const hex = `#${pixel[0].toString(16).padStart(2, "0")}${pixel[1].toString(16).padStart(2, "0")}${pixel[2].toString(16).padStart(2, "0")}`;
      setColor(hex);
      setTool("pen");
      return;
    }

    if (tool === "fill") {
      floodFill(ctx, x, y);
      return;
    }

    const half = Math.floor(brushSize / 2);
    for (let dy = -half; dy < brushSize - half; dy++) {
      for (let dx = -half; dx < brushSize - half; dx++) {
        const px = x + dx, py = y + dy;
        if (px < 0 || px >= cellWidth || py < 0 || py >= cellHeight) continue;
        if (tool === "eraser") {
          ctx.clearRect(px, py, 1, 1);
        } else {
          const [r, g, b, a] = hexToRGBA(color);
          const id = ctx.createImageData(1, 1);
          id.data.set([r, g, b, a]);
          ctx.putImageData(id, px, py);
        }
      }
    }
  };

  const floodFill = (ctx: CanvasRenderingContext2D, startX: number, startY: number) => {
    const imageData = ctx.getImageData(0, 0, cellWidth, cellHeight);
    const data = imageData.data;
    const targetIdx = (startY * cellWidth + startX) * 4;
    const targetColor = [data[targetIdx], data[targetIdx + 1], data[targetIdx + 2], data[targetIdx + 3]];
    const [fr, fg, fb, fa] = tool === "eraser" ? [0, 0, 0, 0] : hexToRGBA(color);

    if (targetColor[0] === fr && targetColor[1] === fg && targetColor[2] === fb && targetColor[3] === fa) return;

    const match = (i: number) =>
      data[i] === targetColor[0] && data[i + 1] === targetColor[1] &&
      data[i + 2] === targetColor[2] && data[i + 3] === targetColor[3];

    const stack = [[startX, startY]];
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const i = (y * cellWidth + x) * 4;
      if (x < 0 || x >= cellWidth || y < 0 || y >= cellHeight) continue;
      if (!match(i)) continue;
      data[i] = fr; data[i + 1] = fg; data[i + 2] = fb; data[i + 3] = fa;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    ctx.putImageData(imageData, 0, 0);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getPixelCoords(e);
    if (tool === "fill" || tool === "picker") {
      drawPixel(x, y);
      if (tool !== "picker") pushHistory();
      return;
    }
    setDrawing(true);
    drawPixel(x, y);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const { x, y } = getPixelCoords(e);
    drawPixel(x, y);
  };

  const handleMouseUp = () => {
    if (drawing) {
      setDrawing(false);
      pushHistory();
    }
  };

  const handleApply = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    onApply(ctx.getImageData(0, 0, cellWidth, cellHeight));
  };

  const tools: { id: Tool; icon: typeof Pencil; label: string }[] = [
    { id: "pen", icon: Pencil, label: "قلم" },
    { id: "eraser", icon: Eraser, label: "ممحاة" },
    { id: "picker", icon: Pipette, label: "التقاط لون" },
    { id: "fill", icon: Square, label: "تعبئة" },
  ];

  const presetColors = [
    "#ffffff", "#000000", "#ff0000", "#00ff00", "#0000ff",
    "#ffff00", "#ff00ff", "#00ffff", "#888888", "#ff8800",
  ];

  return (
    <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold flex items-center gap-2">
          <Pencil className="w-4 h-4 text-primary" />
          محرر الرسم — Glyph #{glyphIndex}
        </span>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={undo} disabled={historyIndex <= 0}>
            <Undo2 className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={redo} disabled={historyIndex >= history.length - 1}>
            <Redo2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex gap-4 items-start flex-wrap">
        {/* Canvas */}
        <div
          className="border-2 border-primary/30 rounded bg-[#111] shrink-0"
          style={{ width: canvasW, height: canvasH }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: canvasW,
              height: canvasH,
              imageRendering: "pixelated",
              cursor: tool === "picker" ? "crosshair" : "cell",
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
        </div>

        {/* Tools panel */}
        <div className="flex flex-col gap-3 min-w-[160px]">
          {/* Tool buttons */}
          <div className="flex gap-1">
            {tools.map(({ id, icon: Icon, label }) => (
              <Button
                key={id}
                variant={tool === id ? "default" : "outline"}
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setTool(id)}
                title={label}
              >
                <Icon className="w-3.5 h-3.5" />
              </Button>
            ))}
          </div>

          {/* Color picker */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">اللون:</label>
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="w-7 h-7 rounded border border-input cursor-pointer"
              />
              <span className="text-xs font-mono text-muted-foreground">{color}</span>
            </div>
            <div className="flex gap-1 flex-wrap">
              {presetColors.map(c => (
                <button
                  key={c}
                  className={`w-5 h-5 rounded border ${color === c ? "border-primary ring-1 ring-primary" : "border-border"}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          {/* Brush size */}
          {(tool === "pen" || tool === "eraser") && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">حجم الفرشاة: {brushSize}px</label>
              <Slider
                value={[brushSize]}
                onValueChange={([v]) => setBrushSize(v)}
                min={1}
                max={8}
                step={1}
                className="w-full"
              />
            </div>
          )}

          {/* Apply / Cancel */}
          <div className="flex gap-2 mt-1">
            <Button size="sm" className="gap-1.5 flex-1" onClick={handleApply}>
              <Check className="w-3.5 h-3.5" />
              تطبيق
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={onCancel}>
              <X className="w-3.5 h-3.5" />
              إلغاء
            </Button>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        ارسم مباشرة على الحرف ({cellWidth}×{cellHeight} بكسل) — استخدم القلم والممحاة والتعبئة — اضغط "تطبيق" لحفظ التعديلات على الخط
      </p>
    </div>
  );
}
