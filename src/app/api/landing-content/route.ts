import { NextRequest } from "next/server";
import { handleOptionsRequest, corsResponse } from "@/middleware/cors";
import { requireTenantContext } from "@/middleware/tenantContext";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logger } from "@/utils/logger";

const DEFAULT_CONTENT = {
  appearance: {
    logo: "",
    heroBackground: "",
  },
  hero: { badge: "Official Training", heading: "Shape Your Future", subheading: "Training", ctaText: "Enroll Now", trustIndicators: [] },
  mission: "To provide accessible training",
  vision: "A community empowered through education",
  features: [
    { icon: "Wrench", title: "Practical", description: "Hands-on" },
    { icon: "Award", title: "Certified", description: "Credentials" },
    { icon: "Users2", title: "Expert", description: "Professional" },
    { icon: "Compass", title: "Guidance", description: "Support" },
  ],
  ctaBanner: { badge: "Start", heading: "Ready?", description: "Join now", ctaPrimaryText: "Enroll", ctaSecondaryText: "View" },
  contact: { address: "Bongabong", addressLine2: "Philippines", phone: "+63", email: "info@bmdc.edu.ph", facebook: "" },
  footer: { companyName: "BMDC", tagline: "Empowering" },
};

function extractTenantIdFromRequest(request: NextRequest): string | null {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) return null;

    const token = authHeader.replace("Bearer ", "");
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
    return payload.tenant_id || payload.sub?.split(":")[0] || null;
  } catch {
    return null;
  }
}

export function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export async function GET(request: NextRequest) {
  try {
    let tenantId: string | null = null;

    // Try to get tenant ID from auth token first (for admin/authenticated requests)
    tenantId = extractTenantIdFromRequest(request);

    // If no auth token (public request), try query param or fetch first tenant
    if (!tenantId) {
      const { searchParams } = new URL(request.url);
      tenantId = searchParams.get("tenantId");

      // If still no tenant ID, fetch the first tenant (default for public landing page)
      if (!tenantId) {
        const { data: tenants } = await supabaseAdmin.from("tenants").select("id").limit(1);
        if (tenants && tenants.length > 0) {
          tenantId = tenants[0].id;
          logger.info("[LANDING_CONTENT] Using first tenant for public landing page", { tenantId });
        }
      }
    }

    if (!tenantId) {
      logger.info("[LANDING_CONTENT] No tenant found, returning defaults");
      return corsResponse(
        { success: true, data: { content: DEFAULT_CONTENT, settingsId: null }, message: "OK" },
        request
      );
    }

    const { data, error } = await supabaseAdmin
      .from("cms_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) {
      logger.error("[LANDING_CONTENT] Database query failed", { tenantId, error });
      return corsResponse(
        { success: true, data: { content: DEFAULT_CONTENT, settingsId: null }, message: "OK" },
        request
      );
    }

    if (!data) {
      logger.info("[LANDING_CONTENT] No settings found for tenant, returning defaults", { tenantId });
      return corsResponse(
        { success: true, data: { content: DEFAULT_CONTENT, settingsId: null }, message: "OK" },
        request
      );
    }

    const settingsData = (data as any)?.settings_data as Record<string, unknown>;
    const content = (settingsData?.content as unknown) || DEFAULT_CONTENT;

    return corsResponse(
      { success: true, data: { content, settingsId: (data as any)?.id }, message: "OK" },
      request
    );
  } catch (error) {
    logger.error("[LANDING_CONTENT] GET error", { error });
    return corsResponse(
      { success: true, data: { content: DEFAULT_CONTENT, settingsId: null }, message: "OK" },
      request
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log("[DEBUG] POST /api/landing-content started");
    
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) {
      console.log("[DEBUG] Auth error:", ctxResult.error);
      return ctxResult.error;
    }

    const { tenantId, userId } = ctxResult.context;
    console.log("[DEBUG] Tenant context extracted:", { tenantId, userId });

    const body = await request.json();
    const { content } = body as { content?: unknown };

    console.log("[DEBUG] Request body parsed, content keys:", Object.keys(content as Record<string, unknown>));

    if (!content) {
      console.log("[DEBUG] Content is missing");
      return corsResponse({ success: false, error: "content is required" }, request, { status: 400 });
    }

    logger.info("[LANDING_CONTENT] POST received", { tenantId, userId });

    let processedContent = content as Record<string, unknown>;
    
    // Handle image uploads
    if (processedContent.appearance && typeof processedContent.appearance === "object") {
      const appearance = processedContent.appearance as Record<string, unknown>;
      const processedAppearance = { ...appearance };

      if (appearance.logo && typeof appearance.logo === "string" && appearance.logo.startsWith("data:")) {
        try {
          logger.info("[LANDING_CONTENT] Uploading logo image", { tenantId });
          const logoResponse = await fetch("http://localhost:3003/api/upload/tenant", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": request.headers.get("Authorization") || "",
            },
            body: JSON.stringify({
              file: appearance.logo,
              category: "images/cms",
              filename: "landing-logo.png",
              prefix: "cms",
            }),
          });

          if (logoResponse.ok) {
            const logoData = await logoResponse.json();
            processedAppearance.logo = logoData.data?.filePath || appearance.logo;
            logger.info("[LANDING_CONTENT] Logo uploaded successfully", { tenantId, filePath: logoData.data?.filePath });
          } else {
            logger.warn("[LANDING_CONTENT] Logo upload failed", { tenantId, status: logoResponse.status });
          }
        } catch (err) {
          logger.error("[LANDING_CONTENT] Logo upload error", { tenantId, error: err });
        }
      }

      if (appearance.heroBackground && typeof appearance.heroBackground === "string" && appearance.heroBackground.startsWith("data:")) {
        try {
          logger.info("[LANDING_CONTENT] Uploading hero background image", { tenantId });
          const heroResponse = await fetch("http://localhost:3003/api/upload/tenant", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": request.headers.get("Authorization") || "",
            },
            body: JSON.stringify({
              file: appearance.heroBackground,
              category: "images/cms",
              filename: "landing-hero-bg.jpg",
              prefix: "cms",
            }),
          });

          if (heroResponse.ok) {
            const heroData = await heroResponse.json();
            processedAppearance.heroBackground = heroData.data?.filePath || appearance.heroBackground;
            logger.info("[LANDING_CONTENT] Hero background uploaded successfully", { tenantId, filePath: heroData.data?.filePath });
          } else {
            logger.warn("[LANDING_CONTENT] Hero background upload failed", { tenantId, status: heroResponse.status });
          }
        } catch (err) {
          logger.error("[LANDING_CONTENT] Hero background upload error", { tenantId, error: err });
        }
      }

      processedContent.appearance = processedAppearance;
    }

    console.log("[DEBUG] About to save settings to database");

    // Prepare the settings data payload
    const settingsPayload = { content: processedContent };

    // Try to update first, then insert if it fails
    try {
      console.log("[DEBUG] Attempting update");
      const updateResult = await supabaseAdmin
        .from("cms_settings")
        .update({
          settings_data: settingsPayload,
          updated_by_admin_id: userId,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .select();

      console.log("[DEBUG] Update result:", { rowCount: updateResult.data?.length || 0, error: updateResult.error });

      // If no rows were updated, insert instead
      if (!updateResult.error && (!updateResult.data || updateResult.data.length === 0)) {
        console.log("[DEBUG] Update returned no rows, attempting insert");
        const insertResult = await supabaseAdmin
          .from("cms_settings")
          .insert({
            tenant_id: tenantId,
            settings_data: settingsPayload,
            updated_by_admin_id: userId,
          })
          .select();

        if (insertResult.error) {
          console.log("[DEBUG] Insert failed:", insertResult.error);
          logger.error("[LANDING_CONTENT] Database insert failed", { tenantId, error: insertResult.error });
          return corsResponse({ success: false, error: "Failed to save settings" }, request, { status: 500 });
        }

        console.log("[DEBUG] Insert successful");
      } else if (updateResult.error) {
        console.log("[DEBUG] Update failed:", updateResult.error);
        logger.error("[LANDING_CONTENT] Database update failed", { tenantId, error: updateResult.error });
        return corsResponse({ success: false, error: "Failed to save settings" }, request, { status: 500 });
      }
    } catch (err) {
      console.log("[DEBUG] Database operation exception:", err);
      logger.error("[LANDING_CONTENT] Database operation error", { tenantId, error: err });
      return corsResponse({ success: false, error: "Failed to save settings" }, request, { status: 500 });
    }

    logger.info("[LANDING_CONTENT] Settings saved successfully", { tenantId, userId });

    return corsResponse(
      { 
        success: true, 
        data: { 
          content: processedContent,
          settingsId: tenantId,
        },
        message: "Landing page content saved successfully"
      },
      request
    );
  } catch (error) {
    console.log("[DEBUG] Caught exception in POST:", error);
    logger.error("[LANDING_CONTENT] POST error", { error });
    return corsResponse({ success: false, error: "Internal server error" }, request, { status: 500 });
  }
}