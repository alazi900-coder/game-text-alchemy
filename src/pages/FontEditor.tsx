import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { ArrowRight, Download, Search, Trash2, Edit, Plus, ZoomIn, ZoomOut, ScanSearch, Paintbrush, Upload } from "lucide-react";
import { decodeDXT5, encodeDXT5, findDDSPositions, DDS_HEADER_SIZE, TEX_SIZE, DXT5_MIP0_SIZE } from "@/lib/dxt5-codec";
import ArabicCharsPanel from "@/components/editor/ArabicCharsPanel";

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
}

export default function FontEditor() {
  const [textures, setTextures] = useState<TextureInfo[]>([]);
  const [glyphs, setGlyphs] = useState<GlyphEntry[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [glyphSearch, setGlyphSearch] = useState("");
  const [fontData, setFontData] = useState<Uint8Array | null>(null);
  const [arabicFontName, setArabicFontName] = useState("Tajawal");
  const [fontSize, setFontSize] = useState(56);
  const [cellSize, setCellSize] = useState(64);
  const [fontColor, setFontColor] = useState("#ffffff");
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);

  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const customFontInputRef = useRef<HTMLInputElement>(null);

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
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, sz, sz);
    ctx.drawImage(t.canvas, 0, 0, sz, sz);

    // Draw glyph grid overlay
    const pageGlyphs = glyphList.filter(g => g.page === idx);
    if (pageGlyphs.length > 0) {
      ctx.strokeStyle = "rgba(0, 212, 170, 0.3)";
      ctx.lineWidth = 1;
      pageGlyphs.forEach(g => {
        ctx.strokeRect(g.x * zoom, g.y * zoom, g.w * zoom, g.h * zoom);
      });
    }
  }, [textures, glyphs, zoom]);

  useEffect(() => {
    if (textures.length > 0) displayTexture(currentPage);
  }, [zoom, currentPage, textures, glyphs, displayTexture]);

  const handleFontFiles = async (files: FileList | null) => {
    if (!files) return;
    let dataFile: File | null = null;
    for (const f of Array.from(files)) {
      if (f.name.endsWith(".data")) dataFile = f;
    }
    if (!dataFile) {
      toast({ title: "خطأ", description: "لم يتم العثور على ملف .data", variant: "destructive" });
      return;
    }

    const dataBuffer = await dataFile.arrayBuffer();
    const data = new Uint8Array(dataBuffer);
    setFontData(data);

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
    toast({ title: "تم التحميل", description: `${ddsPositions.length} صفحة أطلس` });
  };

  const autoDetectGlyphs = () => {
    if (textures.length === 0) {
      toast({ title: "خطأ", description: "حمّل ملف الخط أولاً", variant: "destructive" });
      return;
    }

    const tex0Chars = '!"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    const detected: GlyphEntry[] = [];

    for (let pageIdx = 0; pageIdx < textures.length; pageIdx++) {
      const data = textures[pageIdx].imgData.data;

      // Find row boundaries via alpha channel
      const rowSums = new Float64Array(TEX_SIZE);
      for (let y = 0; y < TEX_SIZE; y++) {
        let sum = 0;
        for (let x = 0; x < TEX_SIZE; x++) sum += data[(y * TEX_SIZE + x) * 4 + 3];
        rowSums[y] = sum;
      }

      const maxRow = Math.max(...rowSums);
      const rowThreshold = maxRow * 0.01;

      const rows: { y0: number; y1: number }[] = [];
      let inRow = false, rowStart = 0;
      for (let y = 0; y < TEX_SIZE; y++) {
        if (rowSums[y] > rowThreshold) {
          if (!inRow) { inRow = true; rowStart = y; }
        } else {
          if (inRow && y - rowStart > 5) rows.push({ y0: rowStart, y1: y });
          inRow = false;
        }
      }
      if (inRow && TEX_SIZE - rowStart > 5) rows.push({ y0: rowStart, y1: TEX_SIZE });

      let charIdx = 0;
      for (const row of rows) {
        const colSums = new Float64Array(TEX_SIZE);
        for (let x = 0; x < TEX_SIZE; x++) {
          let sum = 0;
          for (let y = row.y0; y < row.y1; y++) sum += data[(y * TEX_SIZE + x) * 4 + 3];
          colSums[x] = sum;
        }

        const maxCol = Math.max(...colSums);
        const colThreshold = maxCol * 0.005;
        let inChar = false, charStart = 0;

        for (let x = 0; x < TEX_SIZE; x++) {
          if (colSums[x] > colThreshold) {
            if (!inChar) { inChar = true; charStart = x; }
          } else if (inChar) {
            const w = x - charStart;
            if (w > 3) {
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
          if (w > 3) {
            const ch = pageIdx === 0 && charIdx < tex0Chars.length ? tex0Chars[charIdx] : "?";
            detected.push({ x: charStart, y: rows[rows.length - 1]?.y0 || 0, w, h: Math.min(128, TEX_SIZE - charStart), page: pageIdx, char: ch, code: ch !== "?" ? ch.codePointAt(0)! : 0, advance: w });
            charIdx++;
          }
        }
      }
    }

    setGlyphs(detected);
    toast({ title: "كشف تلقائي", description: `تم كشف ${detected.length} حرف` });
  };

  const handleGenerateArabicAtlas = (chars: { char: string; code: number }[]) => {
    if (chars.length === 0 || textures.length === 0) return;

    const cellW = cellSize;
    const cellH = Math.max(cellSize, 80);
    const colsPerRow = Math.floor(TEX_SIZE / cellW);
    const rowsPerPage = Math.floor(TEX_SIZE / cellH);
    const charsPerPage = colsPerRow * rowsPerPage;
    const pagesNeeded = Math.ceil(chars.length / charsPerPage);
    const targetPage = textures.length;

    const newTextures = [...textures];
    const newGlyphs = [...glyphs];

    for (let p = 0; p < pagesNeeded; p++) {
      const canvas = document.createElement("canvas");
      canvas.width = TEX_SIZE;
      canvas.height = TEX_SIZE;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
      ctx.font = `700 ${fontSize}px "${arabicFontName}", "Tajawal", sans-serif`;
      ctx.fillStyle = fontColor;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";

      const startIdx = p * charsPerPage;
      const endIdx = Math.min(startIdx + charsPerPage, chars.length);

      for (let i = startIdx; i < endIdx; i++) {
        const localIdx = i - startIdx;
        const col = localIdx % colsPerRow;
        const row = Math.floor(localIdx / colsPerRow);
        const x = col * cellW + cellW / 2 + offsetX;
        const y = row * cellH + cellH / 2 + offsetY;

        ctx.fillStyle = fontColor;
        ctx.fillText(chars[i].char, x, y);

        const metrics = ctx.measureText(chars[i].char);
        newGlyphs.push({
          char: chars[i].char,
          code: chars[i].code,
          x: col * cellW,
          y: row * cellH,
          w: cellW,
          h: cellH,
          page: targetPage + p,
          advance: Math.ceil(metrics.width),
        });
      }

      const imgData = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
      newTextures.push({ canvas, ctx, imgData, ddsOffset: -1 });
    }

    setTextures(newTextures);
    setGlyphs(newGlyphs);
    setCurrentPage(targetPage);
    toast({ title: "تم التوليد", description: `${chars.length} حرف على ${pagesNeeded} صفحة` });
  };

  const handleBuildFont = () => {
    if (!fontData) {
      toast({ title: "خطأ", description: "حمّل ملف الخط أولاً", variant: "destructive" });
      return;
    }

    const newData = new Uint8Array(fontData);
    textures.forEach(tex => {
      if (tex.ddsOffset < 0) return;
      const rgba = tex.imgData.data;
      const dxt5 = encodeDXT5(new Uint8Array(rgba), TEX_SIZE, TEX_SIZE);
      const writeOff = tex.ddsOffset + DDS_HEADER_SIZE;
      for (let i = 0; i < dxt5.length && i < DXT5_MIP0_SIZE; i++) {
        newData[writeOff + i] = dxt5[i];
      }
    });

    const blob = new Blob([newData], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "FEBundleFonts_res.data";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "تم البناء", description: "تم بناء ملف الخط بنجاح ✅" });
  };

  const handleCustomFont = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const fontFace = new FontFace("CustomArabic", `url(${url})`);
      const loaded = await fontFace.load();
      document.fonts.add(loaded);
      setArabicFontName("CustomArabic");
      toast({ title: "تم تحميل الخط", description: file.name });
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    }
  };

  const deleteGlyph = (idx: number) => {
    setGlyphs(prev => prev.filter((_, i) => i !== idx));
  };

  const filteredGlyphs = glyphs.filter(g => {
    if (!glyphSearch) return true;
    const s = glyphSearch.toLowerCase();
    return g.char.includes(s) || g.code.toString(16).includes(s);
  });

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Link to="/luigis-mansion" className="text-muted-foreground hover:text-foreground text-sm">
            <ArrowRight className="w-4 h-4 inline ml-1" />
            العودة
          </Link>
          <h1 className="text-lg font-bold bg-gradient-to-l from-[hsl(120,70%,50%)] to-[hsl(270,70%,60%)] bg-clip-text text-transparent">
            🔤 محرر الخطوط
          </h1>
          <Badge variant="secondary">Luigi's Mansion 2 HD</Badge>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4 space-y-6">
        {/* File Upload */}
        {textures.length === 0 && (
          <Card className="border-dashed border-2 cursor-pointer hover:border-[hsl(120,50%,40%)]/50 transition-colors"
            onClick={() => fontInputRef.current?.click()}>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Upload className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-lg font-semibold">اسحب ملفات الخط هنا</p>
              <p className="text-sm text-muted-foreground mt-1">FEBundleFonts_res.data + FEBundleFonts_res.dict</p>
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
          <Tabs defaultValue="atlas" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="atlas">🎨 أطلس الخط</TabsTrigger>
              <TabsTrigger value="arabic">🇸🇦 الأحرف العربية</TabsTrigger>
              <TabsTrigger value="build">💾 البناء</TabsTrigger>
            </TabsList>

            {/* Atlas Tab */}
            <TabsContent value="atlas" className="space-y-4">
              <div className="grid lg:grid-cols-2 gap-4">
                {/* Atlas Viewer */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-base">أطلس الخط</CardTitle>
                      <div className="flex items-center gap-2">
                        <Select value={String(currentPage)} onValueChange={v => setCurrentPage(Number(v))}>
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {textures.map((t, i) => (
                              <SelectItem key={i} value={String(i)}>
                                صفحة {i} {t.ddsOffset >= 0 ? `(0x${t.ddsOffset.toString(16).toUpperCase()})` : "(عربي)"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant="outline" size="icon" onClick={() => setZoom(z => Math.max(0.25, z / 1.25))}>
                          <ZoomOut className="w-4 h-4" />
                        </Button>
                        <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
                        <Button variant="outline" size="icon" onClick={() => setZoom(z => Math.min(4, z * 1.25))}>
                          <ZoomIn className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-auto bg-black rounded-lg border border-border max-h-[500px]">
                      <canvas ref={displayCanvasRef} className="block cursor-crosshair" />
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="secondary" onClick={autoDetectGlyphs}>
                        <ScanSearch className="w-4 h-4 ml-1" />
                        كشف تلقائي
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => fontInputRef.current?.click()}>
                        <Upload className="w-4 h-4 ml-1" />
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
                      <CardTitle className="text-base">جدول الحروف ({glyphs.length})</CardTitle>
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <Search className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                          <Input placeholder="بحث..." className="pr-8 w-40" value={glyphSearch} onChange={e => setGlyphSearch(e.target.value)} />
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-[500px] overflow-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">#</TableHead>
                            <TableHead className="text-right">الحرف</TableHead>
                            <TableHead className="text-right">يونيكود</TableHead>
                            <TableHead className="text-right">X</TableHead>
                            <TableHead className="text-right">Y</TableHead>
                            <TableHead className="text-right">العرض</TableHead>
                            <TableHead className="text-right">صفحة</TableHead>
                            <TableHead className="text-right">إجراء</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredGlyphs.slice(0, 200).map((g, idx) => (
                            <TableRow key={idx} className="cursor-pointer hover:bg-muted/50" onClick={() => { setCurrentPage(g.page); }}>
                              <TableCell className="text-xs">{idx}</TableCell>
                              <TableCell className="text-lg font-bold">{g.char === "?" ? "❓" : g.char}</TableCell>
                              <TableCell className="font-mono text-xs">{g.code.toString(16).toUpperCase().padStart(4, "0")}</TableCell>
                              <TableCell className="text-xs">{g.x}</TableCell>
                              <TableCell className="text-xs">{g.y}</TableCell>
                              <TableCell className="text-xs">{g.w}×{g.h}</TableCell>
                              <TableCell className="text-xs">{g.page}</TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); deleteGlyph(idx); }}>
                                  <Trash2 className="w-3 h-3 text-destructive" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Arabic Tab */}
            <TabsContent value="arabic" className="space-y-4">
              <div className="grid lg:grid-cols-2 gap-4">
                <ArabicCharsPanel
                  onGenerate={handleGenerateArabicAtlas}
                  hasTextures={textures.length > 0}
                />
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">إعدادات رسم الخط</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label>ملف الخط العربي (TTF/OTF)</Label>
                      <Input ref={customFontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleCustomFont} className="mt-1" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>حجم الخط ({fontSize}px)</Label>
                        <Slider value={[fontSize]} onValueChange={v => setFontSize(v[0])} min={10} max={120} step={1} className="mt-2" />
                      </div>
                      <div>
                        <Label>حجم الخلية ({cellSize}px)</Label>
                        <Slider value={[cellSize]} onValueChange={v => setCellSize(v[0])} min={16} max={256} step={4} className="mt-2" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>إزاحة X ({offsetX})</Label>
                        <Slider value={[offsetX]} onValueChange={v => setOffsetX(v[0])} min={-50} max={50} step={1} className="mt-2" />
                      </div>
                      <div>
                        <Label>إزاحة Y ({offsetY})</Label>
                        <Slider value={[offsetY]} onValueChange={v => setOffsetY(v[0])} min={-50} max={50} step={1} className="mt-2" />
                      </div>
                    </div>
                    <div>
                      <Label>لون الخط</Label>
                      <Input type="color" value={fontColor} onChange={e => setFontColor(e.target.value)} className="w-16 h-10 mt-1 cursor-pointer" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Build Tab */}
            <TabsContent value="build" className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">💾 بناء ملف الخط</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      يعيد بناء FEBundleFonts_res.data مع الحروف العربية المضافة
                    </p>
                    <Button onClick={handleBuildFont} className="w-full bg-[hsl(120,50%,40%)] hover:bg-[hsl(120,50%,35%)] text-white">
                      <Download className="w-4 h-4 ml-2" />
                      بناء وتحميل ملف الخط
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">📊 إحصائيات</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p>📄 <strong>صفحات الأطلس:</strong> {textures.length}</p>
                    <p>🔤 <strong>الحروف المكتشفة:</strong> {glyphs.length}</p>
                    <p>🇸🇦 <strong>حروف عربية:</strong> {glyphs.filter(g => g.code >= 0x0600).length}</p>
                    <p>📏 <strong>حجم الملف:</strong> {fontData ? `${(fontData.length / 1024 / 1024).toFixed(1)} MB` : "—"}</p>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
