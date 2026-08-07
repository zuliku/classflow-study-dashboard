import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#F7F5F5",
        alabaster: "#F0EBE1",
        "stone-beige": "#CDB9AB",
        charcoal: "#313032",
        "pastel-mint": "#E3E6E0",
        "ashy-beige": "#CCCBC4",
        sandrift: "#A48F82",
        mozzarella: "#FFFCFA",
        alba: "#E3DDD2",
        "satin-grey": "#676268",
        border: "#E7E3DD",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        subtle: "0 2px 8px -2px rgba(49, 48, 50, 0.04), 0 1px 3px -1px rgba(0, 0, 0, 0.02)",
        card: "0 4px 16px -4px rgba(49, 48, 50, 0.06), 0 2px 6px -2px rgba(0, 0, 0, 0.03)",
        drawer: "-4px 0 24px -4px rgba(49, 48, 50, 0.12)",
      },
      borderRadius: {
        xl: "0.875rem", // 14px
        "2xl": "1.125rem", // 18px
      },
    },
  },
  plugins: [],
};
export default config;
