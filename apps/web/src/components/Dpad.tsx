import type { Dir } from "@nokiadot/engine";

export function Dpad({ onDir }: { onDir: (d: Dir) => void }) {
  return (
    <div className="dpad">
      <button className="up" aria-label="Up" onClick={() => onDir(0)}>▲</button>
      <button className="left" aria-label="Left" onClick={() => onDir(3)}>◀</button>
      <button className="right" aria-label="Right" onClick={() => onDir(1)}>▶</button>
      <button className="down" aria-label="Down" onClick={() => onDir(2)}>▼</button>
    </div>
  );
}
