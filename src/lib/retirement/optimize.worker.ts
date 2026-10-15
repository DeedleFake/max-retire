import { type PlannerInputs, type ProjectionRow } from "./engine";
import { projectExact } from "./optimize";

export type PlanMessage =
  | { type: "progress"; rows: ProjectionRow[] }
  | { type: "done"; rows: ProjectionRow[]; exact: boolean };

self.onmessage = (event: MessageEvent<PlannerInputs>) => {
  const inputs = event.data;
  void projectExact(inputs, (rows) => {
    const message: PlanMessage = { type: "progress", rows };
    self.postMessage(message);
  })
    .then((result) => {
      const message: PlanMessage = { type: "done", rows: result.rows, exact: result.exact };
      self.postMessage(message);
    })
    .catch((error: unknown) => {
      console.error("[retirement] maximization failed in the worker", error);
      const message: PlanMessage = { type: "done", rows: [], exact: false };
      self.postMessage(message);
    });
};
