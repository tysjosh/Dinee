type LogLevel = "info" | "warn" | "error" | "debug";

interface LogContext {
  callId?: string;
  requestId?: string;
  orderId?: string;
  partnerId?: string;
  eventId?: string;
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
