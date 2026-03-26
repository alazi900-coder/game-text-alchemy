import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
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
  Archive, FolderOpen, FileText, HardDrive, Package, ShieldCheck, AlertTriangle,
  CheckCircle2, BookOpen, Hash
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
import {
  parseNLGFontDef, serializeNLGFontDef, findFontDefInData,
  generateArabicGlyphEntries, mergeArabicIntoFontDef,
  type NLGFontDef, type NLGGlyphEntry
} from "@/lib/nlg-font-def";
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
  archiveFileIndex?: number;
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

  // Font definition (character table)
  const [fontDefData, setFontDefData] = useState<NLGFontDef | null>(null);
  const [fontDefOffset, setFontDefOffset] = useState(0);
  const [fontDefLength, setFontDefLength] = useState(0);
  const [fontDefSearch, setFontDefSearch] = useState("");

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

  // Atlas result
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
      pixelLoss: number;
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

    const width = Math.min(700, window.innerWidth - 40);
    const height = 250;
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

    renderTextPreview(ctx, previewText, atlasResult, width - 20, 60, previewScale, true);
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

  /* ─── File loading ─── */
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

        const fontDefResult = findFontDefInData(data);
        if (fontDefResult) {
          const parsedFontDef = parseNLGFontDef(fontDefResult.text);
          setFontDefData(parsedFontDef);
          setFontDefOffset(fontDefResult.offset);
          setFontDefLength(fontDefResult.length);
          console.log(`Font def found: "${parsedFontDef.header.fontName}" with ${parsedFontDef.glyphs.length} glyphs on ${parsedFontDef.header.pageCount} pages`);
        } else {
          setFontDefData(null);
          console.warn("No font definition found in data file");
        }

        setTextures(newTextures);
        setCurrentPage(0);
        setAtlasResult(null);
        toast({
          title: "✅ تم تحميل الأرشيف",
          description: `${info.fileCount} ملف — ${newTextures.length} صفحة DDS${fontDefResult ? ` — ${parseNLGFontDef(fontDefResult.text).glyphs.length} حرف` : ''} — ${formatFileSize(data.length)}`,
        });
      } catch (err: any) {
        console.error("NLG parse error:", err);
        toast({ title: "خطأ في قراءة الأرشيف", description: err.message, variant: "destructive" });
        loadDirectDDS(data);
      }
    } else {
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

  /* ─── Auto-detect glyphs ─── */
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
    toast({ title: "🔍 كشف تلقائي", description: `تم كشف ${detected.length} حرف` });
  };

  /* ─── Generate Arabic Atlas ─── */
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
      newTextures.push({ canvas: page.canvas, ctx: page.ctx, imgData, ddsOffset: -1, isGenerated: true });
    }
    for (const gm of result.glyphs) {
      if (gm.width === 0) continue;
      newGlyphs.push({ char: gm.char, code: gm.code, x: gm.atlasX, y: gm.atlasY, w: gm.width, h: gm.height, page: startPage + gm.page, advance: gm.advance });
    }
    setTextures(newTextures);
    setGlyphs(newGlyphs);
    setCurrentPage(startPage);
    toast({ title: "✅ تم توليد الأطلس العربي", description: `${result.glyphs.length} حرف على ${result.pages.length} صفحة` });
  };

  /* ─── Replace existing page ─── */
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
      newGlyphs.push({ char: gm.char, code: gm.code, x: gm.atlasX, y: gm.atlasY, w: gm.width, h: gm.height, page: targetReplacePage, advance: gm.advance });
    }
    setGlyphs(newGlyphs);
    setTextures([...baseTextures]);
    setCurrentPage(targetReplacePage);
    toast({ title: "✅ تم الاستبدال" });
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
      toast({ title: "✅ تم تحميل الخط", description: file.name });
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
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      presetFontObjectUrlsRef.current.push(objectUrl);
      const fontFace = new FontFace(preset.family, `url(${objectUrl}) format('${preset.format}')`);
      const loaded = await fontFace.load();
      document.fonts.add(loaded);
      await document.fonts.ready;
      setArabicFontName(preset.family);
      setCustomFontLoaded(true);
      toast({ title: "✅ تم تحميل الخط تلقائياً", description: `${preset.label} جاهز` });
    } catch (err: any) {
      toast({ title: "خطأ في التحميل", description: err.message, variant: "destructive" });
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
      await buildWithArchive();
    } else {
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

    const preBuildSnapshots = new Map<number, { hash: number; nonZero: number; label: string }>();
    for (let i = 0; i < textures.length; i++) {
      const tex = textures[i];
      const rgba = tex.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
      const label = tex.isGenerated ? `صفحة عربية جديدة ${i}` : tex.archiveFileIndex !== undefined ? `ملف أرشيف ${tex.archiveFileIndex}` : `صفحة ${i}`;
      preBuildSnapshots.set(i, { hash: computePixelHash(rgba), nonZero: countNonZeroPixels(rgba), label });
    }

    const updatedFiles = [...archiveFiles];
    const ddsTemplate = archiveFiles.find(f => detectFileType(f.data) === "DDS");
    const templateUnk = ddsTemplate?.originalEntry.unk ?? 0;
    const templateCompressionMode = ddsTemplate?.compressionMode ?? (archiveInfo.isCompressed ? "zlib" : "none");

    const texByArchiveIdx = new Map<number, TextureInfo>();
    for (const tex of textures) {
      if (tex.archiveFileIndex !== undefined && !tex.isGenerated) {
        texByArchiveIdx.set(tex.archiveFileIndex, tex);
      }
    }

    for (let i = 0; i < updatedFiles.length; i++) {
      const tex = texByArchiveIdx.get(updatedFiles[i].index);
      if (tex) {
        const rgba = tex.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
        const dxt5 = encodeDXT5(new Uint8Array(rgba), TEX_SIZE, TEX_SIZE);
        const header = buildDDSHeader(TEX_SIZE, TEX_SIZE);
        const newDDS = new Uint8Array(header.length + dxt5.length);
        newDDS.set(header, 0);
        newDDS.set(dxt5, header.length);
        updatedFiles[i] = { ...updatedFiles[i], data: newDDS, wasCompressed: updatedFiles[i].wasCompressed };
      }
    }

    const generatedTextures = replaceMode === "append" ? textures.filter(t => t.isGenerated) : [];

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
        originalEntry: { index: newIndex, offset: 0, decompressedLength: newDDS.length, compressedLength: newDDS.length, unk: templateUnk },
      });
    }

    // Inject Arabic glyph entries into font definition
    if (fontDefData && atlasResult && fontData) {
      const fontDefFileIdx = updatedFiles.findIndex(f => {
        const type = detectFileType(f.data);
        return type === "text" || (type !== "DDS" && f.data.length > 100 && f.data.length < 100000);
      });
      if (fontDefFileIdx >= 0) {
        const existingDDSCount = updatedFiles.filter(f => detectFileType(f.data) === "DDS").length - generatedTextures.length;
        const basePageIdx = existingDDSCount;
        const arabicEntries = generateArabicGlyphEntries(atlasResult.glyphs, basePageIdx, fontDefData.header.renderHeight);
        const totalPages = existingDDSCount + generatedTextures.length;
        const mergedFontDef = mergeArabicIntoFontDef(fontDefData, arabicEntries, totalPages);
        const newFontDefText = serializeNLGFontDef(mergedFontDef);
        const newFontDefBytes = new TextEncoder().encode(newFontDefText);
        const padded = new Uint8Array(Math.ceil(newFontDefBytes.length / 16) * 16);
        padded.set(newFontDefBytes);
        updatedFiles[fontDefFileIdx] = { ...updatedFiles[fontDefFileIdx], data: padded };
        console.log(`Font def updated: ${mergedFontDef.glyphs.length} glyphs (${arabicEntries.length} Arabic) on ${totalPages} pages`);
      }
    }

    const { dict: newDict, data: newData } = repackNLGArchive(archiveInfo, updatedFiles);
    const newArchiveInfo = parseNLGDict(newDict);
    const newArchiveFiles = extractNLGFiles(newArchiveInfo, newData);
    const newTextures = decodeArchiveTextures(newArchiveFiles);

    const verificationResults: Array<{
      pageLabel: string; hashBefore: number; hashAfter: number; match: boolean;
      nonZeroBefore: number; nonZeroAfter: number; pixelLoss: number;
    }> = [];

    for (let i = 0; i < newTextures.length; i++) {
      const afterRgba = newTextures[i].ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
      const hashAfter = computePixelHash(afterRgba);
      const nonZeroAfter = countNonZeroPixels(afterRgba);
      const before = preBuildSnapshots.get(i);
      if (before) {
        const pixelLoss = before.nonZero > 0 ? Math.max(0, (1 - nonZeroAfter / before.nonZero) * 100) : 0;
        verificationResults.push({ pageLabel: before.label, hashBefore: before.hash, hashAfter, match: before.hash === hashAfter, nonZeroBefore: before.nonZero, nonZeroAfter, pixelLoss });
      } else {
        verificationResults.push({ pageLabel: `صفحة جديدة ${i}`, hashBefore: 0, hashAfter, match: true, nonZeroBefore: 0, nonZeroAfter, pixelLoss: 0 });
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

    // Update font def after rebuild
    const newFontDefResult = findFontDefInData(newData);
    if (newFontDefResult) {
      setFontDefData(parseNLGFontDef(newFontDefResult.text));
      setFontDefOffset(newFontDefResult.offset);
      setFontDefLength(newFontDefResult.length);
    }

    setBuildVerification({
      show: true, results: verificationResults, totalPages: verificationResults.length,
      passedPages, newPages: generatedTextures.length,
      dictSizeBefore, dictSizeAfter: newDict.length, dataSizeBefore, dataSizeAfter: newData.length,
      duration: buildDuration,
    });

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

    toast({ title: "✅ تم بناء الأرشيف", description: `${updatedFiles.length} ملف — تحقق: ${passedPages}/${verificationResults.length} سليمة` });
  };

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
  };

  const handleExportPNG = (pageIdx: number) => {
    const tex = textures[pageIdx];
    if (!tex) return;
    const url = tex.canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas_page_${pageIdx}.png`;
    a.click();
  };

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

  // Font def filtered glyphs
  const filteredFontDefGlyphs = useMemo(() => {
    if (!fontDefData) return [];
    if (!fontDefSearch) return fontDefData.glyphs;
    const s = fontDefSearch.toLowerCase();
    return fontDefData.glyphs.filter(g => {
      const charFromCode = String.fromCodePoint(g.code);
      return g.charSpec.includes(s) || g.code.toString(16).includes(s) || charFromCode.includes(s);
    });
  }, [fontDefData, fontDefSearch]);

  const arabicGlyphCount = glyphs.filter(g => g.code >= 0x0600).length;
  const originalPages = textures.filter(t => !t.isGenerated).length;
  const generatedPages = textures.filter(t => t.isGenerated).length;

  // Helper to get char display from font def glyph
  const getGlyphChar = (g: NLGGlyphEntry) => {
    try {
      return String.fromCodePoint(g.code);
    } catch {
      return g.charSpec;
    }
  };

  const getUnicodeRange = (code: number) => {
    if (code >= 0x0600 && code <= 0x06FF) return "عربي";
    if (code >= 0xFB50 && code <= 0xFDFF) return "عرض-أ";
    if (code >= 0xFE70 && code <= 0xFEFF) return "عرض-ب";
    if (code >= 0x0020 && code <= 0x007E) return "لاتيني";
    if (code >= 0x00A0 && code <= 0x00FF) return "لاتيني+";
    return "أخرى";
  };

  return (
    <>
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header — compact mobile */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur px-3 py-2.5">
        <div className="max-w-[1600px] mx-auto flex items-center gap-2 flex-wrap">
          <Link to="/luigis-mansion" className="text-muted-foreground hover:text-foreground text-xs flex items-center gap-1 shrink-0">
            <ArrowRight className="w-3.5 h-3.5" />
            العودة
          </Link>
          <h1 className="text-sm sm:text-base font-bold text-foreground flex items-center gap-1.5">
            <Type className="w-4 h-4 text-primary" />
            محرر الخطوط
          </h1>
          <div className="flex items-center gap-1.5 mr-auto flex-wrap">
            {hasArchive && <Badge className="text-[9px] sm:text-[10px] bg-primary/20 text-primary border-primary/30 px-1.5 py-0">📦 أرشيف</Badge>}
            {fontDefData && <Badge variant="secondary" className="text-[9px] sm:text-[10px] px-1.5 py-0">{fontDefData.glyphs.length} حرف</Badge>}
            {fontData && (
              <Badge variant="outline" className="text-[9px] sm:text-[10px] px-1.5 py-0">
                {formatFileSize(fontData.length)}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-3 sm:p-4 space-y-3 sm:space-y-4">
        {/* Upload area */}
        {textures.length === 0 && (
          <Card className="border-dashed border-2 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fontInputRef.current?.click()}>
            <CardContent className="flex flex-col items-center justify-center py-12 sm:py-20 text-center px-4">
              <Upload className="w-12 h-12 sm:w-16 sm:h-16 text-muted-foreground mb-3" />
              <p className="text-base sm:text-xl font-bold text-foreground">ارفع ملفات الخط</p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-2">FEBundleFonts_res.dict + FEBundleFonts_res.data</p>
              <p className="text-[10px] text-muted-foreground mt-1">ارفع الملفين معاً لدعم الأرشيف الكامل</p>
              <div className="flex gap-2 mt-3 flex-wrap justify-center">
                <Badge variant="outline" className="text-[9px]">
                  <Archive className="w-3 h-3 ml-1" />
                  .dict + .data
                </Badge>
                <Badge variant="outline" className="text-[9px]">
                  <HardDrive className="w-3 h-3 ml-1" />
                  .data فقط
                </Badge>
              </div>
              <input ref={fontInputRef} type="file" multiple accept=".data,.dict" className="hidden" onChange={e => handleFontFiles(e.target.files)} />
            </CardContent>
          </Card>
        )}

        {textures.length > 0 && (
          <Tabs defaultValue={fontDefData ? "fontdef" : hasArchive ? "archive" : "atlas"} className="space-y-3">
            <div className="overflow-x-auto -mx-3 px-3 pb-1">
              <TabsList className="inline-flex h-9 w-auto min-w-full sm:w-full sm:grid sm:grid-cols-6 gap-0.5">
                {hasArchive && (
                  <TabsTrigger value="archive" className="gap-1 text-[10px] sm:text-xs px-2 sm:px-3 py-1.5 whitespace-nowrap">
                    <Archive className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    الأرشيف
                  </TabsTrigger>
                )}
                {fontDefData && (
                  <TabsTrigger value="fontdef" className="gap-1 text-[10px] sm:text-xs px-2 sm:px-3 py-1.5 whitespace-nowrap">
                    <BookOpen className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    جدول الخط
                  </TabsTrigger>
                )}
                <TabsTrigger value="atlas" className="gap-1 text-[10px] sm:text-xs px-2 sm:px-3 py-1.5 whitespace-nowrap">
                  <Layers className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  الأطلس
                </TabsTrigger>
                <TabsTrigger value="generate" className="gap-1 text-[10px] sm:text-xs px-2 sm:px-3 py-1.5 whitespace-nowrap">
                  <Paintbrush className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  توليد عربي
                </TabsTrigger>
                <TabsTrigger value="preview" className="gap-1 text-[10px] sm:text-xs px-2 sm:px-3 py-1.5 whitespace-nowrap">
                  <Eye className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  معاينة
                </TabsTrigger>
                <TabsTrigger value="build" className="gap-1 text-[10px] sm:text-xs px-2 sm:px-3 py-1.5 whitespace-nowrap">
                  <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  البناء
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ═══════════════ FONT DEF TABLE TAB ═══════════════ */}
            {fontDefData && (
              <TabsContent value="fontdef" className="space-y-3">
                {/* Header info cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Card className="p-2.5">
                    <p className="text-[9px] text-muted-foreground">اسم الخط</p>
                    <p className="text-sm font-bold text-foreground truncate">{fontDefData.header.fontName}</p>
                  </Card>
                  <Card className="p-2.5">
                    <p className="text-[9px] text-muted-foreground">الحجم</p>
                    <p className="text-lg font-bold text-primary">{fontDefData.header.fontSize}px</p>
                  </Card>
                  <Card className="p-2.5">
                    <p className="text-[9px] text-muted-foreground">عدد الحروف</p>
                    <p className="text-lg font-bold text-foreground">{fontDefData.glyphs.length}</p>
                  </Card>
                  <Card className="p-2.5">
                    <p className="text-[9px] text-muted-foreground">الصفحات</p>
                    <p className="text-lg font-bold text-foreground">{fontDefData.header.pageCount}</p>
                  </Card>
                </div>

                {/* Font metrics details */}
                <Card>
                  <CardHeader className="pb-2 px-3 pt-3">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <Settings2 className="w-3.5 h-3.5 text-primary" />
                      خصائص الخط
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                      {[
                        { label: "Height", value: fontDefData.header.height },
                        { label: "RenderHeight", value: fontDefData.header.renderHeight },
                        { label: "Ascent", value: fontDefData.header.ascent },
                        { label: "RenderAscent", value: fontDefData.header.renderAscent },
                        { label: "IL", value: fontDefData.header.il },
                        { label: "CharSpacing", value: fontDefData.header.charSpacing },
                        { label: "LineHeight", value: fontDefData.header.lineHeight },
                        { label: "PageSize", value: fontDefData.header.pageSize },
                      ].map(item => (
                        <div key={item.label} className="flex justify-between p-1.5 rounded bg-muted/30">
                          <span className="text-muted-foreground font-mono">{item.label}</span>
                          <span className="font-bold font-mono">{item.value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-2 text-[10px]">
                      <Badge variant="outline" className="text-[9px]">
                        Color: RGB({fontDefData.header.colorR}, {fontDefData.header.colorG}, {fontDefData.header.colorB})
                      </Badge>
                      <Badge variant="outline" className="text-[9px]">
                        {fontDefData.header.distribution}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                {/* Glyph grid & search */}
                <Card>
                  <CardHeader className="pb-2 px-3 pt-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <CardTitle className="text-xs flex items-center gap-1.5">
                        <Hash className="w-3.5 h-3.5 text-primary" />
                        جدول الحروف المحلل ({fontDefData.glyphs.length})
                      </CardTitle>
                      <div className="relative">
                        <Search className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="بحث بالحرف أو الكود..."
                          className="pr-7 w-32 sm:w-40 h-7 text-[10px]"
                          value={fontDefSearch}
                          onChange={e => setFontDefSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    {/* Unicode range summary */}
                    <div className="flex gap-1.5 flex-wrap mt-1.5">
                      {(() => {
                        const ranges: Record<string, number> = {};
                        for (const g of fontDefData.glyphs) {
                          const r = getUnicodeRange(g.code);
                          ranges[r] = (ranges[r] || 0) + 1;
                        }
                        return Object.entries(ranges).map(([name, count]) => (
                          <Badge key={name} variant="secondary" className="text-[8px] px-1.5 py-0 h-4">
                            {name}: {count}
                          </Badge>
                        ));
                      })()}
                    </div>
                  </CardHeader>
                  <CardContent className="px-0 pb-0">
                    {/* Glyph visual grid — mobile friendly */}
                    <ScrollArea className="h-[400px] sm:h-[500px]">
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-1 px-3 pb-3">
                        {filteredFontDefGlyphs.slice(0, 500).map((g, idx) => {
                          const ch = getGlyphChar(g);
                          const isArabic = g.code >= 0x0600;
                          return (
                            <div
                              key={`${g.code}-${idx}`}
                              className={`flex flex-col items-center p-1.5 rounded border transition-colors cursor-pointer hover:border-primary/50 ${
                                isArabic ? 'border-primary/20 bg-primary/5' : 'border-border bg-card'
                              }`}
                              onClick={() => {
                                setCurrentPage(g.page);
                                // Switch to atlas tab to show the page
                              }}
                            >
                              <span className="text-base sm:text-lg leading-tight" dir={isArabic ? "rtl" : "ltr"}>
                                {ch}
                              </span>
                              <span className="text-[7px] sm:text-[8px] text-muted-foreground font-mono mt-0.5">
                                {g.code.toString(16).toUpperCase().padStart(4, "0")}
                              </span>
                              <div className="text-[6px] sm:text-[7px] text-muted-foreground/70 font-mono">
                                {g.width}×{g.x2 - g.x1}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {filteredFontDefGlyphs.length > 500 && (
                        <p className="text-center text-[10px] text-muted-foreground pb-3">
                          يعرض أول 500 من {filteredFontDefGlyphs.length} حرف
                        </p>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>

                {/* Detailed table view — collapsible on mobile */}
                <Card>
                  <CardHeader className="pb-2 px-3 pt-3">
                    <CardTitle className="text-xs">عرض تفصيلي</CardTitle>
                  </CardHeader>
                  <CardContent className="px-0 pb-0">
                    <ScrollArea className="h-[300px] sm:h-[400px]">
                      <div className="min-w-[500px]">
                        <div className="grid grid-cols-[40px_50px_60px_50px_50px_50px_80px_40px] gap-0.5 px-3 py-1.5 bg-muted/40 text-[9px] text-muted-foreground font-semibold sticky top-0">
                          <span>حرف</span>
                          <span>كود</span>
                          <span>Spec</span>
                          <span>Width</span>
                          <span>RW</span>
                          <span>XOff</span>
                          <span>موقع</span>
                          <span>صفحة</span>
                        </div>
                        {filteredFontDefGlyphs.slice(0, 300).map((g, idx) => {
                          const ch = getGlyphChar(g);
                          const isArabic = g.code >= 0x0600;
                          return (
                            <div
                              key={`detail-${g.code}-${idx}`}
                              className={`grid grid-cols-[40px_50px_60px_50px_50px_50px_80px_40px] gap-0.5 px-3 py-1 text-[9px] border-b border-border/50 hover:bg-muted/30 ${
                                isArabic ? 'bg-primary/5' : ''
                              }`}
                            >
                              <span className="text-sm font-bold" dir={isArabic ? "rtl" : "ltr"}>{ch}</span>
                              <span className="font-mono text-muted-foreground">{g.code.toString(16).toUpperCase().padStart(4, "0")}</span>
                              <span className="font-mono text-muted-foreground truncate">{g.charSpec}</span>
                              <span className="font-mono">{g.width}</span>
                              <span className="font-mono">{g.renderWidth}</span>
                              <span className="font-mono">{g.xOffset}</span>
                              <span className="font-mono text-muted-foreground">{g.x1},{g.y1}→{g.x2},{g.y2}</span>
                              <span className="font-mono">{g.page}</span>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {/* ═══════════════ ARCHIVE TAB ═══════════════ */}
            {hasArchive && archiveInfo && (
              <TabsContent value="archive" className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Card className="p-2.5">
                    <p className="text-[9px] text-muted-foreground">عدد الملفات</p>
                    <p className="text-xl font-bold text-foreground">{archiveInfo.fileCount}</p>
                  </Card>
                  <Card className="p-2.5">
                    <p className="text-[9px] text-muted-foreground">صفحات DDS</p>
                    <p className="text-xl font-bold text-primary">{textures.filter(t => !t.isGenerated).length}</p>
                  </Card>
                  <Card className="p-2.5">
                    <p className="text-[9px] text-muted-foreground">مضغوط</p>
                    <p className="text-xl font-bold">{archiveInfo.isCompressed ? "نعم" : "لا"}</p>
                  </Card>
                  <Card className="p-2.5">
                    <p className="text-[9px] text-muted-foreground">حجم .data</p>
                    <p className="text-sm font-bold font-mono">{formatFileSize(fontData?.length ?? 0)}</p>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="pb-2 px-3 pt-3">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <FolderOpen className="w-3.5 h-3.5 text-primary" />
                      ملفات الأرشيف
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-0 pb-0">
                    <ScrollArea className="max-h-[400px]">
                      <div className="space-y-0.5">
                        {archiveFiles.map(file => {
                          const type = detectFileType(file.data);
                          const entry = file.originalEntry;
                          const isDDS = type === "DDS";
                          return (
                            <div key={file.index} className={`flex items-center gap-2 px-3 py-1.5 text-[10px] ${isDDS ? "bg-primary/5" : ""}`}>
                              <span className="font-mono text-muted-foreground w-7">{String(file.index).padStart(3, "0")}</span>
                              <Badge variant={isDDS ? "default" : "secondary"} className="text-[8px] h-4 px-1.5">
                                {type}
                              </Badge>
                              <span className="font-mono text-muted-foreground text-[9px]">
                                {formatFileSize(entry.decompressedLength)}
                              </span>
                              <span className="mr-auto" />
                              <Button variant="ghost" size="sm" className="h-5 text-[9px] gap-0.5 px-1.5"
                                onClick={() => handleExportArchiveFile(file)}>
                                <Download className="w-2.5 h-2.5" />
                                استخراج
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {/* ═══════════════ ATLAS TAB ═══════════════ */}
            <TabsContent value="atlas" className="space-y-3">
              <div className="grid lg:grid-cols-[1fr_320px] gap-3">
                {/* Atlas Viewer */}
                <Card>
                  <CardHeader className="pb-2 px-3 pt-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-xs flex items-center gap-1.5">
                        <Grid3x3 className="w-3.5 h-3.5 text-primary" />
                        عارض الأطلس
                      </CardTitle>
                      <div className="flex items-center gap-1.5">
                        <Select value={String(currentPage)} onValueChange={v => setCurrentPage(Number(v))}>
                          <SelectTrigger className="w-28 sm:w-40 h-7 text-[10px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {textures.map((t, i) => (
                              <SelectItem key={i} value={String(i)}>
                                صفحة {i} {t.isGenerated ? "🇸🇦" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-0.5 bg-muted rounded p-0.5">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setZoom(z => Math.max(0.25, z / 1.25))}>
                            <ZoomOut className="w-3 h-3" />
                          </Button>
                          <span className="text-[9px] text-muted-foreground w-7 text-center font-mono">{Math.round(zoom * 100)}%</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setZoom(z => Math.min(4, z * 1.25))}>
                            <ZoomIn className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-3 pb-3">
                    <ScrollArea className="max-h-[50vh] sm:max-h-[600px] rounded-lg border border-border bg-black">
                      <canvas ref={displayCanvasRef} className="block cursor-crosshair" style={{ imageRendering: zoom >= 2 ? "pixelated" : "auto" }} />
                    </ScrollArea>
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      <Button size="sm" variant="secondary" onClick={autoDetectGlyphs} className="gap-1 text-[10px] h-7">
                        <ScanSearch className="w-3 h-3" />
                        كشف تلقائي
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleExportPNG(currentPage)} className="gap-1 text-[10px] h-7">
                        <Download className="w-3 h-3" />
                        PNG
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => fontInputRef.current?.click()} className="gap-1 text-[10px] h-7">
                        <Upload className="w-3 h-3" />
                        ملف آخر
                      </Button>
                      <input ref={fontInputRef} type="file" multiple accept=".data,.dict" className="hidden" onChange={e => handleFontFiles(e.target.files)} />
                    </div>
                  </CardContent>
                </Card>

                {/* Glyph Table */}
                <Card>
                  <CardHeader className="pb-2 px-3 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-xs">الحروف ({glyphs.length})</CardTitle>
                      <div className="relative">
                        <Search className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input placeholder="بحث..." className="pr-7 w-28 sm:w-36 h-7 text-[10px]" value={glyphSearch} onChange={e => setGlyphSearch(e.target.value)} />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-0 pb-0">
                    <ScrollArea className="h-[350px] sm:h-[550px]">
                      <div className="space-y-0">
                        {filteredGlyphs.slice(0, 300).map((g, idx) => {
                          const realIdx = glyphs.indexOf(g);
                          return (
                            <div
                              key={idx}
                              className={`flex items-center gap-2 px-3 py-1 text-[10px] cursor-pointer border-b border-border/30 transition-colors ${highlightedGlyph === realIdx ? "bg-primary/10" : "hover:bg-muted/50"}`}
                              onClick={() => { setCurrentPage(g.page); setHighlightedGlyph(realIdx); }}
                            >
                              <span className="text-base font-bold w-6 text-center">{g.char === "?" ? "❓" : g.char}</span>
                              <span className="font-mono text-muted-foreground">{g.code.toString(16).toUpperCase().padStart(4, "0")}</span>
                              <span className="text-muted-foreground">{g.w}×{g.h}</span>
                              <span className="text-muted-foreground">ص{g.page}</span>
                              <span className="mr-auto" />
                              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={e => { e.stopPropagation(); setEditingGlyphIdx(realIdx); }}>
                                <Pencil className="w-2.5 h-2.5 text-primary" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={e => { e.stopPropagation(); deleteGlyph(realIdx); }}>
                                <Trash2 className="w-2.5 h-2.5 text-destructive" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>

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
            <TabsContent value="generate" className="space-y-3">
              <div className="grid lg:grid-cols-2 gap-3">
                {/* Font Settings */}
                <Card>
                  <CardHeader className="pb-2 px-3 pt-3">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <Settings2 className="w-3.5 h-3.5 text-primary" />
                      إعدادات الخط العربي
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 px-3 pb-3">
                    <div className="space-y-1.5">
                      <Label className="text-[10px]">ملف الخط (TTF/OTF/WOFF2)</Label>
                      <Input ref={customFontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleCustomFont} className="h-7 text-[10px]" />
                      {customFontLoaded && <Badge variant="secondary" className="text-[9px]">✅ {arabicFontName}</Badge>}
                      <div className="grid grid-cols-[1fr_auto] gap-1.5 mt-1.5">
                        <Select value={presetFontId} onValueChange={setPresetFontId}>
                          <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ARABIC_PRESET_FONTS.map(font => (
                              <SelectItem key={font.id} value={font.id}>{font.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant="secondary" size="sm" className="h-7 gap-1 text-[10px]" onClick={handleDownloadPresetFont} disabled={isDownloadingPresetFont}>
                          {isDownloadingPresetFont ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                          تحميل
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px]">الحجم: {fontSize}px</Label>
                        <Slider value={[fontSize]} onValueChange={v => setFontSize(v[0])} min={16} max={120} step={1} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">الوزن</Label>
                        <Select value={fontWeight} onValueChange={setFontWeight}>
                          <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="300">خفيف</SelectItem>
                            <SelectItem value="400">عادي</SelectItem>
                            <SelectItem value="500">متوسط</SelectItem>
                            <SelectItem value="600">شبه عريض</SelectItem>
                            <SelectItem value="700">عريض</SelectItem>
                            <SelectItem value="900">أسود</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] flex items-center gap-1">
                          <Palette className="w-3 h-3" />
                          اللون
                        </Label>
                        <div className="flex gap-1.5 items-center">
                          <Input type="color" value={fontColor} onChange={e => setFontColor(e.target.value)} className="w-8 h-7 cursor-pointer p-0.5" />
                          <span className="text-[9px] font-mono text-muted-foreground">{fontColor}</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">حدود: {strokeWidth}px</Label>
                        <Slider value={[strokeWidth]} onValueChange={v => setStrokeWidth(v[0])} min={0} max={6} step={0.5} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px]">هامش: {padding}px</Label>
                        <Slider value={[padding]} onValueChange={v => setPadding(v[0])} min={0} max={10} step={1} />
                      </div>
                      <div className="flex items-center gap-1.5 pt-4">
                        <Switch checked={antiAlias} onCheckedChange={setAntiAlias} id="aa" />
                        <Label htmlFor="aa" className="text-[10px] cursor-pointer">Anti-alias</Label>
                      </div>
                    </div>

                    <Button variant="ghost" size="sm" className="w-full gap-1 text-[10px] text-muted-foreground h-7" onClick={() => setShowAdvanced(!showAdvanced)}>
                      {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      متقدم
                    </Button>
                    {showAdvanced && (
                      <div className="space-y-2 p-2 rounded bg-muted/30 border border-border">
                        <Label className="text-[10px]">وضع الإدراج</Label>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant={replaceMode === "append" ? "default" : "outline"} className="flex-1 text-[10px] h-7" onClick={() => setReplaceMode("append")}>
                            إلحاق
                          </Button>
                          <Button size="sm" variant={replaceMode === "replace" ? "default" : "outline"} className="flex-1 text-[10px] h-7" onClick={() => setReplaceMode("replace")}>
                            استبدال
                          </Button>
                        </div>
                        {replaceMode === "replace" && (
                          <Select value={String(targetReplacePage)} onValueChange={v => setTargetReplacePage(Number(v))}>
                            <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {textures.filter(t => !t.isGenerated).map((_, i) => (
                                <SelectItem key={i} value={String(i)}>صفحة {i}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Character Selection */}
                <Card>
                  <CardHeader className="pb-2 px-3 pt-3">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <Type className="w-3.5 h-3.5 text-primary" />
                      اختيار الأحرف
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 px-3 pb-3">
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: "معزول", checked: includeIsolated, set: setIncludeIsolated },
                        { label: "بداية", checked: includeInitial, set: setIncludeInitial },
                        { label: "وسط", checked: includeMedial, set: setIncludeMedial },
                        { label: "نهاية", checked: includeFinal, set: setIncludeFinal },
                        { label: "تشكيل", checked: includeTashkeel, set: setIncludeTashkeel },
                        { label: "إنجليزي", checked: includeEnglish, set: setIncludeEnglish },
                      ].map(f => (
                        <div key={f.label} className="flex items-center gap-1">
                          <Checkbox checked={f.checked} onCheckedChange={v => f.set(!!v)} id={`gen-${f.label}`} className="h-3.5 w-3.5" />
                          <Label htmlFor={`gen-${f.label}`} className="text-[10px] cursor-pointer">{f.label}</Label>
                        </div>
                      ))}
                    </div>

                    <ScrollArea className="h-[200px] sm:h-[280px] rounded border bg-card p-1.5">
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-0.5">
                        {arabicChars.map(c => (
                          <div key={c.code} className="flex flex-col items-center p-1 rounded border border-border bg-background text-center hover:border-primary/40 transition-colors">
                            <span className="text-xs sm:text-sm leading-tight" dir="rtl">
                              {c.code >= 0x064B && c.code <= 0x0652 ? `ـ${c.char}` : c.char}
                            </span>
                            <span className="text-[6px] sm:text-[8px] text-muted-foreground font-mono">{c.code.toString(16).toUpperCase()}</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    <div className="flex gap-1.5 flex-wrap">
                      <Badge variant="secondary" className="text-[8px]">{arabicChars.length} حرف</Badge>
                    </div>

                    <div className="flex gap-1.5">
                      <Button onClick={handleGenerateArabicAtlas} disabled={arabicChars.length === 0} className="flex-1 gap-1 text-xs h-8">
                        <Paintbrush className="w-3.5 h-3.5" />
                        توليد ({arabicChars.length})
                      </Button>
                      {replaceMode === "replace" && atlasResult && (
                        <Button onClick={handleReplaceOnPage} variant="secondary" className="gap-1 text-xs h-8">
                          <Replace className="w-3.5 h-3.5" />
                          استبدال
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Tashkeel reference */}
              <Card>
                <CardHeader className="pb-1.5 px-3 pt-2.5">
                  <CardTitle className="text-[10px] text-muted-foreground">مرجع التشكيل</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-2.5">
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
                    {TASHKEEL.map(t => (
                      <div key={t.code} className="flex flex-col items-center p-1 rounded border border-border bg-card text-center">
                        <span className="text-sm sm:text-base">ـ{t.char}</span>
                        <span className="text-[7px] sm:text-[9px] text-muted-foreground">{t.name}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ═══════════════ PREVIEW TAB ═══════════════ */}
            <TabsContent value="preview" className="space-y-3">
              <div className="grid lg:grid-cols-[1fr_280px] gap-3">
                <Card>
                  <CardHeader className="pb-2 px-3 pt-3">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-primary" />
                      معاينة — محاكاة محرك اللعبة
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3">
                    {!atlasResult ? (
                      <div className="flex flex-col items-center py-12 text-center text-muted-foreground">
                        <Eye className="w-8 h-8 mb-2 opacity-30" />
                        <p className="text-xs">ولّد الأطلس العربي أولاً</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="rounded border border-border overflow-hidden">
                          <canvas ref={previewCanvasRef} className="w-full block" style={{ maxHeight: 300 }} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[10px]">تكبير: {previewScale.toFixed(1)}x</Label>
                            <Slider value={[previewScale]} onValueChange={v => setPreviewScale(v[0])} min={0.5} max={4} step={0.1} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px]">الخلفية</Label>
                            <Input type="color" value={previewBg} onChange={e => setPreviewBg(e.target.value)} className="w-8 h-7 cursor-pointer p-0.5" />
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 px-3 pt-3">
                    <CardTitle className="text-xs">نص الاختبار</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 px-3 pb-3">
                    <textarea
                      dir="rtl"
                      className="w-full h-28 sm:h-36 rounded border bg-background p-2 text-xs resize-none focus:ring-1 focus:ring-primary outline-none"
                      value={previewText}
                      onChange={e => setPreviewText(e.target.value)}
                      placeholder="اكتب نصاً عربياً..."
                    />
                    <div className="space-y-0.5">
                      {["مرحباً بك في قصر لويجي!", "لقد وجدت مفتاحاً ذهبياً!", "احذر! أشباح في الغرفة!"].map((t, i) => (
                        <Button key={i} variant="ghost" size="sm" className="w-full text-[10px] justify-start h-6 text-right" onClick={() => setPreviewText(t)}>
                          {t}
                        </Button>
                      ))}
                    </div>
                    {atlasResult && (
                      <div className="text-[9px] text-muted-foreground space-y-0.5 p-2 rounded bg-muted/30">
                        <p>📐 {atlasResult.fontSize}px • {atlasResult.glyphs.length} حرف</p>
                        <p>📏 سطر: {atlasResult.lineHeight}px • {atlasResult.pages.length} صفحات</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ═══════════════ BUILD TAB ═══════════════ */}
            <TabsContent value="build" className="space-y-3">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Card>
                  <CardHeader className="px-3 pt-3 pb-2">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      {hasArchive ? <Package className="w-3.5 h-3.5 text-primary" /> : <Download className="w-3.5 h-3.5 text-primary" />}
                      {hasArchive ? "بناء الأرشيف" : "بناء الخط"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 px-3 pb-3">
                    <p className="text-[10px] text-muted-foreground">
                      {hasArchive ? "يعيد بناء الأرشيف (dict + data) مع الصفحات الجديدة" : "يرمز DXT5 ويحفظ"}
                    </p>
                    {hasArchive && generatedPages > 0 && (
                      <div className="p-1.5 rounded bg-primary/5 border border-primary/20 text-[9px]">
                        <p className="text-primary font-semibold">📦 {generatedPages} صفحة جديدة</p>
                      </div>
                    )}
                    <Button onClick={handleBuildFont} className="w-full gap-1 text-xs h-8" disabled={!fontData}>
                      {hasArchive ? <Package className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                      {hasArchive ? "بناء ZIP" : "بناء .data"}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="px-3 pt-3 pb-2">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <FileJson className="w-3.5 h-3.5 text-primary" />
                      تصدير البيانات
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 px-3 pb-3">
                    <p className="text-[10px] text-muted-foreground">BMFont JSON</p>
                    <Button onClick={handleExportMetrics} variant="secondary" className="w-full gap-1 text-xs h-8" disabled={!atlasResult}>
                      <FileJson className="w-3.5 h-3.5" />
                      font-metrics.json
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="px-3 pt-3 pb-2">
                    <CardTitle className="text-xs">📊 إحصائيات</CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3">
                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                      <div className="p-1.5 rounded bg-muted/30">
                        <p className="text-muted-foreground text-[9px]">أصلية</p>
                        <p className="text-base font-bold">{originalPages}</p>
                      </div>
                      <div className="p-1.5 rounded bg-muted/30">
                        <p className="text-muted-foreground text-[9px]">مولّدة</p>
                        <p className="text-base font-bold text-primary">{generatedPages}</p>
                      </div>
                      <div className="p-1.5 rounded bg-muted/30">
                        <p className="text-muted-foreground text-[9px]">حروف</p>
                        <p className="text-base font-bold">{glyphs.length}</p>
                      </div>
                      <div className="p-1.5 rounded bg-muted/30">
                        <p className="text-muted-foreground text-[9px]">عربية</p>
                        <p className="text-base font-bold text-primary">{arabicGlyphCount}</p>
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-muted/30 mt-1.5">
                      <p className="text-muted-foreground text-[9px]">حجم الملف</p>
                      <p className="text-xs font-mono">{fontData ? formatFileSize(fontData.length) : "—"}</p>
                    </div>
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
        <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-sm">
              <ShieldCheck className="w-4 h-4 text-primary" />
              تقرير التحقق
            </DialogTitle>
            <DialogDescription className="text-[10px]">
              مقارنة بيانات البكسل قبل وبعد إعادة الحزم
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-1.5 my-1.5">
            <div className="p-1.5 rounded bg-muted/40 text-center">
              <p className="text-[9px] text-muted-foreground">الصفحات</p>
              <p className="text-base font-bold">{buildVerification.totalPages}</p>
            </div>
            <div className={`p-1.5 rounded text-center ${buildVerification.passedPages === buildVerification.totalPages ? 'bg-green-500/10' : 'bg-yellow-500/10'}`}>
              <p className="text-[9px] text-muted-foreground">سليمة</p>
              <p className={`text-base font-bold ${buildVerification.passedPages === buildVerification.totalPages ? 'text-green-600' : 'text-yellow-600'}`}>
                {buildVerification.passedPages}/{buildVerification.totalPages}
              </p>
            </div>
            <div className="p-1.5 rounded bg-muted/40 text-center">
              <p className="text-[9px] text-muted-foreground">المدة</p>
              <p className="text-xs font-bold font-mono">{(buildVerification.duration / 1000).toFixed(1)}s</p>
            </div>
          </div>

          <div className="p-1.5 rounded bg-muted/30 text-[9px] space-y-0.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">حجم .dict</span>
              <span className="font-mono">
                {formatFileSize(buildVerification.dictSizeBefore)} → {formatFileSize(buildVerification.dictSizeAfter)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">حجم .data</span>
              <span className="font-mono">
                {formatFileSize(buildVerification.dataSizeBefore)} → {formatFileSize(buildVerification.dataSizeAfter)}
              </span>
            </div>
          </div>

          <ScrollArea className="max-h-[250px]">
            <div className="space-y-1">
              {buildVerification.results.map((r, i) => {
                const isLoss = r.pixelLoss > 5;
                const hashMismatch = !r.match && r.hashBefore !== 0;
                return (
                  <div key={i} className={`p-1.5 rounded border text-[9px] ${
                    isLoss ? 'border-destructive/40 bg-destructive/5' :
                    hashMismatch ? 'border-yellow-500/40 bg-yellow-500/5' :
                    'border-border bg-card'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold flex items-center gap-0.5">
                        {isLoss ? <AlertTriangle className="w-2.5 h-2.5 text-destructive" /> :
                         hashMismatch ? <AlertTriangle className="w-2.5 h-2.5 text-yellow-500" /> :
                         <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />}
                        {r.pageLabel}
                      </span>
                      <Badge variant={isLoss ? "destructive" : hashMismatch ? "secondary" : "outline"} className="text-[7px] h-3.5 px-1">
                        {isLoss ? `فقد ${r.pixelLoss.toFixed(1)}%` : hashMismatch ? 'DXT5' : '✓'}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBuildVerification(prev => prev ? { ...prev, show: false } : null)}>
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}
