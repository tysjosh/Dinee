type LogLevel = "info" | "warn" | "error" | "debug";

interface LogContext {
  callId?: string;
  requestId?: string;
  orderId?: string;
  partnerId?: string;
  eventId?: string;
  correlationId?: string;  // Voice session correlation (Req 17.10)
  tenantId?: string;       // X-Tenant-Id value (Req 4.2)
  vertical?: string;       // "restaurant" | "logistics" (Req 4.2)
  endpoint?: string;       // Request path (Req 4.2)
  method?: string;         // HTTP method (Req 4.2)
  resourceId?: string;     // shipmentId, riderId, etc. (Req 4.2)
  [key: string]: unknown;
}

export function createLogger(module: string) {
  return {
    info: (message: string, ctx?: LogContext) =>
      emit("info", module, message, ctx),
    warn: (message: string, ctx?: LogContext) =>
      emit("warn", module, message, ctx),
    error: (message: string, ctx?: LogContext) =>
      emit("error", module, message, ctx),
    debug: (message: string, ctx?: LogContext) =>
      emit("debug", module, message, ctx),
  };
}

function emit(level: LogLevel, module: string, message: string, ctx?: LogContext) {
  const entry = {
    level,
    module,
    message,
    timestamp: new Date().toISOString(),
    ...ctx,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}
