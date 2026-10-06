/** Notebook covers: a colour (gradient) and an emoji. Readable with white text in light and dark themes. */
export const COVER_COLORS = {
  forest: { from: "#2f6b4f", to: "#5aa47b", en: "Forest", ar: "غابة" },
  ocean: { from: "#1d5a86", to: "#3d93c9", en: "Ocean", ar: "محيط" },
  teal: { from: "#11706b", to: "#36ad9f", en: "Teal", ar: "فيروزي" },
  violet: { from: "#55399a", to: "#8f72d6", en: "Violet", ar: "بنفسجي" },
  rose: { from: "#a83358", to: "#e07a9a", en: "Rose", ar: "وردي" },
  sunset: { from: "#b84d28", to: "#eb995e", en: "Sunset", ar: "غروب" },
  amber: { from: "#a26d0c", to: "#ddb040", en: "Amber", ar: "كهرماني" },
  slate: { from: "#35404f", to: "#6b7a90", en: "Slate", ar: "رمادي" },
} as const;

export type CoverColor = keyof typeof COVER_COLORS;
export const COVER_NAMES = Object.keys(COVER_COLORS) as CoverColor[];

/** The chosen colour, or one picked from the notebook's number so each looks different. */
export function coverColor(subject: { id: number; color?: string | null }): CoverColor {
  if (subject.color && subject.color in COVER_COLORS) return subject.color as CoverColor;
  return COVER_NAMES[Math.abs(subject.id * 7 + 3) % COVER_NAMES.length];
}

export function coverStyle(subject: { id: number; color?: string | null }) {
  const { from, to } = COVER_COLORS[coverColor(subject)];
  return {
    backgroundImage: `radial-gradient(circle at 85% 15%, rgba(255,255,255,0.22) 0, rgba(255,255,255,0) 45%), radial-gradient(circle at 10% 110%, rgba(0,0,0,0.18) 0, rgba(0,0,0,0) 50%), linear-gradient(135deg, ${from}, ${to})`,
  };
}

export const COVER_EMOJI = [
  "📚", "🎓", "✏️", "🧠", "💡", "🔬", "🧪", "🌍",
  "🎬", "🎙️", "🎧", "📷", "🎨", "✍️", "📖", "🗂️",
  "💼", "📈", "💰", "🏠", "🌱", "🏃", "🍳", "✈️",
  "❤️", "⭐", "🕌", "🌙", "☕", "🎯", "🚀", "🧩",
];
