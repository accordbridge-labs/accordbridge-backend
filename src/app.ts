import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { json, Request, Response, NextFunction } from "express";
import { Database } from "./database";
import { AuthController, SessionGuard } from "./auth";
import { ProjectsController } from "./projects";
import { TestnetController } from "./testnet";
import { WorkController } from "./work";
import { Stellar } from "./stellar";

@Controller("health")
class HealthController {
  constructor(private readonly db: Database) {}
  @Get() async get() {
    await this.db.pool.query("SELECT 1");
    return { status: "ok", payments: "disabled" };
  }
}
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 240 }])],
  controllers: [
    AuthController,
    ProjectsController,
    HealthController,
    TestnetController,
    WorkController,
  ],
  providers: [
    Database,
    Stellar,
    SessionGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
class AppModule {}

export async function createApp() {
  const origin = process.env.FRONTEND_ORIGIN;
  if (!origin || new URL(origin).origin !== origin)
    throw new Error("FRONTEND_ORIGIN must be an exact origin");
  if (process.env.NODE_ENV === "production" && !origin.startsWith("https://"))
    throw new Error("Production requires HTTPS");
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: ["error", "warn"],
  });
  app.setGlobalPrefix("api");
  app.use(helmet());
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("origin") !== origin ||
        req.get("x-accordbridge-request") !== "1")
    ) {
      res
        .status(403)
        .json({ message: "Request origin or anti-CSRF header is invalid." });
      return;
    }
    next();
  });
  app.use(json({ limit: "64kb" }));
  app.use(cookieParser());
  app.enableShutdownHooks();
  await app.init();
  return app;
}
