import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "Retirement Planner - Plan Your Savings Across Multiple Account Types";

function publicShareHost(): string {
  const raw = String(import.meta.env.VITE_PUBLIC_HOSTNAME ?? "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
  if (!raw || !/^[a-z0-9.-]+$/.test(raw) || !raw.includes(".")) return "";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) return "";
  if (
    raw === "vercel.app" ||
    raw.endsWith(".vercel.app") ||
    raw === "vercel.com" ||
    raw.endsWith(".vercel.com")
  ) {
    return "";
  }
  return raw;
}

export const Route = createRootRoute({
  head: () => {
    const host = publicShareHost();
    const xBanner = host ? `https://${host}/x-banner.jpg` : "";
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: APP_NAME },
        {
          name: "description",
          content:
            "Plan your retirement savings across Roth IRA, HSA, 401(k), and taxable brokerage accounts with year-by-year projections and interactive charts.",
        },
        { name: "theme-color", content: "#0b60ea" },
        ...(xBanner ? [{ property: "x:game:image", content: xBanner }] : []),
      ],
      links: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&display=swap",
        },
        { rel: "stylesheet", href: appCss },
        { rel: "manifest", href: "/__grok/manifest.webmanifest" },
        { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      ],
    };
  },
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
