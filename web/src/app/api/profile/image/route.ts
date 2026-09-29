import { forwardProfile } from "@/lib/profile-proxy";

export async function GET(request: Request) {
  return forwardProfile(request, true);
}

export async function PUT(request: Request) {
  return forwardProfile(request, true);
}

export async function DELETE(request: Request) {
  return forwardProfile(request, true);
}
