import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Restaurant } from "@/types/global";
import { LANGUAGE_OPTIONS } from "@/lib/constants";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import { useRestaurantStorage } from "@/hooks/useRestaurantStorage";

export interface SettingsSectionProps {
  tabId: "settings";
}

const SettingsSection: React.FC<SettingsSectionProps> = () => {
  const router = useRouter();
  const {
    restaurantId,
    restaurantData,
    loading,
    saveRestaurantData,
    deleteAllData,
  } = useRestaurantStorage();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [isLoading, setSaveLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const hasInitialized = useRef(false);

  // Initialize local state with current restaurant data
  useEffect(() => {
    if (restaurantData && !hasInitialized.current) {
      setRestaurant(restaurantData);
      hasInitialized.current = true;
    }
  }, [restaurantData]);

  const handleInputChange = (
    field: keyof Restaurant,
    value: string | Restaurant["menuDetails"]
  ) => {
    if (restaurant) {
      setRestaurant((prev) =>
        prev
          ? {
              ...prev,
              [field]: value,
            }
          : null
      );
      // Clear save message when user starts editing
      if (saveMessage) {
        setSaveMessage(null);
      }
    }
  };

  const handleSave = async () => {
    if (!restaurant) return;

    setSaveLoading(true);
    setSaveMessage(null);

    try {
      await saveRestaurantData({
        name: restaurant.name,
        agentName: restaurant.agentName,
        menuDetails: restaurant.menuDetails,
        specialInstructions: restaurant.specialInstructions,
        languagePreference: restaurant.languagePreference,
      });

      setSaveMessage({
        type: "success",
        text: "Settings saved successfully!",
      });
    } catch (error) {
      setSaveMessage({
        type: "error",
        text: "Failed to save settings. Please try again.",
      });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const success = await deleteAllData();
      if (success) {
        // Redirect to home page after successful deletion
        router.push("/client");
      } else {
        setSaveMessage({
          type: "error",
          text: "Failed to delete business data. Please try again.",
        });
      }
    } catch (error) {
      setSaveMessage({
        type: "error",
        text: "Failed to delete business data. Please try again.",
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="bg-black border border-gray-800 rounded-lg p-6 text-center">
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-700 border-t-emerald-500"></div>
            </div>
            <p className="text-sm text-white/60 mt-1">
              Loading business settings...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!restaurant) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="bg-black border border-gray-800 rounded-lg p-6 text-center">
          <p className="text-gray-400 text-sm">No business data available</p>
        </div>
      </div>
    );
  }

  // Helper function to render menu details as readable options
  const renderMenuDetails = (menuDetails: Restaurant["menuDetails"]) => {
    if (typeof menuDetails === "string") {
      return menuDetails;
    }

    if (Array.isArray(menuDetails)) {
      return menuDetails
        .map((item, index) => {
          if (typeof item === "string") {
            return `${index + 1}. ${item}`;
          }
          if (typeof item === "object" && item !== null) {
            const name = item.name || "Menu Item";
            const price = item.price ? ` - $${item.price}` : "";
            const description = item.description
              ? ` (${item.description})`
              : "";
            return `${index + 1}. ${name}${price}${description}`;
          }
          return `${index + 1}. ${String(item)}`;
        })
        .join("\n");
    }

    if (typeof menuDetails === "object" && menuDetails !== null) {
      return Object.entries(menuDetails)
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            return `${key}:\n${value.map((item, i) => `  ${i + 1}. ${typeof item === "object" ? item.name || String(item) : String(item)}`).join("\n")}`;
          }
          return `${key}: ${String(value)}`;
        })
        .join("\n\n");
    }

    return String(menuDetails);
  };

  const handleMenuDetailsChange = (value: string) => {
    // Try to parse as structured data, fallback to string
    try {
      // If it looks like JSON, parse it
      if (value.trim().startsWith("{") || value.trim().startsWith("[")) {
        handleInputChange("menuDetails", JSON.parse(value));
      } else {
        // Otherwise, treat as plain text
        handleInputChange("menuDetails", value);
      }
    } catch (e) {
      // If parsing fails, store as string
      handleInputChange("menuDetails", value);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Restaurant Information Section */}
      <div className="card-minimal rounded-xl">
        <div className="bg-white/5 border-b border-white/10 px-4 sm:px-6 py-4">
          <h2 className="text-base font-semibold text-white">
            Business Information
          </h2>
          <p className="text-sm text-white/70 mt-1">
            Update your business&apos;s basic information.
          </p>
        </div>
        <div className="px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Business Name
                <span className="text-red-400 ml-1" aria-label="required">
                  *
                </span>
              </label>
              <input
                type="text"
                value={restaurant.name}
                onChange={(e) => handleInputChange("name", e.target.value)}
                placeholder="Enter business name"
                className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Business ID
              </label>
              <input
                type="text"
                value={restaurantId || "Not available"}
                disabled
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white/60 text-sm cursor-not-allowed"
              />
              <p className="mt-2 text-sm text-white/50">
                Customers need this ID when calling your AI agent
              </p>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">
              AI Agent Phone Number
            </label>
            <input
              type="text"
              value={process.env.NEXT_PUBLIC_VIRTUAL_NUMBER || "Not configured"}
              disabled
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white/60 text-sm cursor-not-allowed"
            />
            <p className="mt-2 text-sm text-white/50">
              Customers call this number and provide your Business ID
            </p>
          </div>
        </div>
      </div>

      {/* AI Agent Configuration Section */}
      <div className="card-minimal rounded-xl">
        <div className="bg-white/5 border-b border-white/10 px-4 sm:px-6 py-4">
          <h2 className="text-base font-semibold text-white">
            AI Agent Configuration
          </h2>
          <p className="text-sm text-white/70 mt-1">
            Configure your AI agent&apos;s behavior and responses.
          </p>
        </div>
        <div className="px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Agent Name
                <span className="text-red-400 ml-1" aria-label="required">
                  *
                </span>
              </label>
              <input
                type="text"
                value={restaurant.agentName}
                onChange={(e) => handleInputChange("agentName", e.target.value)}
                placeholder="Enter agent name"
                className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
                required
              />
              <p className="mt-2 text-sm text-white/50">
                This is how your AI agent will introduce itself to customers
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Language Preference
                <span className="text-red-400 ml-1" aria-label="required">
                  *
                </span>
              </label>
              <select
                value={restaurant.languagePreference}
                onChange={(e) =>
                  handleInputChange("languagePreference", e.target.value)
                }
                className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent cursor-pointer transition-all duration-200"
                required
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    className="bg-black text-white"
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Menu Details
              <span className="text-red-400 ml-1" aria-label="required">
                *
              </span>
            </label>
            <div className="border border-white/20 rounded-lg bg-white/5">
              {Array.isArray(restaurant.menuDetails) &&
              restaurant.menuDetails.length > 0 ? (
                <div className="max-h-80 overflow-y-auto">
                  <div className="divide-y divide-white/10">
                    {restaurant.menuDetails.map((item, index) => (
                      <div
                        key={index}
                        className="p-3 sm:p-4 hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        <div className="flex justify-between items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-white text-sm truncate">
                              {typeof item === "object" && item !== null
                                ? item.name
                                : String(item)}
                            </h4>
                            {typeof item === "object" &&
                              item !== null &&
                              item.description && (
                                <p className="text-sm text-white/60 mt-1 line-clamp-2">
                                  {item.description}
                                </p>
                              )}
                          </div>
                          {typeof item === "object" &&
                            item !== null &&
                            item.price && (
                              <div className="flex-shrink-0">
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  ${item.price}
                                </span>
                              </div>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-6 sm:p-8 text-center">
                  <div className="w-12 h-12 mx-auto mb-4 bg-white/5 rounded-lg flex items-center justify-center">
                    <svg
                      className="w-6 h-6 text-white/40"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                      />
                    </svg>
                  </div>
                  <h3 className="text-sm font-medium text-white mb-1">
                    No menu items available
                  </h3>
                  <p className="text-sm text-white/50">
                    Menu items will appear here once you complete the onboarding
                    process
                  </p>
                </div>
              )}
            </div>
            <p className="mt-3 text-sm text-white/60">
              Your menu items are displayed here. To update them, you can
              re-upload your menu through the onboarding process.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Special Instructions
            </label>
            <textarea
              value={restaurant.specialInstructions}
              onChange={(e) =>
                handleInputChange("specialInstructions", e.target.value)
              }
              placeholder="Any special instructions for the AI agent when handling calls..."
              rows={3}
              className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
            />
            <p className="mt-2 text-sm text-white/60">
              Include any specific guidelines, policies, or procedures the AI
              agent should follow.
            </p>
          </div>
        </div>
      </div>

      {/* Customer Instructions */}
      <div className="bg-emerald-500/10 rounded-xl border border-emerald-500/20">
        <div className="px-4 sm:px-6 py-4">
          <h3 className="text-sm font-medium text-emerald-400 mb-3 flex items-center">
            <svg
              className="w-4 h-4 mr-2 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Instructions for Your Customers
          </h3>
          <div className="text-xs sm:text-sm text-emerald-300 space-y-2">
            <p className="font-medium">Tell your customers to:</p>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>
                Call{" "}
                <span className="font-mono font-medium bg-emerald-500/20 px-2 py-1 rounded text-emerald-400">
                  {process.env.NEXT_PUBLIC_VIRTUAL_NUMBER || "(555) 123-4567"}
                </span>
              </li>
              <li>
                When prompted, provide Business ID:{" "}
                <span className="font-mono font-medium bg-emerald-500/20 px-2 py-1 rounded text-emerald-400">
                  {restaurantId}
                </span>
              </li>
              <li>Place their order with the AI agent</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Save Section */}
      <div className="card-minimal rounded-xl">
        <div className="px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-sm font-medium text-white">Save Changes</h3>
              <p className="text-sm text-white/60 mt-1">
                Make sure to save your changes before leaving this page.
              </p>
            </div>
            <div className="flex-shrink-0">
              <Button
                className="w-full sm:w-auto hover:opacity-80 hover:bg-zinc-800 cursor-pointer"
                onClick={handleSave}
                loading={isLoading}
                disabled={isLoading}
              >
                {isLoading ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </div>

          {saveMessage && (
            <div
              className={`mt-4 p-3 rounded-lg ${
                saveMessage.type === "success"
                  ? "bg-emerald-500/10 border border-emerald-500/20"
                  : "bg-red-500/10 border border-red-500/20"
              }`}
            >
              <div className="flex items-center">
                <div
                  className={`flex-shrink-0 ${
                    saveMessage.type === "success"
                      ? "text-emerald-400"
                      : "text-red-400"
                  }`}
                >
                  {saveMessage.type === "success" ? (
                    <svg
                      className="h-4 w-4"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-4 w-4"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <div className="ml-3">
                  <p
                    className={`text-sm font-medium ${
                      saveMessage.type === "success"
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    {saveMessage.text}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-black border border-red-500/20 rounded-xl">
        <div className="bg-red-500/5 border-b border-red-500/20 px-4 sm:px-6 py-4">
          <h2 className="text-base font-semibold text-red-400">Danger Zone</h2>
          <p className="text-sm text-red-300 mt-1">
            Permanently delete your business data and reset the system.
          </p>
        </div>
        <div className="px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-sm font-medium text-white">
                Delete Business Data
              </h3>
              <p className="text-sm text-white/70 mt-1">
                This will permanently delete all your business data, calls,
                and orders. This action cannot be undone.
              </p>
            </div>
            <div className="flex-shrink-0">
              <Button
                variant="destructive"
                onClick={() => setShowDeleteModal(true)}
                disabled={isDeleting}
                className="w-full sm:w-auto cursor-pointer"
              >
                Delete All Data
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Business Data"
        message={`Are you sure you want to delete all data for business ID "${restaurantId}"? This will permanently delete your business information, all calls, and orders. This action cannot be undone.`}
        confirmText="Delete Everything"
        cancelText="Cancel"
        variant="danger"
        loading={isDeleting}
      />
    </div>
  );
};

export default SettingsSection;
