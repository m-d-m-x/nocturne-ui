export function createFontFace(fontFamily, fontFiles) {
  const fontFaceDefinitions = fontFiles.map(({ path, weight, style }) => {
    return `
        @font-face {
          font-family: '${fontFamily}';
          src: url('${path}') format('woff2');
          font-weight: ${weight};
          font-style: ${style};
          font-display: swap;
        }
      `;
  });

  return fontFaceDefinitions.join("\n");
}

export const interFontConfig = {
  name: "Inter",
  variable: "--font-inter",
  files: [
    {
      path: "/fonts/Inter-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "/fonts/Inter-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "/fonts/Inter-SemiBold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "/fonts/Inter-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
};

export function detectTextScript(text) {
  if (!text) return "latin";

  const scripts = {
    chinese:
      /[\u4E00-\u9FFF\u3400-\u4DBF\u20000-\u2A6DF\u2A700-\u2B73F\u2B740-\u2B81F]/,
    traditionalChinese: /[\u4E00-\u9FFF]/,
    japanese: /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/,
    korean: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/,
    arabic:
      /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/,
    devanagari: /[\u0900-\u097F]/,
    hebrew: /[\u0590-\u05FF]/,
    bengali: /[\u0980-\u09FF]/,
    tamil: /[\u0B80-\u0BFF]/,
    thai: /[\u0E00-\u0E7F]/,
    gurmukhi: /[\u0A00-\u0A7F]/,
  };

  for (const [script, regex] of Object.entries(scripts)) {
    if (regex.test(text)) return script;
  }

  return "latin";
}

export function getTextDirection(text) {
  const rtlScripts = {
    arabic:
      /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/,
    hebrew: /[\u0590-\u05FF]/,
  };

  for (const [script, regex] of Object.entries(rtlScripts)) {
    if (regex.test(text)) {
      return {
        direction: "rtl",
        script,
      };
    }
  }

  return {
    direction: "ltr",
    script: "latin",
  };
}

// The bundled Noto faces were removed: four CJK variable fonts alone were
// 23.9MB on a rootfs with ~20MB free. Every script now falls back to Inter,
// which covers Latin, Greek and Cyrillic. Text in scripts Inter does not cover
// (CJK, Arabic, Hebrew, Thai, Tamil, Bengali, Devanagari) renders with whatever
// the system provides, which on this image means missing glyphs.
//
// detectTextScript and getTextDirection above are deliberately kept: RTL layout
// for Arabic and Hebrew is correct regardless of which font draws the glyphs.
export const fontFamilyForScript = {
  latin: `var(--font-inter)`,
  chinese: `var(--font-inter)`,
  traditionalChinese: `var(--font-inter)`,
  japanese: `var(--font-inter)`,
  korean: `var(--font-inter)`,
  arabic: `var(--font-inter)`,
  devanagari: `var(--font-inter)`,
  hebrew: `var(--font-inter)`,
  bengali: `var(--font-inter)`,
  tamil: `var(--font-inter)`,
  thai: `var(--font-inter)`,
  gurmukhi: `var(--font-inter)`,
};

export function generateAllFontFaces() {
  return `
      ${createFontFace(interFontConfig.name, interFontConfig.files)}

      :root {
        ${interFontConfig.variable}: ${interFontConfig.name}, sans-serif;
      }
    `;
}
