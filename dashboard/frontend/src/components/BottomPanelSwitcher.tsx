import { useState } from "react";
import "./BottomPanelSwitcher.css";

type Tab = "brain-zoom" | "project-detail" | "tool-registry";

const TABS: { id: Tab; label: string }[] = [
  { id: "brain-zoom", label: "Brain Zoom" },
  { id: "project-detail", label: "Project Detail" },
  { id: "tool-registry", label: "Tool Registry" },
];

export function BottomPanelSwitcher() {
  const [activeTab, setActiveTab] = useState<Tab>("brain-zoom");

  return (
    <div className="bottom-panel-switcher">
      <div className="bottom-panel-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`bottom-panel-tab ${activeTab === tab.id ? "bottom-panel-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="bottom-panel-content">
        <div className="bottom-panel-placeholder">
          {TABS.find((t) => t.id === activeTab)?.label}
        </div>
      </div>
    </div>
  );
}
