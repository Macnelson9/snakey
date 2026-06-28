import { GRID_W, GRID_H, type State } from "@buga/engine";

export function Board({ state }: { state: State }) {
  const lit = new Set(state.snake.map((c) => c.y * GRID_W + c.x));
  const foodKey = state.food.y * GRID_W + state.food.x;
  const cells = [];
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    const cls = "px" + (lit.has(i) ? " on" : "") + (i === foodKey ? " food" : "");
    cells.push(<div key={i} className={cls} />);
  }
  return <div className="board">{cells}</div>;
}
