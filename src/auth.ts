import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  Post,
  Get,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  ConflictException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request, Response } from "express";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { Database } from "./database";
import { loginSchema, parse, registerSchema, User } from "./schemas";

export const cookieName = "accordbridge_session";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await derive(password, salt)).toString("hex")}`;
}
async function verify(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  const actual = await derive(password, salt);
  const bytes = Buffer.from(expected, "hex");
  return actual.length === bytes.length && timingSafeEqual(actual, bytes);
}
export type AuthRequest = Request & { user: User };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly db: Database) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token: unknown = req.cookies?.[cookieName];
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedException("Please sign in.");
    const result = await this.db.pool.query(
      "SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [digest(token)],
    );
    if (!result.rows.length) throw new UnauthorizedException("Please sign in.");
    req.user = result.rows[0];
    return true;
  }
}

@Controller("auth")
@Throttle({ default: { limit: 15, ttl: 60000 } })
export class AuthController {
  constructor(private readonly db: Database) {}
  private async session(user: User, req: Request, res: Response) {
    const token = randomBytes(32).toString("hex");
    await this.db.transaction(async (client) => {
      if (typeof req.cookies?.[cookieName] === "string")
        await client.query("DELETE FROM sessions WHERE token_hash=$1", [
          digest(req.cookies[cookieName]),
        ]);
      await client.query("DELETE FROM sessions WHERE expires_at<=now()");
      await client.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
        [digest(token), user.id],
      );
    });
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 86400000,
    });
    return { user };
  }
  @Post("register")
  async register(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = parse(registerSchema, body);
    const passwordHash = await hashPassword(data.password);
    let user: User;
    try {
      const result = await this.db.pool.query(
        "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4) RETURNING id,name,email",
        [randomUUID(), data.name, data.email, passwordHash],
      );
      user = result.rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new ConflictException(
          "An account already exists. Try signing in.",
        );
      throw error;
    }
    return this.session(user, req, res);
  }
  @Post("login")
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = parse(loginSchema, body);
    const result = await this.db.pool.query(
      "SELECT id,name,email,password_hash FROM users WHERE email=$1",
      [data.email],
    );
    const user = result.rows[0];
    // Spend the same password-derivation work even for unknown accounts.
    const valid = await verify(
      data.password,
      user?.password_hash ?? `${"0".repeat(32)}:${"0".repeat(128)}`,
    );
    if (!user || !valid)
      throw new UnauthorizedException("Email or password is incorrect.");
    return this.session(
      { id: user.id, name: user.name, email: user.email },
      req,
      res,
    );
  }
  @Get("me")
  @UseGuards(SessionGuard)
  me(@Req() req: AuthRequest) {
    return { user: req.user };
  }
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (typeof req.cookies?.[cookieName] === "string")
      await this.db.pool.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(req.cookies[cookieName]),
      ]);
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    return { ok: true };
  }
}
