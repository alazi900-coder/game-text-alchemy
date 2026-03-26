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
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import {
  ArrowRight, Download, Search, ZoomIn, ZoomOut, ScanSearch,
  Upload, Eye, FileJson, Type, Pencil, Trash2,
  Grid3x3, Layers, Loader2,
  Archive, FolderOpen, HardDrive, Package, ShieldCheck, AlertTriangle,
  CheckCircle2, Wand2, BookOpen, BarChart3
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import { decodeDXT5, encodeDXT5, findDDSPositions, DDS_HEADER_SIZE, TEX_SIZE, DXT5_MIP0_SIZE, buildDDSHeader } from "@/lib/dxt5-codec";
import {
  generateFontAtlas, renderTextPreview, exportMetricsJSON,
  type AtlasResult
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
import GlyphPreviewGrid from "@/components/font-editor/GlyphPreviewGrid";
import ArabicWizard, { type ArabicWizardSettings } from "@/components/font-editor/ArabicWizard";
import FontDefInspector from "@/components/font-editor/FontDefInspector";
import GlyphMetricsStats from "@/components/font-editor/GlyphMetricsStats";
import FontDefExporter from "@/components/font-editor/FontDefExporter";
import GlyphBatchEditor from "@/components/font-editor/GlyphBatchEditor";
import FontDiagnosticPanel from "@/components/font-editor/FontDiagnosticPanel";
import FontQualityEnhancer from "@/components/font-editor/FontQualityEnhancer";
import JSZip from "jszip";

/* ─── types ─── */
export interface GlyphEntry {
  char: string; code: number; x: number; y: number; w: number; h: number; page: number; advance: number;
}

interface TextureInfo {
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; imgData: ImageData;
  ddsOffset: number; isGenerated?: boolean; archiveFileIndex?: number;
}

/* ─── component ─── */
export default function FontEditor() {
  const [textures, setTextures] = useState<TextureInfo[]>([]);
  const [glyphs, setGlyphs] = useState<GlyphEntry[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [glyphSearch, setGlyphSearch] = useState("");
  const [fontData, setFontData] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState("");

  const [archiveInfo, setArchiveInfo] = useState<NLGArchiveInfo | null>(null);
  const [archiveFiles, setArchiveFiles] = useState<NLGExtractedFile[]>([]);
  const [dictData, setDictData] = useState<Uint8Array | null>(null);
  const [dictFileName, setDictFileName] = useState("");
  const [hasArchive, setHasArchive] = useState(false);

  const [fontDefData, setFontDefData] = useState<NLGFontDef | null>(null);
  const [originalFontDefData, setOriginalFontDefData] = useState<NLGFontDef | null>(null);
  const [fontDefOffset, setFontDefOffset] = useState(0);
  const [fontDefLength, setFontDefLength] = useState(0);
  const [fontDefHistory, setFontDefHistory] = useState<NLGFontDef[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [atlasResult, setAtlasResult] = useState<AtlasResult | null>(null);
  const [arabicFontName, setArabicFontName] = useState("Tajawal");
  const [lastWizardSettings, setLastWizardSettings] = useState<ArabicWizardSettings | null>(null);

  const [previewText, setPreviewText] = useState("بسم الله الرحمن الرحيم\nمرحباً بالعالم العربي!\nLuigi's Mansion 2 HD");
  const [previewScale, setPreviewScale] = useState(1.5);
  const [previewBg, setPreviewBg] = useState("#1a1a2e");

  const [editingGlyphIdx, setEditingGlyphIdx] = useState<number | null>(null);
  const [highlightedGlyph, setHighlightedGlyph] = useState<number | null>(null);
  const [selectedFontDefGlyph, setSelectedFontDefGlyph] = useState<number | null>(null);

  const [buildVerification, setBuildVerification] = useState<{
    show: boolean;
    results: Array<{ pageLabel: string; hashBefore: number; hashAfter: number; match: boolean; nonZeroBefore: number; nonZeroAfter: number; pixelLoss: number; }>;
    totalPages: number; passedPages: number; newPages: number;
    dictSizeBefore: number; dictSizeAfter: number; dataSizeBefore: number; dataSizeAfter: number; duration: number;
  } | null>(null);

  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);

  /* ─── Helpers ─── */
  const computePixelHash = (rgba: Uint8ClampedArray | Uint8Array): number => {
    let hash = 0x811c9dc5;
    const step = Math.max(4, Math.floor(rgba.length / 65536)) * 4;
    for (let i = 0; i < rgba.length; i += step) {
      hash ^= rgba[i]; hash = Math.imul(hash, 0x01000193);
      hash ^= rgba[i + 1]; hash = Math.imul(hash, 0x01000193);
      hash ^= rgba[i + 2]; hash = Math.imul(hash, 0x01000193);
      hash ^= rgba[i + 3]; hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  };

  const countNonZeroPixels = (rgba: Uint8ClampedArray | Uint8Array): number => {
    let count = 0;
    for (let i = 3; i < rgba.length; i += 4) { if (rgba[i] > 0) count++; }
    return count;
  };

  /* ─── Display texture on canvas with coordinate overlay ─── */
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
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, sz, sz);
    ctx.drawImage(t.canvas, 0, 0, sz, sz);

    // Grid overlay for generated pages
    if (t.isGenerated) {
      ctx.strokeStyle = "rgba(100,100,100,0.1)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x < TEX_SIZE; x += 64) { ctx.beginPath(); ctx.moveTo(x * zoom, 0); ctx.lineTo(x * zoom, sz); ctx.stroke(); }
      for (let y = 0; y < TEX_SIZE; y += 64) { ctx.beginPath(); ctx.moveTo(0, y * zoom); ctx.lineTo(sz, y * zoom); ctx.stroke(); }
    }

    // Draw font def glyph bounds if available
    if (fontDefData) {
      const pageGlyphs = fontDefData.glyphs.filter(g => g.page === idx);
      for (const g of pageGlyphs) {
        const isSelected = selectedFontDefGlyph === g.code;
        ctx.strokeStyle = isSelected ? "rgba(255, 200, 0, 0.9)" : "rgba(0, 200, 160, 0.15)";
        ctx.lineWidth = isSelected ? 2 : 0.5;
        ctx.strokeRect(g.x1 * zoom, g.y1 * zoom, (g.x2 - g.x1) * zoom, (g.y2 - g.y1) * zoom);
        if (isSelected) {
          ctx.fillStyle = "rgba(255, 200, 0, 0.1)";
          ctx.fillRect(g.x1 * zoom, g.y1 * zoom, (g.x2 - g.x1) * zoom, (g.y2 - g.y1) * zoom);
          // Draw label
          ctx.fillStyle = "rgba(255, 200, 0, 0.9)";
          ctx.font = `${10 * zoom}px monospace`;
          const ch = String.fromCodePoint(g.code);
          ctx.fillText(ch, g.x1 * zoom + 2, g.y1 * zoom - 2);
        }
      }
    }

    // Draw detected glyph bounds
    const detectedPageGlyphs = glyphList.filter(g => g.page === idx);
    for (const g of detectedPageGlyphs) {
      const realIdx = glyphList.indexOf(g);
      const isHighlighted = highlightedGlyph === realIdx;
      if (!fontDefData || isHighlighted) {
        ctx.strokeStyle = isHighlighted ? "rgba(255, 200, 0, 0.9)" : "rgba(0, 212, 170, 0.2)";
        ctx.lineWidth = isHighlighted ? 2 : 0.5;
        ctx.strokeRect(g.x * zoom, g.y * zoom, g.w * zoom, g.h * zoom);
      }
    }
  }, [textures, glyphs, zoom, highlightedGlyph, fontDefData, selectedFontDefGlyph]);

  useEffect(() => {
    if (textures.length > 0) displayTexture(currentPage);
  }, [zoom, currentPage, textures, glyphs, displayTexture, highlightedGlyph, selectedFontDefGlyph]);

  /* ─── Preview ─── */
  const updatePreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !atlasResult) return;
    const width = Math.min(700, window.innerWidth - 32);
    const height = 220;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = previewBg;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    for (let y = 40; y < height; y += atlasResult.lineHeight * previewScale) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    renderTextPreview(ctx, previewText, atlasResult, width - 20, 50, previewScale, true);
  }, [atlasResult, previewText, previewScale, previewBg]);

  useEffect(() => { updatePreview(); }, [updatePreview]);

  /* ─── Decode archive textures ─── */
  const decodeArchiveTextures = useCallback((files: NLGExtractedFile[]) => {
    const decoded: TextureInfo[] = [];
    for (const file of files) {
      if (detectFileType(file.data) !== "DDS" || file.data.length <= DDS_HEADER_SIZE + 1024) continue;
      try {
        const rgba = decodeDXT5(file.data.slice(DDS_HEADER_SIZE, DDS_HEADER_SIZE + DXT5_MIP0_SIZE), TEX_SIZE, TEX_SIZE);
        const canvas = document.createElement("canvas");
        canvas.width = TEX_SIZE; canvas.height = TEX_SIZE;
        const ctx = canvas.getContext("2d")!;
        const imgData = ctx.createImageData(TEX_SIZE, TEX_SIZE);
        imgData.data.set(rgba);
        ctx.putImageData(imgData, 0, 0);
        decoded.push({ canvas, ctx, imgData, ddsOffset: -1, archiveFileIndex: file.index });
      } catch (err) {
        console.warn(`DDS decode error for file ${file.index}`, err);
      }
    }
    return decoded;
  }, []);

  /* ─── File loading ─── */
  const handleFontFiles = async (files: FileList | null) => {
    if (!files) return;
    let dataFile: File | null = null, dictFile: File | null = null;
    for (const f of Array.from(files)) {
      if (f.name.endsWith(".data")) dataFile = f;
      if (f.name.endsWith(".dict")) dictFile = f;
    }
    if (!dataFile) {
      toast({ title: "خطأ", description: "لم يتم العثور على ملف .data", variant: "destructive" });
      return;
    }
    const data = new Uint8Array(await dataFile.arrayBuffer());
    setFontData(data); setFileName(dataFile.name);

    if (dictFile) {
      try {
        const dictBytes = new Uint8Array(await dictFile.arrayBuffer());
        setDictData(dictBytes); setDictFileName(dictFile.name);
        const info = parseNLGDict(dictBytes);
        setArchiveInfo(info); setHasArchive(true);
        const extracted = extractNLGFiles(info, data);
        setArchiveFiles(extracted);
        const newTextures = decodeArchiveTextures(extracted);
        const fontDefResult = findFontDefInData(data);
        if (fontDefResult) {
          const parsed = parseNLGFontDef(fontDefResult.text);
          setFontDefData(parsed); setOriginalFontDefData(parsed);
          setFontDefOffset(fontDefResult.offset); setFontDefLength(fontDefResult.length);
          setFontDefHistory([parsed]); setHistoryIndex(0);
        } else { setFontDefData(null); setOriginalFontDefData(null); }
        setTextures(newTextures); setCurrentPage(0); setAtlasResult(null);
        toast({
          title: "✅ تم تحميل الأرشيف",
          description: `${info.fileCount} ملف — ${newTextures.length} DDS${fontDefResult ? ` — ${parseNLGFontDef(fontDefResult.text).glyphs.length} حرف` : ""}`,
        });
      } catch (err: any) {
        toast({ title: "خطأ", description: err.message, variant: "destructive" });
        loadDirectDDS(data);
      }
    } else {
      setHasArchive(false); setArchiveInfo(null); setArchiveFiles([]); setDictData(null);
      loadDirectDDS(data);
    }
  };

  const loadDirectDDS = (data: Uint8Array) => {
    const positions = findDDSPositions(data);
    const newTextures: TextureInfo[] = positions.map(ddsOff => {
      const rgba = decodeDXT5(data.slice(ddsOff + DDS_HEADER_SIZE, ddsOff + DDS_HEADER_SIZE + DXT5_MIP0_SIZE), TEX_SIZE, TEX_SIZE);
      const canvas = document.createElement("canvas"); canvas.width = TEX_SIZE; canvas.height = TEX_SIZE;
      const ctx = canvas.getContext("2d")!;
      const imgData = ctx.createImageData(TEX_SIZE, TEX_SIZE);
      imgData.data.set(rgba); ctx.putImageData(imgData, 0, 0);
      return { canvas, ctx, imgData, ddsOffset: ddsOff };
    });
    setTextures(newTextures); setCurrentPage(0); setAtlasResult(null);
    toast({ title: "✅ تم التحميل", description: `${positions.length} صفحة` });
  };

  /* ─── Auto-detect glyphs ─── */
  const autoDetectGlyphs = () => {
    if (textures.length === 0) return;
    const chars = '!"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    const detected: GlyphEntry[] = [];
    for (let pi = 0; pi < textures.length; pi++) {
      if (textures[pi].isGenerated) continue;
      const d = textures[pi].imgData.data;
      const rowSums = new Float64Array(TEX_SIZE);
      for (let y = 0; y < TEX_SIZE; y++) { let s = 0; for (let x = 0; x < TEX_SIZE; x++) s += d[(y * TEX_SIZE + x) * 4 + 3]; rowSums[y] = s; }
      const maxR = Math.max(...rowSums); if (maxR === 0) continue;
      const rT = maxR * 0.008;
      const rows: { y0: number; y1: number }[] = [];
      let inR = false, rS = 0;
      for (let y = 0; y < TEX_SIZE; y++) {
        if (rowSums[y] > rT) { if (!inR) { inR = true; rS = y; } }
        else { if (inR && y - rS > 4) rows.push({ y0: rS, y1: y }); inR = false; }
      }
      if (inR && TEX_SIZE - rS > 4) rows.push({ y0: rS, y1: TEX_SIZE });
      let ci = 0;
      for (const row of rows) {
        const cs = new Float64Array(TEX_SIZE);
        for (let x = 0; x < TEX_SIZE; x++) { let s = 0; for (let y = row.y0; y < row.y1; y++) s += d[(y * TEX_SIZE + x) * 4 + 3]; cs[x] = s; }
        const mC = Math.max(...cs); if (mC === 0) continue;
        const cT = mC * 0.003; let inC = false, cS = 0;
        for (let x = 0; x < TEX_SIZE; x++) {
          if (cs[x] > cT) { if (!inC) { inC = true; cS = x; } }
          else if (inC) {
            const w = x - cS;
            if (w > 2) { const ch = pi === 0 && ci < chars.length ? chars[ci] : "?"; detected.push({ x: cS, y: row.y0, w, h: row.y1 - row.y0, page: pi, char: ch, code: ch !== "?" ? ch.codePointAt(0)! : 0, advance: w }); ci++; }
            inC = false;
          }
        }
      }
    }
    setGlyphs(detected);
    toast({ title: "🔍 كشف تلقائي", description: `${detected.length} حرف` });
  };

  /* ─── Arabic atlas generated callback ─── */
  const handleAtlasGenerated = (result: AtlasResult, fontName: string, settings: ArabicWizardSettings) => {
    setAtlasResult(result);
    setArabicFontName(fontName);
    setLastWizardSettings(settings);

    const newTextures = [...textures.filter(t => !t.isGenerated)];
    const newGlyphs = [...glyphs.filter(g => { const t = textures[g.page]; return t && !t.isGenerated; })];
    const startPage = newTextures.length;

    for (const page of result.pages) {
      const imgData = page.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
      newTextures.push({ canvas: page.canvas, ctx: page.ctx, imgData, ddsOffset: -1, isGenerated: true });
    }
    for (const gm of result.glyphs) {
      if (gm.width === 0) continue;
      newGlyphs.push({ char: gm.char, code: gm.code, x: gm.atlasX, y: gm.atlasY, w: gm.width, h: gm.height, page: startPage + gm.page, advance: gm.advance });
    }
    setTextures(newTextures); setGlyphs(newGlyphs); setCurrentPage(startPage);
  };

  /* ─── Build ─── */
  const handleBuildFont = async () => {
    if (!fontData) { toast({ title: "خطأ", description: "حمّل الملف أولاً", variant: "destructive" }); return; }
    if (hasArchive && archiveInfo && archiveFiles.length > 0) await buildWithArchive();
    else buildLegacy();
  };

  const buildLegacy = () => {
    if (!fontData) return;
    const newData = new Uint8Array(fontData);
    textures.forEach(tex => {
      if (tex.ddsOffset < 0) return;
      const dxt5 = encodeDXT5(new Uint8Array(tex.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data), TEX_SIZE, TEX_SIZE);
      const off = tex.ddsOffset + DDS_HEADER_SIZE;
      for (let i = 0; i < dxt5.length && i < DXT5_MIP0_SIZE; i++) newData[off + i] = dxt5[i];
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([newData]));
    a.download = fileName || "FEBundleFonts_res.data"; a.click();
    toast({ title: "✅ تم البناء" });
  };

  const buildWithArchive = async () => {
    if (!archiveInfo || !archiveFiles.length) return;
    const t0 = performance.now();
    const dsBefore = dictData?.length ?? 0, daBefore = fontData?.length ?? 0;

    const snaps = new Map<number, { hash: number; nonZero: number; label: string }>();
    textures.forEach((tex, i) => {
      const rgba = tex.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
      snaps.set(i, { hash: computePixelHash(rgba), nonZero: countNonZeroPixels(rgba), label: tex.isGenerated ? `عربية ${i}` : `أرشيف ${tex.archiveFileIndex ?? i}` });
    });

    const updated = [...archiveFiles];
    const tpl = archiveFiles.find(f => detectFileType(f.data) === "DDS");
    const tplUnk = tpl?.originalEntry.unk ?? 0;
    const tplComp = tpl?.compressionMode ?? (archiveInfo.isCompressed ? "zlib" : "none");

    const texByIdx = new Map<number, TextureInfo>();
    textures.forEach(t => { if (t.archiveFileIndex !== undefined && !t.isGenerated) texByIdx.set(t.archiveFileIndex, t); });

    for (let i = 0; i < updated.length; i++) {
      const tex = texByIdx.get(updated[i].index);
      if (tex) {
        const dxt5 = encodeDXT5(new Uint8Array(tex.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data), TEX_SIZE, TEX_SIZE);
        const hdr = buildDDSHeader(TEX_SIZE, TEX_SIZE);
        const dds = new Uint8Array(hdr.length + dxt5.length); dds.set(hdr); dds.set(dxt5, hdr.length);
        updated[i] = { ...updated[i], data: dds };
      }
    }

    const replaceMode = lastWizardSettings?.replaceMode ?? "append";
    const generated = replaceMode === "append" ? textures.filter(t => t.isGenerated) : [];

    for (const tex of generated) {
      const dxt5 = encodeDXT5(new Uint8Array(tex.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data), TEX_SIZE, TEX_SIZE);
      const hdr = buildDDSHeader(TEX_SIZE, TEX_SIZE);
      const dds = new Uint8Array(hdr.length + dxt5.length); dds.set(hdr); dds.set(dxt5, hdr.length);
      const ni = updated.length;
      updated.push({ index: ni, data: dds, wasCompressed: archiveInfo.isCompressed, compressionMode: archiveInfo.isCompressed ? tplComp : "none",
        originalEntry: { index: ni, offset: 0, decompressedLength: dds.length, compressedLength: dds.length, unk: tplUnk } });
    }

    // Inject Arabic into font def
    if (fontDefData && atlasResult && fontData) {
      const fdIdx = updated.findIndex(f => { const t = detectFileType(f.data); return t === "text" || (t !== "DDS" && f.data.length > 100 && f.data.length < 100000); });
      if (fdIdx >= 0) {
        const ddsCount = updated.filter(f => detectFileType(f.data) === "DDS").length - generated.length;
        const entries = generateArabicGlyphEntries(atlasResult.glyphs, ddsCount, fontDefData.header.renderHeight);
        const merged = mergeArabicIntoFontDef(fontDefData, entries, ddsCount + generated.length);
        const bytes = new TextEncoder().encode(serializeNLGFontDef(merged));
        const padded = new Uint8Array(Math.ceil(bytes.length / 16) * 16); padded.set(bytes);
        updated[fdIdx] = { ...updated[fdIdx], data: padded };
      }
    }

    const { dict: newDict, data: newData } = repackNLGArchive(archiveInfo, updated);
    const newInfo = parseNLGDict(newDict);
    const newFiles = extractNLGFiles(newInfo, newData);
    const newTexs = decodeArchiveTextures(newFiles);

    const results: typeof buildVerification extends { results: infer R } | null ? NonNullable<R> : never = [];
    newTexs.forEach((nt, i) => {
      const rgba = nt.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
      const hA = computePixelHash(rgba), nzA = countNonZeroPixels(rgba);
      const b = snaps.get(i);
      if (b) { const pl = b.nonZero > 0 ? Math.max(0, (1 - nzA / b.nonZero) * 100) : 0; results.push({ pageLabel: b.label, hashBefore: b.hash, hashAfter: hA, match: b.hash === hA, nonZeroBefore: b.nonZero, nonZeroAfter: nzA, pixelLoss: pl }); }
      else results.push({ pageLabel: `جديدة ${i}`, hashBefore: 0, hashAfter: hA, match: true, nonZeroBefore: 0, nonZeroAfter: nzA, pixelLoss: 0 });
    });

    const dur = performance.now() - t0;
    const passed = results.filter(r => r.match || r.pixelLoss < 5).length;
    setDictData(newDict); setFontData(newData); setArchiveInfo(newInfo); setArchiveFiles(newFiles); setTextures(newTexs); setCurrentPage(0);

    const fdRes = findFontDefInData(newData);
    if (fdRes) { setFontDefData(parseNLGFontDef(fdRes.text)); setFontDefOffset(fdRes.offset); setFontDefLength(fdRes.length); }

    setBuildVerification({ show: true, results, totalPages: results.length, passedPages: passed, newPages: generated.length, dictSizeBefore: dsBefore, dictSizeAfter: newDict.length, dataSizeBefore: daBefore, dataSizeAfter: newData.length, duration: dur });

    const zip = new JSZip();
    const base = dictFileName.replace(/_res\.dict$/i, "_res").replace(/\.dict$/i, "_res");
    zip.file(`${base}.dict`, newDict); zip.file(`${base}.data`, newData);
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${base}_arabized.zip`; a.click();
    toast({ title: "✅ تم البناء", description: `تحقق: ${passed}/${results.length} سليمة` });
  };

  const handleExportMetrics = () => {
    if (!atlasResult) return;
    const blob = new Blob([exportMetricsJSON(atlasResult)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "font-metrics.json"; a.click();
  };

  const handleExportPNG = (i: number) => {
    const tex = textures[i]; if (!tex) return;
    const a = document.createElement("a"); a.href = tex.canvas.toDataURL("image/png"); a.download = `atlas_page_${i}.png`; a.click();
  };

  const handleExportArchiveFile = (file: NLGExtractedFile) => {
    const ext = detectFileType(file.data) === "DDS" ? ".dds" : detectFileType(file.data) === "text" ? ".txt" : ".bin";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([new Uint8Array(file.data)]));
    a.download = `file${String(file.index).padStart(3, "0")}${ext}`; a.click();
  };

  const handleGlyphEditApply = (imgData: ImageData) => {
    if (editingGlyphIdx === null) return;
    const g = glyphs[editingGlyphIdx]; if (!g) return;
    const tex = textures[g.page]; if (!tex) return;
    tex.ctx.putImageData(imgData, g.x, g.y);
    tex.imgData = tex.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
    setTextures([...textures]); setEditingGlyphIdx(null);
    toast({ title: "✅ تم التعديل" });
  };

  const filteredGlyphs = glyphs.filter(g => {
    if (!glyphSearch) return true;
    const s = glyphSearch.toLowerCase();
    return g.char.includes(s) || g.code.toString(16).includes(s);
  });

  const originalPages = textures.filter(t => !t.isGenerated).length;
  const generatedPages = textures.filter(t => t.isGenerated).length;
  const arabicGlyphCount = glyphs.filter(g => g.code >= 0x0600).length;

  // Texture canvases for GlyphPreviewGrid
  const textureCanvases = useMemo(() => textures.map(t => t.canvas), [textures]);

  return (
    <>
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur px-3 py-2">
        <div className="max-w-[1600px] mx-auto flex items-center gap-2 flex-wrap">
          <Link to="/luigis-mansion" className="text-muted-foreground hover:text-foreground text-xs flex items-center gap-1 shrink-0">
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <h1 className="text-sm font-bold text-foreground flex items-center gap-1.5">
            <Type className="w-4 h-4 text-primary" />
            محرر الخطوط
          </h1>
          <div className="flex items-center gap-1 mr-auto flex-wrap">
            {hasArchive && <Badge className="text-[8px] bg-primary/20 text-primary border-primary/30 px-1 py-0">📦</Badge>}
            {fontDefData && <Badge variant="secondary" className="text-[8px] px-1 py-0">{fontDefData.glyphs.length} حرف</Badge>}
            {fontData && <Badge variant="outline" className="text-[8px] px-1 py-0">{formatFileSize(fontData.length)}</Badge>}
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-2.5 sm:p-4 space-y-3">
        {/* Upload */}
        {textures.length === 0 && (
          <Card className="border-dashed border-2 cursor-pointer hover:border-primary/50 transition-colors" onClick={() => fontInputRef.current?.click()}>
            <CardContent className="flex flex-col items-center justify-center py-12 sm:py-20 text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <p className="text-base sm:text-lg font-bold text-foreground">ارفع ملفات الخط</p>
              <p className="text-xs text-muted-foreground mt-1.5">FEBundleFonts_res.dict + .data</p>
              <div className="flex gap-2 mt-3">
                <Badge variant="outline" className="text-[9px]"><Archive className="w-3 h-3 ml-1" />.dict + .data</Badge>
                <Badge variant="outline" className="text-[9px]"><HardDrive className="w-3 h-3 ml-1" />.data فقط</Badge>
              </div>
              <input ref={fontInputRef} type="file" multiple accept=".data,.dict" className="hidden" onChange={e => handleFontFiles(e.target.files)} />
            </CardContent>
          </Card>
        )}

        {textures.length > 0 && (
          <Tabs defaultValue={fontDefData ? "inspect" : "atlas"} className="space-y-3">
            <div className="overflow-x-auto -mx-2.5 px-2.5 sm:mx-0 sm:px-0 pb-0.5">
              <TabsList className="inline-flex h-8 w-auto min-w-full sm:grid sm:grid-cols-6 gap-0.5 p-0.5">
                <TabsTrigger value="inspect" className="gap-1 text-[9px] sm:text-[10px] px-2 py-1 whitespace-nowrap">
                  <BookOpen className="w-3 h-3" /> فحص الخط
                </TabsTrigger>
                <TabsTrigger value="atlas" className="gap-1 text-[9px] sm:text-[10px] px-2 py-1 whitespace-nowrap">
                  <Layers className="w-3 h-3" /> الأطلس
                </TabsTrigger>
                <TabsTrigger value="arabic" className="gap-1 text-[9px] sm:text-[10px] px-2 py-1 whitespace-nowrap">
                  <Wand2 className="w-3 h-3" /> إضافة العربية
                </TabsTrigger>
                <TabsTrigger value="preview" className="gap-1 text-[9px] sm:text-[10px] px-2 py-1 whitespace-nowrap">
                  <Eye className="w-3 h-3" /> معاينة
                </TabsTrigger>
                <TabsTrigger value="build" className="gap-1 text-[9px] sm:text-[10px] px-2 py-1 whitespace-nowrap">
                  <Package className="w-3 h-3" /> البناء
                </TabsTrigger>
                {hasArchive && (
                  <TabsTrigger value="archive" className="gap-1 text-[9px] sm:text-[10px] px-2 py-1 whitespace-nowrap">
                    <Archive className="w-3 h-3" /> الأرشيف
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            {/* ═══ INSPECT TAB ═══ */}
            <TabsContent value="inspect" className="space-y-3">
              {fontDefData ? (
                <>
                  {/* Undo/Redo bar */}
                  {fontDefHistory.length > 1 && (
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1 px-2"
                        disabled={historyIndex <= 0}
                        onClick={() => {
                          const newIdx = historyIndex - 1;
                          setHistoryIndex(newIdx);
                          setFontDefData(fontDefHistory[newIdx]);
                        }}>
                        ↩ تراجع
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1 px-2"
                        disabled={historyIndex >= fontDefHistory.length - 1}
                        onClick={() => {
                          const newIdx = historyIndex + 1;
                          setHistoryIndex(newIdx);
                          setFontDefData(fontDefHistory[newIdx]);
                        }}>
                        إعادة ↪
                      </Button>
                      <Badge variant="outline" className="text-[7px] font-mono">{historyIndex + 1}/{fontDefHistory.length}</Badge>
                    </div>
                  )}

                  <FontDefInspector fontDef={fontDefData} />
                  
                  <div className="grid lg:grid-cols-[1fr_280px] gap-3">
                    <GlyphPreviewGrid
                      fontDef={fontDefData}
                      textures={textureCanvases}
                      selectedGlyphCode={selectedFontDefGlyph}
                      onGlyphSelect={(g) => {
                        setSelectedFontDefGlyph(g.code);
                        setCurrentPage(g.page);
                      }}
                      onGlyphUpdate={(idx, changes) => {
                        setFontDefData(prev => {
                          if (!prev) return prev;
                          const newGlyphs = [...prev.glyphs];
                          newGlyphs[idx] = { ...newGlyphs[idx], ...changes };
                          const updated = { ...prev, glyphs: newGlyphs, rawText: '' };
                          setFontDefHistory(h => [...h.slice(0, historyIndex + 1), updated]);
                          setHistoryIndex(i => i + 1);
                          return updated;
                        });
                      }}
                      onBatchUpdate={(updates) => {
                        setFontDefData(prev => {
                          if (!prev) return prev;
                          const newGlyphs = [...prev.glyphs];
                          for (const u of updates) {
                            newGlyphs[u.index] = { ...newGlyphs[u.index], ...u.changes };
                          }
                          const updated = { ...prev, glyphs: newGlyphs, rawText: '' };
                          setFontDefHistory(h => [...h.slice(0, historyIndex + 1), updated]);
                          setHistoryIndex(i => i + 1);
                          return updated;
                        });
                      }}
                    />

                    {/* Side panel with tools */}
                    <div className="space-y-3">
                      <FontDiagnosticPanel
                        fontDef={fontDefData}
                        textures={textureCanvases}
                        onBatchUpdate={(updates) => {
                          setFontDefData(prev => {
                            if (!prev) return prev;
                            const newGlyphs = [...prev.glyphs];
                            for (const u of updates) {
                              newGlyphs[u.index] = { ...newGlyphs[u.index], ...u.changes };
                            }
                            const updated = { ...prev, glyphs: newGlyphs, rawText: '' };
                            setFontDefHistory(h => [...h.slice(0, historyIndex + 1), updated]);
                            setHistoryIndex(i => i + 1);
                            return updated;
                          });
                        }}
                      />
                      <GlyphMetricsStats fontDef={fontDefData} />
                      <GlyphBatchEditor fontDef={fontDefData} onBatchUpdate={(updates) => {
                        setFontDefData(prev => {
                          if (!prev) return prev;
                          const newGlyphs = [...prev.glyphs];
                          for (const u of updates) {
                            newGlyphs[u.index] = { ...newGlyphs[u.index], ...u.changes };
                          }
                          const updated = { ...prev, glyphs: newGlyphs, rawText: '' };
                          setFontDefHistory(h => [...h.slice(0, historyIndex + 1), updated]);
                          setHistoryIndex(i => i + 1);
                          return updated;
                        });
                      }} />
                      <FontDefExporter fontDef={fontDefData} originalFontDef={originalFontDefData} />
                    </div>
                  </div>
                </>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center py-12 text-center text-muted-foreground">
                    <BookOpen className="w-10 h-10 mb-3 opacity-30" />
                    <p className="text-xs">لم يتم العثور على جدول تعريف الخط</p>
                    <p className="text-[10px] mt-1">ارفع .dict + .data لقراءة جدول الحروف</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ═══ ATLAS TAB ═══ */}
            <TabsContent value="atlas" className="space-y-3">
              <div className="grid lg:grid-cols-[1fr_300px] gap-3">
                <Card>
                  <CardHeader className="px-3 pt-3 pb-2">
                    <div className="flex items-center justify-between flex-wrap gap-1.5">
                      <CardTitle className="text-xs flex items-center gap-1.5">
                        <Grid3x3 className="w-3.5 h-3.5 text-primary" />
                        عارض الأطلس
                      </CardTitle>
                      <div className="flex items-center gap-1">
                        <Select value={String(currentPage)} onValueChange={v => setCurrentPage(Number(v))}>
                          <SelectTrigger className="w-24 sm:w-36 h-7 text-[9px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {textures.map((t, i) => (
                              <SelectItem key={i} value={String(i)}>صفحة {i} {t.isGenerated ? "🇸🇦" : ""}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-0 bg-muted rounded p-0.5">
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setZoom(z => Math.max(0.25, z / 1.25))}>
                            <ZoomOut className="w-2.5 h-2.5" />
                          </Button>
                          <span className="text-[8px] text-muted-foreground w-6 text-center font-mono">{Math.round(zoom * 100)}</span>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setZoom(z => Math.min(4, z * 1.25))}>
                            <ZoomIn className="w-2.5 h-2.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-3 pb-3">
                    <ScrollArea className="max-h-[50vh] sm:max-h-[600px] rounded-lg border border-border bg-black">
                      <canvas ref={displayCanvasRef} className="block cursor-crosshair" style={{ imageRendering: zoom >= 2 ? "pixelated" : "auto" }} />
                    </ScrollArea>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      <Button size="sm" variant="secondary" onClick={autoDetectGlyphs} className="gap-1 text-[9px] h-6">
                        <ScanSearch className="w-3 h-3" /> كشف
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleExportPNG(currentPage)} className="gap-1 text-[9px] h-6">
                        <Download className="w-3 h-3" /> PNG
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => fontInputRef.current?.click()} className="gap-1 text-[9px] h-6">
                        <Upload className="w-3 h-3" /> ملف
                      </Button>
                      <input ref={fontInputRef} type="file" multiple accept=".data,.dict" className="hidden" onChange={e => handleFontFiles(e.target.files)} />
                    </div>
                  </CardContent>
                </Card>

                {/* Detected glyphs list */}
                <Card>
                  <CardHeader className="px-3 pt-3 pb-2">
                    <div className="flex items-center justify-between gap-1.5">
                      <CardTitle className="text-xs">الحروف ({glyphs.length})</CardTitle>
                      <div className="relative">
                        <Search className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input placeholder="بحث..." className="pr-7 w-24 h-6 text-[9px]" value={glyphSearch} onChange={e => setGlyphSearch(e.target.value)} />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-0 pb-0">
                    <ScrollArea className="h-[300px] sm:h-[520px]">
                      {filteredGlyphs.slice(0, 300).map((g, idx) => {
                        const ri = glyphs.indexOf(g);
                        return (
                          <div key={idx}
                            className={`flex items-center gap-1.5 px-3 py-1 text-[9px] cursor-pointer border-b border-border/20 ${highlightedGlyph === ri ? "bg-primary/10" : "hover:bg-muted/40"}`}
                            onClick={() => { setCurrentPage(g.page); setHighlightedGlyph(ri); }}>
                            <span className="text-sm font-bold w-5 text-center">{g.char === "?" ? "❓" : g.char}</span>
                            <span className="font-mono text-muted-foreground">{g.code.toString(16).toUpperCase().padStart(4, "0")}</span>
                            <span className="text-muted-foreground">{g.w}×{g.h}</span>
                            <span className="mr-auto" />
                            <Button variant="ghost" size="icon" className="h-4 w-4" onClick={e => { e.stopPropagation(); setEditingGlyphIdx(ri); }}>
                              <Pencil className="w-2 h-2 text-primary" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-4 w-4" onClick={e => { e.stopPropagation(); setGlyphs(p => p.filter((_, i) => i !== ri)); }}>
                              <Trash2 className="w-2 h-2 text-destructive" />
                            </Button>
                          </div>
                        );
                      })}
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

            {/* ═══ ARABIC WIZARD TAB ═══ */}
            <TabsContent value="arabic" className="space-y-3">
              <div className="grid lg:grid-cols-2 gap-3">
                <ArabicWizard textureSize={TEX_SIZE} onAtlasGenerated={handleAtlasGenerated} />

                {/* Quick stats */}
                <div className="space-y-3">
                  <Card>
                    <CardHeader className="px-3 pt-3 pb-2">
                      <CardTitle className="text-xs flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5 text-primary" />
                        حالة الأطلس
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3">
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="p-2 rounded bg-muted/30 text-center">
                          <p className="text-[8px] text-muted-foreground">صفحات أصلية</p>
                          <p className="text-xl font-bold">{originalPages}</p>
                        </div>
                        <div className="p-2 rounded bg-primary/10 text-center border border-primary/20">
                          <p className="text-[8px] text-muted-foreground">صفحات عربية</p>
                          <p className="text-xl font-bold text-primary">{generatedPages}</p>
                        </div>
                        <div className="p-2 rounded bg-muted/30 text-center">
                          <p className="text-[8px] text-muted-foreground">حروف مكتشفة</p>
                          <p className="text-xl font-bold">{glyphs.length}</p>
                        </div>
                        <div className="p-2 rounded bg-primary/10 text-center border border-primary/20">
                          <p className="text-[8px] text-muted-foreground">حروف عربية</p>
                          <p className="text-xl font-bold text-primary">{arabicGlyphCount}</p>
                        </div>
                      </div>
                      {fontDefData && (
                        <div className="mt-2 p-2 rounded bg-muted/20 text-[9px]">
                          <p className="font-semibold text-foreground">جدول الخط: {fontDefData.glyphs.length} حرف</p>
                          <p className="text-muted-foreground">
                            {fontDefData.glyphs.filter(g => g.code >= 0x0600).length} عربي • {fontDefData.header.pageCount} صفحة
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {atlasResult && (
                    <Card className="border-primary/20">
                      <CardContent className="p-3 text-[10px] space-y-1">
                        <p className="font-semibold text-primary flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          الأطلس جاهز
                        </p>
                        <p>{arabicFontName} — {atlasResult.fontSize}px</p>
                        <p>{atlasResult.glyphs.length} حرف على {atlasResult.pages.length} صفحة</p>
                        <p className="text-muted-foreground">Shelf Bin-Packing • {atlasResult.textureSize}×{atlasResult.textureSize}</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* ═══ PREVIEW TAB ═══ */}
            <TabsContent value="preview" className="space-y-3">
              <div className="grid lg:grid-cols-[1fr_260px] gap-3">
                <Card>
                  <CardHeader className="px-3 pt-3 pb-2">
                    <CardTitle className="text-xs flex items-center gap-1.5"><Eye className="w-3.5 h-3.5 text-primary" /> معاينة محاكاة اللعبة</CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3">
                    {!atlasResult ? (
                      <div className="flex flex-col items-center py-12 text-center text-muted-foreground">
                        <Eye className="w-8 h-8 mb-2 opacity-30" />
                        <p className="text-xs">ولّد الأطلس أولاً</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="rounded border border-border overflow-hidden"><canvas ref={previewCanvasRef} className="w-full block" /></div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[9px]">تكبير: {previewScale.toFixed(1)}x</Label>
                            <Slider value={[previewScale]} onValueChange={v => setPreviewScale(v[0])} min={0.5} max={4} step={0.1} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[9px]">الخلفية</Label>
                            <Input type="color" value={previewBg} onChange={e => setPreviewBg(e.target.value)} className="w-8 h-7 p-0.5" />
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="px-3 pt-3 pb-2"><CardTitle className="text-xs">نص الاختبار</CardTitle></CardHeader>
                  <CardContent className="px-3 pb-3 space-y-2">
                    <textarea dir="rtl" className="w-full h-24 rounded border bg-background p-2 text-xs resize-none focus:ring-1 focus:ring-primary outline-none" value={previewText} onChange={e => setPreviewText(e.target.value)} />
                    {["مرحباً بك في قصر لويجي!", "لقد وجدت مفتاحاً ذهبياً!", "احذر! أشباح!"].map((t, i) => (
                      <Button key={i} variant="ghost" size="sm" className="w-full text-[9px] justify-start h-5 text-right" onClick={() => setPreviewText(t)}>{t}</Button>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ═══ BUILD TAB ═══ */}
            <TabsContent value="build" className="space-y-3">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Card>
                  <CardHeader className="px-3 pt-3 pb-2">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5 text-primary" />
                      {hasArchive ? "بناء الأرشيف" : "بناء الخط"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 space-y-2">
                    <p className="text-[9px] text-muted-foreground">
                      {hasArchive ? "يبني dict + data مع الحروف العربية → ZIP" : "يرمز DXT5 → .data"}
                    </p>
                    {hasArchive && generatedPages > 0 && (
                      <Badge className="text-[8px] bg-primary/20 text-primary border-primary/30">📦 {generatedPages} صفحة جديدة</Badge>
                    )}
                    <Button onClick={handleBuildFont} className="w-full gap-1 text-xs h-8" disabled={!fontData}>
                      <Package className="w-3.5 h-3.5" />
                      بناء وتحميل
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="px-3 pt-3 pb-2">
                    <CardTitle className="text-xs flex items-center gap-1.5"><FileJson className="w-3.5 h-3.5 text-primary" /> تصدير</CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3">
                    <Button onClick={handleExportMetrics} variant="secondary" className="w-full gap-1 text-xs h-8" disabled={!atlasResult}>
                      <FileJson className="w-3.5 h-3.5" /> font-metrics.json
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="px-3 pt-3 pb-2"><CardTitle className="text-xs">📊 إحصائيات</CardTitle></CardHeader>
                  <CardContent className="px-3 pb-3">
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      <div className="p-1.5 rounded bg-muted/30"><p className="text-[8px] text-muted-foreground">أصلية</p><p className="text-base font-bold">{originalPages}</p></div>
                      <div className="p-1.5 rounded bg-muted/30"><p className="text-[8px] text-muted-foreground">مولّدة</p><p className="text-base font-bold text-primary">{generatedPages}</p></div>
                      <div className="p-1.5 rounded bg-muted/30"><p className="text-[8px] text-muted-foreground">حروف</p><p className="text-base font-bold">{glyphs.length}</p></div>
                      <div className="p-1.5 rounded bg-muted/30"><p className="text-[8px] text-muted-foreground">عربية</p><p className="text-base font-bold text-primary">{arabicGlyphCount}</p></div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ═══ ARCHIVE TAB ═══ */}
            {hasArchive && archiveInfo && (
              <TabsContent value="archive" className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Card className="p-2"><p className="text-[8px] text-muted-foreground">ملفات</p><p className="text-xl font-bold">{archiveInfo.fileCount}</p></Card>
                  <Card className="p-2"><p className="text-[8px] text-muted-foreground">DDS</p><p className="text-xl font-bold text-primary">{originalPages}</p></Card>
                  <Card className="p-2"><p className="text-[8px] text-muted-foreground">مضغوط</p><p className="text-xl font-bold">{archiveInfo.isCompressed ? "نعم" : "لا"}</p></Card>
                  <Card className="p-2"><p className="text-[8px] text-muted-foreground">حجم</p><p className="text-sm font-bold font-mono">{formatFileSize(fontData?.length ?? 0)}</p></Card>
                </div>
                <Card>
                  <CardHeader className="px-3 pt-3 pb-2">
                    <CardTitle className="text-xs flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5 text-primary" /> الملفات</CardTitle>
                  </CardHeader>
                  <CardContent className="px-0 pb-0">
                    <ScrollArea className="max-h-[350px]">
                      {archiveFiles.map(file => {
                        const type = detectFileType(file.data);
                        return (
                          <div key={file.index} className={`flex items-center gap-2 px-3 py-1 text-[9px] ${type === "DDS" ? "bg-primary/5" : ""}`}>
                            <span className="font-mono text-muted-foreground w-6">{String(file.index).padStart(3, "0")}</span>
                            <Badge variant={type === "DDS" ? "default" : "secondary"} className="text-[7px] h-3.5 px-1">{type}</Badge>
                            <span className="text-muted-foreground">{formatFileSize(file.originalEntry.decompressedLength)}</span>
                            <span className="mr-auto" />
                            <Button variant="ghost" size="sm" className="h-5 text-[8px] gap-0.5 px-1" onClick={() => handleExportArchiveFile(file)}>
                              <Download className="w-2.5 h-2.5" /> استخراج
                            </Button>
                          </div>
                        );
                      })}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>
    </div>

    {/* Build verification dialog */}
    {buildVerification?.show && (
      <Dialog open={buildVerification.show} onOpenChange={open => { if (!open) setBuildVerification(p => p ? { ...p, show: false } : null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[80vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-primary" /> تقرير التحقق</DialogTitle>
            <DialogDescription className="text-[9px]">مقارنة بيانات البكسل بعد إعادة الحزم</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-1.5">
            <div className="p-1.5 rounded bg-muted/40 text-center"><p className="text-[8px] text-muted-foreground">الصفحات</p><p className="text-base font-bold">{buildVerification.totalPages}</p></div>
            <div className={`p-1.5 rounded text-center ${buildVerification.passedPages === buildVerification.totalPages ? 'bg-green-500/10' : 'bg-yellow-500/10'}`}>
              <p className="text-[8px] text-muted-foreground">سليمة</p>
              <p className={`text-base font-bold ${buildVerification.passedPages === buildVerification.totalPages ? 'text-green-600' : 'text-yellow-600'}`}>{buildVerification.passedPages}/{buildVerification.totalPages}</p>
            </div>
            <div className="p-1.5 rounded bg-muted/40 text-center"><p className="text-[8px] text-muted-foreground">المدة</p><p className="text-xs font-mono font-bold">{(buildVerification.duration / 1000).toFixed(1)}s</p></div>
          </div>
          <div className="p-1.5 rounded bg-muted/30 text-[8px] space-y-0.5">
            <div className="flex justify-between"><span className="text-muted-foreground">.dict</span><span className="font-mono">{formatFileSize(buildVerification.dictSizeBefore)} → {formatFileSize(buildVerification.dictSizeAfter)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">.data</span><span className="font-mono">{formatFileSize(buildVerification.dataSizeBefore)} → {formatFileSize(buildVerification.dataSizeAfter)}</span></div>
          </div>
          <ScrollArea className="max-h-[200px]">
            <div className="space-y-0.5">
              {buildVerification.results.map((r, i) => (
                <div key={i} className={`p-1.5 rounded border text-[8px] ${r.pixelLoss > 5 ? 'border-destructive/40 bg-destructive/5' : !r.match && r.hashBefore !== 0 ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-border bg-card'}`}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-0.5 font-semibold">
                      {r.pixelLoss > 5 ? <AlertTriangle className="w-2.5 h-2.5 text-destructive" /> : <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />}
                      {r.pageLabel}
                    </span>
                    <Badge variant="outline" className="text-[7px] h-3.5 px-1">{r.pixelLoss > 5 ? `فقد ${r.pixelLoss.toFixed(1)}%` : "✓"}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBuildVerification(p => p ? { ...p, show: false } : null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}
