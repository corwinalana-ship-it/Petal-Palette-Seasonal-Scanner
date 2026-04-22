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

type ApiResponse = {
  analysis?: unknown;
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

        {result && (
          <div className="border border-apricity-charcoal/10 rounded-lg p-4 bg-white">
            <h2 className="text-sm font-medium mb-2 font-sans">Response</h2>
            <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </main>
  );
}
