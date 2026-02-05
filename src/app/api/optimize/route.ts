import { NextRequest, NextResponse } from "next/server";
import { optimizeRoute } from "@/lib/optimize";

export async function POST(req: NextRequest) {
  try {
    const { coordinates } = await req.json();
    
    if (!coordinates || coordinates.length < 2) {
      return NextResponse.json({ error: "At least 2 points required" }, { status: 400 });
    }

    const result = await optimizeRoute(coordinates);
    
    if (!result) {
      return NextResponse.json({ error: "Optimization failed" }, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
