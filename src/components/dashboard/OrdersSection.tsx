import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import CurrentOrders from "./CurrentOrders";
import PastOrders from "./PastOrders";
import DeliveryStatusUI from "./DeliveryStatusUI";
import { ShoppingBag, History, Clock, Truck } from "lucide-react";
import { useOrders } from "@/contexts";
import type { BranchDeliveryMetrics } from "@/lib/delivery/types";

export interface OrdersSectionProps {
  tabId: "orders";
}

type OrdersTabType = "current" | "past" | "delivery";

/**
 * Orders section component that manages current, past, and delivery orders
 * Shows order counts and provides navigation between active, historical, and delivery views
 * 
 * @requirements 14.6 - Display orders grouped by delivery status in branch dashboard
 * @requirements 14.7 - Show average delivery time metrics
 */
const OrdersSection: React.FC<OrdersSectionProps> = ({ tabId }) => {
  const [activeOrdersTab, setActiveOrdersTab] =
    useState<OrdersTabType>("current");

  const {
    state: { activeOrders, pastOrders },
  } = useOrders();

  // Get all orders with delivery status for the delivery tab
  // Combine active and past orders that have delivery tracking
  const deliveryOrders = useMemo(() => {
    const allOrders = [...activeOrders, ...pastOrders];
    // Filter orders that have delivery status set (i.e., orders being tracked for delivery)
    return allOrders.filter(order => order.deliveryStatus !== undefined);
  }, [activeOrders, pastOrders]);

  // Calculate delivery metrics for the branch
  // @requirements 14.7 - Calculate and display average delivery time per branch
  const deliveryMetrics = useMemo((): BranchDeliveryMetrics | undefined => {
    const deliveredOrders = deliveryOrders.filter(
      order => order.deliveryStatus === 'delivered' && order.dispatchedAt && order.deliveredAt
    );
    const failedOrders = deliveryOrders.filter(order => order.deliveryStatus === 'failed');

    if (deliveredOrders.length === 0 && failedOrders.length === 0) {
      return undefined;
    }

    // Calculate delivery times in minutes
    const deliveryTimes = deliveredOrders.map(order => {
      const dispatchedAt = order.dispatchedAt || 0;
      const deliveredAt = order.deliveredAt || 0;
      return Math.round((deliveredAt - dispatchedAt) / (1000 * 60));
    }).filter(time => time > 0);

    const averageDeliveryTime = deliveryTimes.length > 0
      ? Math.round(deliveryTimes.reduce((sum, time) => sum + time, 0) / deliveryTimes.length)
      : 0;

    const totalDeliveries = deliveredOrders.length + failedOrders.length;
    const successRate = totalDeliveries > 0
      ? Math.round((deliveredOrders.length / totalDeliveries) * 100)
      : 0;

    return {
      branchId: deliveryOrders[0]?.branchId || '',
      averageDeliveryTime,
      totalDeliveries,
      failedDeliveries: failedOrders.length,
      successRate,
      fastestDelivery: deliveryTimes.length > 0 ? Math.min(...deliveryTimes) : undefined,
      slowestDelivery: deliveryTimes.length > 0 ? Math.max(...deliveryTimes) : undefined,
    };
  }, [deliveryOrders]);

  // Count active deliveries (not delivered or failed)
  const activeDeliveryCount = useMemo(() => {
    return deliveryOrders.filter(order => 
      order.deliveryStatus && 
      !['delivered', 'failed'].includes(order.deliveryStatus)
    ).length;
  }, [deliveryOrders]);

  const ordersTabs = [
    {
      id: "current" as OrdersTabType,
      label: "Current Orders",
      icon: Clock,
      count: activeOrders.length,
    },
    {
      id: "past" as OrdersTabType,
      label: "Order History",
      icon: History,
      count: pastOrders.length,
    },
    {
      id: "delivery" as OrdersTabType,
      label: "Delivery",
      icon: Truck,
      count: activeDeliveryCount,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-white/5 rounded-lg border border-white/10">
            <ShoppingBag className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-base font-semibold text-white">Orders</h2>
        </div>
        <div className="flex items-center space-x-2 bg-emerald-500/10 px-4 py-2 rounded-lg border border-emerald-500/20">
          <div className="w-2 h-2 bg-emerald-400 rounded-full"></div>
          <span className="text-sm font-medium text-emerald-400">
            {activeOrders.length} Active
          </span>
        </div>
      </div>

      <div className="inline-flex bg-black border border-white/10 rounded-lg p-0.5">
        <nav className="flex">
          {ordersTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveOrdersTab(tab.id)}
                className={cn(
                  "relative px-3 py-1.5 text-sm font-medium transition-all duration-200",
                  "focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-black",
                  "cursor-pointer rounded-md",
                  activeOrdersTab === tab.id
                    ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500/30"
                    : "text-white/70 hover:text-white hover:bg-white/5"
                )}
              >
                <div className="flex items-center space-x-1.5">
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  <div
                    className={cn(
                      "px-2 py-0.5 rounded-full text-xs font-medium",
                      activeOrdersTab === tab.id
                        ? "bg-emerald-500/20 text-emerald-500"
                        : "bg-white/10 text-white/60"
                    )}
                  >
                    {tab.count}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      <div>
        {activeOrdersTab === "current" && <CurrentOrders />}
        {activeOrdersTab === "past" && <PastOrders />}
        {activeOrdersTab === "delivery" && (
          <DeliveryStatusUI
            orders={deliveryOrders}
            metrics={deliveryMetrics}
            showMetrics={true}
          />
        )}
      </div>
    </div>
  );
};

export default OrdersSection;
