import React, { useState } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { useCalls } from "@/contexts";
import TranscriptDisplay from "./TranscriptDisplay";
import {
  Phone,
  Clock,
  CheckCircle,
  XCircle,
  Utensils,
  PhoneCall,
  MessageSquare,
  History,
  Eye,
  ArrowUpRight,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PastCalls: React.FC = () => {
  const {
    state: { pastCalls, loading, error },
  } = useCalls();

  const [expandedCall, setExpandedCall] = useState<string | null>(null);

  const formatCallTime = (creationTime: number): string => {
    const date = new Date(creationTime);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatCallDate = (creationTime: number): string => {
    const date = new Date(creationTime);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    } else {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year:
          date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
      });
    }
  };

  const calculateCallDuration = (startTime?: number): string => {
    if (!startTime) return "Unknown";

    // Estimate duration based on creation time (this is a placeholder)
    // In a real app, you'd have an end time or duration field
    const estimatedDuration = Math.floor(Math.random() * 300) + 60; // 1-5 minutes
    const minutes = Math.floor(estimatedDuration / 60);
    const seconds = estimatedDuration % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="bg-black border border-white/10 rounded-lg p-6 text-center">
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/20 border-t-emerald-500"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <History className="w-3 h-3 text-emerald-500" />
              </div>
            </div>
            <p className="text-white/70 text-sm">Loading call history...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-black border border-red-500/20 rounded-lg p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-red-500/10 rounded-lg flex items-center justify-center border border-red-500/20">
          <XCircle className="w-8 h-8 text-red-400" />
        </div>
        <h3 className="text-base font-semibold text-white mb-2">
          Connection Error
        </h3>
        <p className="text-white/70 text-sm">
          Unable to load call history: {error}
        </p>
      </div>
    );
  }

  if (pastCalls.length === 0) {
    return (
      <div className="bg-black border border-white/10 rounded-xl p-12">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
            <History className="w-10 h-10 text-white/60" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">
            No Call History Yet
          </h3>
          <p className="text-white/70 max-w-md mx-auto mb-6 leading-relaxed text-sm">
            Completed calls will appear here with full transcripts and order
            details. Your call history helps track customer interactions and
            improve service.
          </p>
          <div className="inline-flex items-center space-x-3 bg-emerald-500/10 px-6 py-3 rounded-lg border border-emerald-500/20">
            <PhoneCall className="w-5 h-5 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-400">
              Ready for incoming calls
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-white/5 rounded-lg border border-white/10">
            <History className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-base font-semibold text-white">Call History</h2>
        </div>
        <div className="flex items-center space-x-2 bg-emerald-500/10 px-4 py-2 rounded-lg border border-emerald-500/20">
          <Calendar className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-medium text-emerald-400">
            {pastCalls.length} Completed
          </span>
        </div>
      </div>

      {pastCalls.map((call) => {
        const isExpanded = expandedCall === call._id;
        const callDuration = calculateCallDuration(call.callStartTime);

        return (
          <Card
            key={call._id}
            className="bg-black border border-white/10 hover:border-white/20 transition-all duration-200 rounded-xl overflow-hidden"
          >
            <CardHeader className="bg-white/5 border-b border-white/10">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
                <div className="flex items-center space-x-4">
                  <Badge
                    variant="success"
                    className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 px-2.5 py-1 text-xs font-medium"
                  >
                    <CheckCircle className="w-3 h-3 mr-1.5" />
                    COMPLETED
                  </Badge>
                  <div className="flex items-center space-x-1.5 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10">
                    <Clock className="w-3.5 h-3.5 text-white/60" />
                    <span className="font-mono text-xs font-medium text-white">
                      {callDuration}
                    </span>
                  </div>
                </div>
                <div className="flex items-center space-x-4 text-xs">
                  {call.orderId && (
                    <div className="flex items-center space-x-1.5 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                      <Utensils className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="font-medium text-emerald-400">
                        Order #{call.orderId}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center space-x-1.5 text-white/60">
                    <Calendar className="w-3.5 h-3.5" />
                    <span className="font-medium">
                      {formatCallDate(call._creationTime)} at{" "}
                      {formatCallTime(call._creationTime)}
                    </span>
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-6">
              <div className="space-y-6">
                {/* Call Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                    <div className="flex items-center space-x-1.5 mb-1.5">
                      <Phone className="w-3.5 h-3.5 text-white/60" />
                      <span className="font-medium text-white/60 text-xs">
                        Customer Phone
                      </span>
                    </div>
                    <div className="text-sm font-mono font-medium text-white">
                      {call.phoneNumber || "(555) 123-4567"}
                    </div>
                  </div>

                  <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                    <div className="flex items-center space-x-1.5 mb-1.5">
                      <Clock className="w-3.5 h-3.5 text-white/60" />
                      <span className="font-medium text-white/60 text-xs">
                        Call Duration
                      </span>
                    </div>
                    <div className="text-sm font-mono font-medium text-white">
                      {callDuration}
                    </div>
                  </div>

                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                    <div className="flex items-center space-x-1.5 mb-1.5">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="font-medium text-emerald-400 text-xs">
                        Outcome
                      </span>
                    </div>
                    <div className="text-sm font-medium text-emerald-400">
                      {call.orderId ? (
                        <span className="text-emerald-400">Order Placed</span>
                      ) : (
                        <span className="text-white/60">No Order</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Transcript Section */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-2">
                      <div className="p-1.5 bg-white/5 rounded-lg border border-white/10">
                        <MessageSquare className="w-3.5 h-3.5 text-white" />
                      </div>
                      <h4 className="text-sm font-medium text-white">
                        Call Transcript
                      </h4>
                    </div>
                    <button
                      onClick={() =>
                        setExpandedCall(isExpanded ? null : call._id)
                      }
                      className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/30 px-3 py-1.5 rounded-lg flex items-center space-x-1.5 text-xs font-medium transition-all duration-200"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{isExpanded ? "Hide" : "View"} Transcript</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="animate-fade-in">
                      <TranscriptDisplay
                        callId={call.callId}
                        callStartTime={call._creationTime}
                        isActive={false}
                      />
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default PastCalls;
