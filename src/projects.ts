import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { AuthRequest, SessionGuard } from "./auth";
import { Database } from "./database";
import {
  acceptSchema,
  agreementSchema,
  createSchema,
  parse,
  publishSchema,
  saveSchema,
} from "./schemas";

@Controller("projects")
@UseGuards(SessionGuard)
export class ProjectsController {
  constructor(private readonly db: Database) {}
  private async member(client: PoolClient, id: string, userId: string) {
    const result = await client.query(
      "SELECT * FROM projects WHERE id=$1 AND (client_id=$2 OR freelancer_id=$2) FOR UPDATE",
      [id, userId],
    );
    if (!result.rows.length) throw new NotFoundException("Project not found.");
    return result.rows[0];
  }
  private editable(
    project: { funding_started: boolean; current_version: number },
    expectedVersion: number,
  ) {
    if (project.funding_started)
      throw new ConflictException("Funding has started; terms are locked.");
    if (project.current_version !== expectedVersion)
      throw new ConflictException(
        "The agreement changed. Reload the project before continuing.",
      );
  }
  @Get()
  async list(@Req() req: AuthRequest) {
    const result = await this.db.pool.query(
      `SELECT p.id,p.current_version AS "currentVersion",p.updated_at AS "updatedAt",v.agreement->>'title' AS title,
      CASE WHEN p.client_id=$1 THEN 'client' ELSE 'freelancer' END AS role,
      c.name AS "clientName",f.name AS "freelancerName",d.agreement->>'title' AS "draftTitle"
      FROM projects p JOIN users c ON c.id=p.client_id JOIN users f ON f.id=p.freelancer_id
      LEFT JOIN agreement_versions v ON v.project_id=p.id AND v.version=p.current_version
      LEFT JOIN drafts d ON d.project_id=p.id AND d.user_id=$1
      WHERE p.client_id=$1 OR p.freelancer_id=$1 ORDER BY p.updated_at DESC`,
      [req.user.id],
    );
    return { projects: result.rows };
  }
  @Post()
  async create(@Body() body: unknown, @Req() req: AuthRequest) {
    const data = parse(createSchema, body);
    if (data.counterpartyId === req.user.id)
      throw new ForbiddenException(
        "Choose a different account for the other participant.",
      );
    const id = randomUUID();
    await this.db.transaction(async (client) => {
      const counterparty = await client.query(
        "SELECT id FROM users WHERE id=$1",
        [data.counterpartyId],
      );
      if (!counterparty.rows.length)
        throw new NotFoundException(
          "Counterparty account not found. Ask them for their account ID.",
        );
      await client.query(
        "INSERT INTO projects(id,client_id,freelancer_id,created_by) VALUES($1,$2,$3,$4)",
        [
          id,
          data.role === "client" ? req.user.id : data.counterpartyId,
          data.role === "freelancer" ? req.user.id : data.counterpartyId,
          req.user.id,
        ],
      );
      await client.query(
        "INSERT INTO drafts(project_id,user_id,agreement,base_version) VALUES($1,$2,$3,0)",
        [id, req.user.id, data.agreement],
      );
    });
    return { id };
  }
  @Get(":id")
  async get(@Param("id", ParseUUIDPipe) id: string, @Req() req: AuthRequest) {
    return this.db.transaction(async (client) => {
      const project = await this.member(client, id, req.user.id);
      const participants = await client.query(
        "SELECT id,name FROM users WHERE id=ANY($1::uuid[])",
        [[project.client_id, project.freelancer_id]],
      );
      const versions = await client.query(
        `SELECT v.version,v.agreement,v.published_by AS "publishedBy",v.published_at AS "publishedAt",
        COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',a.user_id,'role',a.role,'acceptedAt',a.accepted_at)) FROM acceptances a WHERE a.project_id=v.project_id AND a.version=v.version),'[]'::jsonb) AS acceptances
        FROM agreement_versions v WHERE project_id=$1 ORDER BY version DESC`,
        [id],
      );
      const draft = await client.query(
        'SELECT agreement,base_version AS "baseVersion",revision,updated_at AS "updatedAt" FROM drafts WHERE project_id=$1 AND user_id=$2',
        [id, req.user.id],
      );
      return {
        id,
        currentVersion: project.current_version,
        fundingStarted: project.funding_started,
        role: project.client_id === req.user.id ? "client" : "freelancer",
        client: participants.rows.find((item) => item.id === project.client_id),
        freelancer: participants.rows.find(
          (item) => item.id === project.freelancer_id,
        ),
        versions: versions.rows,
        draft: draft.rows[0] ?? null,
      };
    });
  }
  @Put(":id/draft")
  async save(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const data = parse(saveSchema, body);
    return this.db.transaction(async (client) => {
      const project = await this.member(client, id, req.user.id);
      this.editable(project, data.expectedVersion);
      const previous = await client.query(
        "SELECT revision,base_version FROM drafts WHERE project_id=$1 AND user_id=$2",
        [id, req.user.id],
      );
      if ((previous.rows[0]?.revision ?? 0) !== data.expectedRevision)
        throw new ConflictException(
          "This draft changed in another tab. Reload before saving.",
        );
      const result = await client.query(
        `INSERT INTO drafts(project_id,user_id,agreement,base_version) VALUES($1,$2,$3,$4)
        ON CONFLICT(project_id,user_id) DO UPDATE SET agreement=EXCLUDED.agreement,base_version=EXCLUDED.base_version,revision=drafts.revision+1,updated_at=now()
        RETURNING revision`,
        [id, req.user.id, data.agreement, data.expectedVersion],
      );
      await client.query("UPDATE projects SET updated_at=now() WHERE id=$1", [
        id,
      ]);
      return { revision: result.rows[0].revision };
    });
  }
  @Post(":id/publish")
  async publish(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const data = parse(publishSchema, body);
    return this.db.transaction(async (client) => {
      const project = await this.member(client, id, req.user.id);
      this.editable(project, data.expectedVersion);
      const result = await client.query(
        "SELECT * FROM drafts WHERE project_id=$1 AND user_id=$2",
        [id, req.user.id],
      );
      const draft = result.rows[0];
      if (
        !draft ||
        draft.revision !== data.expectedRevision ||
        draft.base_version !== data.expectedVersion
      )
        throw new ConflictException(
          "The draft is stale. Reload and review it before publishing.",
        );
      const agreement = parse(agreementSchema, draft.agreement);
      const version = project.current_version + 1;
      await client.query(
        "INSERT INTO agreement_versions(project_id,version,agreement,published_by) VALUES($1,$2,$3,$4)",
        [id, version, agreement, req.user.id],
      );
      await client.query(
        "UPDATE projects SET current_version=$2,updated_at=now() WHERE id=$1",
        [id, version],
      );
      await client.query(
        "DELETE FROM drafts WHERE project_id=$1 AND user_id=$2",
        [id, req.user.id],
      );
      // Old acceptances remain attached to old versions. New versions have no acceptance.
      return { version };
    });
  }
  @Post(":id/accept")
  async accept(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const data = parse(acceptSchema, body);
    return this.db.transaction(async (client) => {
      const project = await this.member(client, id, req.user.id);
      this.editable(project, data.version);
      const role = project.client_id === req.user.id ? "client" : "freelancer";
      await client.query(
        "INSERT INTO acceptances(project_id,version,user_id,role) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [id, data.version, req.user.id, role],
      );
      return { version: data.version, role, accepted: true };
    });
  }
}
