"use client";

/**
 * /analyze — minimal test page.
 *
 * Lets you pick a photo, resizes it client-side to max 1024px on the longest
 * side (to keep upload cost down), POSTs it to /api/analyze, and renders the
 * raw JSON response. This is the Phase 1 harness for validating the AI quality
 * before building the polished multi-page UI on top.
 */

import { useState } from "react";

// Resize target — 1024px matches what we tell the Claude API to expect.
const MAX_DIMENSION = 1024;

// Output format for the canvas resize. JPEG at 0.9 quality is a good tradeoff
// between fidelity (we need to see skin undertone clearly) and upload size.
const OUTPUT_MIME = "image/jpeg";
const OUTPUT_QUALITY = 0.9;

// The shape the /api/analyze route returns. `analysis` matches the JSON the
// Claude system prompt emits. Fields are optional here because the quick-read
// panel renders defensively — if the model omits a field we just skip it.
type Analysis = {
  photo_quality?: "good" | "insufficient";
  quality_notes?: string;
  season?: string | null;
  alternate_season?: string | null;
  confidence?: "high" | "medium" | "low";
  confidence_score?: number;
  vector?: {
    temperature?: number;
    value?: number;
    chroma?: number;
    contrast?: number;
  };
  analysis?: {
    undertone?: string;
    value?: string;
    chroma?: string;
    contrast?: string;
  };
  top_3_seasons?: Array<{ name?: string; distance?: number }>;
  explanation?: string;
  best_colors?: string[];
  colors_to_avoid?: string[];
};

type ApiResponse = {
  analysis?: Analysis;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  model?: string;
  error?: string;
  detail?: string;
  raw?: string;
};

/**
 * Read a File into an HTMLImageElement via an object URL.
 * Using an object URL (rather than FileReader → data URL) keeps memory lower for big files.
 */
function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode image."));
    };
    img.src = url;
  });
}

/**
 * Draw the image onto a canvas scaled so the longest side is MAX_DIMENSION px,
 * then return the canvas as a base64 JPEG (without the data: prefix).
 */
async function resizeToBase64(
  file: File,
): Promise<{ base64: string; mediaType: string }> {
  const img = await fileToImage(file);

  const longest = Math.max(img.width, img.height);
  const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context.");
  ctx.drawImage(img, 0, 0, width, height);

  // toDataURL returns e.g. "data:image/jpeg;base64,AAAA..." — split off the prefix.
  const dataUrl = canvas.toDataURL(OUTPUT_MIME, OUTPUT_QUALITY);
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx < 0) throw new Error("Unexpected data URL format.");
  return { base64: dataUrl.slice(commaIdx + 1), mediaType: OUTPUT_MIME };
}

export default function AnalyzePage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setResult(null);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(selected ? URL.createObjectURL(selected) : null);
  }

  async function handleAnalyze() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { base64, mediaType } = await resizeToBase64(file);
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mediaType }),
      });
      const json: ApiResponse = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Request failed with status ${res.status}`);
        setResult(json); // still show body for debugging
      } else {
        setResult(json);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-serif tracking-wide mb-2">
        Analyzer — test harness
      </h1>
      <p className="text-sm text-apricity-charcoal/70 mb-8">
        Upload a photo and see the raw JSON response from the AI. This page
        exists to validate analysis quality before the real UI is built.
      </p>

      <div className="space-y-6">
        <label className="block">
          <span className="text-sm font-medium">Photo</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleFileChange}
            className="block mt-2 w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-apricity-blush file:text-apricity-charcoal hover:file:bg-apricity-blush/80"
          />
        </label>

        {previewUrl && (
          <div className="border border-apricity-charcoal/10 rounded-lg p-4 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Selected photo preview"
              className="max-h-64 mx-auto rounded"
            />
          </div>
        )}

        <button
          onClick={handleAnalyze}
          disabled={!file || loading}
          className="w-full bg-apricity-gold text-white py-3 rounded-full font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Analyzing…" : "Analyze photo"}
        </button>

        {error && (
          <div className="border border-red-200 bg-red-50 text-red-900 rounded-lg p-4 text-sm">
            <strong>Error:</strong> {error}
          </div>
        )}

        {result?.analysis && <QuickRead analysis={result.analysis} />}

        {result && (
          <div className="border border-apricity-charcoal/10 rounded-lg p-4 bg-white">
            <h2 className="text-sm font-medium mb-2 font-sans">
              Raw response (debug)
            </h2>
            <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * Quick-read panel: surfaces the season, numeric T/V/C vector, confidence,
 * top-3 distances, and color swatches so you can judge the analysis at a
 * glance without reading the JSON. Renders defensively — any missing field
 * is skipped rather than crashing the page.
 */
function QuickRead({ analysis }: { analysis: Analysis }) {
  if (analysis.photo_quality === "insufficient") {
    return (
      <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 text-sm">
        <div className="font-medium text-amber-900 mb-1">
          Photo insufficient
        </div>
        <div className="text-amber-900/80">
          {analysis.quality_notes || "No details provided."}
        </div>
      </div>
    );
  }

  const { vector, best_colors, colors_to_avoid, top_3_seasons } = analysis;

  return (
    <div className="border border-apricity-charcoal/10 rounded-lg p-6 bg-white space-y-5">
      <div>
        <div className="text-xs uppercase tracking-wider text-apricity-charcoal/50 mb-1">
          Season
        </div>
        <div className="text-2xl font-serif">
          {analysis.season ?? "—"}
          {analysis.confidence_score != null && (
            <span className="ml-2 text-sm text-apricity-charcoal/60 font-sans">
              ({analysis.confidence ?? "—"}, score{" "}
              {analysis.confidence_score.toFixed(2)})
            </span>
          )}
        </div>
        {analysis.alternate_season && (
          <div className="text-sm text-apricity-charcoal/60 mt-1">
            Alternate: {analysis.alternate_season}
          </div>
        )}
      </div>

      {vector && (
        <div>
          <div className="text-xs uppercase tracking-wider text-apricity-charcoal/50 mb-2">
            Vector (T, V, C)
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <VectorCell
              label="Temperature"
              value={vector.temperature}
              hint="-1 cool · +1 warm"
            />
            <VectorCell
              label="Value"
              value={vector.value}
              hint="0 light · 1 deep"
            />
            <VectorCell
              label="Chroma"
              value={vector.chroma}
              hint="0 soft · 1 bright"
            />
          </div>
        </div>
      )}

      {top_3_seasons && top_3_seasons.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-apricity-charcoal/50 mb-2">
            Top 3 closest
          </div>
          <ol className="space-y-1 text-sm">
            {top_3_seasons.map((s, i) => (
              <li key={i} className="flex justify-between tabular-nums">
                <span>
                  {i + 1}. {s.name ?? "—"}
                </span>
                <span className="text-apricity-charcoal/60">
                  {s.distance?.toFixed(3) ?? "—"}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {analysis.explanation && (
        <div>
          <div className="text-xs uppercase tracking-wider text-apricity-charcoal/50 mb-2">
            Why
          </div>
          <p className="text-sm leading-relaxed">{analysis.explanation}</p>
        </div>
      )}

      {best_colors && best_colors.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-apricity-charcoal/50 mb-2">
            Best colors
          </div>
          <Swatches hexes={best_colors} />
        </div>
      )}

      {colors_to_avoid && colors_to_avoid.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-apricity-charcoal/50 mb-2">
            Colors to avoid
          </div>
          <Swatches hexes={colors_to_avoid} />
        </div>
      )}
    </div>
  );
}

function VectorCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | undefined;
  hint: string;
}) {
  return (
    <div className="border border-apricity-charcoal/10 rounded p-2">
      <div className="text-xs text-apricity-charcoal/60">{label}</div>
      <div className="text-lg font-serif tabular-nums">
        {value != null ? value.toFixed(2) : "—"}
      </div>
      <div className="text-[10px] text-apricity-charcoal/40">{hint}</div>
    </div>
  );
}

function Swatches({ hexes }: { hexes: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {hexes.map((hex, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <div
            className="w-10 h-10 rounded border border-apricity-charcoal/10"
            style={{ backgroundColor: hex }}
            title={hex}
          />
          <code className="text-[10px] text-apricity-charcoal/60">{hex}</code>
        </div>
      ))}
    </div>
  );
}
