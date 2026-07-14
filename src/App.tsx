import React, { useState, useEffect, useRef } from "react";
import {
  Upload,
  X,
  FileText,
  Plus,
  Copy,
  Download,
  RotateCcw,
  Check,
  Image as ImageIcon,
  Loader2,
  File,
} from "lucide-react";
import { Metric, TableData, Screenshot, SourcesState, FundType } from "./types";
import {
  fileToBase64,
  computeChange,
  formatChange,
  isFavorableMove,
  getHoldStatement,
  getThemeColors,
} from "./utils";

export default function App() {
  // A. Fund & score
  const [fund, setFund] = useState<FundType>("Growth Mantra");
  const [periodOverride, setPeriodOverride] = useState("");
  const [companyOverride, setCompanyOverride] = useState("");
  const [score, setScore] = useState<1 | 2 | 3>(3);

  // B. Results screenshots
  const [resultsScreenshots, setResultsScreenshots] = useState<Screenshot[]>([]);

  // C. Source documents
  const [sources, setSources] = useState<SourcesState>({
    quarterlyResults: { file: null, text: "" },
    investorPresentation: { file: null, text: "" },
    pressRelease: { file: null, text: "" },
  });

  // D. Company logo
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [logoPasteModeArmed, setLogoPasteModeArmed] = useState(false);

  // App flow states
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Step outputs
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [highlights, setHighlights] = useState<string[]>([]);

  // Export & preview state
  const [isCapturing, setIsCapturing] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // File input refs
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const colors = getThemeColors(fund);

  // Global Paste Listener (Ctrl+V)
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          if (!file) continue;

          e.preventDefault();

          const reader = new FileReader();
          reader.onload = (event) => {
            const base64Data = event.target?.result as string;

            if (logoPasteModeArmed) {
              setCompanyLogo(base64Data);
              setLogoPasteModeArmed(false);
            } else {
              setResultsScreenshots((prev) => [
                ...prev,
                {
                  id: Date.now() + i,
                  mimeType: file.type,
                  data: base64Data,
                  name: `Pasted_Image_${new Date().toLocaleTimeString().replace(/\s/g, "")}.png`,
                },
              ]);
            }
          };
          reader.readAsDataURL(file);
          break; // Process one image at a time
        }
      }
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => {
      window.removeEventListener("paste", handleGlobalPaste);
    };
  }, [logoPasteModeArmed]);

  // Handle Drag & Drop for screenshots
  const handleScreenshotDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files) as File[];
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const base64 = await fileToBase64(file);
      setResultsScreenshots((prev) => [
        ...prev,
        {
          id: Date.now() + i,
          mimeType: file.type,
          data: base64,
          name: file.name,
        },
      ]);
    }
  };

  // Step 1 Trigger: Extract Table
  const handleExtractTable = async () => {
    if (resultsScreenshots.length === 0) {
      setError("Please add at least one Results Screenshot before extracting.");
      return;
    }

    setLoading(true);
    setError(null);
    setLoadingMessage("Gemini is reading results screenshots and documents...");

    try {
      const response = await fetch("/api/extract-table", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resultsScreenshots: resultsScreenshots.map((s) => ({
            data: s.data,
            mimeType: s.mimeType,
          })),
          sources: sources,
          overrides: {
            companyName: companyOverride || undefined,
            period: periodOverride || undefined,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to extract table data");
      }

      // Format response metrics with robust IDs
      const mappedMetrics: Metric[] = (data.metrics || []).map(
        (m: any, index: number) => ({
          id: `metric_${Date.now()}_${index}`,
          label: m.label || "Metric Name",
          current: m.current !== undefined ? m.current : null,
          prev_q: m.prev_q !== undefined ? m.prev_q : null,
          prev_y: m.prev_y !== undefined ? m.prev_y : null,
          is_ratio: !!m.is_ratio,
          lower_is_better: !!m.lower_is_better,
          decimals: m.decimals !== undefined ? m.decimals : m.is_ratio ? 2 : 0,
        })
      );

      setTableData({
        company: data.company || companyOverride || "Listed Company",
        period: data.period || periodOverride || "Q1 FY27",
        unit: data.unit || "₹ CR.",
        col_current: data.col_current || "Current Period",
        col_prev_q: data.col_prev_q || "Previous Quarter",
        col_prev_y: data.col_prev_y || "Previous Year",
        metrics: mappedMetrics,
      });

      setStep(1); // Set step 1 output
    } catch (err: any) {
      setError(err.message || "Something went wrong during extraction.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2 Trigger: Generate Commentary
  const handleWritePoints = async () => {
    if (!tableData) return;

    setLoading(true);
    setError(null);
    setLoadingMessage("Gemini is analyzing the confirmed numbers & writing client commentary...");

    try {
      const scoreText = getHoldStatement(score, fund);
      const response = await fetch("/api/write-commentary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableData: tableData,
          resultsScreenshots: resultsScreenshots.map((s) => ({
            data: s.data,
            mimeType: s.mimeType,
          })),
          sources: sources,
          fund: fund,
          scoreText: scoreText,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate commentary");
      }

      setHighlights(data.highlights || []);
      setStep(2); // Advance to step 2 view
    } catch (err: any) {
      setError(err.message || "Failed to write highlight points.");
    } finally {
      setLoading(false);
    }
  };

  // Modify individual metric cell
  const handleMetricChange = (
    id: string,
    field: "label" | "current" | "prev_q" | "prev_y",
    valString: string
  ) => {
    if (!tableData) return;

    const updatedMetrics = tableData.metrics.map((m) => {
      if (m.id !== id) return m;

      if (field === "label") {
        return { ...m, label: valString };
      } else {
        const clean = valString.trim();
        const parsed = clean === "" ? null : parseFloat(clean);
        return { ...m, [field]: parsed === null || isNaN(parsed) ? null : parsed };
      }
    });

    setTableData({
      ...tableData,
      metrics: updatedMetrics,
    });
  };

  const toggleMetricRatio = (id: string) => {
    if (!tableData) return;
    setTableData({
      ...tableData,
      metrics: tableData.metrics.map((m) => {
        if (m.id !== id) return m;
        const nextIsRatio = !m.is_ratio;
        return {
          ...m,
          is_ratio: nextIsRatio,
          decimals: nextIsRatio ? 2 : 0,
        };
      }),
    });
  };

  const toggleMetricLowerIsBetter = (id: string) => {
    if (!tableData) return;
    setTableData({
      ...tableData,
      metrics: tableData.metrics.map((m) => {
        if (m.id !== id) return m;
        return { ...m, lower_is_better: !m.lower_is_better };
      }),
    });
  };

  const deleteMetricRow = (id: string) => {
    if (!tableData) return;
    setTableData({
      ...tableData,
      metrics: tableData.metrics.filter((m) => m.id !== id),
    });
  };

  const addMetricRow = () => {
    if (!tableData) return;
    const newMetric: Metric = {
      id: `metric_added_${Date.now()}`,
      label: "New Financial Metric",
      current: null,
      prev_q: null,
      prev_y: null,
      is_ratio: false,
      lower_is_better: false,
      decimals: 0,
    };
    setTableData({
      ...tableData,
      metrics: [...tableData.metrics, newMetric],
    });
  };

  // Source document upload parser
  const handleSourceUpload = async (
    key: "quarterlyResults" | "investorPresentation" | "pressRelease",
    file: File
  ) => {
    const base64 = await fileToBase64(file);
    setSources((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        file: {
          mimeType: file.type,
          data: base64,
          name: file.name,
        },
      },
    }));
  };

  const removeSourceFile = (key: "quarterlyResults" | "investorPresentation" | "pressRelease") => {
    setSources((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        file: null,
      },
    }));
  };

  const handleSourceTextChange = (
    key: "quarterlyResults" | "investorPresentation" | "pressRelease",
    text: string
  ) => {
    setSources((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        text: text,
      },
    }));
  };

  // Export Actions
  const handleDownloadCardPng = () => {
    setIsCapturing(true);
    setTimeout(async () => {
      const element = document.getElementById("table-card");
      if (element && (window as any).html2canvas) {
        try {
          const canvas = await (window as any).html2canvas(element, {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
          });
          const imgData = canvas.toDataURL("image/png");
          const link = document.createElement("a");
          link.download = `${tableData?.company || "Company"}_${tableData?.period || "Results"}_Card.png`;
          link.href = imgData;
          link.click();
        } catch (err) {
          console.error("Capture Failed:", err);
        }
      }
      setIsCapturing(false);
    }, 100);
  };

  const handleDownloadFullPng = () => {
    setIsCapturing(true);
    setTimeout(async () => {
      const element = document.getElementById("full-card-commentary");
      if (element && (window as any).html2canvas) {
        try {
          const canvas = await (window as any).html2canvas(element, {
            scale: 2,
            useCORS: true,
            backgroundColor: "#F2F5F4",
          });
          const imgData = canvas.toDataURL("image/png");
          const link = document.createElement("a");
          link.download = `${tableData?.company || "Company"}_${tableData?.period || "Results"}_FullCommentary.png`;
          link.href = imgData;
          link.click();
        } catch (err) {
          console.error("Capture Failed:", err);
        }
      }
      setIsCapturing(false);
    }, 100);
  };

  const handleCopyCommentaryText = () => {
    if (!tableData) return;
    const highlightsText = highlights.map((h) => `• ${h}`).join("\n\n");
    const text = `Result Commentary:
${fund} – ${tableData.company}
${tableData.period}

Turtle Score – ${score}
${getHoldStatement(score, fund)}

Key Business Highlights:
${highlightsText}`;

    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  return (
    <div className="flex flex-col min-h-screen font-sans">
      {/* Top Banner App Header */}
      <header
        style={{ backgroundColor: colors.primary }}
        className="text-white py-4 px-6 shadow-md transition-colors duration-300 flex justify-between items-center"
      >
        <div className="flex items-center gap-3">
          <div className="bg-white p-1 rounded-lg">
            {/* Minimal Turtle Wealth Logo icon */}
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={colors.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12A10 10 0 0 1 12 2z"/>
              <path d="M12 6a6 6 0 0 1 6 6c0 3.314-2.686 6-6 6a6 6 0 0 1-6-6 6 6 0 0 1 6-6z"/>
              <circle cx="12" cy="12" r="2"/>
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-display font-extrabold tracking-tight">
              Turtle ResultsCard
            </h1>
            <p className="text-xs text-white/80 font-medium">
              Turtle Wealth • Portfolio Management Service
            </p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full text-xs font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          Ready for Analysis
        </div>
      </header>

      {/* Main Body Grid Layout */}
      <div className="flex-1 w-full max-w-[1700px] mx-auto p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: Control Panel (Rounded 12px panel) */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200/80 shadow-sm p-6 flex flex-col h-fit gap-6">
          
          {/* A. Stepper indicator at top */}
          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => tableData && setStep(1)}
              disabled={!tableData}
              className={`flex-1 py-2 text-xs font-display font-bold rounded-md transition-all duration-200 ${
                step === 1
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-900 disabled:opacity-50"
              }`}
            >
              Step 1 · Build table
            </button>
            <button
              onClick={() => tableData && highlights.length > 0 && setStep(2)}
              disabled={!tableData || highlights.length === 0}
              className={`flex-1 py-2 text-xs font-display font-bold rounded-md transition-all duration-200 ${
                step === 2
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-900 disabled:opacity-50"
              }`}
            >
              Step 2 · Write points
            </button>
          </div>

          <hr className="border-slate-100" />

          {/* Section A: Fund & Score */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span
                style={{ backgroundColor: colors.primary }}
                className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center transition-colors duration-300"
              >
                1
              </span>
              <h2 className="text-sm font-display font-bold uppercase tracking-wider text-slate-700">
                Fund &amp; Scorecard Settings
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Fund Portfolio
                </label>
                <select
                  value={fund}
                  onChange={(e) => setFund(e.target.value as FundType)}
                  className="w-full text-sm font-medium border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="Growth Mantra">Growth Mantra (Teal)</option>
                  <option value="Wealth Mantra">Wealth Mantra (Deep Red)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Turtle Score
                </label>
                <div className="flex bg-slate-100 p-0.5 rounded-lg">
                  {([1, 2, 3] as const).map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => setScore(sc)}
                      style={{
                        backgroundColor: score === sc ? colors.primary : "transparent",
                        color: score === sc ? "#fff" : "inherit",
                      }}
                      className="flex-1 py-1.5 text-xs font-extrabold rounded-md transition-all duration-200"
                    >
                      {sc}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Hold Wording Sentence live preview */}
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100 text-xs text-slate-600 italic">
              <span className="font-bold block text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                Statement Live Preview
              </span>
              "{getHoldStatement(score, fund)}"
            </div>

            {/* Overrides */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 pt-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Company Name (Override)
                </label>
                <input
                  type="text"
                  value={companyOverride}
                  onChange={(e) => setCompanyOverride(e.target.value)}
                  placeholder="e.g. Indian Bank"
                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Period Name (Override)
                </label>
                <input
                  type="text"
                  value={periodOverride}
                  onChange={(e) => setPeriodOverride(e.target.value)}
                  placeholder="e.g. Q1 FY27"
                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Section B: Results Screenshots */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span
                style={{ backgroundColor: colors.primary }}
                className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center transition-colors duration-300"
              >
                2
              </span>
              <h2 className="text-sm font-display font-bold uppercase tracking-wider text-slate-700">
                Results Screenshots
              </h2>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleScreenshotDrop}
              onClick={() => screenshotInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:bg-slate-50 transition cursor-pointer flex flex-col items-center justify-center gap-2 group"
            >
              <input
                type="file"
                multiple
                accept="image/*"
                ref={screenshotInputRef}
                onChange={async (e) => {
                  if (e.target.files) {
                    const files = Array.from(e.target.files) as File[];
                    for (let i = 0; i < files.length; i++) {
                      const base64 = await fileToBase64(files[i]);
                      setResultsScreenshots((prev) => [
                        ...prev,
                        {
                          id: Date.now() + i,
                          mimeType: files[i].type,
                          data: base64,
                          name: files[i].name,
                        },
                      ]);
                    }
                  }
                }}
                className="hidden"
              />
              <div className="bg-slate-100 p-3 rounded-full text-slate-500 group-hover:text-slate-700 transition">
                <Upload size={20} />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-700">
                  Drag &amp; drop results screenshots here
                </p>
                <p className="text-[10px] text-slate-400 mt-1">
                  Or click to browse • Supports clipboard pasting (Ctrl+V) anywhere on the page
                </p>
              </div>
            </div>

            {/* Image thumbnails display */}
            {resultsScreenshots.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {resultsScreenshots.map((shot) => (
                  <div
                    key={shot.id}
                    className="relative w-16 h-16 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 group shadow-xs"
                  >
                    <img
                      src={shot.data}
                      alt={shot.name}
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setResultsScreenshots((prev) => prev.filter((s) => s.id !== shot.id));
                      }}
                      className="absolute top-1 right-1 bg-red-500/80 hover:bg-red-600 text-white rounded-full p-0.5"
                    >
                      <X size={10} />
                    </button>
                    <div className="absolute bottom-0 inset-x-0 bg-slate-900/60 text-[8px] text-white truncate px-1 text-center font-mono">
                      {shot.name.substring(0, 10)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <hr className="border-slate-100" />

          {/* Section C: Source documents */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span
                style={{ backgroundColor: colors.primary }}
                className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center transition-colors duration-300"
              >
                3
              </span>
              <h2 className="text-sm font-display font-bold uppercase tracking-wider text-slate-700">
                Source Documents (Optional)
              </h2>
            </div>

            <div className="space-y-4">
              {(["quarterlyResults", "investorPresentation", "pressRelease"] as const).map((key) => {
                const names: Record<string, string> = {
                  quarterlyResults: "1. Quarterly Results",
                  investorPresentation: "2. Investor Presentation",
                  pressRelease: "3. Press Release",
                };
                const val = sources[key];

                return (
                  <div key={key} className="border border-slate-100 rounded-lg p-3 bg-slate-50/50">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-slate-600">{names[key]}</span>
                      {val.file ? (
                        <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-800 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                          <File size={10} />
                          <span className="truncate max-w-[120px] font-mono">{val.file.name}</span>
                          <button
                            onClick={() => removeSourceFile(key)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ) : (
                        <label className="cursor-pointer text-[10px] font-bold text-slate-500 hover:text-slate-700 flex items-center gap-1">
                          <Upload size={10} />
                          Attach File
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                handleSourceUpload(key, e.target.files[0]);
                              }
                            }}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>

                    <textarea
                      value={val.text}
                      onChange={(e) => handleSourceTextChange(key, e.target.value)}
                      placeholder="Or paste relevant source text directly here..."
                      className="w-full h-16 text-xs bg-white border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-slate-300 resize-none"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Section D: Company logo */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span
                style={{ backgroundColor: colors.primary }}
                className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center transition-colors duration-300"
              >
                4
              </span>
              <h2 className="text-sm font-display font-bold uppercase tracking-wider text-slate-700">
                Company Logo (Optional)
              </h2>
            </div>

            <div className="flex gap-4 items-center">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={async (e) => {
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files) as File[];
                  if (files[0] && files[0].type.startsWith("image/")) {
                    const base64 = await fileToBase64(files[0]);
                    setCompanyLogo(base64);
                  }
                }}
                onClick={() => logoInputRef.current?.click()}
                className={`w-16 h-16 rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition ${
                  companyLogo ? "border-emerald-500" : "border-slate-200 hover:border-slate-400"
                }`}
              >
                <input
                  type="file"
                  accept="image/*"
                  ref={logoInputRef}
                  onChange={async (e) => {
                    if (e.target.files && e.target.files[0]) {
                      const base64 = await fileToBase64(e.target.files[0]);
                      setCompanyLogo(base64);
                    }
                  }}
                  className="hidden"
                />
                {companyLogo ? (
                  <img src={companyLogo} alt="Logo" className="w-full h-full object-contain p-1" />
                ) : (
                  <ImageIcon className="text-slate-400" size={16} />
                )}
              </div>

              <div className="flex-1">
                <button
                  type="button"
                  onClick={() => setLogoPasteModeArmed(!logoPasteModeArmed)}
                  style={{
                    borderColor: logoPasteModeArmed ? "#f59e0b" : "transparent",
                    backgroundColor: logoPasteModeArmed ? "#fef3c7" : "#f1f5f9",
                    color: logoPasteModeArmed ? "#b45309" : "#475569",
                  }}
                  className={`w-full py-2 text-xs font-bold rounded-lg border flex items-center justify-center gap-1.5 transition duration-200`}
                >
                  {logoPasteModeArmed ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      Paste Mode Active (Ctrl+V Logo)
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      Arm Logo Paste Mode
                    </>
                  )}
                </button>
                <p className="text-[10px] text-slate-400 mt-1">
                  {companyLogo
                    ? "Logo uploaded. Drag & drop another to replace."
                    : "Arm paste mode, then press Ctrl+V to paste an image for the company logo slot."}
                </p>
              </div>
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Action Trigger Block */}
          <div className="flex flex-col gap-3">
            <button
              onClick={handleExtractTable}
              disabled={loading || resultsScreenshots.length === 0}
              style={{
                backgroundColor: resultsScreenshots.length > 0 && !loading ? colors.primary : "#cbd5e1",
                cursor: resultsScreenshots.length > 0 && !loading ? "pointer" : "not-allowed",
              }}
              className="w-full py-3 text-sm font-display font-extrabold text-white rounded-lg shadow-sm hover:brightness-95 transition flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  {loadingMessage}
                </>
              ) : (
                <>
                  <FileText size={16} />
                  Extract &amp; Build Table →
                </>
              )}
            </button>

            {/* Error State Banner */}
            {error && (
              <div className="bg-red-50 text-red-800 p-3 rounded-lg border border-red-200 text-xs flex flex-col gap-1">
                <span className="font-extrabold">Extraction Failed</span>
                <p>{error}</p>
                <span className="text-[10px] text-red-500 font-semibold italic mt-1">
                  💡 Hint: Try adding a clearer, higher-resolution screenshot or verify your API key configuration.
                </span>
              </div>
            )}
          </div>

        </div>

        {/* Right Side: Output Columns / Preview Area */}
        <div className="lg:col-span-7 flex flex-col gap-6">

          {/* EMPTY STATE before any Step 1 Table Data exists */}
          {!tableData && (
            <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-12 text-center flex flex-col items-center justify-center min-h-[500px]">
              <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center text-slate-400 mb-6 shadow-inner">
                {/* Custom Big illustration icon */}
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <line x1="10" y1="9" x2="8" y2="9"/>
                </svg>
              </div>
              <h3 className="text-lg font-display font-extrabold text-slate-800 mb-2">
                Create Your Turtle ResultsCard
              </h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
                Turn blurred quarterly earnings screenshots and source PDFs into high-quality, 
                interactive, brand-conforming financial tables and expert client commentaries.
              </p>
              
              {/* Feature flow checklist */}
              <div className="text-left bg-slate-50 border border-slate-100 rounded-xl p-4 w-full max-w-sm space-y-2 mb-2">
                <div className="flex items-start gap-2.5 text-xs text-slate-600">
                  <div className="bg-slate-200 text-slate-700 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">1</div>
                  <p><strong>Upload screenshots</strong> of consolidated quarterly results or tabular earnings.</p>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-slate-600">
                  <div className="bg-slate-200 text-slate-700 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">2</div>
                  <p><strong>Optionally paste texts</strong> from Press Releases or Investor Presentations for richer context.</p>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-slate-600">
                  <div className="bg-slate-200 text-slate-700 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">3</div>
                  <p>Click <strong>"Extract &amp; Build Table"</strong> to let Gemini build your structured card.</p>
                </div>
              </div>
            </div>
          )}

          {/* TABLE AND COMMENTARY CONTAINER */}
          {tableData && (
            <div className="space-y-6">

              {/* Step Confirmation Bar */}
              {step === 1 && (
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs">
                  <div>
                    <h4 className="text-xs font-extrabold text-amber-900 uppercase tracking-wider">
                      Step 1 Completed: Verify Table
                    </h4>
                    <p className="text-xs text-amber-800">
                      Check every number below and fix anything the AI misread. Every cell is directly editable!
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handleExtractTable}
                      disabled={loading}
                      className="bg-white border border-amber-300 text-amber-900 font-bold text-xs px-3 py-1.5 rounded-lg shadow-xs hover:bg-amber-100 transition flex items-center gap-1.5"
                    >
                      <RotateCcw size={12} />
                      Re-extract
                    </button>
                    <button
                      onClick={handleWritePoints}
                      disabled={loading}
                      style={{ backgroundColor: colors.primary }}
                      className="text-white font-extrabold text-xs px-4 py-1.5 rounded-lg shadow-xs hover:brightness-95 transition flex items-center gap-1.5"
                    >
                      {loading ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          Confirm table &amp; write points →
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2 Header Toolbar / Actions (Export Bar) */}
              {step === 2 && (
                <div className="bg-white border border-slate-200 p-3 rounded-xl flex flex-wrap gap-2 items-center justify-between shadow-xs">
                  <button
                    onClick={() => setStep(1)}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-3 py-2 rounded-lg transition flex items-center gap-1"
                  >
                    ← Edit Table
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDownloadCardPng}
                      className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold text-xs px-3 py-2 rounded-lg shadow-xs transition flex items-center gap-1.5"
                    >
                      <Download size={12} />
                      Card PNG
                    </button>
                    <button
                      onClick={handleDownloadFullPng}
                      className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold text-xs px-3 py-2 rounded-lg shadow-xs transition flex items-center gap-1.5"
                    >
                      <Download size={12} />
                      Card + Commentary PNG
                    </button>
                    <button
                      onClick={handleCopyCommentaryText}
                      className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold text-xs px-3 py-2 rounded-lg shadow-xs transition flex items-center gap-1.5"
                    >
                      {copySuccess ? <Check size={12} /> : <Copy size={12} />}
                      {copySuccess ? "Copied!" : "Copy Text"}
                    </button>
                  </div>
                </div>
              )}

              {/* THE EXPORTABLE SCREEN CONTAINER (Includes table card + commentary block) */}
              <div id="full-card-commentary" className="space-y-6">

                {/* THE TURTLE WEALTH HOUSE CARD */}
                <div
                  id="table-card"
                  style={{ borderColor: colors.primary }}
                  className="bg-white border-[4px] rounded-sm shadow-md overflow-hidden transition-colors duration-300 w-full"
                >
                  
                  {/* 1. Logo Row */}
                  <div className="p-4 flex justify-between items-end bg-white border-b border-slate-100">
                    <div>
                      {/* Brand Logo Wordmark */}
                      <div className="font-display font-extrabold text-2xl tracking-tight text-slate-800 select-none">
                        T<span style={{ color: colors.primary }} className="transition-colors duration-300">u</span>rtle<span className="font-light italic text-slate-500">wealth</span>™
                      </div>
                      <div className="text-[10px] text-slate-400 italic font-medium tracking-widest pl-0.5">
                        beyond profits…
                      </div>
                    </div>

                    {/* Logo area */}
                    <div className="h-10">
                      {companyLogo ? (
                        <img src={companyLogo} alt="Logo" className="h-full object-contain max-w-[120px]" />
                      ) : isCapturing ? (
                        <div className="h-full" />
                      ) : (
                        <button
                          onClick={() => setLogoPasteModeArmed(true)}
                          className={`h-full border border-dashed rounded px-3 flex items-center justify-center text-[10px] font-bold transition duration-200 ${
                            logoPasteModeArmed
                              ? "border-amber-500 bg-amber-50 text-amber-700 animate-pulse"
                              : "border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600"
                          }`}
                        >
                          {logoPasteModeArmed ? "⚡ Paste Now" : "+ Paste Logo Here"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 2. Title Band */}
                  <div
                    style={{ backgroundColor: colors.primary }}
                    className="px-4 py-3 text-center text-white transition-colors duration-300 select-none flex justify-center items-center gap-1.5 flex-wrap"
                  >
                    {isCapturing ? (
                      <h3 className="font-display font-extrabold tracking-wide uppercase text-sm sm:text-base">
                        {tableData.company} {tableData.period} Earnings ({tableData.unit})
                      </h3>
                    ) : (
                      <div className="flex items-center gap-1 flex-wrap font-display font-extrabold tracking-wide uppercase text-sm sm:text-base">
                        <input
                          type="text"
                          value={tableData.company}
                          onChange={(e) => setTableData({ ...tableData, company: e.target.value })}
                          className="bg-transparent border-none text-white text-center focus:bg-white/20 px-2 py-0.5 rounded outline-none w-44 inline-block truncate"
                          placeholder="COMPANY"
                        />
                        <input
                          type="text"
                          value={tableData.period}
                          onChange={(e) => setTableData({ ...tableData, period: e.target.value })}
                          className="bg-transparent border-none text-white text-center focus:bg-white/20 px-2 py-0.5 rounded outline-none w-28 inline-block"
                          placeholder="PERIOD"
                        />
                        <span>Earnings (</span>
                        <input
                          type="text"
                          value={tableData.unit}
                          onChange={(e) => setTableData({ ...tableData, unit: e.target.value })}
                          className="bg-transparent border-none text-white text-center focus:bg-white/20 px-1 py-0.5 rounded outline-none w-20 inline-block"
                          placeholder="UNIT"
                        />
                        <span>)</span>
                      </div>
                    )}
                  </div>

                  {/* 3. Bordered Table Grid */}
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse border-b border-black">
                      <thead>
                        <tr className="bg-slate-50 border-b border-black">
                          <th className="border-r border-black p-2.5 text-left text-xs font-extrabold text-slate-700 w-1/3">
                            Key Financials
                          </th>
                          <th className="border-r border-black p-2 text-center text-xs font-extrabold text-slate-700 w-[14%]">
                            {isCapturing ? (
                              <span>{tableData.col_current}</span>
                            ) : (
                              <input
                                type="text"
                                value={tableData.col_current}
                                onChange={(e) =>
                                  setTableData({ ...tableData, col_current: e.target.value })
                                }
                                className="w-full bg-transparent border-none outline-none font-extrabold text-center text-slate-700 focus:bg-slate-200 rounded px-1"
                              />
                            )}
                          </th>
                          <th className="border-r border-black p-2 text-center text-xs font-extrabold text-slate-700 w-[14%]">
                            {isCapturing ? (
                              <span>{tableData.col_prev_q || "-"}</span>
                            ) : (
                              <input
                                type="text"
                                value={tableData.col_prev_q || ""}
                                onChange={(e) =>
                                  setTableData({ ...tableData, col_prev_q: e.target.value })
                                }
                                className="w-full bg-transparent border-none outline-none font-extrabold text-center text-slate-700 focus:bg-slate-200 rounded px-1"
                              />
                            )}
                          </th>
                          <th className="border-r border-black p-2 text-center text-xs font-extrabold text-slate-700 w-[14%]">
                            {isCapturing ? (
                              <span>{tableData.col_prev_y || "-"}</span>
                            ) : (
                              <input
                                type="text"
                                value={tableData.col_prev_y || ""}
                                onChange={(e) =>
                                  setTableData({ ...tableData, col_prev_y: e.target.value })
                                }
                                className="w-full bg-transparent border-none outline-none font-extrabold text-center text-slate-700 focus:bg-slate-200 rounded px-1"
                              />
                            )}
                          </th>
                          <th className="border-r border-black p-2 text-center text-xs font-extrabold text-slate-700 w-[12%]">
                            QOQ
                          </th>
                          <th className="p-2 text-center text-xs font-extrabold text-slate-700 w-[12%]">
                            YOY
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableData.metrics.map((metric) => {
                          const qoq = computeChange(metric.current, metric.prev_q, metric.is_ratio);
                          const yoy = computeChange(metric.current, metric.prev_y, metric.is_ratio);

                          const isQoqFavorable = isFavorableMove(qoq, metric.lower_is_better);
                          const isYoyFavorable = isFavorableMove(yoy, metric.lower_is_better);

                          const qoqColor =
                            isQoqFavorable === null
                              ? ""
                              : isQoqFavorable
                              ? "bg-emerald-50 text-emerald-800 font-bold"
                              : "bg-rose-50 text-rose-800 font-bold";

                          const yoyColor =
                            isYoyFavorable === null
                              ? ""
                              : isYoyFavorable
                              ? "bg-emerald-50 text-emerald-800 font-bold"
                              : "bg-rose-50 text-rose-800 font-bold";

                          return (
                            <tr
                              key={metric.id}
                              className="border-b border-black last:border-b-0 hover:bg-slate-50/50 transition group"
                            >
                              {/* Label Column */}
                              <td className="border-r border-black p-2 text-xs font-medium text-slate-900 flex justify-between items-center gap-2">
                                {isCapturing ? (
                                  <span className="font-semibold">{metric.label}</span>
                                ) : (
                                  <div className="flex-1 flex items-center gap-1.5 overflow-hidden">
                                    <button
                                      onClick={() => deleteMetricRow(metric.id)}
                                      className="text-red-400 hover:text-red-600 transition opacity-0 group-hover:opacity-100 shrink-0"
                                      title="Delete metric"
                                    >
                                      <X size={12} />
                                    </button>
                                    <input
                                      type="text"
                                      value={metric.label}
                                      onChange={(e) => handleMetricChange(metric.id, "label", e.target.value)}
                                      className="flex-1 bg-transparent border-none outline-none focus:bg-slate-100 rounded px-1 font-semibold truncate"
                                    />
                                    {/* Action button toggles */}
                                    <button
                                      onClick={() => toggleMetricRatio(metric.id)}
                                      className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 transition ${
                                        metric.is_ratio
                                          ? "bg-amber-100 text-amber-800 font-bold"
                                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                      }`}
                                      title="Toggle Ratio / Margin Format"
                                    >
                                      {metric.is_ratio ? "%" : "#"}
                                    </button>
                                    <button
                                      onClick={() => toggleMetricLowerIsBetter(metric.id)}
                                      className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 transition ${
                                        metric.lower_is_better
                                          ? "bg-purple-100 text-purple-800 font-bold"
                                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                      }`}
                                      title="Toggle Lower-Is-Better (e.g. NPAs)"
                                    >
                                      {metric.lower_is_better ? "↓ Better" : "↑ Better"}
                                    </button>
                                  </div>
                                )}
                              </td>

                              {/* Current */}
                              <td className="border-r border-black p-1 text-center text-xs font-bold text-slate-900">
                                {isCapturing ? (
                                  <span>
                                    {metric.current !== null
                                      ? metric.current.toFixed(metric.decimals) + (metric.is_ratio ? "%" : "")
                                      : "-"}
                                  </span>
                                ) : (
                                  <input
                                    type="text"
                                    value={metric.current !== null ? metric.current : ""}
                                    onChange={(e) => handleMetricChange(metric.id, "current", e.target.value)}
                                    placeholder="-"
                                    className="w-full bg-transparent border-none text-center outline-none font-bold focus:bg-slate-100 rounded"
                                  />
                                )}
                              </td>

                              {/* Prev Q */}
                              <td className="border-r border-black p-1 text-center text-xs font-medium text-slate-600">
                                {isCapturing ? (
                                  <span>
                                    {metric.prev_q !== null
                                      ? metric.prev_q.toFixed(metric.decimals) + (metric.is_ratio ? "%" : "")
                                      : "-"}
                                  </span>
                                ) : (
                                  <input
                                    type="text"
                                    value={metric.prev_q !== null ? metric.prev_q : ""}
                                    onChange={(e) => handleMetricChange(metric.id, "prev_q", e.target.value)}
                                    placeholder="-"
                                    className="w-full bg-transparent border-none text-center outline-none font-medium focus:bg-slate-100 rounded"
                                  />
                                )}
                              </td>

                              {/* Prev Y */}
                              <td className="border-r border-black p-1 text-center text-xs font-medium text-slate-600">
                                {isCapturing ? (
                                  <span>
                                    {metric.prev_y !== null
                                      ? metric.prev_y.toFixed(metric.decimals) + (metric.is_ratio ? "%" : "")
                                      : "-"}
                                  </span>
                                ) : (
                                  <input
                                    type="text"
                                    value={metric.prev_y !== null ? metric.prev_y : ""}
                                    onChange={(e) => handleMetricChange(metric.id, "prev_y", e.target.value)}
                                    placeholder="-"
                                    className="w-full bg-transparent border-none text-center outline-none font-medium focus:bg-slate-100 rounded"
                                  />
                                )}
                              </td>

                              {/* QOQ change */}
                              <td className={`border-r border-black p-2 text-center text-xs ${qoqColor}`}>
                                {metric.is_ratio ? (
                                  <span>
                                    {qoq !== null ? `${qoq > 0 ? "+" : ""}${qoq.toFixed(2)} bps` : "-"}
                                  </span>
                                ) : (
                                  <span>{formatChange(qoq, false)}</span>
                                )}
                              </td>

                              {/* YOY change */}
                              <td className={`p-2 text-center text-xs ${yoyColor}`}>
                                {metric.is_ratio ? (
                                  <span>
                                    {yoy !== null ? `${yoy > 0 ? "+" : ""}${yoy.toFixed(2)} bps` : "-"}
                                  </span>
                                ) : (
                                  <span>{formatChange(yoy, false)}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}

                        {/* Editable Add Metric Row (Hidden during screenshot capture) */}
                        {!isCapturing && (
                          <tr className="bg-slate-50 border-t border-slate-200">
                            <td colSpan={6} className="p-2 text-left">
                              <button
                                onClick={addMetricRow}
                                className="text-xs font-bold text-slate-500 hover:text-slate-800 transition flex items-center gap-1"
                              >
                                <Plus size={14} /> Add Financial Metric Row
                              </button>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* 4. Scorecard / hold statement footer band */}
                  <div className="bg-slate-100 p-4 border-t border-black grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                    <div className="md:col-span-3 flex items-center gap-2.5">
                      <div
                        style={{ backgroundColor: colors.primary }}
                        className="w-12 h-12 rounded-sm text-white flex flex-col items-center justify-center font-display shadow-xs transition-colors duration-300"
                      >
                        <span className="text-[9px] uppercase tracking-wider font-extrabold leading-none opacity-80 mt-1.5">
                          Score
                        </span>
                        <span className="text-2xl font-black leading-none mb-1">{score}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                          TURTLE SCORE
                        </span>
                        <div className="text-xs font-black text-slate-800">
                          {score === 1 ? "Under Review" : score === 2 ? "Hold/Neutral" : "High Confidence"}
                        </div>
                      </div>
                    </div>

                    <div className="md:col-span-9 text-xs font-bold text-slate-700 italic border-t md:border-t-0 md:border-l border-slate-300 pt-3 md:pt-0 md:pl-4 leading-relaxed">
                      "{getHoldStatement(score, fund)}"
                    </div>
                  </div>
                </div>

                {/* THE RESULT COMMENTARY HIGHLIGHTS BLOCK */}
                {highlights.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <FileText className="text-slate-500" size={18} />
                      <h3 className="text-sm font-display font-extrabold text-slate-800 uppercase tracking-wider">
                        Key Business Highlights &amp; Commentary
                      </h3>
                    </div>

                    <div className="space-y-4">
                      {highlights.map((point, index) => (
                        <div key={index} className="flex gap-3 items-start text-xs leading-relaxed text-slate-700">
                          <span
                            style={{ backgroundColor: colors.primary }}
                            className="w-5 h-5 rounded-full text-white font-extrabold flex items-center justify-center shrink-0 mt-0.5 text-[10px]"
                          >
                            {index + 1}
                          </span>
                          <p className="flex-1">{point}</p>
                        </div>
                      ))}
                    </div>

                    {/* Disclaimer Footer */}
                    <div className="border-t border-slate-100 mt-6 pt-3 text-[10px] text-slate-400 italic">
                      Disclaimer: This quarterly results commentary is prepared strictly for internal PMS advisory and client correspondence of Turtle Wealth. Under no circumstances should this be treated as absolute public investment solicitation.
                    </div>
                  </div>
                )}

              </div>

            </div>
          )}

        </div>

      </div>

      {/* global loader backdrop */}
      {loading && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex flex-col items-center justify-center text-white z-50">
          <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 shadow-2xl flex flex-col items-center gap-4 text-center max-w-sm">
            <Loader2 className="animate-spin text-emerald-400" size={32} />
            <div>
              <p className="font-display font-extrabold text-sm">{loadingMessage}</p>
              <p className="text-[10px] text-slate-400 mt-1">Please do not close this tab or interrupt the process.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
