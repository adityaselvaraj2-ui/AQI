import { useEffect, useRef, useState } from "react";
import { Globe, ChevronDown, Check } from "lucide-react";
import { useTranslation, LANGUAGE_OPTIONS, type Language } from "@/i18n";
import { useTheme } from "@/context/ThemeContext";

interface LanguageSelectorProps {
  compact?: boolean;
}

export function LanguageSelector({ compact = false }: LanguageSelectorProps) {
  const { language, setLanguage } = useTranslation();
  const { theme } = useTheme();
  const isLight = theme === "light";
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const currentOption = LANGUAGE_OPTIONS.find((opt) => opt.code === language) || LANGUAGE_OPTIONS[0];

  const handleSelect = (code: Language) => {
    setLanguage(code);
    setIsOpen(false);
  };

  return (
    <div ref={menuRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          height: "32px",
          padding: compact ? "0 0.65rem" : "0 0.8rem",
          background: isOpen
            ? (isLight ? "rgba(2, 132, 199, 0.16)" : "rgba(56, 189, 248, 0.2)")
            : (isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(12, 16, 26, 0.7)"),
          border: `1px solid ${isOpen
            ? (isLight ? "rgba(2, 132, 199, 0.55)" : "rgba(56, 189, 248, 0.55)")
            : (isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.16)")}`,
          borderRadius: "9999px",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          color: isLight ? "#0f172a" : "#FFFFFF",
          fontFamily: "var(--mono)",
          fontSize: "11px",
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: isOpen
            ? (isLight ? "0 0 12px rgba(2, 132, 199, 0.25)" : "0 0 12px rgba(56, 189, 248, 0.35)")
            : (isLight ? "0 4px 12px rgba(15, 23, 42, 0.06)" : "0 4px 12px rgba(0, 0, 0, 0.25)"),
          outline: "none",
        }}
        onMouseEnter={(e) => {
          if (!isOpen) {
            e.currentTarget.style.borderColor = isLight ? "rgba(2, 132, 199, 0.45)" : "rgba(56, 189, 248, 0.4)";
            e.currentTarget.style.background = isLight ? "rgba(255, 255, 255, 0.98)" : "rgba(16, 22, 36, 0.85)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.borderColor = isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.16)";
            e.currentTarget.style.background = isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(12, 16, 26, 0.7)";
          }
        }}
        aria-label="Select Language"
        aria-expanded={isOpen}
      >
        <Globe size={12.5} style={{ color: isLight ? "#0284c7" : "var(--cyan)" }} />
        <span>{currentOption.nativeLabel}</span>
        <ChevronDown
          size={11}
          style={{
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
            color: isLight ? "#64748b" : "rgba(255, 255, 255, 0.6)",
          }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 100,
            minWidth: "140px",
            background: isLight
              ? "linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.98) 100%)"
              : "linear-gradient(135deg, rgba(20, 26, 44, 0.96) 0%, rgba(11, 15, 26, 0.98) 100%)",
            border: `1px solid ${isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(168, 85, 247, 0.35)"}`,
            borderRadius: "8px",
            boxShadow: isLight
              ? "0 16px 40px rgba(15, 23, 42, 0.12), 0 0 20px rgba(15, 23, 42, 0.06)"
              : "0 16px 40px rgba(0, 0, 0, 0.8), 0 0 20px rgba(168, 85, 247, 0.2)",
            padding: "4px",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            animation: "fadeIn 0.15s ease",
          }}
        >
          {LANGUAGE_OPTIONS.map((opt) => {
            const isSelected = opt.code === language;
            return (
              <button
                key={opt.code}
                type="button"
                onClick={() => handleSelect(opt.code)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "0.45rem 0.7rem",
                  borderRadius: "5px",
                  background: isSelected
                    ? (isLight ? "rgba(2, 132, 199, 0.12)" : "rgba(168, 85, 247, 0.22)")
                    : "transparent",
                  border: "none",
                  color: isSelected
                    ? (isLight ? "#0284c7" : "#FFFFFF")
                    : (isLight ? "#334155" : "#cbd5e1"),
                  fontFamily: opt.code === "hi" ? "var(--font-sans), 'Noto Sans Devanagari', sans-serif" : opt.code === "ta" ? "var(--font-sans), 'Noto Sans Tamil', sans-serif" : "var(--mono)",
                  fontSize: "12px",
                  fontWeight: isSelected ? 600 : 400,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = isLight ? "rgba(15, 23, 42, 0.05)" : "rgba(255, 255, 255, 0.08)";
                    e.currentTarget.style.color = isLight ? "#0f172a" : "#FFFFFF";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = isLight ? "#334155" : "#cbd5e1";
                  }
                }}
              >
                <span>{opt.nativeLabel}</span>
                {isSelected && <Check size={13} style={{ color: isLight ? "#0284c7" : "#c084fc" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
