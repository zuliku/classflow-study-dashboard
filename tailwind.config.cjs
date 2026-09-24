/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* ===== 基础色卡（派生自 app/globals.css :root，S1 立约后 :root 为唯一真值；
           此处字面量须与 :root 同值，由 tests/tokenContract.test.ts 校验，勿单方面修改） ===== */
        background: "#F7F5F5", // Warm paper page bg（非纯白，by design；Light-only，无 darkMode）
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
        // Typography V1：sans 必须跟随界面字体 token（勿回退系统栈，否则 font-sans 会逃逸设置）
        sans: ["var(--font-ui)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      boxShadow: {
        subtle: "0 2px 8px -2px rgba(49, 48, 50, 0.04), 0 1px 3px -1px rgba(49, 48, 50, 0.02)",
        card: "0 4px 16px -4px rgba(49, 48, 50, 0.06), 0 2px 6px -2px rgba(49, 48, 50, 0.03)",
        drawer: "-4px 0 24px -4px rgba(49, 48, 50, 0.12)",
        modal: "0 12px 40px -8px rgba(49, 48, 50, 0.18), 0 4px 12px -4px rgba(49, 48, 50, 0.08)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
        // S1 立约新增（派生自 :root --r-*，零视觉变更：只新增 utilities，不改既有档位）
        sm: "var(--r-sm)",
        md: "var(--r-md)",
        "3xl": "var(--r-2xl)",
        sidecar: "var(--r-sidecar)",
      },
      fontSize: {
        // S1 立约新增（派生自 :root --text-*/--leading-*；收敛 text-[任意px] 目标）
        caption: ["var(--text-caption)", "var(--leading-caption)"],
        body: ["var(--text-body)", "var(--leading-body)"],
        title: ["var(--text-title)", "var(--leading-title)"],
        h: ["var(--text-h)", "var(--leading-h)"],
      },
      zIndex: {
        // S1 立约新增（派生自 :root --z-*；Peek/BottomNav 同级冲突见 S4）
        header: "var(--z-header)",
        peek: "var(--z-peek)",
        sidecar: "var(--z-sidecar)",
        dialog: "var(--z-dialog)",
        reminder: "var(--z-reminder)",
        titlebar: "var(--z-titlebar)",
      },
    },
  },
  plugins: [],
};
