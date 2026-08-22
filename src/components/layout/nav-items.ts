export interface NavItem {
  label: string;
  href: string;
}

/** Single source of truth for primary app navigation, used by both the sidebar and mobile nav. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Today", href: "/today" },
  { label: "Schedule", href: "/schedule" },
  { label: "Assignments", href: "/assignments" },
  { label: "Tests & Quizzes", href: "/tests" },
  { label: "Insights", href: "/insights" },
  { label: "Settings", href: "/settings" },
];
