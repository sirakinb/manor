import type { APIRoute } from "astro";
import { CRM_INTEGRATIONS_MARKDOWN, markdownResponse } from "../../agent-content";

export const GET: APIRoute = ({ request }) =>
  markdownResponse(CRM_INTEGRATIONS_MARKDOWN, request.method);
