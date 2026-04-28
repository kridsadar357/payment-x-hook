import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        "pay-card-in": {
          "0%": { opacity: "0", transform: "translateY(20px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "pay-orb-1": {
          "0%, 100%": { opacity: "0.12", transform: "translate(0, 0) scale(1)" },
          "50%": { opacity: "0.28", transform: "translate(-18px, 14px) scale(1.09)" },
        },
        "pay-orb-2": {
          "0%, 100%": { opacity: "0.08", transform: "translate(0, 0) scale(1)" },
          "50%": { opacity: "0.2", transform: "translate(14px, -12px) scale(1.07)" },
        },
        "pay-total-glow": {
          "0%, 100%": { textShadow: "0 0 18px rgba(52, 211, 153, 0.35)" },
          "50%": { textShadow: "0 0 32px rgba(52, 211, 153, 0.65), 0 0 48px rgba(16, 185, 129, 0.25)" },
        },
        "pay-border-shimmer": {
          "0%": { opacity: "0.35" },
          "50%": { opacity: "0.85" },
          "100%": { opacity: "0.35" },
        },
      },
      animation: {
        "pay-card-in": "pay-card-in 0.75s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "pay-orb-1": "pay-orb-1 18s ease-in-out infinite",
        "pay-orb-2": "pay-orb-2 24s ease-in-out 2.5s infinite",
        "pay-total-glow": "pay-total-glow 3.2s ease-in-out infinite",
        "pay-border-shimmer": "pay-border-shimmer 2.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
