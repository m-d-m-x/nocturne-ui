import React, { useEffect } from "react";
import { generateAllFontFaces } from "../../constants/fonts";

const FontLoader = () => {
  useEffect(() => {
    const styleEl = document.createElement("style");
    styleEl.setAttribute("id", "font-styles");
    styleEl.textContent = generateAllFontFaces();
    document.head.appendChild(styleEl);

    const loadFonts = async () => {
      try {
        // Only Inter is preloaded. The bundled Noto faces were removed:
        // four CJK variable fonts alone were 23.9MB on a nearly-full rootfs.
        const fontLoadPromises = [
          document.fonts.load("400 16px Inter"),
          document.fonts.load("500 16px Inter"),
          document.fonts.load("600 16px Inter"),
          document.fonts.load("700 16px Inter"),
        ];

        await Promise.all(fontLoadPromises);
      } catch (error) {
        console.warn("Font loading failed, continuing anyway:", error);
      }
    };

    loadFonts();

    return () => {
      const existingStyle = document.getElementById("font-styles");
      if (existingStyle) {
        document.head.removeChild(existingStyle);
      }
    };
  }, []);

  return null;
};

export default FontLoader;
