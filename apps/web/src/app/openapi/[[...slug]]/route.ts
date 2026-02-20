import { handleApiRequest } from "@glare/api";

export const runtime = "nodejs";

async function handler(request: Request) {
  return handleApiRequest(request);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
