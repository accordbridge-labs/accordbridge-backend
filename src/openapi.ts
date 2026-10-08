import { writeFileSync } from "node:fs";
import { z } from "zod";
import {
  acceptSchema,
  createSchema,
  draftSchema,
  loginSchema,
  publishSchema,
  registerSchema,
  saveSchema,
} from "./schemas";

const requests = {
  Register: registerSchema,
  Login: loginSchema,
  CreateProject: createSchema,
  SaveDraft: saveSchema,
  Publish: publishSchema,
  Accept: acceptSchema,
  Agreement: draftSchema,
};
const schema = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (value: unknown) => ({
  content: { "application/json": { schema: value } },
});
const responses = (success: number, value: unknown) => ({
  [success]: { description: "Success", ...json(value) },
  "400": { description: "Invalid fields" },
  "401": { description: "Sign-in required" },
  "403": { description: "Origin/header or action forbidden" },
  "404": { description: "Record not found or not accessible" },
  "409": {
    description: "Stale version/draft, locked terms or duplicate account",
  },
  "429": { description: "Too many requests" },
});
const object = (properties: object) => ({ type: "object", properties });
const user = object({
  id: { type: "string", format: "uuid" },
  name: { type: "string" },
  email: { type: "string", format: "email" },
});
const acceptance = object({
  userId: { type: "string", format: "uuid" },
  role: { enum: ["client", "freelancer"] },
  acceptedAt: { type: "string", format: "date-time" },
});
const version = object({
  version: { type: "integer" },
  agreement: schema("Agreement"),
  publishedBy: { type: "string", format: "uuid" },
  publishedAt: { type: "string", format: "date-time" },
  acceptances: { type: "array", items: acceptance },
});
const project = object({
  id: { type: "string", format: "uuid" },
  currentVersion: { type: "integer" },
  role: { enum: ["client", "freelancer"] },
  fundingStarted: { type: "boolean" },
  client: object({ id: { type: "string" }, name: { type: "string" } }),
  freelancer: object({ id: { type: "string" }, name: { type: "string" } }),
  versions: { type: "array", items: version },
  draft: {
    oneOf: [
      { type: "null" },
      object({
        agreement: schema("Agreement"),
        baseVersion: { type: "integer" },
        revision: { type: "integer" },
        updatedAt: { type: "string", format: "date-time" },
      }),
    ],
  },
});
function operation(
  summary: string,
  method: string,
  response: unknown,
  body?: string,
  authenticated = true,
) {
  return {
    summary,
    security: authenticated ? [{ session: [] }] : [],
    ...(body ? { requestBody: { required: true, ...json(schema(body)) } } : {}),
    ...(method !== "get"
      ? {
          parameters: [
            {
              in: "header",
              name: "Origin",
              required: true,
              schema: { type: "string" },
              description: "Must equal configured FRONTEND_ORIGIN",
            },
            {
              in: "header",
              name: "X-AccordBridge-Request",
              required: true,
              schema: { const: "1" },
            },
          ],
        }
      : {}),
    responses: responses(method === "post" ? 201 : 200, response),
  };
}
const idParameter = {
  in: "path",
  name: "id",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const document = {
  openapi: "3.1.0",
  info: {
    title: "AccordBridge workspace API",
    version: "0.1.0",
    description:
      "Development workspace. No payment endpoints. Sessions use HttpOnly cookies; unsafe requests require an exact allowed Origin and X-AccordBridge-Request: 1.",
  },
  servers: [{ url: "http://127.0.0.1:4000/api" }],
  components: {
    securitySchemes: {
      session: { type: "apiKey", in: "cookie", name: "accordbridge_session" },
    },
    schemas: {
      ...Object.fromEntries(
        Object.entries(requests).map(([name, value]) => [
          name,
          z.toJSONSchema(value),
        ]),
      ),
      User: user,
      Project: project,
    },
  },
  paths: {
    "/health": {
      get: operation(
        "Read database readiness",
        "get",
        object({ status: { const: "ok" }, payments: { const: "disabled" } }),
        undefined,
        false,
      ),
    },
    "/auth/register": {
      post: operation(
        "Create an account and session",
        "post",
        object({ user: schema("User") }),
        "Register",
        false,
      ),
    },
    "/auth/login": {
      post: operation(
        "Sign in and rotate the browser session",
        "post",
        object({ user: schema("User") }),
        "Login",
        false,
      ),
    },
    "/auth/logout": {
      post: operation(
        "Revoke session and clear cookie",
        "post",
        object({ ok: { const: true } }),
        undefined,
        false,
      ),
    },
    "/auth/me": {
      get: operation(
        "Read the signed-in account",
        "get",
        object({ user: schema("User") }),
      ),
    },
    "/projects": {
      get: operation(
        "List only projects this account participates in",
        "get",
        object({
          projects: {
            type: "array",
            items: object({
              id: { type: "string" },
              title: { type: ["string", "null"] },
              draftTitle: { type: ["string", "null"] },
              currentVersion: { type: "integer" },
              role: { type: "string" },
              clientName: { type: "string" },
              freelancerName: { type: "string" },
              updatedAt: { type: "string" },
            }),
          },
        }),
      ),
      post: operation(
        "Create a project with an existing account and private draft",
        "post",
        object({ id: { type: "string", format: "uuid" } }),
        "CreateProject",
      ),
    },
    "/projects/{id}": {
      parameters: [idParameter],
      get: operation(
        "Read terms, versions, acceptances and only the caller’s private draft",
        "get",
        schema("Project"),
      ),
    },
    "/projects/{id}/draft": {
      parameters: [idParameter],
      put: operation(
        "Save private draft with optimistic concurrency",
        "put",
        object({ revision: { type: "integer" } }),
        "SaveDraft",
      ),
    },
    "/projects/{id}/publish": {
      parameters: [idParameter],
      post: operation(
        "Validate and publish a saved draft as a new immutable version",
        "post",
        object({ version: { type: "integer" } }),
        "Publish",
      ),
    },
    "/projects/{id}/accept": {
      parameters: [idParameter],
      post: operation(
        "Accept the current version as the authenticated participant",
        "post",
        object({
          version: { type: "integer" },
          role: { type: "string" },
          accepted: { const: true },
        }),
        "Accept",
      ),
    },
  },
};
writeFileSync("docs/openapi.json", JSON.stringify(document, null, 2) + "\n");
