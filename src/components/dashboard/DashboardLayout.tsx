import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion } from "motion/react";
import { cn, toTitleCase } from "@/lib/utils";
import { Inter } from "next/font/google";
import Link from "next/link";
import SettingsSection from "./SettingsSection";
import KpiDashboard from "./KpiDashboard";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { useTenant } from "@/contexts/TenantContext";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export interface DashboardLayoutProps {
  restaurantName: string;
  children: React.ReactNode;
}

export type TabType =
  | "calls"
  | "orders"
  | "shipments"
  | "kpi"
  | "settings";

export interface TabConfig {
  id: TabType;
  label: string;
  icon: React.ReactNode;
}

/**
 * Maps tab IDs to required module IDs.
 * Tabs without an entry are core tabs (always shown).
 * REQ-8.2
 */
const TAB_MODULE_MAP: Record<string, string> = {
  orders: "restaurant_pack",
  shipments: "logistics_pack",
  riders: "logistics_pack",
  runsheet: "runsheet_connect",
};

/**
 * Main dashboard layout component that provides navigation and structure
 * Handles tab navigation between calls, orders, and settings sections
 */
const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  restaurantName,
  children,
}) => {
  const displayName = toTitleCase(restaurantName);
  const [activeTab, setActiveTab] = useState<TabType>("calls");
  const tabRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});
  const skipLinkRef = useRef<HTMLAnchorElement>(null);
  const { isModuleActive } = useEnabledModules();
  const { state: tenantState } = useTenant();
  const isPlatformAdmin = tenantState.userRole === "platform_admin";

  const tabs: TabConfig[] = useMemo(() => {
    const coreTabs: TabConfig[] = [
      {
        id: "calls",
        label: "Calls",
        icon: (
          <svg
            className="w-4 h-4 sm:w-5 sm:h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
            />
          </svg>
        ),
      },
    ];

    // Restaurant-specific tabs (Req 13.2)
    if (isModuleActive("restaurant_pack")) {
      coreTabs.push({
        id: "orders",
        label: "Orders",
        icon: (
          <svg
            className="w-4 h-4 sm:w-5 sm:h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
            />
          </svg>
        ),
      });
    }

    // Logistics-specific tabs (Req 13.3)
    if (isModuleActive("logistics_pack")) {
      coreTabs.push({
        id: "shipments",
        label: "Shipments",
        icon: (
          <svg
            className="w-4 h-4 sm:w-5 sm:h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
            />
          </svg>
        ),
      });
    }

    // KPI dashboard tab — platform_admin only (REQ-7.4)
    if (isPlatformAdmin) {
      coreTabs.push({
        id: "kpi",
        label: "KPI Dashboard",
        icon: (
          <svg
            className="w-4 h-4 sm:w-5 sm:h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        ),
      });
    }

    return coreTabs;
  }, [isModuleActive, isPlatformAdmin]);

  const handleKeyDown = (event: React.KeyboardEvent, tabId: TabType) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === tabId);
    let nextIndex = currentIndex;

    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        nextIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
        break;
      case "ArrowRight":
        event.preventDefault();
        nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
        break;
      case "Home":
        event.preventDefault();
        nextIndex = 0;
        break;
      case "End":
        event.preventDefault();
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    const nextTab = tabs[nextIndex];
    setActiveTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  const handleSkipToContent = (event: React.MouseEvent) => {
    event.preventDefault();
    const mainContent = document.getElementById("main-content");
    if (mainContent) {
      mainContent.focus();
      mainContent.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    const handleNavigateToCall = (event: CustomEvent) => {
      const { callId } = event.detail;
      if (callId) {
        setActiveTab("calls");
      }
    };

    window.addEventListener(
      "navigateToCall",
      handleNavigateToCall as EventListener
    );
    return () => {
      window.removeEventListener(
        "navigateToCall",
        handleNavigateToCall as EventListener
      );
    };
  }, []);

  return (
    <div className="min-h-screen bg-black">
      <header className="sticky top-0 z-50 bg-black border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center min-w-0 flex-1">
              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0 w-8 h-8 bg-emerald-500/20 border border-emerald-500/30 rounded-lg flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-emerald-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                    />
                  </svg>
                </div>

                <div className="min-w-0 flex-1">
                  <h1
                    className={`text-lg font-semibold text-white truncate ${inter.className}`}
                  >
                    {displayName}
                  </h1>
                  <p className="text-sm text-gray-400 truncate">
                    AI Reception OS
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium text-emerald-500">
                  System Online
                </span>
              </div>

              <button
                onClick={() => setActiveTab("settings")}
                className="p-2 text-gray-400 hover:text-white hover:bg-emerald-500/20 rounded-lg transition-all duration-200 cursor-pointer"
                title="Settings"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <nav
        className="sticky top-16 z-40 bg-black border-b border-gray-800"
        role="tablist"
        aria-label="Dashboard navigation"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-6 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[tab.id] = el;
                }}
                onClick={() => {
                  setActiveTab(tab.id);
                }}
                className={cn(
                  "flex items-center space-x-2 py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-all duration-200",
                  "focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-black",
                  "min-h-[40px] cursor-pointer",
                  activeTab === tab.id
                    ? "border-emerald-500 text-emerald-500"
                    : "border-transparent text-gray-400 hover:text-white hover:border-gray-700"
                )}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`${tab.id}-panel`}
                id={`${tab.id}-tab`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onKeyDown={(e) => handleKeyDown(e, tab.id)}
              >
                <span
                  className={cn(
                    "flex-shrink-0 transition-colors duration-200 w-4 h-4",
                    activeTab === tab.id ? "text-emerald-500" : "text-gray-400"
                  )}
                >
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main
        id="main-content"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
        tabIndex={-1}
      >
        <div
          id={`${activeTab}-panel`}
          role="tabpanel"
          aria-labelledby={`${activeTab}-tab`}
          className="focus:outline-none"
        >
          {React.Children.map(children, (child) => {
            if (
              React.isValidElement(child) &&
              (child.props as any).tabId === activeTab
            ) {
              return child;
            }
            return null;
          })}

          {activeTab === "settings" && <SettingsSection tabId="settings" />}
          {activeTab === "kpi" && isPlatformAdmin && <KpiDashboard tabId="kpi" />}
        </div>
      </main>
    </div>
  );
};

export default DashboardLayout;
