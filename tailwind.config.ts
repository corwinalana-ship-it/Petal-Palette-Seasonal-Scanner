import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "apricity-blush": "#F4C8CB",
        "apricity-cream": "#FDF8F5",
        "apricity-charcoal": "#3D2E2C",
        "apricity-gold": "#D4A574",
      },
      fontFamily: {
        serif: ["Georgia", "Times New Roman", "serif"],
        sans: ["Arial", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
