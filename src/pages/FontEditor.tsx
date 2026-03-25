import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  ArrowRight, Download, Search, Trash2, ZoomIn, ZoomOut, ScanSearch,
  Paintbrush, Upload, Eye, FileJson, Replace, Type, Pencil, RotateCcw,
  Settings2, Grid3x3, Layers, ChevronDown, ChevronUp, Palette, Move, Loader2,
  Archive, FolderOpen, FileText, HardDrive, Package, ShieldCheck, AlertTriangle, CheckCircle2
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import { decodeDXT5, encodeDXT5, findDDSPositions, DDS_HEADER_SIZE, TEX_SIZE, DXT5_MIP0_SIZE, buildDDSHeader } from "@/lib/dxt5-codec";
import { getArabicChars, ARABIC_LETTERS, TASHKEEL } from "@/lib/arabic-forms-data";
import {
  generateFontAtlas, renderTextPreview, exportMetricsJSON, mergeAtlasToFontData,
  type GlyphMetrics, type AtlasResult, type AtlasPage
} from "@/lib/font-atlas-engine";
import {
  parseNLGDict, extractNLGFiles, repackNLGArchive, detectFileType, formatFileSize,
  type NLGArchiveInfo, type NLGExtractedFile
} from "@/lib/nlg-archive";
import GlyphDrawingEditor from "@/components/editor/GlyphDrawingEditor";
import JSZip from "jszip";

/* ─── types ─── */
export interface GlyphEntry {
  char: string;
  code: number;
  x: number;
  y: number;
  w: number;
  h: number;
  page: number;
  advance: number;
}

interface TextureInfo {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imgData: ImageData;
  ddsOffset: number;
  isGenerated?: boolean;
  archiveFileIndex?: number; // NLG archive file index
}

interface ArabicPresetFont {
  id: string;
  label: string;
  family: string;
  url: string;
  format: "truetype" | "opentype" | "woff" | "woff2";
}

const ARABIC_PRESET_FONTS: ArabicPresetFont[] = [
  {
    id: "noto-kufi-bold",
    label: "Noto Kufi Arabic (موصى به للعبة)",
    family: "Noto Kufi Arabic",
    url: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoKufiArabic/NotoKufiArabic-Bold.ttf",
    format: "truetype",
  },
  {
    id: "noto-naskh-bold",
    label: "Noto Naskh Arabic",
    family: "Noto Naskh Arabic",
    url: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoNaskhArabic/NotoNaskhArabic-Bold.ttf",
    format: "truetype",
  },
  {
    id: "cairo-bold",
    label: "Cairo",
    family: "Cairo",
    url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/cairo/Cairo-Bold.ttf",
    format: "truetype",
  },
];

/* ─── component ─── */
export default function FontEditor() {
  // Core state
  const [textures, setTextures] = useState<TextureInfo[]>([]);
  const [glyphs, setGlyphs] = useState<GlyphEntry[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [glyphSearch, setGlyphSearch] = useState("");
  const [fontData, setFontData] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState("");

  // NLG Archive state
  const [archiveInfo, setArchiveInfo] = useState<NLGArchiveInfo | null>(null);
  const [archiveFiles, setArchiveFiles] = useState<NLGExtractedFile[]>([]);
  const [dictData, setDictData] = useState<Uint8Array | null>(null);
  const [dictFileName, setDictFileName] = useState("");
  const [hasArchive, setHasArchive] = useState(false);

  // Arabic generation settings
  const [arabicFontName, setArabicFontName] = useState("Tajawal");
  const [customFontLoaded, setCustomFontLoaded] = useState(false);
  const [fontSize, setFontSize] = useState(52);
  const [fontWeight, setFontWeight] = useState("700");
  const [fontColor, setFontColor] = useState("#ffffff");
  const [strokeWidth, setStrokeWidth] = useState(0);
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [padding, setPadding] = useState(3);
  const [antiAlias, setAntiAlias] = useState(true);
  const [presetFontId, setPresetFontId] = useState(ARABIC_PRESET_FONTS[0].id);
  const [isDownloadingPresetFont, setIsDownloadingPresetFont] = useState(false);

  // Arabic char selection
  const [includeIsolated, setIncludeIsolated] = useState(true);
  const [includeInitial, setIncludeInitial] = useState(true);
  const [includeMedial, setIncludeMedial] = useState(true);
  const [includeFinal, setIncludeFinal] = useState(true);
  const [includeTashkeel, setIncludeTashkeel] = useState(true);
  const [includeEnglish, setIncludeEnglish] = useState(false);

  // Atlas result (from advanced engine)
  const [atlasResult, setAtlasResult] = useState<AtlasResult | null>(null);

  // Preview
  const [previewText, setPreviewText] = useState("بسم الله الرحمن الرحيم\nمرحباً بالعالم العربي!\nLuigi's Mansion 2 HD");
  const [previewScale, setPreviewScale] = useState(1.5);
  const [previewBg, setPreviewBg] = useState("#1a1a2e");

  // Glyph editor
  const [editingGlyphIdx, setEditingGlyphIdx] = useState<number | null>(null);

  // Advanced settings
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [replaceMode, setReplaceMode] = useState<"append" | "replace">("append");
  const [targetReplacePage, setTargetReplacePage] = useState(0);

  // Highlighted glyph
  const [highlightedGlyph, setHighlightedGlyph] = useState<number | null>(null);

  // Build verification state
  const [buildVerification, setBuildVerification] = useState<{
    show: boolean;
    results: Array<{
      pageLabel: string;
      hashBefore: number;
      hashAfter: number;
      match: boolean;
      nonZeroBefore: number;
      nonZeroAfter: number;
      pixelLoss: number; // percentage of lost non-zero pixels
    }>;
    totalPages: number;
    passedPages: number;
    newPages: number;
    dictSizeBefore: number;
    dictSizeAfter: number;
    dataSizeBefore: number;
    dataSizeAfter: number;
    duration: number;
  } | null>(null);

  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const customFontInputRef = useRef<HTMLInputElement>(null);
  const presetFontObjectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      for (const url of presetFontObjectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      presetFontObjectUrlsRef.current = [];
    };
  }, []);

  /* ─── Arabic chars memo ─── */
  const arabicChars = useMemo(() => getArabicChars({
    isolated: includeIsolated,
    initial: includeInitial,
    medial: includeMedial,
    final: includeFinal,
    tashkeel: includeTashkeel,
    english: includeEnglish,
  }), [includeIsolated, includeInitial, includeMedial, includeFinal, includeTashkeel, includeEnglish]);

  /* ─── Pixel hash helper ─── */
  const computePixelHash = (rgba: Uint8ClampedArray | Uint8Array): number => {
    // FNV-1a 32-bit hash on RGBA data (sampled every 4th pixel for speed)
    let hash = 0x811c9dc5;
    const step = Math.max(4, Math.floor(rgba.length / 65536)) * 4;
    for (let i = 0; i < rgba.length; i += step) {
      hash ^= rgba[i];
      hash = Math.imul(hash, 0x01000193);
      hash ^= rgba[i + 1];
      hash = Math.imul(hash, 0x01000193);
      hash ^= rgba[i + 2];
      hash = Math.imul(hash, 0x01000193);
      hash ^= rgba[i + 3];
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  };

  const countNonZeroPixels = (rgba: Uint8ClampedArray | Uint8Array): number => {
    let count = 0;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] > 0) count++;
    }
    return count;
  };

  /* ─── display texture on canvas ─── */
  const displayTexture = useCallback((idx: number, tex?: TextureInfo[], gly?: GlyphEntry[]) => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const textureList = tex || textures;
    const glyphList = gly || glyphs;
    const t = textureList[idx];
    if (!t) return;

    const sz = TEX_SIZE * zoom;
    canvas.width = sz;
    canvas.height = sz;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, sz, sz);
    ctx.drawImage(t.canvas, 0, 0, sz, sz);

    if (t.isGenerated) {
      ctx.strokeStyle = "rgba(100, 100, 100, 0.15)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x < TEX_SIZE; x += 64) {
        ctx.beginPath(); ctx.moveTo(x * zoom, 0); ctx.lineTo(x * zoom, sz); ctx.stroke();
      }
      for (let y = 0; y < TEX_SIZE; y += 64) {
        ctx.beginPath(); ctx.moveTo(0, y * zoom); ctx.lineTo(sz, y * zoom); ctx.stroke();
      }
    }

    const pageGlyphs = glyphList.filter(g => g.page === idx);
    if (pageGlyphs.length > 0) {
      pageGlyphs.forEach(g => {
        const isHighlighted = highlightedGlyph !== null && glyphList.indexOf(g) === highlightedGlyph;
        ctx.strokeStyle = isHighlighted ? "rgba(255, 200, 0, 0.9)" : "rgba(0, 212, 170, 0.25)";
        ctx.lineWidth = isHighlighted ? 2 : 0.5;
        ctx.strokeRect(g.x * zoom, g.y * zoom, g.w * zoom, g.h * zoom);
        if (isHighlighted) {
          ctx.fillStyle = "rgba(255, 200, 0, 0.15)";
          ctx.fillRect(g.x * zoom, g.y * zoom, g.w * zoom, g.h * zoom);
        }
      });
    }
  }, [textures, glyphs, zoom, highlightedGlyph]);

  useEffect(() => {
    if (textures.length > 0) displayTexture(currentPage);
  }, [zoom, currentPage, textures, glyphs, displayTexture, highlightedGlyph]);

  /* ─── Update text preview ─── */
  const updatePreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !atlasResult) return;

    const width = 700;
    const height = 300;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = previewBg;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let y = 40; y < height; y += atlasResult.lineHeight * previewScale) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    renderTextPreview(ctx, previewText, atlasResult, width - 30, 60, previewScale, true);
  }, [atlasResult, previewText, previewScale, previewBg]);

  useEffect(() => { updatePreview(); }, [updatePreview]);

  const decodeArchiveTextures = useCallback((files: NLGExtractedFile[]) => {
    const decodedTextures: TextureInfo[] = [];

    for (const file of files) {
      const type = detectFileType(file.data);
      if (type !== "DDS" || file.data.length <= DDS_HEADER_SIZE + 1024) continue;

      try {
        const dxtData = file.data.slice(DDS_HEADER_SIZE, DDS_HEADER_SIZE + DXT5_MIP0_SIZE);
        const rgba = decodeDXT5(dxtData, TEX_SIZE, TEX_SIZE);

        const canvas = document.createElement("canvas");
        canvas.width = TEX_SIZE;
        canvas.height = TEX_SIZE;
        const ctx = canvas.getContext("2d")!;
        const imgData = ctx.createImageData(TEX_SIZE, TEX_SIZE);
        imgData.data.set(rgba);
        ctx.putImageData(imgData, 0, 0);

        decodedTextures.push({ canvas, ctx, imgData, ddsOffset: -1, archiveFileIndex: file.index });
      } catch (err) {
        console.warn(`Failed to decode DDS from archive file ${file.index}`, err);
      }
    }

    return decodedTextures;
  }, []);

  /* ─── File loading (supports .dict + .data pairs) ─── */
  const handleFontFiles = async (files: FileList | null) => {
    if (!files) return;
    let dataFile: File | null = null;
    let dictFile: File | null = null;

    for (const f of Array.from(files)) {
      if (f.name.endsWith(".data")) dataFile = f;
      if (f.name.endsWith(".dict")) dictFile = f;
    }

    if (!dataFile) {
      toast({ title: "خطأ", description: "لم يتم العثور على ملف .data", variant: "destructive" });
      return;
    }

    const dataBuffer = await dataFile.arrayBuffer();
    const data = new Uint8Array(dataBuffer);
    setFontData(data);
    setFileName(dataFile.name);

    // If .dict is provided, use NLG archive parser
    if (dictFile) {
      try {
        const dictBuffer = await dictFile.arrayBuffer();
        const dictBytes = new Uint8Array(dictBuffer);
        setDictData(dictBytes);
        setDictFileName(dictFile.name);

        const info = parseNLGDict(dictBytes);
        setArchiveInfo(info);
        setHasArchive(true);

        const extracted = extractNLGFiles(info, data);
        setArchiveFiles(extracted);

        const newTextures = decodeArchiveTextures(extracted);

        setTextures(newTextures);
        setCurrentPage(0);
        setAtlasResult(null);
        toast({
          title: "✅ تم تحميل الأرشيف",
          description: `${info.fileCount} ملف في الأرشيف — ${newTextures.length} صفحة DDS — ${formatFileSize(data.length)}`,
        });
      } catch (err: any) {
        console.error("NLG parse error:", err);
        toast({ title: "خطأ في قراءة الأرشيف", description: err.message, variant: "destructive" });
        // Fallback to direct DDS scan
        loadDirectDDS(data);
      }
    } else {
      // No .dict — use direct DDS scan (legacy mode)
      setHasArchive(false);
      setArchiveInfo(null);
      setArchiveFiles([]);
      setDictData(null);
      loadDirectDDS(data);
    }
  };

  const loadDirectDDS = (data: Uint8Array) => {
    const ddsPositions = findDDSPositions(data);
    const newTextures: TextureInfo[] = [];

    for (let i = 0; i < ddsPositions.length; i++) {
      const ddsOff = ddsPositions[i];
      const dxtData = data.slice(ddsOff + DDS_HEADER_SIZE, ddsOff + DDS_HEADER_SIZE + DXT5_MIP0_SIZE);
      const rgba = decodeDXT5(dxtData, TEX_SIZE, TEX_SIZE);

      const canvas = document.createElement("canvas");
      canvas.width = TEX_SIZE;
      canvas.height = TEX_SIZE;
      const ctx = canvas.getContext("2d")!;
      const imgData = ctx.createImageData(TEX_SIZE, TEX_SIZE);
      imgData.data.set(rgba);
      ctx.putImageData(imgData, 0, 0);

      newTextures.push({ canvas, ctx, imgData, ddsOffset: ddsOff });
    }

    setTextures(newTextures);
    setCurrentPage(0);
    setAtlasResult(null);
    toast({ title: "✅ تم التحميل", description: `${ddsPositions.length} صفحة أطلس — ${formatFileSize(data.length)}` });
  };

  /* ─── Auto-detect glyphs from existing textures ─── */
  const autoDetectGlyphs = () => {
    if (textures.length === 0) return;

    const tex0Chars = '!"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    const detected: GlyphEntry[] = [];

    for (let pageIdx = 0; pageIdx < textures.length; pageIdx++) {
      if (textures[pageIdx].isGenerated) continue;
      const data = textures[pageIdx].imgData.data;

      const rowSums = new Float64Array(TEX_SIZE);
      for (let y = 0; y < TEX_SIZE; y++) {
        let sum = 0;
        for (let x = 0; x < TEX_SIZE; x++) sum += data[(y * TEX_SIZE + x) * 4 + 3];
        rowSums[y] = sum;
      }

      const maxRow = Math.max(...rowSums);
      if (maxRow === 0) continue;
      const rowThreshold = maxRow * 0.008;

      const rows: { y0: number; y1: number }[] = [];
      let inRow = false, rowStart = 0;
      for (let y = 0; y < TEX_SIZE; y++) {
        if (rowSums[y] > rowThreshold) {
          if (!inRow) { inRow = true; rowStart = y; }
        } else {
          if (inRow && y - rowStart > 4) rows.push({ y0: rowStart, y1: y });
          inRow = false;
        }
      }
      if (inRow && TEX_SIZE - rowStart > 4) rows.push({ y0: rowStart, y1: TEX_SIZE });

      let charIdx = 0;
      for (const row of rows) {
        const colSums = new Float64Array(TEX_SIZE);
        for (let x = 0; x < TEX_SIZE; x++) {
          let sum = 0;
          for (let y = row.y0; y < row.y1; y++) sum += data[(y * TEX_SIZE + x) * 4 + 3];
          colSums[x] = sum;
        }

        const maxCol = Math.max(...colSums);
        if (maxCol === 0) continue;
        const colThreshold = maxCol * 0.003;
        let inChar = false, charStart = 0;

        for (let x = 0; x < TEX_SIZE; x++) {
          if (colSums[x] > colThreshold) {
            if (!inChar) { inChar = true; charStart = x; }
          } else if (inChar) {
            const w = x - charStart;
            if (w > 2) {
              const ch = pageIdx === 0 && charIdx < tex0Chars.length ? tex0Chars[charIdx] : "?";
              const code = ch !== "?" ? ch.codePointAt(0)! : 0;
              detected.push({ x: charStart, y: row.y0, w, h: row.y1 - row.y0, page: pageIdx, char: ch, code, advance: w });
              charIdx++;
            }
            inChar = false;
          }
        }
        if (inChar) {
          const w = TEX_SIZE - charStart;
          if (w > 2) {
            const ch = pageIdx === 0 && charIdx < tex0Chars.length ? tex0Chars[charIdx] : "?";
            detected.push({ x: charStart, y: row.y0, w, h: row.y1 - row.y0, page: pageIdx, char: ch, code: ch !== "?" ? ch.codePointAt(0)! : 0, advance: w });
            charIdx++;
          }
        }
      }
    }

    setGlyphs(detected);
    toast({ title: "🔍 كشف تلقائي", description: `تم كشف ${detected.length} حرف من ${textures.filter(t => !t.isGenerated).length} صفحة` });
  };

  /* ─── Generate Arabic Atlas (Advanced Engine) ─── */
  const handleGenerateArabicAtlas = () => {
    if (arabicChars.length === 0) return;

    const result = generateFontAtlas({
      chars: arabicChars,
      fontFamily: arabicFontName,
      fontSize,
      fontWeight,
      textureSize: TEX_SIZE,
      padding,
      color: fontColor,
      strokeWidth,
      strokeColor,
      antiAlias,
    });

    setAtlasResult(result);

    const newTextures = [...textures.filter(t => !t.isGenerated)];
    const newGlyphs = [...glyphs.filter(g => {
      const tex = textures[g.page];
      return tex && !tex.isGenerated;
    })];

    const startPage = newTextures.length;

    for (let i = 0; i < result.pages.length; i++) {
      const page = result.pages[i];
      const imgData = page.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
      newTextures.push({
        canvas: page.canvas,
        ctx: page.ctx,
        imgData,
        ddsOffset: -1,
        isGenerated: true,
      });
    }

    for (const gm of result.glyphs) {
      if (gm.width === 0) continue;
      newGlyphs.push({
        char: gm.char,
        code: gm.code,
        x: gm.atlasX,
        y: gm.atlasY,
        w: gm.width,
        h: gm.height,
        page: startPage + gm.page,
        advance: gm.advance,
      });
    }

    setTextures(newTextures);
    setGlyphs(newGlyphs);
    setCurrentPage(startPage);
    toast({
      title: "✅ تم توليد الأطلس العربي",
      description: `${result.glyphs.length} حرف على ${result.pages.length} صفحة — ${result.fontSize}px — Bin-packed`,
    });
  };

  /* ─── Replace existing page with generated Arabic ─── */
  const handleReplaceOnPage = () => {
    if (!atlasResult || targetReplacePage >= textures.length) return;
    const baseTextures = textures.filter(t => !t.isGenerated);
    const tex = baseTextures[targetReplacePage];
    if (!tex || tex.isGenerated) return;

    const page0 = atlasResult.pages[0];
    if (!page0) return;

    tex.ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
    tex.ctx.drawImage(page0.canvas, 0, 0);
    tex.imgData = tex.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);

    const newGlyphs = glyphs.filter(g => g.page !== targetReplacePage && g.page < baseTextures.length);
    for (const gm of atlasResult.glyphs) {
      if (gm.width === 0) continue;
      newGlyphs.push({
        char: gm.char, code: gm.code,
        x: gm.atlasX, y: gm.atlasY,
        w: gm.width, h: gm.height,
        page: targetReplacePage, advance: gm.advance,
      });
    }

    setGlyphs(newGlyphs);
    setTextures([...baseTextures]);
    setCurrentPage(targetReplacePage);
    toast({ title: "✅ تم الاستبدال", description: `تم استبدال صفحة ${targetReplacePage} بالأحرف العربية` });
  };

  /* ─── Custom font loading ─── */
  const handleCustomFont = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const fontFace = new FontFace("CustomArabicFont", `url(${url})`);
      const loaded = await fontFace.load();
      document.fonts.add(loaded);
      setArabicFontName("CustomArabicFont");
      setCustomFontLoaded(true);
      toast({ title: "✅ تم تحميل الخط", description: `${file.name} — جاهز للاستخدام` });
    } catch (err: any) {
      toast({ title: "خطأ في تحميل الخط", description: err.message, variant: "destructive" });
    }
  };

  const handleDownloadPresetFont = async () => {
    const preset = ARABIC_PRESET_FONTS.find(p => p.id === presetFontId);
    if (!preset) return;

    setIsDownloadingPresetFont(true);
    try {
      const response = await fetch(preset.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      presetFontObjectUrlsRef.current.push(objectUrl);

      const fontFace = new FontFace(preset.family, `url(${objectUrl}) format('${preset.format}')`);
      const loaded = await fontFace.load();
      document.fonts.add(loaded);
      await document.fonts.ready;

      setArabicFontName(preset.family);
      setCustomFontLoaded(true);

      toast({
        title: "✅ تم تحميل الخط تلقائياً",
        description: `${preset.label} جاهز الآن للتوليد`,
      });
    } catch (err: any) {
      toast({
        title: "خطأ في التحميل التلقائي",
        description: err.message || "تعذر تنزيل الخط، جرّب الرفع اليدوي",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingPresetFont(false);
    }
  };

  /* ─── Build & Download ─── */
  const handleBuildFont = async () => {
    if (!fontData) {
      toast({ title: "خطأ", description: "حمّل ملف الخط أولاً", variant: "destructive" });
      return;
    }

    if (hasArchive && archiveInfo && archiveFiles.length > 0) {
      // NLG Archive mode: repack the entire archive
      await buildWithArchive();
    } else {
      // Legacy mode: in-place DDS patching
      buildLegacy();
    }
  };

  const buildLegacy = () => {
    if (!fontData) return;
    const newData = new Uint8Array(fontData);
    let modifiedCount = 0;

    textures.forEach(tex => {
      if (tex.ddsOffset < 0) return;
      const rgba = tex.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
      const dxt5 = encodeDXT5(new Uint8Array(rgba), TEX_SIZE, TEX_SIZE);
      const writeOff = tex.ddsOffset + DDS_HEADER_SIZE;
      for (let i = 0; i < dxt5.length && i < DXT5_MIP0_SIZE; i++) {
        newData[writeOff + i] = dxt5[i];
      }
      modifiedCount++;
    });

    const blob = new Blob([newData], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "FEBundleFonts_res.data";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "✅ تم البناء", description: `تم تعديل ${modifiedCount} صفحة DDS` });
  };

  const buildWithArchive = async () => {
    if (!archiveInfo || archiveFiles.length === 0) return;
    const buildStart = performance.now();
    const dictSizeBefore = dictData?.length ?? 0;
    const dataSizeBefore = fontData?.length ?? 0;

    // Phase 0: Capture pre-build pixel hashes for ALL textures
    const preBuildSnapshots = new Map<number, { hash: number; nonZero: number; label: string }>();
    for (let i = 0; i < textures.length; i++) {
      const tex = textures[i];
      const rgba = tex.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
      const label = tex.isGenerated
        ? `صفحة عربية جديدة ${i}`
        : tex.archiveFileIndex !== undefined
          ? `ملف أرشيف ${tex.archiveFileIndex}`
          : `صفحة ${i}`;
      preBuildSnapshots.set(i, {
        hash: computePixelHash(rgba),
        nonZero: countNonZeroPixels(rgba),
        label,
      });
    }

    // Update DDS files in archive with modified textures
    const updatedFiles = [...archiveFiles];
    const ddsTemplate = archiveFiles.find(f => detectFileType(f.data) === "DDS");
    const templateUnk = ddsTemplate?.originalEntry.unk ?? 0;
    const templateCompressionMode = ddsTemplate?.compressionMode ?? (archiveInfo.isCompressed ? "zlib" : "none");

    // Map: archiveFileIndex → texture
    const texByArchiveIdx = new Map<number, TextureInfo>();
    for (const tex of textures) {
      if (tex.archiveFileIndex !== undefined && !tex.isGenerated) {
        texByArchiveIdx.set(tex.archiveFileIndex, tex);
      }
    }

    // Update existing DDS files
    for (let i = 0; i < updatedFiles.length; i++) {
      const tex = texByArchiveIdx.get(updatedFiles[i].index);
      if (tex) {
        const rgba = tex.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
        const dxt5 = encodeDXT5(new Uint8Array(rgba), TEX_SIZE, TEX_SIZE);
        const header = buildDDSHeader(TEX_SIZE, TEX_SIZE);
        const newDDS = new Uint8Array(header.length + dxt5.length);
        newDDS.set(header, 0);
        newDDS.set(dxt5, header.length);

        updatedFiles[i] = {
          ...updatedFiles[i],
          data: newDDS,
          wasCompressed: updatedFiles[i].wasCompressed,
        };
      }
    }

    // Append new generated pages as new DDS files
    const generatedTextures = replaceMode === "append"
      ? textures.filter(t => t.isGenerated)
      : [];

    for (const tex of generatedTextures) {
      const rgba = tex.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
      const dxt5 = encodeDXT5(new Uint8Array(rgba), TEX_SIZE, TEX_SIZE);
      const header = buildDDSHeader(TEX_SIZE, TEX_SIZE);
      const newDDS = new Uint8Array(header.length + dxt5.length);
      newDDS.set(header, 0);
      newDDS.set(dxt5, header.length);

      const newIndex = updatedFiles.length;
      updatedFiles.push({
        index: newIndex,
        data: newDDS,
        wasCompressed: archiveInfo.isCompressed,
        compressionMode: archiveInfo.isCompressed ? templateCompressionMode : "none",
        originalEntry: {
          index: newIndex,
          offset: 0,
          decompressedLength: newDDS.length,
          compressedLength: newDDS.length,
          unk: templateUnk,
        },
      });
    }

    // Repack
    const { dict: newDict, data: newData } = repackNLGArchive(archiveInfo, updatedFiles);
    const newArchiveInfo = parseNLGDict(newDict);
    const newArchiveFiles = extractNLGFiles(newArchiveInfo, newData);
    const newTextures = decodeArchiveTextures(newArchiveFiles);

    // Phase: Post-build verification — compare pixel data
    const verificationResults: Array<{
      pageLabel: string;
      hashBefore: number;
      hashAfter: number;
      match: boolean;
      nonZeroBefore: number;
      nonZeroAfter: number;
      pixelLoss: number;
    }> = [];

    for (let i = 0; i < newTextures.length; i++) {
      const afterRgba = newTextures[i].ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
      const hashAfter = computePixelHash(afterRgba);
      const nonZeroAfter = countNonZeroPixels(afterRgba);

      const before = preBuildSnapshots.get(i);
      if (before) {
        const pixelLoss = before.nonZero > 0
          ? Math.max(0, (1 - nonZeroAfter / before.nonZero) * 100)
          : 0;
        verificationResults.push({
          pageLabel: before.label,
          hashBefore: before.hash,
          hashAfter,
          match: before.hash === hashAfter,
          nonZeroBefore: before.nonZero,
          nonZeroAfter,
          pixelLoss,
        });
      } else {
        // New page added during repack (appended)
        verificationResults.push({
          pageLabel: `صفحة جديدة ${i}`,
          hashBefore: 0,
          hashAfter,
          match: true, // no comparison baseline
          nonZeroBefore: 0,
          nonZeroAfter,
          pixelLoss: 0,
        });
      }
    }

    const buildDuration = performance.now() - buildStart;
    const passedPages = verificationResults.filter(r => r.match || r.pixelLoss < 5).length;

    setDictData(newDict);
    setFontData(newData);
    setArchiveInfo(newArchiveInfo);
    setArchiveFiles(newArchiveFiles);
    setTextures(newTextures);
    setCurrentPage(0);

    // Show verification dialog
    setBuildVerification({
      show: true,
      results: verificationResults,
      totalPages: verificationResults.length,
      passedPages,
      newPages: generatedTextures.length,
      dictSizeBefore,
      dictSizeAfter: newDict.length,
      dataSizeBefore,
      dataSizeAfter: newData.length,
      duration: buildDuration,
    });

    // Download as ZIP
    const zip = new JSZip();
    const baseName = dictFileName.replace(/_res\.dict$/i, "_res").replace(/\.dict$/i, "_res");
    zip.file(`${baseName}.dict`, newDict);
    zip.file(`${baseName}.data`, newData);

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}_arabized.zip`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: "✅ تم بناء الأرشيف",
      description: `${updatedFiles.length} ملف (${generatedTextures.length} صفحة جديدة) — تحقق: ${passedPages}/${verificationResults.length} صفحة سليمة`,
    });
  };

  /* ─── Export metrics JSON ─── */
  const handleExportMetrics = () => {
    if (!atlasResult) return;
    const json = exportMetricsJSON(atlasResult);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "font-metrics.json";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "📥 تم التصدير", description: "font-metrics.json" });
  };

  /* ─── Export atlas page as PNG ─── */
  const handleExportPNG = (pageIdx: number) => {
    const tex = textures[pageIdx];
    if (!tex) return;
    const url = tex.canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas_page_${pageIdx}.png`;
    a.click();
  };

  /* ─── Export single archive file ─── */
  const handleExportArchiveFile = (file: NLGExtractedFile) => {
    const type = detectFileType(file.data);
    const ext = type === "DDS" ? ".dds" : type === "text" ? ".txt" : ".bin";
    const blob = new Blob([new Uint8Array(file.data)], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `file${String(file.index).padStart(3, "0")}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ─── Glyph edit apply ─── */
  const handleGlyphEditApply = (imgData: ImageData) => {
    if (editingGlyphIdx === null) return;
    const g = glyphs[editingGlyphIdx];
    if (!g) return;
    const tex = textures[g.page];
    if (!tex) return;

    tex.ctx.putImageData(imgData, g.x, g.y);
    tex.imgData = tex.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
    setTextures([...textures]);
    setEditingGlyphIdx(null);
    toast({ title: "✅ تم تطبيق التعديل" });
  };

  const deleteGlyph = (idx: number) => {
    setGlyphs(prev => prev.filter((_, i) => i !== idx));
  };

  const filteredGlyphs = glyphs.filter(g => {
    if (!glyphSearch) return true;
    const s = glyphSearch.toLowerCase();
    return g.char.includes(s) || g.code.toString(16).includes(s) || g.char === s;
  });

  const arabicGlyphCount = glyphs.filter(g => g.code >= 0x0600).length;
  const originalPages = textures.filter(t => !t.isGenerated).length;
  const generatedPages = textures.filter(t => t.isGenerated).length;

  return (
    <>
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur px-4 py-3">
        <div className="max-w-[1600px] mx-auto flex items-center gap-3 flex-wrap">
          <Link to="/luigis-mansion" className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1">
            <ArrowRight className="w-4 h-4" />
            العودة
          </Link>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Type className="w-5 h-5 text-primary" />
            محرر الخطوط المتقدم
          </h1>
          <Badge variant="secondary" className="text-xs">Luigi's Mansion 2 HD</Badge>
          {hasArchive && <Badge className="text-xs bg-primary/20 text-primary border-primary/30">📦 وضع الأرشيف</Badge>}
          {fontData && (
            <Badge variant="outline" className="text-xs mr-auto">
              {fileName} — {formatFileSize(fontData.length)}
            </Badge>
          )}
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-4 space-y-4">
        {/* Upload area */}
        {textures.length === 0 && (
          <Card className="border-dashed border-2 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fontInputRef.current?.click()}>
            <CardContent className="flex flex-col items-center justify-center py-20 text-center">
              <Upload className="w-16 h-16 text-muted-foreground mb-4" />
              <p className="text-xl font-bold text-foreground">ارفع ملفات الخط</p>
              <p className="text-sm text-muted-foreground mt-2">FEBundleFonts_res.dict + FEBundleFonts_res.data</p>
              <p className="text-xs text-muted-foreground mt-1">ارفع الملفين معاً لدعم الأرشيف الكامل، أو ملف .data فقط للوضع المباشر</p>
              <div className="flex gap-3 mt-4">
                <Badge variant="outline" className="text-[10px]">
                  <Archive className="w-3 h-3 ml-1" />
                  .dict + .data = أرشيف كامل
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  <HardDrive className="w-3 h-3 ml-1" />
                  .data فقط = مسح DDS مباشر
                </Badge>
              </div>
              <input
                ref={fontInputRef}
                type="file"
                multiple
                accept=".data,.dict"
                className="hidden"
                onChange={e => handleFontFiles(e.target.files)}
              />
            </CardContent>
          </Card>
        )}

        {textures.length > 0 && (
          <Tabs defaultValue={hasArchive ? "archive" : "atlas"} className="space-y-4">
            <TabsList className={`grid w-full h-auto ${hasArchive ? "grid-cols-5" : "grid-cols-4"}`}>
              {hasArchive && (
                <TabsTrigger value="archive" className="gap-1.5 text-xs py-2">
                  <Archive className="w-3.5 h-3.5" />
                  الأرشيف
                </TabsTrigger>
              )}
              <TabsTrigger value="atlas" className="gap-1.5 text-xs py-2">
                <Layers className="w-3.5 h-3.5" />
                الأطلس
              </TabsTrigger>
              <TabsTrigger value="generate" className="gap-1.5 text-xs py-2">
                <Paintbrush className="w-3.5 h-3.5" />
                توليد عربي
              </TabsTrigger>
              <TabsTrigger value="preview" className="gap-1.5 text-xs py-2">
                <Eye className="w-3.5 h-3.5" />
                معاينة
              </TabsTrigger>
              <TabsTrigger value="build" className="gap-1.5 text-xs py-2">
                <Download className="w-3.5 h-3.5" />
                البناء
              </TabsTrigger>
            </TabsList>

            {/* ═══════════════ ARCHIVE TAB ═══════════════ */}
            {hasArchive && archiveInfo && (
              <TabsContent value="archive" className="space-y-4">
                {/* Archive summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="p-3">
                    <p className="text-[10px] text-muted-foreground">عدد الملفات</p>
                    <p className="text-2xl font-bold text-foreground">{archiveInfo.fileCount}</p>
                  </Card>
                  <Card className="p-3">
                    <p className="text-[10px] text-muted-foreground">صفحات DDS</p>
                    <p className="text-2xl font-bold text-primary">{textures.filter(t => !t.isGenerated).length}</p>
                  </Card>
                  <Card className="p-3">
                    <p className="text-[10px] text-muted-foreground">مضغوط</p>
                    <p className="text-2xl font-bold">{archiveInfo.isCompressed ? "نعم" : "لا"}</p>
                  </Card>
                  <Card className="p-3">
                    <p className="text-[10px] text-muted-foreground">حجم .data</p>
                    <p className="text-lg font-bold font-mono">{formatFileSize(fontData?.length ?? 0)}</p>
                  </Card>
                </div>

                {/* File table */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-primary" />
                      ملفات الأرشيف
                    </CardTitle>
                    <p className="text-[10px] text-muted-foreground">
                      {dictFileName} — Magic: 0x{archiveInfo.magic.toString(16).toUpperCase()}
                    </p>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="max-h-[500px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right text-[10px] w-12">#</TableHead>
                            <TableHead className="text-right text-[10px]">النوع</TableHead>
                            <TableHead className="text-right text-[10px]">الإزاحة</TableHead>
                            <TableHead className="text-right text-[10px]">الحجم الأصلي</TableHead>
                            <TableHead className="text-right text-[10px]">الحجم المضغوط</TableHead>
                            <TableHead className="text-right text-[10px]">UNK</TableHead>
                            <TableHead className="text-right text-[10px] w-20"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {archiveFiles.map(file => {
                            const type = detectFileType(file.data);
                            const entry = file.originalEntry;
                            const isDDS = type === "DDS";
                            return (
                              <TableRow key={file.index} className={isDDS ? "bg-primary/5" : ""}>
                                <TableCell className="text-[10px] py-1.5 font-mono">{String(file.index).padStart(3, "0")}</TableCell>
                                <TableCell className="py-1.5">
                                  <Badge variant={isDDS ? "default" : "secondary"} className="text-[9px]">
                                    {isDDS && <Layers className="w-2.5 h-2.5 ml-0.5" />}
                                    {type === "text" && <FileText className="w-2.5 h-2.5 ml-0.5" />}
                                    {type}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-[10px] py-1.5 font-mono text-muted-foreground">
                                  0x{entry.offset.toString(16).toUpperCase()}
                                </TableCell>
                                <TableCell className="text-[10px] py-1.5">{formatFileSize(entry.decompressedLength)}</TableCell>
                                <TableCell className="text-[10px] py-1.5">
                                  {entry.compressedLength !== entry.decompressedLength
                                    ? formatFileSize(entry.compressedLength)
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-[10px] py-1.5 font-mono text-muted-foreground">
                                  0x{entry.unk.toString(16).toUpperCase()}
                                </TableCell>
                                <TableCell className="py-1.5">
                                  <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1"
                                    onClick={() => handleExportArchiveFile(file)}>
                                    <Download className="w-3 h-3" />
                                    استخراج
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {/* ═══════════════ ATLAS TAB ═══════════════ */}
            <TabsContent value="atlas" className="space-y-4">
              <div className="grid lg:grid-cols-[1fr_400px] gap-4">
                {/* Atlas Viewer */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Grid3x3 className="w-4 h-4 text-primary" />
                        عارض الأطلس
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Select value={String(currentPage)} onValueChange={v => setCurrentPage(Number(v))}>
                          <SelectTrigger className="w-44 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {textures.map((t, i) => (
                              <SelectItem key={i} value={String(i)}>
                                صفحة {i} {t.isGenerated ? "🇸🇦" : t.archiveFileIndex !== undefined ? `(ملف ${t.archiveFileIndex})` : t.ddsOffset >= 0 ? `(0x${t.ddsOffset.toString(16).toUpperCase()})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.max(0.25, z / 1.25))}>
                            <ZoomOut className="w-3.5 h-3.5" />
                          </Button>
                          <span className="text-[10px] text-muted-foreground w-8 text-center font-mono">{Math.round(zoom * 100)}%</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.min(4, z * 1.25))}>
                            <ZoomIn className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="max-h-[600px] rounded-lg border border-border bg-black">
                      <canvas ref={displayCanvasRef} className="block cursor-crosshair" style={{ imageRendering: zoom >= 2 ? "pixelated" : "auto" }} />
                    </ScrollArea>
                    <div className="flex gap-2 mt-3 flex-wrap">
                      <Button size="sm" variant="secondary" onClick={autoDetectGlyphs} className="gap-1.5">
                        <ScanSearch className="w-3.5 h-3.5" />
                        كشف تلقائي
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleExportPNG(currentPage)} className="gap-1.5">
                        <Download className="w-3.5 h-3.5" />
                        PNG
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => fontInputRef.current?.click()} className="gap-1.5">
                        <Upload className="w-3.5 h-3.5" />
                        ملف آخر
                      </Button>
                      <input ref={fontInputRef} type="file" multiple accept=".data,.dict" className="hidden" onChange={e => handleFontFiles(e.target.files)} />
                    </div>
                  </CardContent>
                </Card>

                {/* Glyph Table */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">الحروف ({glyphs.length})</CardTitle>
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input placeholder="بحث..." className="pr-8 w-36 h-8 text-xs" value={glyphSearch} onChange={e => setGlyphSearch(e.target.value)} />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[550px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right text-[10px] w-8">#</TableHead>
                            <TableHead className="text-right text-[10px]">حرف</TableHead>
                            <TableHead className="text-right text-[10px]">كود</TableHead>
                            <TableHead className="text-right text-[10px]">حجم</TableHead>
                            <TableHead className="text-right text-[10px]">صفحة</TableHead>
                            <TableHead className="text-right text-[10px] w-16"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredGlyphs.slice(0, 300).map((g, idx) => {
                            const realIdx = glyphs.indexOf(g);
                            return (
                              <TableRow
                                key={idx}
                                className={`cursor-pointer transition-colors ${highlightedGlyph === realIdx ? "bg-primary/10" : "hover:bg-muted/50"}`}
                                onClick={() => { setCurrentPage(g.page); setHighlightedGlyph(realIdx); }}
                              >
                                <TableCell className="text-[10px] py-1">{realIdx}</TableCell>
                                <TableCell className="text-base font-bold py-1">{g.char === "?" ? "❓" : g.char}</TableCell>
                                <TableCell className="font-mono text-[10px] py-1 text-muted-foreground">{g.code.toString(16).toUpperCase().padStart(4, "0")}</TableCell>
                                <TableCell className="text-[10px] py-1">{g.w}×{g.h}</TableCell>
                                <TableCell className="text-[10px] py-1">{g.page}</TableCell>
                                <TableCell className="py-1">
                                  <div className="flex gap-0.5">
                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); setEditingGlyphIdx(realIdx); }}>
                                      <Pencil className="w-3 h-3 text-primary" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); deleteGlyph(realIdx); }}>
                                      <Trash2 className="w-3 h-3 text-destructive" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>

              {/* Glyph pixel editor */}
              {editingGlyphIdx !== null && glyphs[editingGlyphIdx] && (
                <GlyphDrawingEditor
                  atlasCanvas={textures[glyphs[editingGlyphIdx].page]?.canvas || document.createElement("canvas")}
                  glyphIndex={editingGlyphIdx}
                  cellWidth={glyphs[editingGlyphIdx].w}
                  cellHeight={glyphs[editingGlyphIdx].h}
                  gridCols={1}
                  onApply={handleGlyphEditApply}
                  onCancel={() => setEditingGlyphIdx(null)}
                />
              )}
            </TabsContent>

            {/* ═══════════════ GENERATE TAB ═══════════════ */}
            <TabsContent value="generate" className="space-y-4">
              <div className="grid lg:grid-cols-[1fr_1fr] gap-4">
                {/* Font Settings */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Settings2 className="w-4 h-4 text-primary" />
                      إعدادات الخط العربي
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">ملف الخط (TTF/OTF/WOFF2)</Label>
                      <div className="flex gap-2 items-center">
                        <Input ref={customFontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleCustomFont} className="h-8 text-xs flex-1" />
                        {customFontLoaded && <Badge variant="secondary" className="text-[10px] shrink-0">✅ {arabicFontName}</Badge>}
                      </div>
                      <div className="grid grid-cols-[1fr_auto] gap-2 mt-2">
                        <Select value={presetFontId} onValueChange={setPresetFontId}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="اختر خطاً عربياً جاهزاً" />
                          </SelectTrigger>
                          <SelectContent>
                            {ARABIC_PRESET_FONTS.map(font => (
                              <SelectItem key={font.id} value={font.id}>{font.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={handleDownloadPresetFont}
                          disabled={isDownloadingPresetFont}
                        >
                          {isDownloadingPresetFont ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                          تحميل تلقائي
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">يُنصح بخط عربي يدعم جميع الأشكال: Tajawal, Noto Kufi Arabic, Cairo</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">حجم الخط: {fontSize}px</Label>
                        <Slider value={[fontSize]} onValueChange={v => setFontSize(v[0])} min={16} max={120} step={1} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">وزن الخط</Label>
                        <Select value={fontWeight} onValueChange={setFontWeight}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="300">خفيف (300)</SelectItem>
                            <SelectItem value="400">عادي (400)</SelectItem>
                            <SelectItem value="500">متوسط (500)</SelectItem>
                            <SelectItem value="600">شبه عريض (600)</SelectItem>
                            <SelectItem value="700">عريض (700)</SelectItem>
                            <SelectItem value="900">أسود (900)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs flex items-center gap-1.5">
                          <Palette className="w-3 h-3" />
                          لون الخط
                        </Label>
                        <div className="flex gap-2 items-center">
                          <Input type="color" value={fontColor} onChange={e => setFontColor(e.target.value)} className="w-10 h-8 cursor-pointer p-0.5" />
                          <span className="text-[10px] font-mono text-muted-foreground">{fontColor}</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">حدود (Stroke): {strokeWidth}px</Label>
                        <Slider value={[strokeWidth]} onValueChange={v => setStrokeWidth(v[0])} min={0} max={6} step={0.5} />
                        {strokeWidth > 0 && (
                          <div className="flex gap-2 items-center mt-1">
                            <Input type="color" value={strokeColor} onChange={e => setStrokeColor(e.target.value)} className="w-10 h-8 cursor-pointer p-0.5" />
                            <span className="text-[10px] font-mono text-muted-foreground">{strokeColor}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">هامش (Padding): {padding}px</Label>
                        <Slider value={[padding]} onValueChange={v => setPadding(v[0])} min={0} max={10} step={1} />
                      </div>
                      <div className="flex items-center gap-2 pt-5">
                        <Switch checked={antiAlias} onCheckedChange={setAntiAlias} id="aa-switch" />
                        <Label htmlFor="aa-switch" className="text-xs cursor-pointer">مضاد التشويش (Anti-alias)</Label>
                      </div>
                    </div>

                    <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs text-muted-foreground" onClick={() => setShowAdvanced(!showAdvanced)}>
                      {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      إعدادات متقدمة
                    </Button>
                    {showAdvanced && (
                      <div className="space-y-3 p-3 rounded-lg bg-muted/30 border border-border">
                        <div className="space-y-1.5">
                          <Label className="text-xs">وضع الإدراج</Label>
                          <div className="flex gap-2">
                            <Button size="sm" variant={replaceMode === "append" ? "default" : "outline"} className="flex-1 text-xs h-8" onClick={() => setReplaceMode("append")}>
                              إلحاق صفحات جديدة
                            </Button>
                            <Button size="sm" variant={replaceMode === "replace" ? "default" : "outline"} className="flex-1 text-xs h-8" onClick={() => setReplaceMode("replace")}>
                              استبدال صفحة موجودة
                            </Button>
                          </div>
                        </div>
                        {replaceMode === "replace" && (
                          <div className="space-y-1">
                            <Label className="text-xs">الصفحة المستهدفة</Label>
                            <Select value={String(targetReplacePage)} onValueChange={v => setTargetReplacePage(Number(v))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {textures.filter(t => !t.isGenerated).map((t, i) => (
                                  <SelectItem key={i} value={String(i)}>صفحة {i} {t.archiveFileIndex !== undefined ? `(ملف ${t.archiveFileIndex})` : `(0x${t.ddsOffset.toString(16).toUpperCase()})`}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Character Selection */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Type className="w-4 h-4 text-primary" />
                      اختيار الأحرف
                    </CardTitle>
                    <p className="text-[10px] text-muted-foreground">Presentation Forms — أشكال الحروف السياقية</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-3">
                      {[
                        { label: "معزول", checked: includeIsolated, set: setIncludeIsolated, count: ARABIC_LETTERS.filter(l => l.isolated).length },
                        { label: "بداية", checked: includeInitial, set: setIncludeInitial, count: ARABIC_LETTERS.filter(l => l.initial).length },
                        { label: "وسط", checked: includeMedial, set: setIncludeMedial, count: ARABIC_LETTERS.filter(l => l.medial).length },
                        { label: "نهاية", checked: includeFinal, set: setIncludeFinal, count: ARABIC_LETTERS.filter(l => l.final).length },
                        { label: "تشكيل", checked: includeTashkeel, set: setIncludeTashkeel, count: TASHKEEL.length },
                        { label: "إنجليزي", checked: includeEnglish, set: setIncludeEnglish, count: 94 },
                      ].map(f => (
                        <div key={f.label} className="flex items-center gap-1.5">
                          <Checkbox checked={f.checked} onCheckedChange={v => f.set(!!v)} id={`gen-${f.label}`} />
                          <Label htmlFor={`gen-${f.label}`} className="text-[11px] cursor-pointer">{f.label} ({f.count})</Label>
                        </div>
                      ))}
                    </div>

                    <ScrollArea className="h-[280px] rounded-lg border bg-card p-2">
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-1">
                        {arabicChars.map(c => (
                          <div key={c.code} className="flex flex-col items-center p-1 rounded border border-border bg-background text-center hover:border-primary/40 transition-colors">
                            <span className="text-sm leading-tight" dir="rtl">
                              {c.code >= 0x064B && c.code <= 0x0652 ? `ـ${c.char}` : c.char}
                            </span>
                            <span className="text-[8px] text-muted-foreground font-mono">{c.code.toString(16).toUpperCase()}</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex gap-2 text-[10px]">
                        <Badge variant="secondary">{arabicChars.filter(c => c.code >= 0xFE00).length} عربي</Badge>
                        <Badge variant="secondary">{arabicChars.filter(c => c.code >= 0x064B && c.code <= 0x0652).length} تشكيل</Badge>
                        <Badge variant="outline">{arabicChars.length} مجموع</Badge>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={handleGenerateArabicAtlas} disabled={arabicChars.length === 0} className="flex-1 gap-1.5">
                        <Paintbrush className="w-4 h-4" />
                        توليد أطلس عربي ({arabicChars.length} حرف)
                      </Button>
                      {replaceMode === "replace" && atlasResult && (
                        <Button onClick={handleReplaceOnPage} variant="secondary" className="gap-1.5">
                          <Replace className="w-4 h-4" />
                          استبدال
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">مرجع التشكيل</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                    {TASHKEEL.map(t => (
                      <div key={t.code} className="flex flex-col items-center p-1.5 rounded border border-border bg-card text-center">
                        <span className="text-lg">ـ{t.char}</span>
                        <span className="text-[9px] text-muted-foreground">{t.name}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ═══════════════ PREVIEW TAB ═══════════════ */}
            <TabsContent value="preview" className="space-y-4">
              <div className="grid lg:grid-cols-[1fr_300px] gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Eye className="w-4 h-4 text-primary" />
                      معاينة النص — محاكاة محرك اللعبة
                    </CardTitle>
                    <p className="text-[10px] text-muted-foreground">يعرض النص باستخدام بيانات الأطلس المُولّد (كما يظهر داخل اللعبة)</p>
                  </CardHeader>
                  <CardContent>
                    {!atlasResult ? (
                      <div className="flex flex-col items-center py-16 text-center text-muted-foreground">
                        <Eye className="w-10 h-10 mb-3 opacity-30" />
                        <p className="text-sm">قم بتوليد الأطلس العربي أولاً من تبويب "توليد عربي"</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-lg border border-border overflow-hidden">
                          <canvas ref={previewCanvasRef} className="w-full block" style={{ maxHeight: 400 }} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">تكبير المعاينة: {previewScale.toFixed(1)}x</Label>
                            <Slider value={[previewScale]} onValueChange={v => setPreviewScale(v[0])} min={0.5} max={4} step={0.1} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">لون الخلفية</Label>
                            <Input type="color" value={previewBg} onChange={e => setPreviewBg(e.target.value)} className="w-10 h-8 cursor-pointer p-0.5" />
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">نص الاختبار</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <textarea
                      dir="rtl"
                      className="w-full h-40 rounded-md border bg-background p-2 text-sm font-arabic resize-none focus:ring-1 focus:ring-primary outline-none"
                      value={previewText}
                      onChange={e => setPreviewText(e.target.value)}
                      placeholder="اكتب نصاً عربياً هنا..."
                    />
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">نصوص جاهزة:</Label>
                      {[
                        "مرحباً بك في قصر لويجي!",
                        "لقد وجدت مفتاحاً ذهبياً!",
                        "احذر! هناك أشباح في الغرفة!",
                        "تم إنقاذ ماريو بنجاح!",
                      ].map((t, i) => (
                        <Button key={i} variant="ghost" size="sm" className="w-full text-xs justify-start h-7 text-right" onClick={() => setPreviewText(t)}>
                          {t}
                        </Button>
                      ))}
                    </div>
                    {atlasResult && (
                      <div className="text-[10px] text-muted-foreground space-y-0.5 p-2 rounded bg-muted/30">
                        <p>📐 حجم الخط: {atlasResult.fontSize}px</p>
                        <p>📏 ارتفاع السطر: {atlasResult.lineHeight}px</p>
                        <p>⬆ Ascent: {atlasResult.ascent}px</p>
                        <p>⬇ Descent: {atlasResult.descent}px</p>
                        <p>🔤 عدد الحروف: {atlasResult.glyphs.length}</p>
                        <p>📄 عدد الصفحات: {atlasResult.pages.length}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ═══════════════ BUILD TAB ═══════════════ */}
            <TabsContent value="build" className="space-y-4">
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      {hasArchive ? <Package className="w-4 h-4 text-primary" /> : <Download className="w-4 h-4 text-primary" />}
                      {hasArchive ? "بناء الأرشيف" : "بناء ملف الخط"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      {hasArchive
                        ? "يعيد بناء الأرشيف كاملاً (dict + data) مع الصفحات الجديدة ويحمّلهما كـ ZIP"
                        : "يعيد ترميز جميع صفحات الأطلس المعدّلة كـ DXT5 ويحفظها في ملف .data الأصلي"}
                    </p>
                    {hasArchive && generatedPages > 0 && (
                      <div className="p-2 rounded bg-primary/5 border border-primary/20 text-[10px]">
                        <p className="text-primary font-semibold">📦 سيتم إلحاق {generatedPages} صفحة DDS جديدة للأرشيف</p>
                        <p className="text-muted-foreground">عدد ملفات الأرشيف: {archiveFiles.length} → {archiveFiles.length + generatedPages}</p>
                      </div>
                    )}
                    <Button onClick={handleBuildFont} className="w-full gap-1.5" disabled={!fontData}>
                      {hasArchive ? <Package className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                      {hasArchive ? "بناء وتحميل ZIP (dict + data)" : "بناء وتحميل .data"}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileJson className="w-4 h-4 text-primary" />
                      تصدير بيانات الخط
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      يصدر بيانات الحروف (إحداثيات، أبعاد، تقدم) بتنسيق BMFont JSON
                    </p>
                    <Button onClick={handleExportMetrics} variant="secondary" className="w-full gap-1.5" disabled={!atlasResult}>
                      <FileJson className="w-4 h-4" />
                      تصدير font-metrics.json
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      📊 إحصائيات
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded bg-muted/30">
                        <p className="text-muted-foreground text-[10px]">صفحات أصلية</p>
                        <p className="text-lg font-bold">{originalPages}</p>
                      </div>
                      <div className="p-2 rounded bg-muted/30">
                        <p className="text-muted-foreground text-[10px]">صفحات مولّدة</p>
                        <p className="text-lg font-bold text-primary">{generatedPages}</p>
                      </div>
                      <div className="p-2 rounded bg-muted/30">
                        <p className="text-muted-foreground text-[10px]">حروف مكتشفة</p>
                        <p className="text-lg font-bold">{glyphs.length}</p>
                      </div>
                      <div className="p-2 rounded bg-muted/30">
                        <p className="text-muted-foreground text-[10px]">حروف عربية</p>
                        <p className="text-lg font-bold text-primary">{arabicGlyphCount}</p>
                      </div>
                    </div>
                    {hasArchive && (
                      <div className="p-2 rounded bg-muted/30">
                        <p className="text-muted-foreground text-[10px]">ملفات الأرشيف</p>
                        <p className="text-lg font-bold">{archiveFiles.length}</p>
                      </div>
                    )}
                    <div className="p-2 rounded bg-muted/30">
                      <p className="text-muted-foreground text-[10px]">حجم الملف</p>
                      <p className="text-sm font-mono">{fontData ? formatFileSize(fontData.length) : "—"}</p>
                    </div>
                    {atlasResult && (
                      <div className="p-2 rounded bg-primary/5 border border-primary/20">
                        <p className="text-[10px] text-primary font-semibold mb-1">بيانات الأطلس المولّد</p>
                        <p>الخط: {arabicFontName} — {atlasResult.fontSize}px</p>
                        <p>الخوارزمية: Shelf Bin-Packing</p>
                        <p>الدقة: {antiAlias ? "Anti-aliased" : "Pixel-perfect"}</p>
                        <p>المقاسات: bearingX/Y + advance لكل حرف</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>

    {/* ═══════════════ BUILD VERIFICATION DIALOG ═══════════════ */}
    {buildVerification?.show && (
      <Dialog open={buildVerification.show} onOpenChange={(open) => {
        if (!open) setBuildVerification(prev => prev ? { ...prev, show: false } : null);
      }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="w-5 h-5 text-primary" />
              تقرير التحقق بعد البناء
            </DialogTitle>
            <DialogDescription className="text-xs">
              مقارنة بيانات البكسل قبل وبعد إعادة الحزم (DXT5 encode → repack → decode)
            </DialogDescription>
          </DialogHeader>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-2 my-2">
            <div className="p-2 rounded bg-muted/40 text-center">
              <p className="text-[10px] text-muted-foreground">الصفحات</p>
              <p className="text-lg font-bold">{buildVerification.totalPages}</p>
            </div>
            <div className={`p-2 rounded text-center ${buildVerification.passedPages === buildVerification.totalPages ? 'bg-green-500/10' : 'bg-yellow-500/10'}`}>
              <p className="text-[10px] text-muted-foreground">سليمة</p>
              <p className={`text-lg font-bold ${buildVerification.passedPages === buildVerification.totalPages ? 'text-green-600' : 'text-yellow-600'}`}>
                {buildVerification.passedPages}/{buildVerification.totalPages}
              </p>
            </div>
            <div className="p-2 rounded bg-muted/40 text-center">
              <p className="text-[10px] text-muted-foreground">المدة</p>
              <p className="text-sm font-bold font-mono">{(buildVerification.duration / 1000).toFixed(1)}s</p>
            </div>
          </div>

          {/* Size comparison */}
          <div className="p-2 rounded bg-muted/30 text-[10px] space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">حجم .dict</span>
              <span className="font-mono">
                {formatFileSize(buildVerification.dictSizeBefore)} → {formatFileSize(buildVerification.dictSizeAfter)}
                {buildVerification.dictSizeAfter !== buildVerification.dictSizeBefore && (
                  <span className={buildVerification.dictSizeAfter > buildVerification.dictSizeBefore ? 'text-yellow-600 mr-1' : 'text-green-600 mr-1'}>
                    ({buildVerification.dictSizeAfter > buildVerification.dictSizeBefore ? '+' : ''}{formatFileSize(buildVerification.dictSizeAfter - buildVerification.dictSizeBefore)})
                  </span>
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">حجم .data</span>
              <span className="font-mono">
                {formatFileSize(buildVerification.dataSizeBefore)} → {formatFileSize(buildVerification.dataSizeAfter)}
                {buildVerification.dataSizeAfter !== buildVerification.dataSizeBefore && (
                  <span className={buildVerification.dataSizeAfter > buildVerification.dataSizeBefore ? 'text-yellow-600 mr-1' : 'text-green-600 mr-1'}>
                    ({buildVerification.dataSizeAfter > buildVerification.dataSizeBefore ? '+' : ''}{formatFileSize(buildVerification.dataSizeAfter - buildVerification.dataSizeBefore)})
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Per-page results */}
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-1.5">
              {buildVerification.results.map((r, i) => {
                const isLoss = r.pixelLoss > 5;
                const isWarning = r.pixelLoss > 0 && r.pixelLoss <= 5;
                const hashMismatch = !r.match && r.hashBefore !== 0;
                return (
                  <div key={i} className={`p-2 rounded border text-[10px] ${
                    isLoss ? 'border-destructive/40 bg-destructive/5' :
                    (hashMismatch || isWarning) ? 'border-yellow-500/40 bg-yellow-500/5' :
                    'border-border bg-card'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold flex items-center gap-1">
                        {isLoss ? <AlertTriangle className="w-3 h-3 text-destructive" /> :
                         hashMismatch ? <AlertTriangle className="w-3 h-3 text-yellow-500" /> :
                         <CheckCircle2 className="w-3 h-3 text-green-500" />}
                        {r.pageLabel}
                      </span>
                      <Badge variant={isLoss ? "destructive" : hashMismatch ? "secondary" : "outline"} className="text-[8px] h-4">
                        {isLoss ? `فقد ${r.pixelLoss.toFixed(1)}%` :
                         hashMismatch ? 'DXT5 تقريب' : '✓ مطابق'}
                      </Badge>
                    </div>
                    <div className="flex gap-4 mt-1 text-muted-foreground font-mono">
                      <span>بكسل قبل: {r.nonZeroBefore.toLocaleString()}</span>
                      <span>بعد: {r.nonZeroAfter.toLocaleString()}</span>
                      {r.hashBefore !== 0 && (
                        <span>Hash: {r.hashBefore.toString(16).slice(0, 6)}→{r.hashAfter.toString(16).slice(0, 6)}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Warning note about DXT5 */}
          {buildVerification.results.some(r => !r.match && r.hashBefore !== 0) && (
            <div className="p-2 rounded bg-yellow-500/10 border border-yellow-500/20 text-[10px] text-yellow-700 dark:text-yellow-400">
              <p className="font-semibold">⚠️ اختلاف Hash متوقع</p>
              <p>ضغط DXT5 يفقد بعض التفاصيل اللونية (Lossy compression). الاختلاف طبيعي ما لم تكن نسبة فقد البكسل عالية (&gt;5%).</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setBuildVerification(prev => prev ? { ...prev, show: false } : null)}>
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}
