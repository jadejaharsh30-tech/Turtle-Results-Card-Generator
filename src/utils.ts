export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

export const computeChange = (current: number | null, prev: number | null, isRatio: boolean): number | null => {
  if (current === null || prev === null || prev === undefined) return null;
  if (isRatio) {
    // Plain point difference for ratios
    return current - prev;
  } else {
    // Relative percentage change for absolute figures
    if (prev === 0) return null;
    return ((current - prev) / prev) * 100;
  }
};

export const formatChange = (change: number | null, _isRatio: boolean): string => {
  if (change === null) return "-";
  const prefix = change > 0 ? "+" : "";
  return `${prefix}${change.toFixed(2)}%`;
};

export const isFavorableMove = (change: number | null, lowerIsBetter: boolean): boolean | null => {
  if (change === null || change === 0) return null;
  if (lowerIsBetter) {
    return change < 0; // Decrease is good (e.g., lower NPAs, lower costs)
  } else {
    return change > 0; // Increase is good (e.g., higher profits, higher revenue, higher margins)
  }
};

export const getHoldStatement = (score: 1 | 2 | 3, fund: string): string => {
  if (score === 1) {
    return `Based on Turtle score we are Actively Seeking New Opportunities to Replace this Stock in Our ${fund} Fund.`;
  } else if (score === 2) {
    return `Based on the Turtle Score we are Reviewing the Company and we Continue to Hold it in Our ${fund} Fund.`;
  } else {
    return `Based on Turtle score we remain Confident and Continue to Hold in Our ${fund} Fund.`;
  }
};

export const getThemeColors = (fund: "Growth Mantra" | "Wealth Mantra") => {
  if (fund === "Growth Mantra") {
    return {
      primary: "rgb(0, 128, 128)", // Teal
      hover: "rgb(0, 102, 102)",
      light: "rgba(0, 128, 128, 0.08)",
      border: "border-teal-600",
      bg: "bg-teal-600",
      text: "text-teal-600",
      ring: "focus:ring-teal-600",
    };
  } else {
    return {
      primary: "rgb(192, 0, 0)", // Deep red
      hover: "rgb(160, 0, 0)",
      light: "rgba(192, 0, 0, 0.08)",
      border: "border-red-700",
      bg: "bg-red-700",
      text: "text-red-700",
      ring: "focus:ring-red-700",
    };
  }
};
