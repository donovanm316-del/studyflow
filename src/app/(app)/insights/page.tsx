import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default function InsightsPage() {
  return (
    <div>
      <PageHeader
        title="Insights"
        description="Patterns in your planning and workload over time."
      />

      <EmptyState
        title="Insights aren't available yet"
        description="This page will show estimate-vs-actual accuracy, workload trends, and planning habits once the scheduling engine and work-session tracking are built."
      />
    </div>
  );
}
