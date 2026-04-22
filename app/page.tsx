import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="text-4xl font-serif tracking-wide mb-4">Apricity</h1>
      <p className="text-apricity-charcoal/70 mb-8">
        Petal Palettes — AI-powered 12-season color analysis.
      </p>
      <Link
        href="/analyze"
        className="inline-block bg-apricity-gold text-white px-8 py-3 rounded-full font-medium hover:opacity-90 transition"
      >
        Test the analyzer
      </Link>
      <p className="mt-8 text-xs text-apricity-charcoal/50">
        Development scaffold. Full landing page coming next.
      </p>
    </main>
  );
}
