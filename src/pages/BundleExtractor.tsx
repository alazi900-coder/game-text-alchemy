import { useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Upload, Download, FileText, Package, ArrowLeft, Info,
  CheckCircle2, AlertTriangle, Loader2, Search, Archive, Eye,
  RefreshCw, Replace, PackagePlus
} from "lucide-react";
import {
  extractBundleAssets, isMsbt, getBundleSummary, repackBundle,
  type UnityBundleInfo, type ExtractedAsset, type RepackResult
} from "@/lib/unity-asset-bundle";

interface LoadedBundle {
  fileName: string;
  info: UnityBundleInfo;
  assets: ExtractedAsset[];
  decompressedData: Uint8Array;
  originalBuffer: ArrayBuffer;
}

export default function BundleExtractor() {
  const [bundle, setBundle] = useState<LoadedBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [replacements, setReplacements] = useState<Map<string, Uint8Array>>(new Map());
  const [repackResult, setRepackResult] = useState<RepackResult | null>(null);
  const [repacking, setRepacking] = useState(false);
  const [repackError, setRepackError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const batchReplaceRef = useRef<HTMLInputElement>(null);

  const handleFileLoad = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError("");
    setBundle(null);
    setSelectedAsset(null);
    setReplacements(new Map());
    setRepackResult(null);

    try {
      const buffer = await file.arrayBuffer();
      const { info, assets, decompressedData } = await extractBundleAssets(buffer);
      setBundle({ fileName: file.name, info, assets, decompressedData, originalBuffer: buffer });
    } catch (err: any) {
      setError(err.message || "فشل في قراءة الملف");
    } finally {
      setLoading(false);
    }
  }, []);

  const downloadAsset = useCallback((asset: ExtractedAsset) => {
    const blob = new Blob([new Uint8Array(asset.data)]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ext = isMsbt(asset.data) ? ".msbt" : ".bytes";
    a.download = asset.name.endsWith(ext) ? asset.name : `${asset.name}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadAllMsbt = useCallback(() => {
    if (!bundle) return;
    const msbtAssets = bundle.assets.filter(a => isMsbt(a.data));
    msbtAssets.forEach(a => downloadAsset(a));
  }, [bundle, downloadAsset]);

  /** Replace a single asset with an uploaded file */
  const handleReplaceAsset = useCallback((assetName: string) => {
    // Store which asset to replace, then trigger file picker
    replaceRef.current?.setAttribute("data-asset-name", assetName);
    replaceRef.current?.click();
  }, []);

  const onReplaceFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const assetName = replaceRef.current?.getAttribute("data-asset-name");
    if (!file || !assetName) return;

    const data = new Uint8Array(await file.arrayBuffer());
    setReplacements(prev => {
      const next = new Map(prev);
      next.set(assetName, data);
      return next;
    });
    setRepackResult(null);
    e.target.value = "";
  }, []);

  /** Batch replace: upload multiple MSBT files matched by name */
  const handleBatchReplace = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !bundle) return;

    const newReplacements = new Map(replacements);
    let matched = 0;

    for (const file of Array.from(files)) {
      const data = new Uint8Array(await file.arrayBuffer());
      // Try to match by filename
      const baseName = file.name.replace(/\.msbt$/i, "").replace(/\.bytes$/i, "");
      const matchedAsset = bundle.assets.find(a => {
        const aBase = a.name.replace(/\.msbt$/i, "").replace(/\.bytes$/i, "");
        return aBase === baseName || a.name === file.name || a.name === baseName;
      });
      if (matchedAsset) {
        newReplacements.set(matchedAsset.name, data);
        matched++;
      }
    }

    setReplacements(newReplacements);
    setRepackResult(null);
    e.target.value = "";
  }, [bundle, replacements]);

  /** Remove a replacement */
  const removeReplacement = useCallback((assetName: string) => {
    setReplacements(prev => {
      const next = new Map(prev);
      next.delete(assetName);
      return next;
    });
    setRepackResult(null);
  }, []);

  /** Execute repack */
  const handleRepack = useCallback(async () => {
    if (!bundle || replacements.size === 0) return;

    setRepacking(true);
    setRepackError("");
    setRepackResult(null);

    try {
      // Use setTimeout to allow UI to update
      await new Promise(resolve => setTimeout(resolve, 50));
      const result = repackBundle(
        bundle.originalBuffer,
        bundle.info,
        bundle.decompressedData,
        bundle.assets,
        replacements,
      );
      setRepackResult(result);
    } catch (err: any) {
      setRepackError(err.message || "فشل في إعادة الحزم");
    } finally {
      setRepacking(false);
    }
  }, [bundle, replacements]);

  /** Download repacked bundle */
  const downloadRepackedBundle = useCallback(() => {
    if (!repackResult || !bundle) return;
    const blob = new Blob([repackResult.buffer]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = bundle.fileName.replace(/\.bundle$/i, "_arabic.bundle");
    a.click();
    URL.revokeObjectURL(url);
  }, [repackResult, bundle]);

  const filteredAssets = bundle?.assets.filter(a => {
    if (!filter) return true;
    return a.name.toLowerCase().includes(filter.toLowerCase()) || a.type.toLowerCase().includes(filter.toLowerCase());
  }) ?? [];

  const msbtCount = bundle?.assets.filter(a => isMsbt(a.data)).length ?? 0;
  const replaceableCount = bundle?.assets.filter(a => a.textAssetDataLenOffset >= 0).length ?? 0;
  const previewAsset = selectedAsset !== null ? bundle?.assets[selectedAsset] : null;

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Hidden file inputs */}
      <input ref={replaceRef} type="file" className="hidden" accept=".msbt,.bytes" onChange={onReplaceFileSelected} />
      <input ref={batchReplaceRef} type="file" className="hidden" accept=".msbt,.bytes" multiple onChange={handleBatchReplace} />

      {/* Header */}
      <div className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/fire-emblem">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <Archive className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-lg font-bold">فاك ملفات Unity Asset Bundle</h1>
            <p className="text-xs text-muted-foreground">استخراج وإعادة حزم ملفات MSBT و TextAsset</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Upload Section */}
        <Card className="border-dashed border-2 hover:border-primary/50 transition-colors">
          <CardContent className="p-8 text-center">
            <input
              ref={fileRef}
              type="file"
              accept=".bundle,.unity3d,.assets,.bytes"
              className="hidden"
              onChange={handleFileLoad}
            />
            {loading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
                <p className="text-muted-foreground">جاري تحليل الملف وفك الضغط...</p>
              </div>
            ) : (
              <div
                className="flex flex-col items-center gap-3 cursor-pointer"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="w-12 h-12 text-muted-foreground" />
                <div>
                  <p className="font-medium">اسحب ملف Bundle هنا أو اضغط للاختيار</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    يدعم ملفات .bundle و .unity3d و .assets (تنسيق UnityFS)
                  </p>
                </div>
                <Button variant="outline" className="mt-2">
                  <Upload className="w-4 h-4 ml-2" />
                  اختيار ملف
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error */}
        {error && (
          <Card className="border-destructive bg-destructive/10">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
              <div>
                <p className="font-medium text-destructive">خطأ في قراءة الملف</p>
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info Card */}
        {!bundle && !loading && !error && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="w-5 h-5 text-primary" />
                ما هي ملفات Unity Asset Bundle؟
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                ملفات Asset Bundle هي حاويات تستخدمها ألعاب Unity لتخزين الموارد مثل النصوص والصور والأصوات.
                في <strong>Fire Emblem Engage</strong>، ملفات النصوص (MSBT) مخزنة داخل ملفات <code dir="ltr">.bytes.bundle</code>.
              </p>
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <p className="font-medium text-foreground">الخطوات:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>ارفع ملف <code dir="ltr">.bundle</code> من مجلد اللعبة</li>
                  <li>الأداة تفك الضغط (LZ4) وتحلل البنية الداخلية</li>
                  <li>استخرج ملفات MSBT للترجمة في المحرر</li>
                  <li>ارفع الملفات المترجمة وأعد حزم الـ Bundle</li>
                  <li>حمّل الـ Bundle الجديد وضعه في مجلد اللعبة</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bundle Info + Assets */}
        {bundle && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <Package className="w-8 h-8 mx-auto mb-2 text-primary" />
                  <p className="text-2xl font-bold">{bundle.assets.length}</p>
                  <p className="text-sm text-muted-foreground">ملف داخل الحزمة</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-primary" />
                  <p className="text-2xl font-bold">{msbtCount}</p>
                  <p className="text-sm text-muted-foreground">ملف MSBT</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <Replace className="w-8 h-8 mx-auto mb-2 text-accent-foreground" />
                  <p className="text-2xl font-bold">{replacements.size}</p>
                  <p className="text-sm text-muted-foreground">ملف مستبدل</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <Archive className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-2xl font-bold">{(bundle.decompressedData.length / 1024).toFixed(0)} KB</p>
                  <p className="text-sm text-muted-foreground">الحجم بعد الفك</p>
                </CardContent>
              </Card>
            </div>

            {/* Bundle Details */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">تفاصيل الحزمة</CardTitle>
                <CardDescription>{bundle.fileName}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre dir="ltr" className="text-xs bg-muted/50 rounded p-3 whitespace-pre-wrap font-mono">
                  {getBundleSummary(bundle.info)}
                </pre>
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex gap-3 flex-wrap">
              {msbtCount > 0 && (
                <>
                  <Button onClick={downloadAllMsbt} className="gap-2">
                    <Download className="w-4 h-4" />
                    تحميل جميع ملفات MSBT ({msbtCount})
                  </Button>
                  <Link to="/fire-emblem/process">
                    <Button variant="outline" className="gap-2">
                      <FileText className="w-4 h-4" />
                      معالجة MSBT
                    </Button>
                  </Link>
                </>
              )}
              {replaceableCount > 0 && (
                <Button variant="outline" className="gap-2" onClick={() => batchReplaceRef.current?.click()}>
                  <PackagePlus className="w-4 h-4" />
                  رفع ملفات مترجمة (دفعة)
                </Button>
              )}
            </div>

            {/* ─── Repack Section ─── */}
            {replacements.size > 0 && (
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <PackagePlus className="w-5 h-5 text-primary" />
                    إعادة حزم الملفات ({replacements.size} ملف مستبدل)
                  </CardTitle>
                  <CardDescription>
                    الملفات التالية سيتم استبدالها داخل الـ Bundle الأصلي
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Replacement list */}
                  <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                    {Array.from(replacements.entries()).map(([name, data]) => {
                      const originalAsset = bundle.assets.find(a => a.name === name);
                      const originalSize = originalAsset?.data.length ?? 0;
                      const sizeDiff = data.length - originalSize;
                      return (
                        <div key={name} className="flex items-center justify-between p-3 bg-card">
                          <div className="flex items-center gap-3 min-w-0">
                            <FileText className="w-4 h-4 text-primary shrink-0" />
                            <div className="min-w-0">
                              <p className="font-mono text-sm truncate" dir="ltr">{name}</p>
                              <p className="text-xs text-muted-foreground">
                                {(originalSize / 1024).toFixed(1)} KB → {(data.length / 1024).toFixed(1)} KB
                                <span className={sizeDiff > 0 ? "text-destructive mr-1" : sizeDiff < 0 ? "text-primary mr-1" : "mr-1"}>
                                  {" "}({sizeDiff > 0 ? "+" : ""}{(sizeDiff / 1024).toFixed(1)} KB)
                                </span>
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeReplacement(name)}
                            className="text-destructive hover:text-destructive"
                          >
                            إزالة
                          </Button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Repack button */}
                  <div className="flex gap-3 items-center">
                    <Button
                      onClick={handleRepack}
                      disabled={repacking}
                      className="gap-2"
                    >
                      {repacking ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      {repacking ? "جاري إعادة الحزم..." : "إعادة حزم الـ Bundle"}
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={() => batchReplaceRef.current?.click()}>
                      <Upload className="w-4 h-4" />
                      إضافة ملفات أخرى
                    </Button>
                  </div>

                  {/* Repack error */}
                  {repackError && (
                    <div className="flex items-center gap-2 text-destructive text-sm">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      {repackError}
                    </div>
                  )}

                  {/* Repack result */}
                  {repackResult && (
                    <div className="bg-card rounded-lg border border-primary/30 p-4 space-y-3">
                      <div className="flex items-center gap-2 text-primary">
                        <CheckCircle2 className="w-5 h-5" />
                        <p className="font-medium">تم إعادة الحزم بنجاح!</p>
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-center text-sm">
                        <div>
                          <p className="text-2xl font-bold">{repackResult.replacedCount}</p>
                          <p className="text-muted-foreground">ملف مستبدل</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{(repackResult.originalSize / 1024).toFixed(0)} KB</p>
                          <p className="text-muted-foreground">الحجم الأصلي</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{(repackResult.newSize / 1024).toFixed(0)} KB</p>
                          <p className="text-muted-foreground">الحجم الجديد</p>
                        </div>
                      </div>
                      <Button onClick={downloadRepackedBundle} className="w-full gap-2">
                        <Download className="w-4 h-4" />
                        تحميل الـ Bundle المعدّل
                      </Button>
                      <p className="text-xs text-muted-foreground text-center">
                        ضع الملف في المسار الأصلي: <code dir="ltr">romfs/StreamingAssets/aa/Switch/fe_assets_message/</code>
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Assets List */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">الملفات المستخرجة</CardTitle>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      className="h-9 rounded-md border border-input bg-background pr-9 pl-3 text-sm w-56"
                      placeholder="بحث..."
                      value={filter}
                      onChange={e => setFilter(e.target.value)}
                      dir="auto"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border max-h-96 overflow-y-auto">
                  {filteredAssets.map((asset, idx) => {
                    const msbt = isMsbt(asset.data);
                    const originalIdx = bundle.assets.indexOf(asset);
                    const isReplaced = replacements.has(asset.name);
                    const canReplace = asset.textAssetDataLenOffset >= 0;
                    return (
                      <div
                        key={idx}
                        className={`flex items-center justify-between p-3 hover:bg-muted/50 cursor-pointer transition-colors ${
                          selectedAsset === originalIdx ? "bg-primary/10" : ""
                        } ${isReplaced ? "bg-primary/5 border-r-2 border-r-primary" : ""}`}
                        onClick={() => setSelectedAsset(selectedAsset === originalIdx ? null : originalIdx)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {msbt ? (
                            <FileText className="w-5 h-5 text-primary shrink-0" />
                          ) : (
                            <Package className="w-5 h-5 text-muted-foreground shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="font-mono text-sm truncate" dir="ltr">{asset.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {asset.type} · {(asset.data.length / 1024).toFixed(1)} KB
                              {msbt && <span className="text-primary font-medium mr-2"> · MSBT ✓</span>}
                              {isReplaced && <span className="text-accent-foreground font-medium mr-2"> · مستبدل ✓</span>}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {canReplace && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="استبدال هذا الملف"
                              onClick={(e) => { e.stopPropagation(); handleReplaceAsset(asset.name); }}
                            >
                              <Replace className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); setSelectedAsset(originalIdx); }}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); downloadAsset(asset); }}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {filteredAssets.length === 0 && (
                    <p className="text-center text-muted-foreground py-8">لا توجد نتائج</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Preview */}
            {previewAsset && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Eye className="w-5 h-5" />
                    معاينة: <span dir="ltr" className="font-mono">{previewAsset.name}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <AssetPreview asset={previewAsset} />
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ───────── Asset Preview Component ───────── */
function AssetPreview({ asset }: { asset: ExtractedAsset }) {
  const isMsbtFile = isMsbt(asset.data);

  const hexLines: string[] = [];
  const previewLen = Math.min(asset.data.length, 512);
  for (let i = 0; i < previewLen; i += 16) {
    const hexParts: string[] = [];
    let ascii = "";
    for (let j = 0; j < 16 && i + j < previewLen; j++) {
      const b = asset.data[i + j];
      hexParts.push(b.toString(16).padStart(2, "0"));
      ascii += b >= 32 && b < 127 ? String.fromCharCode(b) : ".";
    }
    hexLines.push(
      `${i.toString(16).padStart(8, "0")}  ${hexParts.join(" ").padEnd(48)}  ${ascii}`
    );
  }

  let msbtStrings: string[] = [];
  if (isMsbtFile) {
    try {
      const view = new DataView(
        (asset.data.buffer as ArrayBuffer).slice(asset.data.byteOffset, asset.data.byteOffset + asset.data.byteLength)
      );
      let current = "";
      for (let i = 0; i < asset.data.length - 1; i += 2) {
        const code = view.getUint16(i, true);
        if (code >= 32 && code < 0xFFFE) {
          current += String.fromCharCode(code);
        } else if (current.length > 2) {
          msbtStrings.push(current);
          current = "";
        } else {
          current = "";
        }
      }
      if (current.length > 2) msbtStrings.push(current);
      msbtStrings = [...new Set(msbtStrings)].slice(0, 50);
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-4">
      {isMsbtFile && msbtStrings.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            نصوص مستخرجة ({msbtStrings.length})
          </p>
          <div className="bg-muted/50 rounded-lg p-3 max-h-48 overflow-y-auto space-y-1">
            {msbtStrings.map((s, i) => (
              <p key={i} className="text-sm font-mono" dir="auto">{s}</p>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="text-sm font-medium mb-2">Hex Dump (أول {previewLen} بايت)</p>
        <pre dir="ltr" className="text-xs bg-muted/50 rounded-lg p-3 max-h-64 overflow-y-auto font-mono leading-relaxed">
          {hexLines.join("\n")}
        </pre>
      </div>
    </div>
  );
}
