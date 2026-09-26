import { mascotPath } from "../../projects/model/projectMascots";
import { CloudUpload } from "../../../shared/ui/icons";

const GRID_W = 16;

/**
 * A terminal at a prompt, in the same '#'/'.' pixel convention as the project
 * mascots. `glow` is a sparse scatter drawn dimmer than the sprite so the
 * shape dissolves at its edges instead of ending on a hard rectangle.
 */
const TERMINAL = [
  "..############..",
  ".##..........##.",
  ".#............#.",
  ".#..#.........#.",
  ".#...#...###..#.",
  ".#..#....###..#.",
  ".#............#.",
  ".#............#.",
  ".##..........##.",
  "..############..",
  "......####......",
  "....########....",
];

const GLOW = [
  "#.#..........#.#",
  "................",
  "#..............#",
  "................",
  "................",
  "................",
  "................",
  "#..............#",
  "................",
  "#.#..........#.#",
  "................",
  "..#..........#..",
];

const TERMINAL_PATH = mascotPath(TERMINAL);
const GLOW_PATH = mascotPath(GLOW);

/** Empty state for a project that has no sessions yet. */
export function SessionsEmpty({
  message,
  onImportSessions,
}: {
  message: string;
  onImportSessions?: () => void;
}) {
  return (
    // `min-h-full` rather than `h-full` so a short window scrolls instead of
    // clipping the artwork.
    <div className="flex min-h-full flex-col items-center justify-center gap-5 px-6 py-10 text-center">
      <div className="flex flex-col items-center gap-3">
        <p className="text-[13px] leading-relaxed text-content/45">{message}</p>
        {onImportSessions ? (
          <button
            type="button"
            onClick={onImportSessions}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-content/10 px-3 text-[12px] text-content/65 hover:bg-content/7 hover:text-content"
          >
            <CloudUpload className="size-3.5" aria-hidden />
            Import past sessions
          </button>
        ) : null}
      </div>
      <svg
        aria-hidden
        viewBox={`0 0 ${GRID_W} ${TERMINAL.length}`}
        shapeRendering="crispEdges"
        className="w-24 text-content/25"
        fill="currentColor"
      >
        <path d={GLOW_PATH} opacity={0.4} />
        <path d={TERMINAL_PATH} />
      </svg>
    </div>
  );
}
