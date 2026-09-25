import { motion } from "framer-motion";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = "" }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`relative inline-flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 cursor-pointer outline-none ${className}`}
      style={{
        background: isLight ? "rgba(241, 245, 249, 0.9)" : "rgba(12, 16, 26, 0.7)",
        border: `1px solid ${isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.16)"}`,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        color: isLight ? "#f59e0b" : "#38bdf8",
        boxShadow: isLight
          ? "0 2px 8px rgba(245, 158, 11, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.9)"
          : "0 4px 12px rgba(0, 0, 0, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.1)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = isLight ? "rgba(245, 158, 11, 0.45)" : "rgba(56, 189, 248, 0.5)";
        e.currentTarget.style.transform = "scale(1.06)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.16)";
        e.currentTarget.style.transform = "scale(1)";
      }}
      title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
      aria-label={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
    >
      <motion.div
        key={theme}
        initial={{ rotate: -45, scale: 0.75, opacity: 0 }}
        animate={{ rotate: 0, scale: 1, opacity: 1 }}
        exit={{ rotate: 45, scale: 0.75, opacity: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="flex items-center justify-center pointer-events-none"
      >
        {isLight ? (
          <Sun size={14} className="text-amber-500 fill-amber-500/20" />
        ) : (
          <Moon size={13.5} className="text-sky-400 fill-sky-400/20" />
        )}
      </motion.div>
    </button>
  );
}
