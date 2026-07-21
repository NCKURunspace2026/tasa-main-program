import { useState } from "react";
import "./Sidebar.css";

import {
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
  SideNavCollapseButton,
} from "@astryxdesign/core/SideNav";

function SubmissionIcon(props) {
  return (
    <svg
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.25 2.25H6.75A2.25 2.25 0 0 0 4.5 4.5v15A2.25 2.25 0 0 0 6.75 21h10.5a2.25 2.25 0 0 0 2.25-2.25V7.5L14.25 2.25Z"
      />

      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.25 2.25V7.5h5.25"
      />

      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 17.25v-6m0 0-2.25 2.25M12 11.25l2.25 2.25"
      />
    </svg>
  );
}

function ChartIcon(props) {
  return (
    <svg
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
      />
    </svg>
  );
}

function CogIcon(props) {
  return (
    <svg
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
      />

      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
  );
}

function DashboardLogo(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

const navigationItems = [
  { id: "submissions", label: "Submissions", icon: SubmissionIcon },
  { id: "leaderboard", label: "Leaderboard", icon: ChartIcon },
];

export default function Sidebar({ currentPage, onNavigate, runtimeRole }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const handleNavigate = (pageId) => onNavigate?.(pageId);

  return (
    <aside className={`sidebar${isCollapsed ? " is-collapsed" : ""}`}>
      <SideNav
        collapsible={{
          hasButton: false,
          isCollapsed,
          onCollapsedChange: setIsCollapsed,
        }}
        header={
          <div className="sidebar-header">
            <SideNavHeading heading="DASHBOARD" />
            <div className="sidebar-brand-button">
              <span className="sidebar-logo">
                <DashboardLogo />
              </span>
              <span className="sidebar-collapse-control">
                <SideNavCollapseButton />
              </span>
            </div>
          </div>
        }
      >
        <div className="sidebar-content">
          <div className={`sidebar-role sidebar-role-${runtimeRole}`}>
            <span />
            <strong>{runtimeRole === "worker" ? "OFFICIAL VALIDATOR" : "CLOUD CONNECTED"}</strong>
          </div>
          <SideNavSection title="Competition">
            {navigationItems.map(({ id, label, icon }) => (
              <SideNavItem
                key={id}
                className="sidebar-item"
                label={label}
                icon={icon}
                isSelected={currentPage === id}
                onClick={() => handleNavigate(id)}
              />
            ))}
          </SideNavSection>

          <div className="sidebar-bottom">
            <SideNavItem
              className="sidebar-item sidebar-item-last"
              label="Settings"
              icon={CogIcon}
              isSelected={currentPage === "settings"}
              onClick={() => handleNavigate("settings")}
            />
          </div>
        </div>
      </SideNav>
    </aside>
  );
}
