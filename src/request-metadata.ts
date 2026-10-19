import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NextFunction, Request, Response } from "express";

export interface RequestRecord {
  requestId: string;
  method: string;
  route: string;
  status: number;
  elapsedMs: number;
}

// Caller IDs, raw URLs, request/response bodies and exception objects are never logged.
export function requestMetadata(
  write: (record: RequestRecord) => void = (record) =>
    console.log(JSON.stringify(record)),
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const started = performance.now();
    res.setHeader("X-Request-ID", requestId);
    res.once("finish", () => {
      const template = req.route?.path;
      write({
        requestId,
        method: [
          "GET",
          "HEAD",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
          "OPTIONS",
        ].includes(req.method)
          ? req.method
          : "OTHER",
        route: typeof template === "string" ? template : "unmatched",
        status: res.statusCode,
        elapsedMs: Math.round(performance.now() - started),
      });
    });
    next();
  };
}
