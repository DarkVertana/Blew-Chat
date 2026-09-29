import { forwardProfile } from "@/lib/profile-proxy";

export async function PUT(request: Request) {
  return forwardProfile(request);
}
