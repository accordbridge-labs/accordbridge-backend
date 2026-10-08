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
  Req,
  UseGuards,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { AuthRequest, SessionGuard } from "./auth";
import { Database } from "./database";
import { parse, submissionSchema, reviewSchema } from "./schemas";

export async function submissions(
  client: Pick<PoolClient, "query">,
  id: string,
) {
  return (
    await client.query(
      `SELECT s.id,s.agreement_version AS "agreementVersion",s.sequence,s.author_id AS "authorId",s.notes,s.links,
    s.submitted_at AS "submittedAt",s.review_due_at AS "reviewDueAt",
    CASE WHEN r.submission_id IS NULL THEN NULL ELSE jsonb_build_object('decision',r.decision,'feedback',r.feedback,'reviewerId',r.reviewer_id,'reviewedAt',r.reviewed_at) END AS review
    FROM work_submissions s LEFT JOIN work_reviews r ON r.submission_id=s.id WHERE s.project_id=$1 ORDER BY s.sequence DESC`,
      [id],
    )
  ).rows;
}
export async function approvedWork(
  client: Pick<PoolClient, "query">,
  id: string,
) {
  const rows = await submissions(client, id);
  return rows[0]?.review?.decision === "approved"
    ? (rows[0].id as string)
    : null;
}
@Controller("projects/:id/work")
@UseGuards(SessionGuard)
export class WorkController {
  constructor(private readonly db: Database) {}
  private async member(client: PoolClient, id: string, user: string) {
    const p = (
      await client.query(
        "SELECT * FROM projects WHERE id=$1 AND (client_id=$2 OR freelancer_id=$2) FOR UPDATE",
        [id, user],
      )
    ).rows[0];
    if (!p) throw new NotFoundException("Project not found.");
    return p;
  }
  private async ready(client: PoolClient, id: string, version: number) {
    const escrow = (
      await client.query("SELECT * FROM testnet_escrows WHERE project_id=$1", [
        id,
      ])
    ).rows[0];
    if (
      !escrow ||
      escrow.agreement_version !== version ||
      escrow.chain_state?.status !== 1 ||
      !escrow.checked_at ||
      Date.now() - new Date(escrow.checked_at).getTime() > 300000
    )
      throw new ConflictException(
        "Check transaction & chain state first. Work requires a funded first milestone verified within five minutes.",
      );
    if (
      (
        await client.query(
          "SELECT id FROM testnet_intents WHERE project_id=$1 AND state IN ('prepared','submitted')",
          [id],
        )
      ).rowCount
    )
      throw new ConflictException(
        "Resolve the pending testnet transaction before submitting or reviewing work.",
      );
  }
  @Get() async get(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.db.transaction(async (client) => {
      const p = await this.member(client, id, req.user.id);
      let canAct = true;
      try {
        await this.ready(client, id, p.current_version);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        canAct = false;
      }
      return { canAct, submissions: await submissions(client, id) };
    });
  }
  @Post("submissions") async submit(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const data = parse(submissionSchema, body);
    return this.db.transaction(async (client) => {
      const p = await this.member(client, id, req.user.id);
      if (p.freelancer_id !== req.user.id)
        throw new ForbiddenException("Only the freelancer can submit work.");
      if (p.current_version !== data.version)
        throw new ConflictException(
          "The agreement changed. Refresh before submitting.",
        );
      await this.ready(client, id, data.version);
      const history = await submissions(client, id),
        latest = history[0];
      if ((latest?.id ?? null) !== data.expectedLatestId)
        throw new ConflictException(
          "A submission already changed. Refresh to see the saved version before retrying.",
        );
      if (latest && latest.review?.decision !== "revision_requested")
        throw new ConflictException(
          "The latest submission must receive a revision request before replacement.",
        );
      const agreement = (
        await client.query(
          "SELECT agreement FROM agreement_versions WHERE project_id=$1 AND version=$2",
          [id, data.version],
        )
      ).rows[0].agreement;
      const submissionId = randomUUID();
      await client.query(
        "INSERT INTO work_submissions(id,project_id,agreement_version,sequence,author_id,notes,links,review_due_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+($8 * interval '1 day'))",
        [
          submissionId,
          id,
          data.version,
          history.length + 1,
          req.user.id,
          data.notes,
          JSON.stringify(data.links),
          agreement.reviewDays,
        ],
      );
      await client.query("UPDATE projects SET updated_at=now() WHERE id=$1", [
        id,
      ]);
      return { id: submissionId };
    });
  }
  @Post("reviews") async review(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const data = parse(reviewSchema, body);
    return this.db.transaction(async (client) => {
      const p = await this.member(client, id, req.user.id);
      if (p.client_id !== req.user.id)
        throw new ForbiddenException("Only the client can review work.");
      const history = await submissions(client, id),
        latest = history[0];
      if (!latest || latest.id !== data.submissionId)
        throw new ConflictException(
          "Review the latest submission. Refresh before continuing.",
        );
      if (latest.review) {
        if (
          latest.review.decision === data.decision &&
          latest.review.feedback === data.feedback
        )
          return { decision: data.decision };
        throw new ConflictException(
          "This submission already has a review. Decisions cannot be overwritten.",
        );
      }
      await this.ready(client, id, p.current_version);
      const agreement = (
        await client.query(
          "SELECT agreement FROM agreement_versions WHERE project_id=$1 AND version=$2",
          [id, p.current_version],
        )
      ).rows[0].agreement;
      if (
        data.decision === "revision_requested" &&
        history.filter((s) => s.review?.decision === "revision_requested")
          .length >= agreement.revisions
      )
        throw new ConflictException(
          "The agreed revision rounds are exhausted. Discuss a separate agreement or mutual refund; no dispute resolver is implemented.",
        );
      await client.query(
        "INSERT INTO work_reviews(submission_id,reviewer_id,decision,feedback) VALUES($1,$2,$3,$4)",
        [latest.id, req.user.id, data.decision, data.feedback],
      );
      await client.query("UPDATE projects SET updated_at=now() WHERE id=$1", [
        id,
      ]);
      return { decision: data.decision };
    });
  }
}
