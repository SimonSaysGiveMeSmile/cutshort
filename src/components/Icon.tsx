// Cohesive monoline icon set (Lucide). Importing the specific icons we use
// keeps the bundle tree-shaken — no 5,000-icon blob. Emoji are deliberately
// banned from the UI: a single consistent stroke icon family is what makes the
// deck read as designed rather than assembled.
import {
  Copy,
  Scissors,
  ClipboardPaste,
  SquareDashedMousePointer,
  Undo2,
  Redo2,
  Save,
  Search,
  RotateCw,
  RefreshCw,
  SquarePlus,
  SquareX,
  RotateCcw,
  Wrench,
  Glasses,
  Eraser,
  ScanSearch,
  ArrowLeftRight,
  Maximize,
  Camera,
  Power,
  Command,
  MessageSquareCode,
  Braces,
  SquareTerminal,
  TextCursor,
  SquarePen,
  Globe,
  Monitor,
  Code,
  Square,
  type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  Copy,
  Scissors,
  ClipboardPaste,
  SquareDashedMousePointer,
  Undo2,
  Redo2,
  Save,
  Search,
  RotateCw,
  RefreshCw,
  SquarePlus,
  SquareX,
  RotateCcw,
  Wrench,
  Glasses,
  Eraser,
  ScanSearch,
  ArrowLeftRight,
  Maximize,
  Camera,
  Power,
  Command,
  MessageSquareCode,
  Braces,
  SquareTerminal,
  TextCursor,
  SquarePen,
  Globe,
  Monitor,
  Code,
};

export function Icon({
  name,
  size = 24,
  strokeWidth = 1.6,
  className,
}: {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const C = MAP[name] ?? Square;
  return <C size={size} strokeWidth={strokeWidth} className={className} aria-hidden />;
}
