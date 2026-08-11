import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function addRecurrence(
  date: Date,
  recurrence: string,
): Date {
  const next = new Date(date);
  switch (recurrence) {
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      break;
    case "every_3_months":
      next.setMonth(next.getMonth() + 3);
      break;
    case "yearly":
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreLabel(s: number | null) {
  if (s === null) return "N/A";
  if (s >= 90) return "Excellent";
  if (s >= 80) return "Good";
  if (s >= 60) return "Needs Work";
  if (s >= 40) return "Poor";
  return "Critical";
}

function scoreColor(s: number | null) {
  if (s === null) return "#64748b";
  if (s >= 80) return "#059669";
  if (s >= 50) return "#d97706";
  return "#dc2626";
}

function buildEmailHtml(
  projectName: string,
  scanUrl: string,
  score: number | null,
  totalViolations: number,
  totalPasses: number,
  pagesScanned: number,
  severityCounts: Record<string, number>,
  reportUrl: string,
): string {
  const sc = score ?? 0;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">

<!-- Header -->
<tr><td style="background:#0f172a;padding:28px 32px">
  <table width="100%"><tr>
    <td><span style="display:inline-block;width:36px;height:36px;background:#10b981;border-radius:8px;color:#fff;font-size:18px;font-weight:800;text-align:center;line-height:36px">&#9741;</span></td>
    <td style="padding-left:12px;color:#fff;font-size:18px;font-weight:700">ADA Scanner</td>
    <td align="right" style="color:#94a3b8;font-size:13px">Scheduled Scan Report</td>
  </tr></table>
</td></tr>

<!-- Score -->
<tr><td style="padding:32px">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:24px">
  <tr>
    <td style="width:80px;text-align:center;vertical-align:top">
      <div style="width:64px;height:64px;border-radius:50%;background:${scoreColor(score)};color:#fff;font-size:24px;font-weight:800;line-height:64px;text-align:center;margin:0 auto">${sc}</div>
      <div style="font-size:11px;color:${scoreColor(score)};font-weight:600;margin-top:6px">${scoreLabel(score)}</div>
    </td>
    <td style="padding-left:20px;vertical-align:top">
      <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:4px">${esc(projectName)}</div>
      <div style="font-size:13px;color:#64748b;margin-bottom:12px">${esc(scanUrl)}</div>
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:20px"><span style="font-size:22px;font-weight:700;color:#0f172a">${totalViolations}</span><br><span style="font-size:11px;color:#64748b">Issues</span></td>
        <td style="padding-right:20px"><span style="font-size:22px;font-weight:700;color:#0f172a">${totalPasses}</span><br><span style="font-size:11px;color:#64748b">Passed</span></td>
        <td><span style="font-size:22px;font-weight:700;color:#0f172a">${pagesScanned}</span><br><span style="font-size:11px;color:#64748b">Pages</span></td>
      </tr></table>
    </td>
  </tr>
  </table>
</td></tr>

<!-- Severity breakdown -->
<tr><td style="padding:0 32px 24px">
  <div style="font-size:13px;font-weight:600;color:#0f172a;margin-bottom:12px">Issue Breakdown</div>
  <table width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td style="padding:10px 12px;background:#fef2f2;border-radius:8px 0 0 8px;border:1px solid #fecaca;text-align:center">
      <div style="font-size:18px;font-weight:700;color:#dc2626">${severityCounts.critical || 0}</div>
      <div style="font-size:10px;color:#dc2626;font-weight:600">Critical</div>
    </td>
    <td style="padding:10px 12px;background:#fff7ed;border-top:1px solid #fed7aa;border-bottom:1px solid #fed7aa;text-align:center">
      <div style="font-size:18px;font-weight:700;color:#ea580c">${severityCounts.serious || 0}</div>
      <div style="font-size:10px;color:#ea580c;font-weight:600">Serious</div>
    </td>
    <td style="padding:10px 12px;background:#fffbeb;border-top:1px solid #fde68a;border-bottom:1px solid #fde68a;text-align:center">
      <div style="font-size:18px;font-weight:700;color:#d97706">${severityCounts.moderate || 0}</div>
      <div style="font-size:10px;color:#d97706;font-weight:600">Moderate</div>
    </td>
    <td style="padding:10px 12px;background:#eff6ff;border-radius:0 8px 8px 0;border:1px solid #bfdbfe;text-align:center">
      <div style="font-size:18px;font-weight:700;color:#2563eb">${severityCounts.minor || 0}</div>
      <div style="font-size:10px;color:#2563eb;font-weight:600">Minor</div>
    </td>
  </tr>
  </table>
</td></tr>

<!-- CTA -->
<tr><td style="padding:0 32px 32px;text-align:center">
  <a href="${esc(reportUrl)}" style="display:inline-block;padding:14px 36px;background:#10b981;color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">View Full Report</a>
</td></tr>

<!-- Footer -->
<tr><td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">
  <div style="font-size:11px;color:#94a3b8">This is an automated scan report from ADA Scanner. You received this because a recurring scan was scheduled for ${esc(projectName)}.</div>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date().toISOString();
    const { data: dueSchedules, error: fetchErr } = await supabase
      .from("scheduled_scans")
      .select("*, projects(*)")
      .eq("status", "active")
      .lte("next_scan_at", now);

    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!dueSchedules || dueSchedules.length === 0) {
      return new Response(
        JSON.stringify({ message: "No due schedules", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: { scheduleId: string; status: string; scanId?: string }[] = [];

    for (const schedule of dueSchedules) {
      const project = schedule.projects;
      if (!project) {
        results.push({ scheduleId: schedule.id, status: "skipped_no_project" });
        continue;
      }

      try {
        // 1. Trigger scan via internal call to ada-scan
        const scanResp = await fetch(`${supabaseUrl}/functions/v1/ada-scan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({ url: project.url, maxDepth: 3 }),
        });

        if (!scanResp.ok) {
          results.push({ scheduleId: schedule.id, status: "scan_trigger_failed" });
          continue;
        }

        const { scanId } = await scanResp.json();

        // 2. Poll until completed or failed (max ~10 minutes)
        let scanData = null;
        const maxAttempts = 120;
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise((r) => setTimeout(r, 5000));

          const pollResp = await fetch(
            `${supabaseUrl}/functions/v1/ada-scan/${scanId}`,
            {
              headers: { Authorization: `Bearer ${supabaseKey}` },
            },
          );

          if (!pollResp.ok) continue;
          const data = await pollResp.json();
          if (data.scan?.status === "completed") {
            scanData = data;
            break;
          }
          if (data.scan?.status === "failed") break;
        }

        if (!scanData) {
          results.push({ scheduleId: schedule.id, status: "scan_timeout_or_failed", scanId });
          continue;
        }

        // 3. Update project's last_scan_id
        await supabase
          .from("projects")
          .update({ last_scan_id: scanId })
          .eq("id", project.id);

        // 4. Build severity counts
        const severityCounts: Record<string, number> = {
          critical: 0,
          serious: 0,
          moderate: 0,
          minor: 0,
        };
        (scanData.results || []).forEach((r: { impact: string }) => {
          if (r.impact in severityCounts) severityCounts[r.impact]++;
        });

        // 5. Build report URL (deep link into the app)
        const appUrl = Deno.env.get("APP_URL") || supabaseUrl.replace(".supabase.co", ".netlify.app");
        const reportUrl = `${appUrl}?scan=${scanId}`;

        // 6. Send email via Resend (if API key is available)
        const resendKey = Deno.env.get("RESEND_API_KEY");
        if (resendKey) {
          const emailHtml = buildEmailHtml(
            project.name,
            scanData.scan.url,
            scanData.scan.score,
            scanData.scan.total_violations || 0,
            scanData.scan.total_passes || 0,
            scanData.scan.pages_scanned || (scanData.pages || []).length,
            severityCounts,
            reportUrl,
          );

          const emailResp = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${resendKey}`,
            },
            body: JSON.stringify({
              from: Deno.env.get("EMAIL_FROM") || "ADA Scanner <onboarding@resend.dev>",
              to: [schedule.email],
              subject: `ADA Scan Report: ${project.name} — Score ${scanData.scan.score ?? "N/A"}/100`,
              html: emailHtml,
            }),
          });

          if (!emailResp.ok) {
            console.error("Email send failed:", await emailResp.text());
          }
        } else {
          console.warn("RESEND_API_KEY not set — skipping email for schedule", schedule.id);
        }

        // 7. Advance next_scan_at and update last_scan_id
        const nextDate = addRecurrence(
          new Date(schedule.next_scan_at),
          schedule.recurrence,
        );
        await supabase
          .from("scheduled_scans")
          .update({
            next_scan_at: nextDate.toISOString(),
            last_scan_id: scanId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", schedule.id);

        results.push({ scheduleId: schedule.id, status: "completed", scanId });
      } catch (err) {
        console.error("Schedule processing error:", err);
        results.push({ scheduleId: schedule.id, status: "error" });
      }
    }

    return new Response(
      JSON.stringify({ processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
