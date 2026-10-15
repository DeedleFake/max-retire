import { createFileRoute } from "@tanstack/react-router";
import { RetirementPlanner } from "@/components/retirement/planner";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <RetirementPlanner />;
}
