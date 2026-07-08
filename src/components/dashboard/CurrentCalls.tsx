import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { useCalls } from "@/contexts";
import TranscriptDisplay from "./TranscriptDisplay";
import {
  Phone,
  Clock,
  MapPin,
  Utensils,
  PhoneCall,
  MessageSquare,
  Activity,
  Eye,
  ArrowUpRight,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CurrentCalls: React.FC = () => {
  const {
    state: { activeCalls: calls, loading, error },
  } = useCalls();

  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${remainingSeconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${remainingSeconds}s`;
    }
  };

  const calculateCallDuration = (creationTime: number): number => {
    const durationMs = currentTime - creationTime;
    return Math.floor(durationMs / 1000);
  };

  const formatCallStartTime = (creationTime: number): string => {
    const date = new Date(creationTime);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="bg-black border border-white/10 rounded-lg p-6 text-center">
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/20 border-t-emerald-500"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <PhoneCall className="w-3 h-3 text-emerald-500" />
              </div>
            </div>
            <p className="text-white/70 text-sm">Loading active calls...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-black border border-red-500/20 rounded-lg p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-red-500/10 rounded-lg flex items-center justify-center border border-red-500/20">
          <Phone className="w-8 h-8 text-red-400" />
        </div>
        <h3 className="text-base font-semibold text-white mb-2">
          Connection Error
        </h3>
        <p className="text-white/70 text-sm">
          Unable to load active calls: {error}
        </p>
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="bg-black border border-white/10 rounded-xl p-12">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
            <PhoneCall className="w-10 h-10 text-white/60" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">
            Ready for Incoming Calls
          </h3>
          <p className="text-white/70 max-w-md mx-auto mb-6 leading-relaxed text-sm">
            Your AI assistant is standing by to answer calls and help your
            customers. Active calls will appear here in real-time.
          </p>
          <div className="inline-flex items-center space-x-3 bg-emerald-500/10 px-6 py-3 rounded-lg border border-emerald-500/20">
            <div className="w-2 h-2 bg-emerald-400 rounded-full"></div>
            <span className="text-sm font-medium text-emerald-400">
              System Online & Ready
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
            <Activity className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-base font-semibold text-white">
            Active Customer Calls
          </h2>
        </div>
        <div className="flex items-center space-x-2 bg-emerald-500/10 px-4 py-2 rounded-lg border border-emerald-500/20">
          <div className="w-2 h-2 bg-emerald-400 rounded-full"></div>
          <span className="text-sm font-medium text-emerald-400">
            {calls.length} Active
          </span>
        </div>
      </div>

      {calls.map((call, index) => {
        const callDuration = calculateCallDuration(call._creationTime);

        return (
          <div key={call.callId}>
            <Card className="bg-black border border-white/10 hover:border-white/20 transition-all duration-200 rounded-xl overflow-hidden">
              <CardHeader className="bg-white/5 border-b border-white/10">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
                  <div className="flex items-center space-x-4">
                    <Badge
                      variant="success"
                      className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 px-2.5 py-1 text-xs font-medium"
                    >
                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full mr-1.5 animate-pulse"></div>
                      LIVE CALL
                    </Badge>
                    <div className="flex items-center space-x-1.5 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10">
                      <Clock className="w-3.5 h-3.5 text-white/60" />
                      <span className="font-mono text-xs font-medium text-white">
                        {formatDuration(callDuration)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4 text-xs">
                    <div className="flex items-center space-x-1.5 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                      <Utensils className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="font-medium text-emerald-400">
                        Order #
                        {call.orderId ? (
                          call.orderId
                        ) : (
                          <span className="inline-block w-12 h-3 bg-emerald-500/20 rounded ml-1"></span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 text-white/60">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="font-medium">
                        Started {formatCallStartTime(call._creationTime)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-6">
                <div className="space-y-6">
                  {/* Live Transcript Section */}
                  <div>
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="p-1.5 bg-white/5 rounded-lg border border-white/10">
                        <MessageSquare className="w-3.5 h-3.5 text-white" />
                      </div>
                      <h4 className="text-sm font-medium text-white">
                        Live Conversation
                      </h4>
                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
                    </div>
                    <TranscriptDisplay
                      callId={call.callId}
                      callStartTime={call._creationTime}
                    />
                  </div>

                  {/* Call Details Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                      <div className="flex items-center space-x-1.5 mb-1.5">
                        <Phone className="w-3.5 h-3.5 text-white/60" />
                        <span className="font-medium text-white/60 text-xs">
                          Customer Phone
                        </span>
                      </div>
                      <div className="text-sm font-mono font-medium text-white">
                        {call.phoneNumber || "Unknown"}
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
                        {formatDuration(callDuration)}
                      </div>
                    </div>

                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                      <div className="flex items-center space-x-1.5 mb-1.5">
                        <Zap className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="font-medium text-emerald-400 text-xs">
                          Order Status
                        </span>
                      </div>
                      <div className="text-sm font-medium text-emerald-400">
                        In Progress
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex flex-wrap gap-2 pt-3 border-t border-white/10">
                    <button
                      disabled={!call.orderId}
                      className={cn(
                        "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/30 px-3 py-1.5 rounded-lg flex items-center space-x-1.5 text-xs font-medium transition-all duration-200",
                        !call.orderId && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View Order Details</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })}
    </div>
  );
};

export default CurrentCalls;
