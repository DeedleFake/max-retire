import loadHighs from "highs";

const highs = await loadHighs();
const bodies = [
  `Maximize
 obj: x
Subject To
Bounds
 0 <= x <= 1
End
`,
  `Maximize
 obj: 2 x + y
Subject To
 c: x + y <= 1
Bounds
 0 <= x <= 1
 0 <= y <= 1
General
 x
 y
SOS
 sos1: S1 :: x:1 y:2
End
`,
];
for (const lp of bodies) {
  try {
    const solved = highs.solve(lp, { output_flag: false, time_limit: 5 });
    console.log("OK", solved.Status, solved.ObjectiveValue);
  } catch (error) {
    console.log("THREW", error instanceof Error ? error.message.split("\n")[0] : error);
  }
}
