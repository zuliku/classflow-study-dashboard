/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* ===== 基础色卡（唯一来源） ===== */
        background: "#F7F5F5", // White
        alabaster: "#F0EBE1",
        "stone-beige": "#CDB9AB",
        charcoal: "#313032",
        mozzarella: "#EFECEA",
        alba: "#E3DDD2",
        sandrift: "#A48F82",
        "strong-black": "#000000",
        "pastel-mint": "#E3E6E0",
        "ashy-beige": "#CCCBC4",
        "satin-grey": "#676266",

        /* ===== 语义层 ===== */
        // 表面层级：page > surface(卡片) > surface-soft(hover/inset) > surface-muted(selected)
        surface: "#F4F2EF",
        "surface-soft": "#F0EBE1",
        "surface-muted": "#E3E6E0",
        // 边框：stone-beige 透明度派生，不再为每张卡发明新 HEX
        line: {
          DEFAULT: "rgba(205, 185, 171, 0.45)",
          soft: "rgba(205, 185, 171, 0.22)",
          strong: "rgba(205, 185, 171, 0.72)",
        },
        // 低饱和语义色：danger / warning / success
        danger: {
          DEFAULT: "#9B5B57",
          bg: "#F2E8E6",
          border: "#D9BCB8",
        },
        warning: {
          DEFAULT: "#936E4C",
          bg: "#F1EAE1",
          border: "#DFD2C2",
        },
        success: {
          DEFAULT: "#627566",
          bg: "#E7ECE6",
          border: "#C8D3C7",
        },
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
        subtle: "0 2px 8px -2px rgba(49, 48, 50, 0.04), 0 1px 3px -1px rgba(49, 48, 50, 0.02)",
        card: "0 4px 16px -4px rgba(49, 48, 50, 0.06), 0 2px 6px -2px rgba(49, 48, 50, 0.03)",
        drawer: "-4px 0 24px -4px rgba(49, 48, 50, 0.12)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
    },
  },
  plugins: [],
};
